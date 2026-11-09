const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  HOME,
  ACCOUNTS_DIR,
  PROFILES_DIR,
  CONFIG_FILE,
  ACTIVE_ACCOUNT_FILE,
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
  if (!fs.existsSync(ACCOUNTS_DIR)) {
    fs.mkdirSync(ACCOUNTS_DIR, { recursive: true });
  }
}

function loadConfig() {
  ensureDirectories();
  return readJsonSync(CONFIG_FILE, {
    active_account: null,
    aliases: {}
  });
}

function saveConfig(config) {
  ensureDirectories();
  atomicWriteJsonSync(CONFIG_FILE, config);
}

function getActiveAccountEmail() {
  let email = null;
  try {
    if (fs.existsSync(ACTIVE_ACCOUNT_FILE)) {
      email = fs.readFileSync(ACTIVE_ACCOUNT_FILE, 'utf8').trim();
    }
  } catch {}

  const cfg = loadConfig();
  if (!email && cfg.active_account) email = cfg.active_account;

  // Backwards-compatibility with legacy active_profile
  if (!email) {
    try {
      if (fs.existsSync(ACTIVE_PROFILE_FILE)) {
        email = fs.readFileSync(ACTIVE_PROFILE_FILE, 'utf8').trim();
      }
    } catch {}
  }
  if (!email && cfg.active_profile) email = cfg.active_profile;

  // If active pointer is an alias, resolve to mapped email
  if (email && cfg.aliases && cfg.aliases[email.toLowerCase()]) {
    email = cfg.aliases[email.toLowerCase()];
  }

  if (email) return email;

  // Fallback to first available account
  const accounts = listAccounts();
  return accounts.length > 0 ? accounts[0].email : null;
}

function setActiveAccount(email) {
  ensureDirectories();
  const cleanEmail = email.trim();
  atomicWriteFileSync(ACTIVE_ACCOUNT_FILE, cleanEmail);
  const cfg = loadConfig();
  cfg.active_account = cleanEmail;
  saveConfig(cfg);
}

function getAccountDir(email) {
  return path.join(ACCOUNTS_DIR, email);
}

function getAccountConfigPath(email) {
  return path.join(getAccountDir(email), '.wrangler', 'config', 'default.toml');
}

function getAccountMetaPath(email) {
  return path.join(getAccountDir(email), 'account.json');
}

/**
 * List all saved accounts
 */
