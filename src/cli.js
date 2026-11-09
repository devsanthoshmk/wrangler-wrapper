const fs = require('fs');
const path = require('path');
const {
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
  autoHealAccounts,
  importExistingCredentials,
  syncStandardConfig
} = require('./accounts');
const { atomicWriteJsonSync, readJsonSync } = require('./utils');
const { runWrangler, formatEmailBanner } = require('./runner');
const { setupAlias, removeAlias } = require('./alias');

function getWrapperHelpText() {
  return `
WRAPPER COMMANDS (Account Management for Developers & AI Agents)
  wrangler acc list                  List authenticated accounts, emails, and aliases
  wrangler acc switch <email|alias>  Switch the active Cloudflare account
  wrangler acc current               Display currently active account and email
  wrangler acc add [flags]           Add an account via login or API token (--token, --alias)
  wrangler acc remove <email|alias>  Remove a saved account
  wrangler acc alias <email> <alias> Assign a short alias to an email
  wrangler acc refresh [email]       Update cached metadata from Cloudflare API
  wrangler-wrapper alias             Add alias to your shell config (.bashrc/.zshrc/PowerShell)
  wrangler-wrapper unalias           Remove alias from your shell config

WRAPPER FLAGS (Applicable to ANY Wrangler command)
  --acc <email|alias>       Run command using a specific account or alias (e.g. --acc work)
  --email-only, --raw-email Output only the raw email address on the first line
  --no-email                Suppress the email header line

WRAPPER ENVIRONMENT VARIABLES
  WRANGLER_ACC=<email|alias>    Default account for subsequent commands
  WRANGLER_EMAIL_STREAM         "stdout" (default) or "stderr" (used for clean --json output)
  WRANGLER_EMAIL_FORMAT         Custom format template (e.g. "Account: %s")
`;
}

function printDomainHelp(domain) {
  console.log(`
wrangler ${domain} - Cloudflare account switcher

COMMANDS
  wrangler ${domain} list                     List all saved accounts and aliases
  wrangler ${domain} current                  Show active account email, alias, and account ID
  wrangler ${domain} switch <email|alias>     Switch the active account
  wrangler ${domain} add [flags]              Add an account:
                                                --token <token>    Set Cloudflare API token
                                                --email <email>    Set associated email
                                                --alias <alias>    Set optional short alias
  wrangler ${domain} alias <email> <alias>    Assign a short alias to an email
  wrangler ${domain} remove <email|alias>     Remove a saved account
  wrangler ${domain} refresh [email]          Re-fetch user & account info from Cloudflare API
  wrangler ${domain} import                   Import credentials from ~/.config/.wrangler

PER-COMMAND USAGE
  wrangler --acc <email|alias> <command>
  Example: wrangler --acc user@example.com whoami
           wrangler --acc work deploy
`);
}

