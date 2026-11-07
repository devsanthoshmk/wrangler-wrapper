const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  parseWranglerToml,
  isCleanOutputRequested,
  findRealWrangler
} = require('../src/utils');

const {
  resolveAccount,
  listAccounts,
  parseWhoamiOutput,
  getActiveAccountEmail,
  setAccountAlias
} = require('../src/accounts');

const WRAPPER_BIN = path.join(__dirname, '..', 'bin', 'wrangler-wrapper.js');

describe('Utils & Parsers', () => {
  it('parses Wrangler toml credentials correctly', () => {
    const tomlSample = `
oauth_token = "test-token-12345"
refresh_token = "test-refresh-67890"
expiration_time = "2026-11-05T08:00:00.000Z"
scopes = ["user:read", "workers:write"]
`;
    const parsed = parseWranglerToml(tomlSample);
    assert.equal(parsed.oauth_token, 'test-token-12345');
    assert.equal(parsed.refresh_token, 'test-refresh-67890');
    assert.equal(parsed.expiration_time, '2026-11-05T08:00:00.000Z');
  });

  it('detects clean/json output requests correctly', () => {
    assert.equal(isCleanOutputRequested(['whoami', '--json']), true);
    assert.equal(isCleanOutputRequested(['d1', 'list', '--json']), true);
    assert.equal(isCleanOutputRequested(['r2', 'object', 'get', '--pipe']), true);
    assert.equal(isCleanOutputRequested(['deploy', '-q']), true);
    assert.equal(isCleanOutputRequested(['dev']), false);
    assert.equal(isCleanOutputRequested(['whoami']), false);
  });

  it('resolves real wrangler path without loop', () => {
    const realBin = findRealWrangler(WRAPPER_BIN);
    assert.ok(realBin);
    assert.notEqual(realBin, WRAPPER_BIN);
  });
});

describe('Accounts & Resolution', () => {
  it('parses email and accounts from whoami text', () => {
    const sampleWhoami = `
 ⛅️ wrangler 4.54.0
──────────────────────────────────────────────
Getting User settings...
👋 You are logged in with an OAuth Token, associated with the email testuser@cloudflare.com.
┌───────────────────────────────────────────┬──────────────────────────────────┐
│ Account Name                              │ Account ID                       │
├───────────────────────────────────────────┼──────────────────────────────────┤
│ My Enterprise Account                     │ a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4 │
└───────────────────────────────────────────┴──────────────────────────────────┘
`;
    const parsed = parseWhoamiOutput(sampleWhoami);
    assert.equal(parsed.email, 'testuser@cloudflare.com');
    assert.equal(parsed.accounts.length, 1);
    assert.equal(parsed.accounts[0].name, 'My Enterprise Account');
    assert.equal(parsed.accounts[0].id, 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4');
  });

  it('resolves active account by default', () => {
    const active = resolveAccount();
    assert.ok(active);
    assert.equal(active.email.toLowerCase(), getActiveAccountEmail().toLowerCase());
  });

  it('resolves account by email case-insensitively', () => {
    const active = resolveAccount();
    if (active?.email) {
      const resolved = resolveAccount(active.email.toUpperCase());
      assert.ok(resolved);
      assert.equal(resolved.email.toLowerCase(), active.email.toLowerCase());
    }
  });

  it('resolves account by alias', () => {
    const active = resolveAccount();
    if (active?.email) {
      setAccountAlias(active.email, 'test-alias-work');
      const resolved = resolveAccount('test-alias-work');
      assert.ok(resolved);
      assert.equal(resolved.email.toLowerCase(), active.email.toLowerCase());
    }
  });
});

describe('CLI Execution & Flags', () => {
  it('executes wrapper and outputs Account Email first', () => {
    const res = spawnSync('node', [WRAPPER_BIN, '--version'], { encoding: 'utf8' });
    assert.equal(res.status, 0);
    const lines = res.stdout.trim().split('\n');
    assert.match(lines[0], /^Account Email:\s+/);
    assert.match(lines[lines.length - 1], /^\d+\.\d+\.\d+/);
  });

  it('respects --acc flag', () => {
    const active = resolveAccount();
    const res = spawnSync('node', [WRAPPER_BIN, '--acc', active.email, '--version'], { encoding: 'utf8' });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /^Account Email:\s+/);
  });

  it('respects --account flag for backwards compatibility', () => {
    const active = resolveAccount();
    const res = spawnSync('node', [WRAPPER_BIN, '--account', active.email, '--version'], { encoding: 'utf8' });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /^Account Email:\s+/);
  });

  it('supports raw email format with --email-only', () => {
    const res = spawnSync('node', [WRAPPER_BIN, '--email-only', '--version'], { encoding: 'utf8' });
    assert.equal(res.status, 0);
    const lines = res.stdout.trim().split('\n');
    assert.match(lines[0], /^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  });

  it('suppresses banner when --no-email is passed', () => {
    const res = spawnSync('node', [WRAPPER_BIN, '--no-email', '--version'], { encoding: 'utf8' });
    assert.equal(res.status, 0);
    assert.ok(!res.stdout.includes('Account Email:'));
  });

  it('routes email to stderr when --json is passed to avoid corrupting json output', () => {
    const res = spawnSync('node', [WRAPPER_BIN, 'whoami', '--json'], { encoding: 'utf8' });
    assert.ok(!res.stdout.startsWith('Account Email:'));
    assert.ok(res.stderr.includes('Account Email:'));
  });

  it('lists accounts with wrangler acc list', () => {
    const res = spawnSync('node', [WRAPPER_BIN, 'acc', 'list'], { encoding: 'utf8' });
    assert.equal(res.status, 0);
    assert.ok(res.stdout.includes('Cloudflare Wrangler Accounts:'));
    assert.ok(res.stdout.includes('connectwithsanthoshmk@gmail.com') || res.stdout.includes('@'));
  });

  it('displays wrapper commands and flags in global --help output', () => {
    const res = spawnSync('node', [WRAPPER_BIN, '--help'], { encoding: 'utf8' });
    assert.equal(res.status, 0);
    assert.ok(res.stdout.includes('WRAPPER COMMANDS (Account Management for Developers & AI Agents)'));
    assert.ok(res.stdout.includes('wrangler acc list'));
    assert.ok(res.stdout.includes('wrangler acc switch'));
    assert.ok(res.stdout.includes('WRAPPER FLAGS (Applicable to ANY Wrangler command)'));
    assert.ok(res.stdout.includes('--acc <email|alias>'));
    assert.ok(res.stdout.includes('WRAPPER ENVIRONMENT VARIABLES'));
    assert.ok(res.stdout.includes('WRANGLER_ACC=<email|alias>'));
  });

  it('displays domain-specific help for acc --help', () => {
    const resAcc = spawnSync('node', [WRAPPER_BIN, 'acc', '--help'], { encoding: 'utf8' });
    assert.equal(resAcc.status, 0);
    assert.ok(resAcc.stdout.includes('wrangler acc - Cloudflare account switcher'));
    assert.ok(resAcc.stdout.includes('wrangler acc switch'));
    assert.ok(resAcc.stdout.includes('wrangler acc alias'));
  });

  it('handles alias subcommand correctly', () => {
    const res = spawnSync('node', [WRAPPER_BIN, 'alias'], { encoding: 'utf8' });
    assert.equal(res.status, 0);
    assert.ok(res.stdout.toLowerCase().includes('alias') || res.stdout.includes('Set-Alias'));
  });
});
