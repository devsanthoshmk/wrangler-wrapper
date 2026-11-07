const fs = require('fs');
const path = require('path');
const {
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
  refreshProfile,
  importExistingCredentials,
  syncStandardConfig
} = require('./profiles');
const { atomicWriteJsonSync, readJsonSync } = require('./utils');
const { runWrangler, formatEmailBanner } = require('./runner');
const { setupAlias, removeAlias } = require('./alias');

function getWrapperHelpText() {
  return `
WRAPPER COMMANDS (Account Management for Developers & AI Agents)
  wrangler account list                  List all saved profiles and Cloudflare accounts
  wrangler account switch <name|email>   Switch active profile (by name or email)
  wrangler account current               Display currently active account and email
  wrangler account add <name> [flags]    Add a profile (--token <token> --email <email>)
  wrangler account remove <name>         Remove a saved profile
  wrangler account refresh [name]        Update cached metadata from Cloudflare API
  wrangler-wrapper alias                 Add alias to your shell config (.bashrc/.zshrc/PowerShell)
  wrangler-wrapper unalias               Remove alias from your shell config

WRAPPER FLAGS (Applicable to ANY Wrangler command)
  --account <name|email>    Run command using a specific profile or email (e.g. --account work)
  --profile <name>          Run command under the specified profile directory sandbox
  --email-only, --raw-email Output only the raw email address on the first line
  --no-email                Suppress the email header line

WRAPPER ENVIRONMENT VARIABLES
  WRANGLER_ACCOUNT=<name|email> Default account for subsequent commands
  WRANGLER_PROFILE=<name>       Default profile directory for subsequent commands
  WRANGLER_EMAIL_STREAM         "stdout" (default) or "stderr" (used for clean --json output)
  WRANGLER_EMAIL_FORMAT         Custom format template (e.g. "Account: %s")
`;
}

function printDomainHelp(domain) {
  console.log(`
wrangler ${domain} - Multi-account profile management

COMMANDS
  wrangler ${domain} list                     List all saved profiles and Cloudflare accounts
  wrangler ${domain} current                  Show active profile, email, and account ID
  wrangler ${domain} switch <name|email>      Switch the active profile
  wrangler ${domain} add <name> [flags]       Add a profile:
                                              --token <token>    Set Cloudflare API token
                                              --email <email>    Set associated email
  wrangler ${domain} remove <name>            Remove a saved profile
  wrangler ${domain} refresh [name]           Re-fetch user & account info from Cloudflare API
  wrangler ${domain} import                   Import credentials from ~/.config/.wrangler

PER-COMMAND USAGE
  wrangler --account <name|email> <command>
  wrangler --profile <name> <command>
  Example: wrangler --account user@example.com whoami
           wrangler --profile prod deploy
`);
}

async function handleProfileCommands(args) {
  const [domain, subCmd, ...rest] = args;

  if (subCmd === '--help' || subCmd === '-h' || subCmd === 'help') {
    printDomainHelp(domain);
    process.exit(0);
  }

  if (domain === 'account' || domain === 'profile') {
    if (!subCmd || subCmd === 'list' || subCmd === 'ls') {
      return printAccountsTable();
    }

    if (subCmd === 'switch' || subCmd === 'use') {
      const target = rest[0];
      if (!target) {
        console.error(`Usage: wrangler ${domain} switch <name|email>`);
        process.exit(1);
      }
      return switchProfileByQuery(target);
    }

    if (subCmd === 'current') {
      const current = resolveProfile();
      if (!current) {
        console.log('No active profile configured.');
      } else {
        console.log(`Active Profile : ${current.name}`);
        console.log(`Account Email  : ${current.email || 'unknown'}`);
        console.log(`Account ID     : ${current.account_id || 'none'}`);
        console.log(`Account Name   : ${current.account_name || 'none'}`);
      }
      process.exit(0);
    }

    if (subCmd === 'add') {
      const name = rest[0];
      if (!name) {
        console.error(`Usage: wrangler ${domain} add <name> [--token <api_token>] [--email <email>]`);
        process.exit(1);
      }

      let token = null;
      let email = null;
      for (let i = 1; i < rest.length; i++) {
        if (rest[i] === '--token' && rest[i + 1]) {
          token = rest[++i];
        } else if (rest[i] === '--email' && rest[i + 1]) {
          email = rest[++i];
        }
      }

      const pDir = getProfileDir(name);
      const metaPath = getProfileMetaPath(name);
      fs.mkdirSync(path.join(pDir, '.wrangler', 'config'), { recursive: true });

      const meta = {
        name,
        api_token: token || null,
        email: email || null
      };
      atomicWriteJsonSync(metaPath, meta);

      if (token) {
        await refreshProfile(name);
      }

      console.log(`Created profile '${name}'.`);
      process.exit(0);
    }

    if (subCmd === 'remove' || subCmd === 'rm') {
      const name = rest[0];
      if (!name) {
        console.error(`Usage: wrangler ${domain} remove <name>`);
        process.exit(1);
      }
      const pDir = getProfileDir(name);
      if (fs.existsSync(pDir)) {
        fs.rmSync(pDir, { recursive: true, force: true });
        console.log(`Removed profile '${name}'.`);
      } else {
        console.error(`Profile '${name}' does not exist.`);
      }
      process.exit(0);
    }

    if (subCmd === 'refresh') {
      const target = rest[0] || getActiveProfileName();
      console.log(`Refreshing profile metadata for '${target}'...`);
      const updated = await refreshProfile(target);
      console.log(`Updated: Email=${updated?.email}, Account=${updated?.account_name} (${updated?.account_id})`);
      process.exit(0);
    }

    if (subCmd === 'import') {
      await importExistingCredentials();
      console.log('Imported credentials from standard ~/.config/.wrangler directory.');
      process.exit(0);
    }
  }

  return false;
}

