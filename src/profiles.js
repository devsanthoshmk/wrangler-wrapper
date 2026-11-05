const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  HOME,
  PROFILES_DIR,
  CONFIG_FILE,
  ACTIVE_PROFILE_FILE
} = require('./constants');
const {
  atomicWriteFileSync,
  atomicWriteJsonSync,
  readJsonSync,
  parseWranglerToml,
  findRealWrangler
} = require('./utils');
const { fetchCloudflareUser, fetchCloudflareAccounts } = require('./cloudflare');

function ensureDirectories() {
  if (!fs.existsSync(PROFILES_DIR)) {
    fs.mkdirSync(PROFILES_DIR, { recursive: true });
  }
}

function loadConfig() {
  ensureDirectories();
  return readJsonSync(CONFIG_FILE, {
    active_profile: 'default',
    country_map: {},
    aliases: {}
  });
}

function saveConfig(config) {
  ensureDirectories();
  atomicWriteJsonSync(CONFIG_FILE, config);
}

function getActiveProfileName() {
  try {
    if (fs.existsSync(ACTIVE_PROFILE_FILE)) {
      const name = fs.readFileSync(ACTIVE_PROFILE_FILE, 'utf8').trim();
      if (name) return name;
    }
  } catch {}
  const cfg = loadConfig();
  return cfg.active_profile || 'default';
}

function setActiveProfileName(name) {
  ensureDirectories();
  atomicWriteFileSync(ACTIVE_PROFILE_FILE, name.trim());
  const cfg = loadConfig();
  cfg.active_profile = name.trim();
  saveConfig(cfg);
}

function getProfileDir(name) {
  return path.join(PROFILES_DIR, name);
}

function getProfileConfigPath(name) {
  return path.join(getProfileDir(name), '.wrangler', 'config', 'default.toml');
}

function getProfileMetaPath(name) {
  return path.join(getProfileDir(name), 'profile.json');
}

/**
 * List all saved profiles
 */
function listProfiles() {
  ensureDirectories();
  const cfg = loadConfig();
  const activeName = getActiveProfileName();
  const entries = fs.readdirSync(PROFILES_DIR, { withFileTypes: true });
  const profiles = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    const metaPath = getProfileMetaPath(name);
    const tomlPath = getProfileConfigPath(name);

    let meta = readJsonSync(metaPath, {}) || {};
    let hasCredentials = false;
    let token = meta.api_token || null;

    if (fs.existsSync(tomlPath)) {
      hasCredentials = true;
      try {
        const tomlContent = fs.readFileSync(tomlPath, 'utf8');
        const parsed = parseWranglerToml(tomlContent);
        token = token || parsed.oauth_token || parsed.api_token;
      } catch {}
    }

    // Determine country
    const country = meta.country || cfg.country_map[name.toLowerCase()] || null;

    profiles.push({
      name,
      email: meta.email || null,
      account_id: meta.account_id || null,
      account_name: meta.account_name || null,
      country: country ? country.toUpperCase() : null,
      aliases: meta.aliases || [],
      has_credentials: hasCredentials || Boolean(meta.api_token),
      is_active: name === activeName,
      dir: getProfileDir(name)
    });
  }

  return profiles;
}

/**
 * Resolve profile by identifier:
 * Matches in order:
 * 1. Name exact/lowercase
 * 2. Country (e.g. US, IN, UK)
 * 3. Email
 * 4. Alias
 * 5. Account ID
 * 6. Account Name
 */
function resolveProfile(identifier) {
  const profiles = listProfiles();
  if (profiles.length === 0) return null;

  if (!identifier) {
    const activeName = getActiveProfileName();
    const found = profiles.find(p => p.name === activeName);
    return found || profiles[0];
  }

  const query = identifier.trim().toLowerCase();
  const cfg = loadConfig();

  // Check alias map in config
  const aliased = cfg.aliases[query] ? cfg.aliases[query].toLowerCase() : query;

  // 1. Direct name match
  let matched = profiles.find(p => p.name.toLowerCase() === aliased);
  if (matched) return matched;

  // 2. Country match (case-insensitive)
  matched = profiles.find(p => p.country && p.country.toLowerCase() === query);
  if (matched) return matched;

  // Check country map in config
  if (cfg.country_map[query]) {
    const targetName = cfg.country_map[query].toLowerCase();
    matched = profiles.find(p => p.name.toLowerCase() === targetName);
    if (matched) return matched;
  }

  // 3. Email match
  matched = profiles.find(p => p.email && p.email.toLowerCase() === query);
  if (matched) return matched;

  // 4. Aliases list match
  matched = profiles.find(p => p.aliases.some(a => a.toLowerCase() === query));
  if (matched) return matched;

  // 5. Account ID match
  matched = profiles.find(p => p.account_id && p.account_id.toLowerCase() === query);
  if (matched) return matched;

  // 6. Account Name match (partial or full)
  matched = profiles.find(p => p.account_name && p.account_name.toLowerCase().includes(query));
  if (matched) return matched;

  return null;
}

/**
 * Parse wrangler whoami stdout for email and account listings
 */