async function handleAccountCommands(args) {
  const [domain, subCmd, ...rest] = args;

  if (subCmd === '--help' || subCmd === '-h' || subCmd === 'help') {
    printDomainHelp(domain);
    process.exit(0);
  }

  if (domain === 'acc' || domain === 'account' || domain === 'profile') {
    if (!subCmd || subCmd === 'list' || subCmd === 'ls') {
      return printAccountsTable();
    }

    if (subCmd === 'switch' || subCmd === 'use') {
      const target = rest[0];
      if (!target) {
        console.error(`Usage: wrangler ${domain} switch <email|alias>`);
        process.exit(1);
      }
      return switchAccountByQuery(target);
    }

    if (subCmd === 'current') {
      const current = resolveAccount();
      if (!current) {
        console.log('No active account configured.');
      } else {
        console.log(`Account Email : ${current.email || 'unknown'}`);
        console.log(`Alias         : ${current.alias || 'none'}`);
        console.log(`Account ID    : ${current.account_id || 'none'}`);
        console.log(`Account Name  : ${current.account_name || 'none'}`);
      }
      process.exit(0);
    }

    if (subCmd === 'alias') {
      const [emailOrTarget, aliasName] = rest;
      if (!emailOrTarget || !aliasName) {
        console.error(`Usage: wrangler ${domain} alias <email> <alias>`);
        process.exit(1);
      }
      const acc = resolveAccount(emailOrTarget);
      if (!acc) {
        console.error(`Account not found matching: "${emailOrTarget}"`);
        process.exit(1);
      }
      setAccountAlias(acc.email, aliasName);
      console.log(`Assigned alias '${aliasName}' to '${acc.email}'.`);
      process.exit(0);
    }

    if (subCmd === 'add') {
      let token = null;
      let email = null;
      let alias = null;

      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '--token' && rest[i + 1]) {
          token = rest[++i];
        } else if (rest[i] === '--email' && rest[i + 1]) {
          email = rest[++i];
        } else if (rest[i] === '--alias' && rest[i + 1]) {
          alias = rest[++i];
        } else if (!rest[i].startsWith('-') && !email && !alias) {
          // If first positional argument passed, treat as email or alias
          if (rest[i].includes('@')) {
            email = rest[i];
          } else {
            alias = rest[i];
          }
        }
      }

      if (token) {
        const targetEmail = email || alias || 'default';
        const aDir = getAccountDir(targetEmail);
        const metaPath = getAccountMetaPath(targetEmail);
        fs.mkdirSync(path.join(aDir, '.wrangler', 'config'), { recursive: true });

        const meta = {
          email: email || targetEmail,
          alias: alias || null,
          api_token: token
        };
        atomicWriteJsonSync(metaPath, meta);

        if (alias) {
          setAccountAlias(meta.email, alias);
        }

        console.log(`Refreshing metadata for account...`);
        const refreshed = await refreshAccount(targetEmail);
        const finalEmail = refreshed?.email || targetEmail;

        // If actual email was discovered and differed from targetEmail directory, rename directory
        if (refreshed?.email && refreshed.email !== targetEmail) {
          const newDir = getAccountDir(refreshed.email);
          if (!fs.existsSync(newDir)) {
            try {
              fs.renameSync(aDir, newDir);
            } catch {}
          }
          if (alias) {
            setAccountAlias(refreshed.email, alias);
          }
        }

        setActiveAccount(finalEmail);
        syncStandardConfig(finalEmail);
        console.log(`Added account '${finalEmail}'${alias ? ' (alias: ' + alias + ')' : ''}.`);
        process.exit(0);
      }

      // Interactive login flow: run login in a new sandbox
      console.log('Launching Wrangler login...');
      const tempId = `temp-login-${Date.now()}`;
      const tempDir = getAccountDir(tempId);
      fs.mkdirSync(path.join(tempDir, '.wrangler', 'config'), { recursive: true });

      const loginCode = await runWrangler(['login'], { dir: tempDir, email: null }, { suppressBanner: true, exitOnFinish: false });
      if (loginCode !== 0) {
        console.error('Wrangler login was cancelled or failed.');
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
        process.exit(loginCode || 1);
      }

      // After login completes, inspect credentials in tempDir
      const refreshed = await refreshAccount(tempId);
      const discoveredEmail = refreshed?.email;

      if (!discoveredEmail) {
        console.error('Failed to authenticate or discover account email.');
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
        process.exit(1);
      }

      const finalDir = getAccountDir(discoveredEmail);
      if (fs.existsSync(finalDir)) {
        try { fs.rmSync(finalDir, { recursive: true, force: true }); } catch {}
      }
      fs.renameSync(tempDir, finalDir);

      if (alias) {
        setAccountAlias(discoveredEmail, alias);
      }

      setActiveAccount(discoveredEmail);
      syncStandardConfig(discoveredEmail);
      console.log(`\nSuccessfully authenticated and activated account: ${discoveredEmail}${alias ? ' (alias: ' + alias + ')' : ''}`);
      process.exit(0);
    }

    if (subCmd === 'remove' || subCmd === 'rm') {
      const query = rest[0];
      if (!query) {
        console.error(`Usage: wrangler ${domain} remove <email|alias>`);
        process.exit(1);
      }
      const acc = resolveAccount(query);
      if (!acc) {
        console.error(`Account not found matching: "${query}"`);
        process.exit(1);
      }
      const aDir = acc.dir;
      if (fs.existsSync(aDir)) {
        fs.rmSync(aDir, { recursive: true, force: true });
        if (acc.alias) {
          removeAccountAlias(acc.alias);
        }
        console.log(`Removed account '${acc.email}'.`);
      } else {
        console.error(`Account directory not found.`);
      }
      process.exit(0);
    }

    if (subCmd === 'refresh') {
      const query = rest[0];
      const acc = query ? resolveAccount(query) : resolveAccount();
      if (!acc) {
        console.error('No account found to refresh.');
        process.exit(1);
      }
      console.log(`Refreshing metadata for '${acc.email}'...`);
      const updated = await refreshAccount(acc.email);
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
  const accounts = listAccounts();
  const activeEmail = getActiveAccountEmail();

  console.log(`\nCloudflare Wrangler Accounts:`);
  console.log('────────────────────────────────────────────────────────────────────────────────────────');
  console.log(`  ${'EMAIL'.padEnd(36)} ${'ALIAS'.padEnd(16)} ${'ACCOUNT ID'.padEnd(34)}`);
  console.log('────────────────────────────────────────────────────────────────────────────────────────');

  if (accounts.length === 0) {
    console.log('  No accounts configured. Run `wrangler login` or `wrangler acc add`.');
  } else {
    for (const a of accounts) {
      const prefix = a.is_active ? '* ' : '  ';
      const email = (a.email || (a.has_credentials ? '(run refresh)' : 'no auth')).padEnd(36);
      const alias = (a.alias || '-').padEnd(16);
      const accId = (a.account_id || '-').padEnd(34);
      console.log(`${prefix}${email} ${alias} ${accId}`);
    }
  }

  console.log('────────────────────────────────────────────────────────────────────────────────────────');
  console.log(`* indicates active account. Switch with: wrangler acc switch <email|alias>\n`);
  process.exit(0);
}

