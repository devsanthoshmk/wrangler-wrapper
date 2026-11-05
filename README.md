# Wrangler account switch and profile manager

A CLI wrapper for Cloudflare multi-account management that switches accounts and profiles with one command, tags accounts by country code, and prints the active account email on every run.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org)
[![Wrangler](https://img.shields.io/badge/wrangler-v4-orange.svg)](https://developers.cloudflare.com/workers/wrangler/)

---

## Why switch accounts with a wrapper

Cloudflare Wrangler stores credentials in one global file. Switching accounts natively requires repeated `wrangler logout` and `wrangler login` commands. Because Cloudflare OAuth uses single-use refresh token rotation, logging into one account often breaks active sessions for other accounts.

Standard Wrangler also omits the logged-in email from output during `wrangler dev` or `wrangler deploy`. Developers and automated AI agents cannot verify which account ran a command without running a separate `wrangler whoami` check, which takes 2.5 seconds per run.

This wrapper solves Cloudflare multi-account friction:
- Switches accounts instantly with `wrangler account switch <name|email|country>` or the `--account` flag.
- Isolates tokens into separate profile directories under `~/.config/wrangler-wrapper/profiles/`. Cloudflare token refreshes stay inside each profile sandbox.
- Prints the active account email as line 1 on every command in under 5 milliseconds.
- Redirects the email header to stderr when `--json` or `--pipe` is present so stdout stays valid for `jq` and binary downloads.

---

## Installation

### Method 1: Symlink to local bin (recommended)

Clone the repository and link the binary into `~/.local/bin`:

```bash
git clone https://github.com/devsanthoshmk/wrangler-wrapper.git ~/.local/share/wrangler-wrapper
chmod +x ~/.local/share/wrangler-wrapper/bin/wrangler-wrapper.js

mkdir -p ~/.local/bin
ln -sf ~/.local/share/wrangler-wrapper/bin/wrangler-wrapper.js ~/.local/bin/wrangler
ln -sf ~/.local/share/wrangler-wrapper/bin/wrangler-wrapper.js ~/.local/bin/wrangler-wrapper
ln -sf ~/.local/share/wrangler-wrapper/bin/wrangler-wrapper.js ~/.local/bin/wrangler-country
ln -sf ~/.local/share/wrangler-wrapper/bin/wrangler-wrapper.js ~/.local/bin/wrangler-account
```

Make sure `~/.local/bin` comes before your global node path in `$PATH`:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Running `which wrangler` should now point to `/home/<user>/.local/bin/wrangler`.

### Method 2: Global npm link

```bash
cd /path/to/wrangler-wrapper
npm link
```

Add an alias to your shell configuration file (`~/.bashrc` or `~/.zshrc`):

```bash
alias wrangler="wrangler-wrapper"
```

---

## Quick start

On its first run, the wrapper imports your current credentials from `~/.config/.wrangler/config/default.toml` into a profile named `default`.

View all configured accounts and profiles:

```bash
wrangler account list
```

Assign a country code to the default account:

```bash
wrangler account set-country default US
```

Run any Wrangler command. The wrapper outputs the active account email first, then passes all arguments to Wrangler:

```bash
wrangler whoami
```

Output:
```text
Account Email: connectwithsanthoshmk@gmail.com [Country: US]

 ⛅️ wrangler 4.54.0
──────────────────────────────────────────────
Getting User settings...
👋 You are logged in with an OAuth Token, associated with the email connectwithsanthoshmk@gmail.com.
```

---

## How to switch accounts in Wrangler

### Switch active profile globally (wrangler switch profile)

Switch your default active account by profile name, email address, or country tag:

```bash
# Switch by profile name
wrangler account switch staging

# Switch by email address
wrangler account switch user@example.com

# Switch by country code
wrangler country switch IN
```

When you switch profiles with `wrangler account switch` or `wrangler country switch`, the wrapper updates the active profile pointer and synchronizes `~/.config/.wrangler/config/default.toml`. Third-party tools that invoke Wrangler directly continue to use the active profile credentials.

### Switch accounts for a single command

Target a specific account without changing your global active profile:

```bash
# Target by account name or email
wrangler --account staging deploy
wrangler --account user@example.com d1 list

# Target by country code
wrangler --country US dev
wrangler --country IN deploy

# Target via environment variables
WRANGLER_ACCOUNT=staging wrangler dev
WRANGLER_COUNTRY=IN wrangler deploy
```

The wrapper removes the `--account` and `--country` flags before executing Wrangler to prevent argument parse errors.

### Add a new account

Add an account with a Cloudflare API token:

```bash
wrangler account add prod --country US --token <CLOUDFLARE_API_TOKEN> --email prod@company.com
```

Or authenticate a new profile with browser OAuth:

```bash
XDG_CONFIG_HOME="$HOME/.config/wrangler-wrapper/profiles/client-uk" wrangler login
wrangler account set-country client-uk UK
```

---

## Safe structured output with jq and json

AI agents and automated shell scripts frequently pipe Wrangler output into `jq` or file redirects. Printing text to stdout breaks JSON parsing and corrupts binary image downloads.

When you pass `--json`, `--pipe`, `-q`, or `--silent`, the wrapper sends the account email banner to stderr:

```bash
wrangler d1 list --json | jq .
```

`stdout` contains clean JSON for `jq`. `stderr` receives `Account Email: connectwithsanthoshmk@gmail.com [Country: US]`.

---

## Command reference

### Subcommands

| Command | Action |
|---|---|
| `wrangler country list` | List accounts, emails, account IDs, and assigned country codes |
| `wrangler country switch <code>` | Switch active account by country code |
| `wrangler account list` | List all saved profiles |
| `wrangler account current` | Print active profile name, email, account ID, and country |
| `wrangler account switch <id>` | Switch active profile by name, email, or country |
| `wrangler account set-country <id> <code>` | Assign a country code to an existing profile |
| `wrangler account add <name> [flags]` | Create profile with `--country`, `--token`, and `--email` |
| `wrangler account remove <name>` | Delete a saved profile |
| `wrangler account refresh [name]` | Update profile cache from Cloudflare API |

### Flags

| Flag | Action |
|---|---|
| `--country <code\|name>` | Run command with the account assigned to this country code |
| `--account <name\|email>` | Run command with this account profile or email |
| `--profile <name>` | Run command using this profile directory sandbox |
| `--email-only`, `--raw-email` | Print only the email address on line 1 without extra text |
| `--no-email` | Omit the email line |

### Environment variables

| Variable | Description |
|---|---|
| `WRANGLER_COUNTRY` | Selects account by country code for commands in current shell |
| `WRANGLER_ACCOUNT` | Selects account by name or email for commands in current shell |
| `WRANGLER_PROFILE` | Selects profile directory |
| `WRANGLER_EMAIL_STREAM` | Force output stream: `stdout` or `stderr` |
| `WRANGLER_EMAIL_FORMAT` | Template string, such as `Account: %s` |

---

## How it works

```text
~/.config/wrangler-wrapper/
├── active_profile          # Active profile name ("default")
├── config.json             # Country mappings and aliases
└── profiles/
    ├── default/
    │   ├── profile.json    # Cached email, account ID, and country
    │   └── .wrangler/
    │       └── config/
    │           └── default.toml  # OAuth token file
    └── staging/
        ├── profile.json
        └── .wrangler/
            └── config/
                └── default.toml
```

1. **Path resolution without recursion.** When installed as `~/.local/bin/wrangler`, the wrapper searches `$PATH` for the next `wrangler` executable. It inspects canonical paths with `fs.realpathSync()` and skips candidate files containing its own header marker to prevent infinite execution loops.
2. **Profile isolation.** Wrangler determines its config directory via `XDG_CONFIG_HOME`. For each profile, the wrapper sets `XDG_CONFIG_HOME=~/.config/wrangler-wrapper/profiles/<name>`. Each account keeps its own token file and refreshes OAuth tokens independently.
3. **Sub-5ms startup.** The wrapper caches the resolved email, account name, and account ID in `profile.json`. Commands read this JSON file directly instead of making network calls or running Wrangler subprocesses.
4. **Process control.** The wrapper uses `child_process.spawn()` with `stdio: 'inherit'`. Interactive hotkeys in `wrangler dev` (such as `b` to open browser, `r` to reload, and `x` to quit) work normally. Signals (`SIGINT`, `SIGTERM`, `SIGHUP`) pass straight through to the child process.

---

## License

MIT. See [LICENSE](LICENSE).