function parseWhoamiOutput(output) {
  let email = null;
  const accounts = [];

  if (!output) return { email, accounts };

  const emailMatch = output.match(/associated with the email\s+([^\s.]+@[^\s.]+\.[^\s.]+)/i) ||
                     output.match(/email\s+([^\s]+@[^\s]+)/i);
  if (emailMatch) {
    email = emailMatch[1].replace(/[.,]$/, '').trim();
  }

  const accountMatches = [...output.matchAll(/│\s*([^│]+?)\s*│\s*([a-f0-9]{32})\s*│/g)];
  for (const m of accountMatches) {
    const name = m[1].trim();
    const id = m[2].trim();
    if (id && name) {
      accounts.push({ name, id });
    }
  }

  return { email, accounts };
}

/**
 * Fetch and update cached email and account information for a profile.
 * Fast path: API call with token.
 * Fallback / Refresh path: runs `wrangler whoami` in profile sandbox to auto-refresh token.
 */
async function refreshProfile(profileName) {
  const pDir = getProfileDir(profileName);
  const tomlPath = getProfileConfigPath(profileName);
  const metaPath = getProfileMetaPath(profileName);
  let meta = readJsonSync(metaPath, {}) || {};

  let token = meta.api_token;
  if (!token && fs.existsSync(tomlPath)) {
    try {
      const tomlContent = fs.readFileSync(tomlPath, 'utf8');
      const parsed = parseWranglerToml(tomlContent);
      token = parsed.oauth_token || parsed.api_token;
    } catch {}
  }

  // 1. Try fast path via direct Cloudflare API if token exists
  if (token) {
    try {
      const user = await fetchCloudflareUser(token);
      if (user?.email) {
        meta.email = user.email;
        const accounts = await fetchCloudflareAccounts(token);
        if (accounts && accounts.length > 0) {
          meta.account_id = meta.account_id || accounts[0].id;
          meta.account_name = meta.account_name || accounts[0].name;
          meta.available_accounts = accounts.map(a => ({ id: a.id, name: a.name }));
        }
        meta.name = profileName;
        meta.last_synced = new Date().toISOString();
        atomicWriteJsonSync(metaPath, meta);
        return meta;
      }
    } catch {}
  }

  // 2. Fallback / Token refresh path: Run wrangler whoami in the profile's sandbox
  if (fs.existsSync(tomlPath)) {
    try {
      const realWrangler = findRealWrangler();
      const res = spawnSync(realWrangler, ['whoami'], {
        encoding: 'utf8',
        env: {
          ...process.env,
          XDG_CONFIG_HOME: pDir,
          __WRANGLER_WRAPPER_ACTIVE: '1'
        },
        timeout: 10000
      });

      const parsed = parseWhoamiOutput(res.stdout + '\n' + res.stderr);
      if (parsed.email) {
        meta.email = parsed.email;
      }
      if (parsed.accounts && parsed.accounts.length > 0) {
        meta.account_id = meta.account_id || parsed.accounts[0].id;
        meta.account_name = meta.account_name || parsed.accounts[0].name;
        meta.available_accounts = parsed.accounts;
      }
      meta.name = profileName;
      meta.last_synced = new Date().toISOString();
      atomicWriteJsonSync(metaPath, meta);
      return meta;
    } catch {}
  }

  return meta;
}

/**
 * Import the existing ~/.config/.wrangler credentials into 'default' profile
 */
async function importExistingCredentials() {
  ensureDirectories();
  const defaultDir = getProfileDir('default');
  const defaultToml = path.join(defaultDir, '.wrangler', 'config', 'default.toml');
  const standardToml = path.join(HOME, '.config', '.wrangler', 'config', 'default.toml');

  if (fs.existsSync(standardToml)) {
    const configDir = path.dirname(defaultToml);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    // Always keep in sync on initial import or if missing
    if (!fs.existsSync(defaultToml) || fs.statSync(standardToml).mtimeMs > fs.statSync(defaultToml).mtimeMs) {
      fs.copyFileSync(standardToml, defaultToml);
    }
    const metaPath = getProfileMetaPath('default');
    if (!fs.existsSync(metaPath)) {
      await refreshProfile('default');
    }
  }
}

/**
 * Synchronize the active profile's default.toml back to ~/.config/.wrangler/config/default.toml
 */
function syncStandardConfig(profileName) {
  const pToml = getProfileConfigPath(profileName);
  const standardDir = path.join(HOME, '.config', '.wrangler', 'config');
  const standardToml = path.join(standardDir, 'default.toml');

  if (!fs.existsSync(pToml)) return;

  try {
    if (!fs.existsSync(standardDir)) {
      fs.mkdirSync(standardDir, { recursive: true });
    }
    if (fs.existsSync(standardToml)) {
      try {
        fs.unlinkSync(standardToml);
      } catch {}
    }
    try {
      fs.symlinkSync(pToml, standardToml);
    } catch {
      fs.copyFileSync(pToml, standardToml);
    }
  } catch {}
}

module.exports = {
  ensureDirectories,
  loadConfig,
  saveConfig,
  getActiveProfileName,
  setActiveProfileName,
  getProfileDir,
  getProfileConfigPath,
  getProfileMetaPath,
  listProfiles,
  resolveProfile,
  parseWhoamiOutput,
  refreshProfile,
  importExistingCredentials,
  syncStandardConfig
};
