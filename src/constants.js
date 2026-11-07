const path = require('path');
const os = require('os');

const HOME = os.homedir();
const WRAPPER_CONFIG_DIR = process.env.WRANGLER_WRAPPER_DIR || path.join(HOME, '.config', 'wrangler-wrapper');
const ACCOUNTS_DIR = path.join(WRAPPER_CONFIG_DIR, 'accounts');
const PROFILES_DIR = path.join(WRAPPER_CONFIG_DIR, 'profiles'); // Legacy backwards-compatibility
const CONFIG_FILE = path.join(WRAPPER_CONFIG_DIR, 'config.json');
const ACTIVE_ACCOUNT_FILE = path.join(WRAPPER_CONFIG_DIR, 'active_account');
const ACTIVE_PROFILE_FILE = path.join(WRAPPER_CONFIG_DIR, 'active_profile'); // Legacy

const DEFAULT_REAL_WRANGLER = '/home/santhoshmk/.nvm/versions/node/v22.20.0/bin/wrangler';

module.exports = {
  HOME,
  WRAPPER_CONFIG_DIR,
  ACCOUNTS_DIR,
  PROFILES_DIR,
  CONFIG_FILE,
  ACTIVE_ACCOUNT_FILE,
  ACTIVE_PROFILE_FILE,
  DEFAULT_REAL_WRANGLER
};
