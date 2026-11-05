const fs = require('fs');
const path = require('path');
const os = require('os');
const { DEFAULT_REAL_WRANGLER } = require('./constants');

/**
 * Locate the real Wrangler binary to execute, avoiding recursion if the wrapper
 * is installed at ~/.local/bin/wrangler or in PATH.
 */
function findRealWrangler(currentScriptPath) {
  if (process.env.REAL_WRANGLER_BIN && fs.existsSync(process.env.REAL_WRANGLER_BIN)) {
    return process.env.REAL_WRANGLER_BIN;
  }

  const currentReal = currentScriptPath ? safeRealPath(currentScriptPath) : null;
  const pathDirs = (process.env.PATH || '').split(path.delimiter);

  for (const dir of pathDirs) {
    if (!dir) continue;
    const candidate = path.join(dir, 'wrangler');
    if (fs.existsSync(candidate)) {
      const candidateReal = safeRealPath(candidate);
      // Skip if this candidate is the wrapper itself
      if (candidateReal && currentReal && candidateReal === currentReal) {
        continue;
      }
      // Skip if script contains wrangler-wrapper marker
      try {
        const head = fs.readFileSync(candidate, 'utf8').slice(0, 500);
        if (head.includes('WRANGLER_WRAPPER') || head.includes('wrangler-wrapper')) {
          continue;
        }
      } catch {}
      return candidate;
    }
  }

  // Fallback to default installed location
  if (fs.existsSync(DEFAULT_REAL_WRANGLER)) {
    return DEFAULT_REAL_WRANGLER;
  }

  return 'wrangler';
}

function safeRealPath(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function atomicWriteFileSync(filePath, content) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).substring(2, 8)}`;
  fs.writeFileSync(tempPath, content, 'utf8');
  fs.renameSync(tempPath, filePath);
}

function atomicWriteJsonSync(filePath, data) {
  atomicWriteFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

function readJsonSync(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

/**
 * Simple parser for Wrangler default.toml to extract tokens
 */
function parseWranglerToml(tomlContent) {
  const result = {};
  if (!tomlContent) return result;

  const oauthMatch = tomlContent.match(/oauth_token\s*=\s*"([^"]+)"/);
  if (oauthMatch) result.oauth_token = oauthMatch[1];

  const refreshMatch = tomlContent.match(/refresh_token\s*=\s*"([^"]+)"/);
  if (refreshMatch) result.refresh_token = refreshMatch[1];

  const expMatch = tomlContent.match(/expiration_time\s*=\s*"([^"]+)"/);
  if (expMatch) result.expiration_time = expMatch[1];

  const apiTokenMatch = tomlContent.match(/api_token\s*=\s*"([^"]+)"/);
  if (apiTokenMatch) result.api_token = apiTokenMatch[1];

  return result;
}

/**
 * Check if the arguments indicate structured / pipe output where stdout
 * must not be polluted with banner text.
 */
function isCleanOutputRequested(args) {
  return args.some(arg =>
    arg === '--json' ||
    arg.startsWith('--json=') ||
    arg === '--pipe' ||
    arg === '--raw' ||
    arg === '-q' ||
    arg === '--silent'
  );
}

module.exports = {
  findRealWrangler,
  safeRealPath,
  atomicWriteFileSync,
  atomicWriteJsonSync,
  readJsonSync,
  parseWranglerToml,
  isCleanOutputRequested
};