function switchAccountByQuery(query) {
  const acc = resolveAccount(query);
  if (!acc) {
    console.error(`Account not found matching: "${query}"`);
    console.error('Use `wrangler acc list` to view available accounts.');
    process.exit(1);
  }

  setActiveAccount(acc.email);
  syncStandardConfig(acc.email);
  const aliasPart = acc.alias ? ` (alias: ${acc.alias})` : '';
  console.log(`Switched active Cloudflare account to '${acc.email}'${aliasPart}`);
  process.exit(0);
}

/**
 * Main CLI entry
 */
async function main() {
  ensureDirectories();
  await autoHealAccounts();
  await importExistingCredentials();

  let rawArgs = process.argv.slice(2);

  // If invoked via shortcut binary name (wrangler-acc or wrangler-account)
  const scriptName = path.basename(process.argv[1] || '');
  if (scriptName === 'wrangler-acc' || scriptName === 'wrangler-account') {
    rawArgs = ['acc', ...rawArgs];
  }

  // Check for built-in management subcommands
  const first = rawArgs[0];
  if (first === 'acc' || first === 'account' || first === 'profile') {
    const handled = await handleAccountCommands(rawArgs);
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

  // Parse per-command selection flags: --acc, --account, (legacy --profile)
  let targetIdentifier = process.env.WRANGLER_ACC || process.env.WRANGLER_ACCOUNT || process.env.WRANGLER_PROFILE || null;
  const forwardedArgs = [];
  let rawEmail = false;
  let noEmail = false;

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];

    if ((arg === '--acc' || arg === '--account' || arg === '--profile') && i + 1 < rawArgs.length) {
      const val = rawArgs[i + 1];
      const matched = resolveAccount(val);
      if (matched) {
        targetIdentifier = val;
        i++;
      } else {
        // If not matching an account or alias, pass through to wrangler
        forwardedArgs.push(arg);
      }
    } else if (arg.startsWith('--acc=')) {
      const val = arg.slice(6);
      const matched = resolveAccount(val);
      if (matched) {
        targetIdentifier = val;
      } else {
        forwardedArgs.push(arg);
      }
    } else if (arg.startsWith('--account=')) {
      const val = arg.slice(10);
      const matched = resolveAccount(val);
      if (matched) {
        targetIdentifier = val;
      } else {
        forwardedArgs.push(arg);
      }
    } else if (arg.startsWith('--profile=')) {
      const val = arg.slice(10);
      targetIdentifier = val;
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

  // Resolve target account
  const account = resolveAccount(targetIdentifier);

  const isGlobalHelp = rawArgs.length === 0 ||
    rawArgs.includes('--help') ||
    rawArgs.includes('-h') ||
    (rawArgs.length === 1 && rawArgs[0] === 'help');

  if (isGlobalHelp) {
    if (!noEmail) {
      const bannerText = formatEmailBanner(account?.email);
      process.stdout.write(`${bannerText}\n`);
    }
    process.stdout.write(getWrapperHelpText());
    process.stdout.write('\n');
    await runWrangler(forwardedArgs, account, {
      scriptPath: __filename,
      suppressBanner: true
    });
    return;
  }

  // Execute
  await runWrangler(forwardedArgs, account, {
    scriptPath: __filename,
    suppressBanner: noEmail
  });
}

module.exports = {
  main,
  handleAccountCommands
};
