# Cloudflare Wrangler multi-account manager and profile switcher

A zero-dependency CLI wrapper for Cloudflare Wrangler that manages multiple Cloudflare accounts, switches active profiles, tags accounts by country code, and prints the active account email on every run.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org)
[![Wrangler](https://img.shields.io/badge/wrangler-v4-orange.svg)](https://developers.cloudflare.com/workers/wrangler/)

## Purpose

Cloudflare Wrangler stores authentication credentials in a single global configuration file at `~/.config/.wrangler/config/default.toml`. Cloudflare OAuth uses single-use refresh token rotation. Logging into a second account invalidates active sessions for previous accounts, which forces developers to log out and re-authenticate repeatedly.

Standard Wrangler also omits the logged-in email address during commands like `wrangler dev` and `wrangler deploy`. Developers and automated scripts cannot determine which account executes a command without running `wrangler whoami`, which adds 2.5 seconds of network delay per command.

`wrangler-wrapper` eliminates this friction. The wrapper:
- Isolates OAuth tokens and credentials into individual profile directories under `~/.config/wrangler-wrapper/profiles/`.
- Switches active accounts by profile name, account email, or country code.
- Prints the authenticated account email as the first line of output in under 5 milliseconds.
- Redirects account banners to standard error when passing `--json`, `--pipe`, `-q`, or `--silent`, keeping standard output clean for `jq` and binary pipes.
- Synchronizes credentials back to `~/.config/.wrangler/config/default.toml` so external tools and editors continue to function.

## Architecture

The wrapper acts as a transparent execution shim around the installed `wrangler` executable.

```text
~/.config/wrangler-wrapper/
├── active_profile          # Plain text file containing the active profile name
├── config.json             # Global configuration, country mappings, and aliases
└── profiles/
    ├── default/
    │   ├── profile.json    # Cached email, account ID, and country tag
    │   └── .wrangler/
    │       └── config/
    │           └── default.toml  # Isolated Wrangler OAuth token
    └── production/
        ├── profile.json
        └── .wrangler/
            └── config/
                └── default.toml
```

### Isolated configuration environments

The wrapper sets the `XDG_CONFIG_HOME` environment variable to the selected profile directory. Wrangler stores and refreshes credentials in `<profile-dir>/.wrangler/config/default.toml`. Refreshing tokens in one profile leaves all other profile sandboxes untouched.

### System credential synchronization

When switching profiles, the wrapper removes `~/.config/.wrangler/config/default.toml` and creates a symlink to the active profile configuration file. If symlink creation fails, the wrapper copies the file. Direct calls to `wrangler` by IDE extensions or global scripts automatically use the active profile.

### Binary resolution and recursion prevention

When installed as `wrangler` in `~/.local/bin` or through shell aliases, the wrapper scans directories in `$PATH` to locate the real Wrangler executable. The wrapper resolves symlinks with `fs.realpathSync`, checks file headers for wrapper markers, and skips itself to prevent infinite execution loops.

### Process execution and terminal interaction

The wrapper executes the underlying Wrangler executable with Node.js `child_process.spawn` and sets `stdio: 'inherit'`. Interactive hotkeys in `wrangler dev`, such as `b` to open a browser, `r` to reload, and `x` to quit, operate without interruption. Signals including `SIGINT`, `SIGTERM`, and `SIGHUP` forward directly to the child process.

### Sub-5 millisecond email banner

The wrapper caches profile emails and account identifiers in `profile.json`. Commands read the local JSON file on startup and print the header before spawning Wrangler. If a profile lacks cached details, the wrapper runs a quick lookup via the Cloudflare API or `wrangler whoami` and saves the result.

## Setup

### Global installation

Install the wrapper globally with npm:

```bash
npm install -g devsanthoshmk/wrangler-wrapper
```

This command installs three executable entry points, `wrangler-wrapper`, `wrangler-account`, and `wrangler-country`.

### Shell alias configuration

Configure your shell to run `wrangler` through the wrapper automatically:

```bash
wrangler-wrapper alias
```

The command detects your shell configuration file, including `.zshrc`, `.bashrc`, `config.fish`, or Windows PowerShell `$PROFILE`, and appends the alias.

To configure the alias manually:

```bash
# Zsh
echo 'alias wrangler="wrangler-wrapper"' >> ~/.zshrc && source ~/.zshrc

# Bash
echo 'alias wrangler="wrangler-wrapper"' >> ~/.bashrc && source ~/.bashrc

# Fish
alias -s wrangler="wrangler-wrapper"

# PowerShell
Add-Content $PROFILE 'Set-Alias -Name wrangler -Value wrangler-wrapper'
```

To remove the alias, run:

```bash
wrangler-wrapper unalias
```

### Manual installation with symlinks

To install the wrapper without global npm permissions:

```bash
git clone https://github.com/devsanthoshmk/wrangler-wrapper.git ~/.local/share/wrangler-wrapper
chmod +x ~/.local/share/wrangler-wrapper/bin/wrangler-wrapper.js

mkdir -p ~/.local/bin
ln -sf ~/.local/share/wrangler-wrapper/bin/wrangler-wrapper.js ~/.local/bin/wrangler
ln -sf ~/.local/share/wrangler-wrapper/bin/wrangler-wrapper.js ~/.local/bin/wrangler-wrapper
ln -sf ~/.local/share/wrangler-wrapper/bin/wrangler-wrapper.js ~/.local/bin/wrangler-country
ln -sf ~/.local/share/wrangler-wrapper/bin/wrangler-wrapper.js ~/.local/bin/wrangler-account
```

Ensure `~/.local/bin` is present in your `$PATH`:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

### Credential import

On its first invocation, the wrapper imports existing credentials from `~/.config/.wrangler/config/default.toml` into a profile named `default`. You can also trigger this import manually:

```bash
wrangler account import
```

## Usage

### Quick start

List all configured accounts and profiles:

```bash
wrangler account list
```

Assign a country code to the default profile:

```bash
wrangler account set-country default US
```

Run any Wrangler command. The wrapper prints the active account email on line 1, then executes Wrangler:

```bash
wrangler whoami
```

Output:

```text
Account Email: user@example.com [Country: US]

 ⛅️ wrangler 4.54.0
──────────────────────────────────────────────
Getting User settings...
👋 You are logged in with an OAuth Token, associated with the email user@example.com.
```

### Profile listing

List configured profiles and their assigned country codes, emails, and account IDs:

```bash
wrangler account list
# or
wrangler account ls
# or
wrangler country list
```

Display the active profile details:

```bash
wrangler account current
```

### Profile switching

Switch the active profile globally by name, account email, or country code:

```bash
# Switch by profile name
wrangler account switch production
# or
wrangler account use production

# Switch by account email
wrangler account switch user@example.com

# Switch by country code
wrangler country switch IN
```

### Command-level profile overrides

Select a profile for a single command without modifying the global active profile:

```bash
# Select by profile name or email
wrangler --account production deploy
wrangler --account user@example.com d1 list

# Select by country code
wrangler --country US dev
wrangler --country IN deploy

# Select via profile directory name
wrangler --profile production pages deploy

# Select via environment variables
WRANGLER_ACCOUNT=production wrangler dev
WRANGLER_COUNTRY=IN wrangler deploy
WRANGLER_PROFILE=production wrangler whoami
```

The wrapper removes `--account`, `--country`, and `--profile` flags before passing arguments to Wrangler.

### Adding profiles

Create a profile using OAuth authentication:

```bash
XDG_CONFIG_HOME="$HOME/.config/wrangler-wrapper/profiles/client-uk" wrangler login
wrangler account set-country client-uk UK
```

Create a profile using an API token:

```bash
wrangler account add production --country US --token secret-cf-token --email user@example.com
```

### Removing profiles

Delete a profile directory:

```bash
wrangler account remove staging
# or
wrangler account rm staging
```

### Refreshing credentials

Update cached email and account information from Cloudflare:

```bash
wrangler account refresh
wrangler account refresh production
```

When you execute `wrangler login` or `wrangler logout`, the wrapper updates cached metadata automatically upon process completion.

### Safe output pipelines

Automated scripts and AI agents often parse command output using `jq`. Printing banner text to standard output corrupts JSON structures.

When you supply `--json`, `--pipe`, `-q`, or `--silent`, the wrapper sends the account banner to standard error:

```bash
wrangler d1 list --json | jq .
```

Standard output receives clean JSON. Standard error receives the account email banner.

To output only the raw email address without formatting:

```bash
wrangler whoami --email-only
# or
wrangler whoami --raw-email
```

To suppress the email banner completely:

```bash
wrangler whoami --no-email
```

## Configuration

### Subcommands

| Command | Aliases | Description |
|---|---|---|
| `wrangler account list` | `ls` | List all saved profiles, country tags, emails, and account IDs |
| `wrangler country list` | `ls` | List all profiles with country code focus |
| `wrangler account current` | None | Display active profile details |
| `wrangler account switch <target>` | `use` | Switch active profile by name, email, or country |
| `wrangler country switch <code>` | `use` | Switch active profile by country code |
| `wrangler account set-country <name> <code>` | None | Assign a country code to a profile |
| `wrangler account add <name> [flags]` | None | Create a profile with optional `--country`, `--token`, and `--email` |
| `wrangler account remove <name>` | `rm` | Remove a profile directory |
| `wrangler account refresh [name]` | None | Refresh cached account metadata from Cloudflare |
| `wrangler account import` | None | Import credentials from `~/.config/.wrangler/config/default.toml` into default profile |
| `wrangler-wrapper alias` | `setup-alias` | Detect shell configuration and register `wrangler` alias |
| `wrangler-wrapper unalias` | `remove-alias` | Remove `wrangler` alias from shell configuration |

The `wrangler profile <subcommand>` syntax functions as an alias for `wrangler account <subcommand>`.

### Command-line flags

| Flag | Description |
|---|---|
| `--country <code\|name>` | Execute command with the profile mapped to this country code |
| `--country=<code\|name>` | Execute command with the profile mapped to this country code |
| `--account <name\|email>` | Execute command with the profile matching this name or email |
| `--account=<name\|email>` | Execute command with the profile matching this name or email |
| `--profile <name>` | Execute command within this profile directory sandbox |
| `--profile=<name>` | Execute command within this profile directory sandbox |
| `--email-only`, `--raw-email` | Print only the plain email address on line 1 |
| `--no-email` | Suppress email banner output |
| `--json`, `--pipe`, `-q`, `--silent` | Forwarded flags that cause wrapper to route email banner to standard error |

### Environment variables

| Variable | Description |
|---|---|
| `WRANGLER_COUNTRY` | Overrides active profile by country code |
| `WRANGLER_ACCOUNT` | Overrides active profile by account name or email |
| `WRANGLER_PROFILE` | Overrides active profile by directory name |
| `WRANGLER_EMAIL_STREAM` | Directs email banner stream to `stdout` or `stderr` |
| `WRANGLER_EMAIL_FORMAT` | Custom email banner template, or `raw` for plain email |
| `WRANGLER_EMAIL_RAW` | Set to `1` to output only the plain email address |
| `WRANGLER_NO_EMAIL` | Set to `1` to suppress email banner output |
| `WRANGLER_WRAPPER_DIR` | Custom directory path for configuration and profiles |
| `REAL_WRANGLER_BIN` | Explicit file path to the target Wrangler executable |

### Profile resolution order

When resolving a profile identifier, the wrapper evaluates queries in this sequence:
1. Exact or lowercase profile directory name.
2. Profile country tag or `country_map` entry in `config.json`.
3. Profile email address.
4. Profile aliases array.
5. Account ID exact match.
6. Account name substring match.

## License

MIT. See [LICENSE](LICENSE).