function listAccounts() {
  ensureDirectories();
  const cfg = loadConfig();
  const activeEmail = getActiveAccountEmail();
  const entries = fs.readdirSync(ACCOUNTS_DIR, { withFileTypes: true });
  const accounts = [];

  // Build reverse alias map (email -> alias)
  const aliasMap = {};
  if (cfg.aliases) {
    for (const [alias, targetEmail] of Object.entries(cfg.aliases)) {
      aliasMap[targetEmail.toLowerCase()] = alias;
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirEmail = entry.name;
    const metaPath = getAccountMetaPath(dirEmail);
    const tomlPath = getAccountConfigPath(dirEmail);

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

    const email = meta.email || dirEmail;
    const alias = aliasMap[email.toLowerCase()] || meta.alias || null;

    accounts.push({
      email,
      alias,
      account_id: meta.account_id || null,
      account_name: meta.account_name || null,
      has_credentials: hasCredentials || Boolean(meta.api_token),
      is_active: Boolean(activeEmail && email.toLowerCase() === activeEmail.toLowerCase()),
      dir: getAccountDir(dirEmail)
    });
  }

  return accounts;
}

/**
 * Resolve account by email, alias, or account ID.
 * Matches in order:
 * 1. Alias map in config (e.g. "work" -> "user@example.com")
 * 2. Exact email match (case-insensitive)
 * 3. Account ID match
 * 4. Account Name substring match
 * 5. Active account fallback if identifier omitted
 */
function resolveAccount(identifier) {
  const accounts = listAccounts();
  if (accounts.length === 0) return null;

  if (!identifier) {
    const activeEmail = getActiveAccountEmail();
    if (activeEmail) {
      const found = accounts.find(a => a.email.toLowerCase() === activeEmail.toLowerCase());
      if (found) return found;
    }
    return accounts[0];
  }

  const query = identifier.trim().toLowerCase();
  const cfg = loadConfig();

  // 1. Check alias in config
  let targetEmail = query;
  if (cfg.aliases && cfg.aliases[query]) {
    targetEmail = cfg.aliases[query].toLowerCase();
  }

  // 2. Direct email match
  let matched = accounts.find(a => a.email.toLowerCase() === targetEmail);
  if (matched) return matched;

  // 3. Explicit alias property match
  matched = accounts.find(a => a.alias && a.alias.toLowerCase() === query);
  if (matched) return matched;

  // 4. Account ID match
  matched = accounts.find(a => a.account_id && a.account_id.toLowerCase() === query);
  if (matched) return matched;

  // 5. Account Name match (partial or full)
  matched = accounts.find(a => a.account_name && a.account_name.toLowerCase().includes(query));
  if (matched) return matched;

  return null;
}

/**
 * Set an alias for an account email
 */
function setAccountAlias(email, alias) {
  ensureDirectories();
  const cfg = loadConfig();
  if (!cfg.aliases) cfg.aliases = {};

  const cleanEmail = email.trim().toLowerCase();
  const cleanAlias = alias.trim().toLowerCase();

  cfg.aliases[cleanAlias] = cleanEmail;
  saveConfig(cfg);

  // Also update metadata if account directory exists
  const metaPath = getAccountMetaPath(cleanEmail);
  if (fs.existsSync(metaPath)) {
    const meta = readJsonSync(metaPath, {}) || {};
    meta.alias = cleanAlias;
    atomicWriteJsonSync(metaPath, meta);
  }
}

/**
 * Remove an alias
 */
function removeAccountAlias(alias) {
  ensureDirectories();
  const cfg = loadConfig();
  const cleanAlias = alias.trim().toLowerCase();
  if (cfg.aliases && cfg.aliases[cleanAlias]) {
    delete cfg.aliases[cleanAlias];
    saveConfig(cfg);
    return true;
  }
  return false;
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
 * Fetch and update cached email and account information for an account.
 */
async function refreshAccount(email) {
  const aDir = getAccountDir(email);
  const tomlPath = getAccountConfigPath(email);
  const metaPath = getAccountMetaPath(email);
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
      const [user, accounts] = await Promise.all([
        fetchCloudflareUser(token),
        fetchCloudflareAccounts(token)
      ]);
      let changed = false;
      if (user?.email) {
        meta.email = user.email;
        changed = true;
      }
      if (accounts && accounts.length > 0) {
        meta.account_id = accounts[0].id;
        meta.account_name = accounts[0].name;
        meta.available_accounts = accounts.map(a => ({ id: a.id, name: a.name }));
        changed = true;
      }
      if (changed || meta.email) {
        meta.last_synced = new Date().toISOString();
        atomicWriteJsonSync(metaPath, meta);
        return meta;
      }
    } catch {}
  }

  // 2. Fallback path: Run wrangler whoami in account sandbox
  if (fs.existsSync(tomlPath)) {
    try {
      const realWrangler = findRealWrangler();
      const res = spawnSync(realWrangler, ['whoami'], {
        encoding: 'utf8',
        env: {
          ...process.env,
          XDG_CONFIG_HOME: aDir,
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
      meta.last_synced = new Date().toISOString();
      atomicWriteJsonSync(metaPath, meta);
      return meta;
    } catch {}
  }

  return meta;
}

/**
 * Migrate legacy profiles/ directory if accounts/ is empty or missing.
 */
function migrateLegacyProfiles() {
  if (!fs.existsSync(PROFILES_DIR)) return;
  ensureDirectories();

  try {
    const profileEntries = fs.readdirSync(PROFILES_DIR, { withFileTypes: true });
    for (const entry of profileEntries) {
      if (!entry.isDirectory()) continue;
      const pName = entry.name;
      const pDir = path.join(PROFILES_DIR, pName);
      const metaPath = path.join(pDir, 'profile.json');
      const tomlPath = path.join(pDir, '.wrangler', 'config', 'default.toml');

      let email = null;
      let meta = {};
      if (fs.existsSync(metaPath)) {
        meta = readJsonSync(metaPath, {}) || {};
        email = meta.email;
      }

      if (!email && fs.existsSync(tomlPath)) {
        try {
          const tomlContent = fs.readFileSync(tomlPath, 'utf8');
          const parsed = parseWranglerToml(tomlContent);
          const token = parsed.oauth_token || parsed.api_token;
          if (token) {
            // Read email from whoami output if possible
            const res = spawnSync(findRealWrangler(), ['whoami'], {
              encoding: 'utf8',
              env: { ...process.env, XDG_CONFIG_HOME: pDir, __WRANGLER_WRAPPER_ACTIVE: '1' },
              timeout: 10000
            });
            const parsedWhoami = parseWhoamiOutput(res.stdout + '\n' + res.stderr);
            email = parsedWhoami.email;
          }
        } catch {}
      }

      const targetEmail = email || pName;
      const targetDir = getAccountDir(targetEmail);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(path.join(targetDir, '.wrangler', 'config'), { recursive: true });
        if (fs.existsSync(tomlPath)) {
          fs.copyFileSync(tomlPath, path.join(targetDir, '.wrangler', 'config', 'default.toml'));
        }
        meta.email = targetEmail;
        if (pName !== targetEmail && pName !== 'default') {
          setAccountAlias(targetEmail, pName);
        }
        atomicWriteJsonSync(path.join(targetDir, 'account.json'), meta);
      }
    }
  } catch {}
}

/**
 * Import existing ~/.config/.wrangler credentials if no accounts exist yet
 */
async function importExistingCredentials() {
  ensureDirectories();
  migrateLegacyProfiles();

  const accounts = listAccounts();
  const standardToml = path.join(HOME, '.config', '.wrangler', 'config', 'default.toml');

  if (accounts.length === 0 && fs.existsSync(standardToml)) {
    try {
      const tomlContent = fs.readFileSync(standardToml, 'utf8');
      const parsed = parseWranglerToml(tomlContent);
      let email = null;

      if (parsed.oauth_token || parsed.api_token) {
        try {
          const user = await fetchCloudflareUser(parsed.oauth_token || parsed.api_token);
          if (user?.email) email = user.email;
        } catch {}
      }

      if (!email) {
        const res = spawnSync(findRealWrangler(), ['whoami'], {
          encoding: 'utf8',
          env: { ...process.env, __WRANGLER_WRAPPER_ACTIVE: '1' },
          timeout: 10000
        });
        const parsedWhoami = parseWhoamiOutput(res.stdout + '\n' + res.stderr);
        email = parsedWhoami.email;
      }

      const accountEmail = email || 'default';
      const aDir = getAccountDir(accountEmail);
      fs.mkdirSync(path.join(aDir, '.wrangler', 'config'), { recursive: true });
      fs.copyFileSync(standardToml, path.join(aDir, '.wrangler', 'config', 'default.toml'));

      setActiveAccount(accountEmail);
      await refreshAccount(accountEmail);
    } catch {}
  }
}

/**
 * Auto-heals accounts:
 * 1. Renames any temp-login-* directory to the discovered email
 * 2. Caches missing account_id or account_name if credentials exist
 */
async function autoHealAccounts() {
  ensureDirectories();
  const entries = fs.readdirSync(ACCOUNTS_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirName = entry.name;
    const aDir = getAccountDir(dirName);
    const tomlPath = getAccountConfigPath(dirName);
    const metaPath = getAccountMetaPath(dirName);

    let meta = readJsonSync(metaPath, {}) || {};
    const isTemp = dirName.startsWith('temp-login-') || !dirName.includes('@');
    const missingAccountData = !meta.account_id || !meta.email;

    if ((isTemp || missingAccountData) && (fs.existsSync(tomlPath) || meta.api_token)) {
      try {
        const refreshed = await refreshAccount(dirName);
        const resolvedEmail = refreshed?.email;

        if (resolvedEmail && resolvedEmail.includes('@')) {
          const finalDir = getAccountDir(resolvedEmail);
          if (finalDir !== aDir) {
            if (fs.existsSync(finalDir)) {
              try { fs.rmSync(finalDir, { recursive: true, force: true }); } catch {}
            }
            try {
              fs.renameSync(aDir, finalDir);
            } catch {}
          }

          const active = getActiveAccountEmail();
          if (active === dirName) {
            setActiveAccount(resolvedEmail);
            syncStandardConfig(resolvedEmail);
          }
        }
      } catch {}
    }
  }
}

/**
 * Synchronize the active account's default.toml back to ~/.config/.wrangler/config/default.toml
 */
function syncStandardConfig(email) {
  const aToml = getAccountConfigPath(email);
  const standardDir = path.join(HOME, '.config', '.wrangler', 'config');
  const standardToml = path.join(standardDir, 'default.toml');

  if (!fs.existsSync(aToml)) return;

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
      fs.symlinkSync(aToml, standardToml);
    } catch {
      fs.copyFileSync(aToml, standardToml);
    }
  } catch {}
}

module.exports = {
  ensureDirectories,
  loadConfig,
  saveConfig,
  getActiveAccountEmail,
  setActiveAccount,
  getAccountDir,
  getAccountConfigPath,
  getAccountMetaPath,
  listAccounts,
  resolveAccount,
  setAccountAlias,
  removeAccountAlias,
  refreshAccount,
  parseWhoamiOutput,
  importExistingCredentials,
  syncStandardConfig,
  autoHealAccounts,
  // Backwards-compatible aliases
  resolveProfile: resolveAccount,
  listProfiles: listAccounts,
  getActiveProfileName: getActiveAccountEmail,
  setActiveProfileName: setActiveAccount,
  refreshProfile: refreshAccount,
  getProfileDir: getAccountDir,
  getProfileConfigPath: getAccountConfigPath,
  getProfileMetaPath: getAccountMetaPath
};
