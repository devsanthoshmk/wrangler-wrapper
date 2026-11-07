const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { HOME } = require('./constants');
const { findRealWrangler, isCleanOutputRequested } = require('./utils');
const { refreshProfile, getProfileConfigPath } = require('./profiles');

/**
 * Format the email banner string based on environment / user preferences
 */
function formatEmailBanner(email, profile) {
  const customFormat = process.env.WRANGLER_EMAIL_FORMAT;
  const isRaw = process.env.WRANGLER_EMAIL_RAW === '1' || process.env.WRANGLER_EMAIL_FORMAT === 'raw';

  if (isRaw) {
    return email || 'unknown';
  }

  if (customFormat && customFormat !== 'raw') {
    return customFormat.replace('%s', email || 'not-authenticated');
  }

  const emailPart = email || 'Not Authenticated';
  return `Account Email: ${emailPart}`;
}

/**
 * Executes the real Wrangler binary with isolated profile environment and
 * emits the account email id as the first line of output.
 */
async function runWrangler(forwardedArgs, profile, options = {}) {
  const realWranglerBin = findRealWrangler(options.scriptPath);

  // If profile has no email cached yet, try a quick refresh
  let email = profile?.email || null;
  if (!email && profile?.has_credentials) {
    try {
      const refreshed = await refreshProfile(profile.name);
      email = refreshed?.email || null;
      if (email && profile) profile.email = email;
    } catch {}
  }

  // Format banner
  const bannerText = formatEmailBanner(email, profile);

  // Determine output stream (stdout vs stderr)
  const isPipedOrJson = isCleanOutputRequested(forwardedArgs);
  let targetStream = process.stdout;

  if (process.env.WRANGLER_EMAIL_STREAM === 'stderr') {
    targetStream = process.stderr;
  } else if (process.env.WRANGLER_EMAIL_STREAM === 'stdout') {
    targetStream = process.stdout;
  } else if (isPipedOrJson) {
    // If output is piped to json or raw stream, write email to stderr to avoid data corruption
    targetStream = process.stderr;
  }

  if (!options.suppressBanner && process.env.WRANGLER_NO_EMAIL !== '1') {
    targetStream.write(`${bannerText}\n`);
  }

  // Construct environment variables for isolated profile execution
  const childEnv = { ...process.env };
  childEnv.__WRANGLER_WRAPPER_ACTIVE = '1';

  if (profile) {
    childEnv.XDG_CONFIG_HOME = profile.dir;
    if (profile.account_id && !childEnv.CLOUDFLARE_ACCOUNT_ID) {
      childEnv.CLOUDFLARE_ACCOUNT_ID = profile.account_id;
    }
  }

  // Spawn child process with inherited stdio
  const child = spawn(realWranglerBin, forwardedArgs, {
    stdio: 'inherit',
    env: childEnv
  });

  // Signal propagation
  const handleSignal = (sig) => {
    if (child.pid && !child.killed) {
      try {
        child.kill(sig);
      } catch {}
    }
  };

  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('SIGTERM', () => handleSignal('SIGTERM'));
  process.on('SIGHUP', () => handleSignal('SIGHUP'));

  return new Promise((resolve) => {
    child.on('exit', async (code, signal) => {
      // If the command was a login or logout, refresh the cached credentials
      const firstArg = forwardedArgs[0];
      if (profile && (firstArg === 'login' || firstArg === 'logout')) {
        try {
          await refreshProfile(profile.name);
        } catch {}
      }

      if (signal) {
        process.kill(process.pid, signal);
      } else {
        process.exit(code ?? 0);
      }
      resolve(code ?? 0);
    });

    child.on('error', (err) => {
      console.error(`Failed to execute Wrangler (${realWranglerBin}):`, err.message);
      process.exit(1);
    });
  });
}

module.exports = {
  formatEmailBanner,
  runWrangler
};
