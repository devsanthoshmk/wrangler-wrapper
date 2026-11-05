# ⛅ Wrangler Wrapper for AI Agents

> **Multi-Account & Country-Aware CLI Wrapper for Cloudflare Wrangler with Automatic Account Email Output.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org)
[![Wrangler](https://img.shields.io/badge/wrangler-v4-orange.svg)](https://developers.cloudflare.com/workers/wrangler/)

---

## 💡 Why This Wrapper?

When AI coding agents (such as Claude Code, Cursor, OpenCode, OpenChamber, or Devin) execute Cloudflare commands, they face several critical bottlenecks:
1. **Unidentified Accounts**: Standard Wrangler output does not report which account or email was used, making it impossible for automated agents to confirm whether a command deployed to production, staging, or a personal account.
2. **Disruptive Login Cycles**: Modern Cloudflare OAuth uses **single-use refresh token rotation**. Switching between client, personal, or regional accounts by running `wrangler login` and `wrangler logout` constantly invalidates credentials and breaks unattended workflows.
3. **High Latency**: Probing `wrangler whoami` on every command takes **~2.5 seconds** because Wrangler boots a 300,000-line bundle and makes several network roundtrips.
4. **Regional / Country Targeting**: AI agents frequently need to target regional accounts or country-specific deployments (e.g., US vs EU vs India) without interactive prompts.

**Wrangler Wrapper** solves all of this:
- **Outputs Account Email First**: Prints the active account email as the first line for every request (`Account Email: user@example.com [Country: US]`).
- **Country & Account Switching**: Select accounts on the fly with `--country <tag>` or `--account <id>`, or switch persistent active profiles.
- **Isolated Profile Sandboxes**: Each profile has its own isolated credentials, allowing seamless automatic OAuth token refresh without collision.
- **Sub-5ms Latency**: Fast local metadata caching bypasses network overhead.
- **Piping & JSON Safe**: When commands specify `--json`, `--pipe`, or `-q`, banner text is directed to `stderr` to ensure stdout streams (`| jq` or binary images) remain 100% uncorrupted.

---

## 🚀 Installation

### Option 1: Direct Symlink into `~/.local/bin` (Recommended)

Ensure `~/.local/bin` is in your `$PATH` (standard on modern Linux and macOS):

```bash
# 1. Clone the repository
git clone https://github.com/devsanthoshmk/wrangler-wrapper.git ~/.local/share/wrangler-wrapper
cd ~/.local/share/wrangler-wrapper

# 2. Make the CLI executable
chmod +x bin/wrangler-wrapper.js

# 3. Create symlinks in ~/.local/bin
ln -sf ~/.local/share/wrangler-wrapper/bin/wrangler-wrapper.js ~/.local/bin/wrangler-wrapper
ln -sf ~/.local/share/wrangler-wrapper/bin/wrangler-wrapper.js ~/.local/bin/wrangler
ln -sf ~/.local/share/wrangler-wrapper/bin/wrangler-wrapper.js ~/.local/bin/wrangler-country
ln -sf ~/.local/share/wrangler-wrapper/bin/wrangler-wrapper.js ~/.local/bin/wrangler-account
```

Because `~/.local/bin` precedes global Node/NVM binaries in `$PATH`, any invocation of `wrangler ...` will automatically run through the wrapper!

---

### Option 2: Global NPM Link

```bash
cd /path/to/wrangler-wrapper
npm link
```

This creates the global `wrangler-wrapper` command. You can then alias it in your `~/.bashrc` or `~/.zshrc`:
```bash
alias wrangler="wrangler-wrapper"
```

---

## ⚡ Quick Start

### 1. Initial Setup

On first run, the wrapper automatically detects and imports any existing credentials from `~/.config/.wrangler/config/default.toml` as your `default` profile:

```bash
# List configured profiles and countries
wrangler country list
```

### 2. Tag Profiles with Countries

Assign a country code (e.g., `US`, `IN`, `UK`, `EU`) to your account:

```bash
wrangler account set-country default US
```

### 3. Adding Additional Accounts / Profiles

You can add profiles using an API Token directly:
```bash
wrangler account add client-eu --country EU --token <CLOUDFLARE_API_TOKEN> --email dev@client.eu
```

Or log in via OAuth inside an isolated sandbox:
```bash
XDG_CONFIG_HOME="$HOME/.config/wrangler-wrapper/profiles/client-in" wrangler login
wrangler account set-country client-in IN
```

---

## 📖 Usage Guide for AI Agents & Developers

### Standard Execution (Always shows Email First)

Every command prints the account email at offset 0:

```bash
$ wrangler dev
Account Email: connectwithsanthoshmk@gmail.com [Country: US]

 ⛅️ wrangler 4.54.0
───────────────────
Starting local server...
```

```bash
$ wrangler deploy
Account Email: connectwithsanthoshmk@gmail.com [Country: US]

Total Upload: 12.45 KiB / gzip: 3.12 KiB
Uploaded worker (1.23 sec)
Published my-worker (0.45 sec)
  https://my-worker.example.workers.dev
```

### Targeting a Country or Account on the Fly

You can switch target accounts per-command without changing your global active profile:

```bash
# Target account by Country tag
wrangler --country US dev
wrangler --country IN deploy

# Target account by Profile Name or Email
wrangler --account client-eu whoami
wrangler --account dev@client.eu d1 list

# Target via Environment Variables (ideal for CI/CD or Agent sessions)
WRANGLER_COUNTRY=IN wrangler deploy
WRANGLER_ACCOUNT=client-eu wrangler dev
```

### Switching the Active Account Globally

```bash
# Switch by country tag
wrangler country switch IN

# Switch by profile name or email
wrangler account switch client-eu
wrangler account switch connectwithsanthoshmk@gmail.com
```

### Inspecting Current Profile

```bash
$ wrangler account current
Active Profile : default
Account Email  : connectwithsanthoshmk@gmail.com
Country        : US
Account ID     : baf33b93c7066cf63c3f364c5e97c476
Account Name   : Connectwithsanthoshmk@gmail.com's Account
```

---

## 🛡️ Safe Structured Output (`--json` & Piping)

When an AI agent or script pipes output to `jq` or downloads binary files:

```bash
# JSON commands route the email line to stderr automatically:
$ wrangler d1 list --json | jq .
```
- `stdout`: Contains 100% valid JSON parseable by `jq` or `JSON.parse()`.
- `stderr`: Displays `Account Email: user@example.com [Country: US]`.

---

## 🎛️ Command & Flag Reference

### Subcommands

| Command | Description |
|---|---|
| `wrangler country list` | View formatted table of all accounts, emails, IDs, and country tags |
| `wrangler country switch <code>` | Switch persistent active account by country code (`US`, `IN`, etc.) |
| `wrangler account list` | View all configured profiles and credentials |
| `wrangler account switch <id>` | Switch persistent active profile by name, email, or country |
| `wrangler account current` | Display details for the currently active profile |
| `wrangler account set-country <id> <c>` | Assign a country tag to an existing account profile |
| `wrangler account add <name> [flags]` | Create profile (`--country`, `--token`, `--email`) |
| `wrangler account remove <name>` | Delete a saved profile |
| `wrangler account refresh [name]` | Re-fetch and update metadata from Cloudflare API |

### Flags (Applicable to Any Wrangler Command)

| Flag | Description |
|---|---|
| `--country <code\|name>` | Run command using the account tagged with this country |
| `--account <name\|email>` | Run command using a specific profile name or email |
| `--profile <name>` | Run command using the specified profile directory sandbox |
| `--email-only`, `--raw-email` | Output only the raw email address on line 1 (no prefix/suffix) |
| `--no-email` | Suppress the email header line completely |

### Environment Variables

| Variable | Description | Default |
|---|---|---|
| `WRANGLER_COUNTRY` | Default country tag for commands | None |
| `WRANGLER_ACCOUNT` | Default account email or profile name | None |
| `WRANGLER_PROFILE` | Default profile directory name | `default` |
| `WRANGLER_EMAIL_STREAM` | Output stream for email line (`stdout` or `stderr`) | Auto (`stdout` for text, `stderr` for `--json`/`--pipe`) |
| `WRANGLER_EMAIL_FORMAT` | Custom format template (e.g. `Account: %s`) | `Account Email: %s [Country: %c]` |

---

## 🏗️ Architecture

```text
~/.config/wrangler-wrapper/
├── active_profile          # Stores current active profile ("default")
├── config.json             # Country mappings, aliases, and global options
└── profiles/
    ├── default/
    │   ├── profile.json    # Cached metadata: email, account_id, country
    │   └── .wrangler/
    │       └── config/
    │           └── default.toml  # OAuth tokens (isolated)
    └── client-eu/
        ├── profile.json
        └── .wrangler/
            └── config/
                └── default.toml
```

### Self-Recursion Prevention
When installed as `~/.local/bin/wrangler`, the wrapper dynamically walks `$PATH` while ignoring its own real path (`fs.realpathSync()`) and checking candidate binary headers, resolving the true underlying Wrangler binary without infinite process loops.

### Full TTY & Signal Forwarding
Built on `child_process.spawn()` with `stdio: 'inherit'`, forwarding `SIGINT`, `SIGTERM`, and `SIGHUP` directly to the child process. Interactive terminal applications like `wrangler dev` (with keyboard shortcuts `b`, `r`, `x`) and log tailing (`wrangler tail`) operate with zero degradation.

---

## 🧪 Running Tests

The test suite covers TOML parsing, stream safety, CLI flags, country resolution, and native help output:

```bash
npm test
```

---

## 📄 License

MIT License. See [LICENSE](LICENSE) for details.
