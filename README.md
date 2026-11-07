# Cloudflare Wrangler multi-account switcher

A zero-dependency Wrangler CLI wrapper that manages multiple Cloudflare accounts, switches active credentials, and prints the authenticated account email on line 1 of every run.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org)
[![Wrangler](https://img.shields.io/badge/wrangler-v4-orange.svg)](https://developers.cloudflare.com/workers/wrangler/)

---

## Purpose

Cloudflare Wrangler stores authentication credentials in a single global configuration file at `~/.config/.wrangler/config/default.toml`. Cloudflare OAuth uses single-use refresh token rotation. Logging into a second account invalidates active sessions for previous accounts, forcing developers to log out and re-authenticate repeatedly.

Standard Wrangler also omits the logged-in email address during commands like `wrangler dev` and `wrangler deploy`. Developers and automated AI agents cannot determine which account executes a command without running `wrangler whoami`, which adds 2.5 seconds of network latency.

`wrangler-wrapper` eliminates this friction:
- Isolates OAuth tokens into dedicated account sandboxes under `~/.config/wrangler-wrapper/accounts/<email>/`.
- Switches active accounts instantly by email address or optional short alias (`wrangler acc switch <email|alias>`).
- Prints the authenticated account email on line 1 in under 5 milliseconds.
- Redirects account banners to standard error when passing `--json`, `--pipe`, `-q`, or `--silent`, keeping standard output clean for `jq` and binary pipes.
- Synchronizes credentials back to `~/.config/.wrangler/config/default.toml` so IDE extensions and external tools continue to function.

---

## Architecture

The wrapper acts as a transparent execution shim around your installed `wrangler` executable.

```text
~/.config/wrangler-wrapper/
├── active_account          # Plain text file containing active email address
├── config.json             # Global configuration and aliases
└── accounts/
    ├── user@example.com/
    │   ├── account.json    # Cached email, account ID, and optional alias
    │   └── .wrangler/
    │       └── config/
    │           └── default.toml  # Isolated Cloudflare OAuth token
    └── work@company.com/
        ├── account.json
        └── .wrangler/
            └── config/
                └── default.toml
```

### Isolated configuration environments

The wrapper sets `XDG_CONFIG_HOME` to the selected account directory. Wrangler stores and refreshes credentials in `<account-dir>/.wrangler/config/default.toml`. Refreshing tokens in one account leaves all other account sandboxes untouched.

### System credential synchronization

When switching accounts, the wrapper replaces `~/.config/.wrangler/config/default.toml` with a symlink pointing to the active account configuration file. If symlink creation fails, the wrapper copies the file. Direct calls to `wrangler` by IDE extensions automatically use the active account.

### Binary resolution and recursion prevention

When installed as `wrangler` in `~/.local/bin` or through shell aliases, the wrapper scans directories in `$PATH` to locate the real Wrangler executable. The wrapper resolves symlinks with `fs.realpathSync`, checks file headers for wrapper markers, and skips itself to prevent infinite execution loops.

### Process execution and terminal interaction

The wrapper executes the underlying Wrangler executable with Node.js `child_process.spawn` and sets `stdio: 'inherit'`. Interactive hotkeys in `wrangler dev`, such as `b` to open a browser, `r` to reload, and `x` to quit, operate without interruption. Signals including `SIGINT`, `SIGTERM`, and `SIGHUP` forward directly to the child process.

### Sub-5 millisecond email banner

The wrapper caches authenticated emails and account identifiers in `account.json`. Commands read the local JSON file on startup and print the header before spawning Wrangler. If an account lacks cached details, the wrapper runs a quick lookup via the Cloudflare API or `wrangler whoami` and saves the result.

---

## Setup

### Global installation

Install the wrapper globally with npm:

```bash
npm install -g devsanthoshmk/wrangler-wrapper
```

This command installs `wrangler-wrapper`, `wrangler-acc`, and `wrangler-account`.

### Shell alias configuration

Configure your shell to run `wrangler` through the wrapper automatically:

```bash
wrangler-wrapper alias
```

The command inspects your active environment and appends the alias to your shell profile (`~/.zshrc`, `~/.bashrc`, `~/.config/fish/config.fish`, or Windows PowerShell `$PROFILE`).

To remove the alias, run `wrangler-wrapper unalias`.

### Manual installation via symlink

Clone the repository and symlink the binary into a directory on your `$PATH`:

```bash
git clone https://github.com/devsanthoshmk/wrangler-wrapper.git ~/.local/share/wrangler-wrapper
chmod +x ~/.local/share/wrangler-wrapper/bin/wrangler-wrapper.js

mkdir -p ~/.local/bin
ln -sf ~/.local/share/wrangler-wrapper/bin/wrangler-wrapper.js ~/.local/bin/wrangler
ln -sf ~/.local/share/wrangler-wrapper/bin/wrangler-wrapper.js ~/.local/bin/wrangler-wrapper
ln -sf ~/.local/share/wrangler-wrapper/bin/wrangler-wrapper.js ~/.local/bin/wrangler-acc
ln -sf ~/.local/share/wrangler-wrapper/bin/wrangler-wrapper.js ~/.local/bin/wrangler-account
```

---

## Usage

### First run and default import

On first run, the wrapper imports existing credentials from `~/.config/.wrangler/config/default.toml` into an account directory named after your authenticated email.

List all configured accounts:

```bash
wrangler acc list
```

Run any Wrangler command. The wrapper prints the active account email on line 1, then executes Wrangler:

```bash
wrangler whoami
```

Output:

```text
Account Email: user@example.com

 ⛅️ wrangler 4.54.0
──────────────────────────────────────────────
Getting User settings...
👋 You are logged in with an OAuth Token, associated with the email user@example.com.
```

---

### Account listing

List saved accounts, emails, aliases, and account IDs:

```bash
wrangler acc list
# or
wrangler acc ls
```

Display the active account details:

```bash
wrangler acc current
```

---

### Account switching

Switch the active account globally by email address or optional alias:

```bash
# Switch by email address
wrangler acc switch user@example.com

# Switch by alias
wrangler acc switch work
```

The syntax `wrangler account switch` is also supported as an alias for backwards compatibility.

---

### Assigning an optional alias

Assign a short alias to an account email:

```bash
wrangler acc alias user@example.com work
```

You can now switch or target this account using `work` instead of typing the full email.

---

### Command-level account overrides

Select an account for a single command without modifying the global active account:

```bash
# Select by email address
wrangler --acc user@example.com d1 list

# Select by alias
wrangler --acc work deploy

# Select via environment variable
WRANGLER_ACC=work wrangler dev
```

The flag `--account` is also accepted for backwards compatibility. The wrapper removes the flag before passing arguments to Wrangler.

---

### Adding accounts

Add an account via interactive browser login:

```bash
wrangler acc add
# or with an optional alias
wrangler acc add --alias work
```

Add an account using a Cloudflare API token:

```bash
wrangler acc add --token secret-cf-token --email user@example.com --alias prod
```

---

### Removing accounts

Delete a saved account and its aliases:

```bash
wrangler acc remove user@example.com
# or by alias
wrangler acc remove work
```

---

### Refreshing credentials

Update cached email and account information from Cloudflare:

```bash
wrangler acc refresh
wrangler acc refresh user@example.com
```

When you execute `wrangler login` or `wrangler logout`, the wrapper updates cached metadata automatically upon process completion.

---

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

---

## Configuration

### Subcommands

| Command | Aliases | Description |
|---|---|---|
| `wrangler acc list` | `ls` | List all saved accounts, aliases, and account IDs |
| `wrangler acc current` | None | Display active account details |
| `wrangler acc switch <target>` | `use` | Switch active account by email or alias |
| `wrangler acc alias <email> <alias>` | None | Assign a short alias to an email address |
| `wrangler acc add [flags]` | None | Add an account via login or API token (`--token`, `--email`, `--alias`) |
| `wrangler acc remove <target>` | `rm` | Remove a saved account and its aliases |
| `wrangler acc refresh [target]` | None | Refresh cached account metadata from Cloudflare |
| `wrangler acc import` | None | Import credentials from `~/.config/.wrangler/config/default.toml` |
| `wrangler-wrapper alias` | `setup-alias` | Detect shell configuration and register `wrangler` alias |
| `wrangler-wrapper unalias` | `remove-alias` | Remove `wrangler` alias from shell configuration |

The `wrangler account <subcommand>` syntax functions as an alias for `wrangler acc <subcommand>`.

### Command-line flags

| Flag | Description |
|---|---|
| `--acc <email\|alias>` | Execute command with the account matching this email or alias |
| `--acc=<email\|alias>` | Execute command with the account matching this email or alias |
| `--account <email\|alias>` | Backwards-compatible alias for `--acc` |
| `--email-only`, `--raw-email` | Print only the plain email address on line 1 |
| `--no-email` | Suppress email banner output |
| `--json`, `--pipe`, `-q`, `--silent` | Forwarded flags that cause wrapper to route email banner to standard error |

### Environment variables

| Variable | Description |
|---|---|
| `WRANGLER_ACC` | Overrides active account by email or alias |
| `WRANGLER_ACCOUNT` | Backwards-compatible alias for `WRANGLER_ACC` |
| `WRANGLER_EMAIL_STREAM` | Directs email banner stream to `stdout` or `stderr` |
| `WRANGLER_EMAIL_FORMAT` | Custom email banner template, or `raw` for plain email |
| `WRANGLER_EMAIL_RAW` | Set to `1` to output only the plain email address |
| `WRANGLER_NO_EMAIL` | Set to `1` to suppress email banner output |
| `WRANGLER_WRAPPER_DIR` | Custom directory path for configuration and accounts |
| `REAL_WRANGLER_BIN` | Explicit file path to the target Wrangler executable |

---

### Account resolution order

When resolving an account identifier, the wrapper evaluates queries in this sequence:
1. Alias match from `config.json` aliases mapping.
2. Exact email match (case-insensitive).
3. Account alias property match.
4. Account ID exact match.
5. Account name substring match.
6. Fallback to active account if query is omitted.

---

## License

MIT. See [LICENSE](LICENSE).