function printAccountsTable() {
  const profiles = listProfiles();
  const active = getActiveProfileName();

  console.log(`\nCloudflare Wrangler Profiles & Accounts:`);
  console.log('────────────────────────────────────────────────────────────────────────────────────────');
  console.log(`  ${'NAME'.padEnd(20)} ${'ACCOUNT EMAIL'.padEnd(38)} ${'ACCOUNT ID'.padEnd(34)}`);
  console.log('────────────────────────────────────────────────────────────────────────────────────────');

  if (profiles.length === 0) {
    console.log('  No profiles configured. Run `wrangler login` or `wrangler account import`.');
  } else {
    for (const p of profiles) {
      const prefix = p.name === active ? '* ' : '  ';
      const name = (p.name || '').padEnd(20);
      const email = (p.email || (p.has_credentials ? '(run refresh)' : 'no auth')).padEnd(38);
      const accId = (p.account_id || '-').padEnd(34);
      console.log(`${prefix}${name} ${email} ${accId}`);
    }
  }

  console.log('────────────────────────────────────────────────────────────────────────────────────────');
  console.log(`* indicates active profile. Switch with: wrangler account switch <name|email>\n`);
  process.exit(0);
}

function switchProfileByQuery(query) {
  const prof = resolveProfile(query);
  if (!prof) {
    console.error(`Profile not found matching: "${query}"`);
    console.error('Use `wrangler account list` to view available profiles.');
    process.exit(1);
  }

  setActiveProfileName(prof.name);
  syncStandardConfig(prof.name);
  console.log(`Switched active Cloudflare profile to '${prof.name}' (Email: ${prof.email || 'unknown'})`);
  process.exit(0);
}

/**
 * Main CLI entry
 */
async function main() {
  ensureDirectories();
  // Ensure default profile is seeded from existing config if not yet set up
  await importExistingCredentials();

  let rawArgs = process.argv.slice(2);

  // If invoked via shortcut binary name (wrangler-account or wrangler-profile)
  const scriptName = path.basename(process.argv[1] || '');
  if (scriptName === 'wrangler-account' || scriptName === 'wrangler-profile') {
    rawArgs = ['account', ...rawArgs];
  }

  // Check for built-in management subcommands
  const first = rawArgs[0];
  if (first === 'account' || first === 'profile') {
    const handled = await handleProfileCommands(rawArgs);
    if (handled !== false) return;
  }
  if (first === 'alias' || first === 'setup-alias') {
    setupAlias();
    process.exit(0);
  }
  if (first === 'unalias' || first === 'remove-alias') {
    removeAlias();
    process.exit(0);
  }

  // Parse per-command selection flags: --account, --profile
  let targetIdentifier = process.env.WRANGLER_ACCOUNT || process.env.WRANGLER_PROFILE || null;
  const forwardedArgs = [];
  let rawEmail = false;
  let noEmail = false;

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];

    if (arg === '--profile' && i + 1 < rawArgs.length) {
      targetIdentifier = rawArgs[++i];
    } else if (arg.startsWith('--profile=')) {
      targetIdentifier = arg.slice(10);
    } else if (arg === '--account' && i + 1 < rawArgs.length) {
      const val = rawArgs[i + 1];
      // Check if value matches an existing wrapper profile or email
      const matched = resolveProfile(val);
      if (matched) {
        targetIdentifier = val;
        i++;
      } else {
        // Pass through to wrangler if not a profile match
        forwardedArgs.push(arg);
      }
    } else if (arg.startsWith('--account=')) {
      const val = arg.slice(10);
      const matched = resolveProfile(val);
      if (matched) {
        targetIdentifier = val;
      } else {
        forwardedArgs.push(arg);
      }
    } else if (arg === '--email-only' || arg === '--raw-email') {
      rawEmail = true;
    } else if (arg === '--no-email') {
      noEmail = true;
    } else {
      forwardedArgs.push(arg);
    }
  }

  if (rawEmail) {
    process.env.WRANGLER_EMAIL_RAW = '1';
  }

  // Resolve target profile
  const profile = resolveProfile(targetIdentifier);

  const isGlobalHelp = rawArgs.length === 0 ||
    rawArgs.includes('--help') ||
    rawArgs.includes('-h') ||
    (rawArgs.length === 1 && rawArgs[0] === 'help');

  if (isGlobalHelp) {
    if (!noEmail) {
      const bannerText = formatEmailBanner(profile?.email, profile);
      process.stdout.write(`${bannerText}\n`);
    }
    process.stdout.write(getWrapperHelpText());
    process.stdout.write('\n');
    await runWrangler(forwardedArgs, profile, {
      scriptPath: __filename,
      suppressBanner: true
    });
    return;
  }

  // Execute
  await runWrangler(forwardedArgs, profile, {
    scriptPath: __filename,
    suppressBanner: noEmail
  });
}

module.exports = {
  main,
  handleProfileCommands
};
