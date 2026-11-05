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
  resolveProfile,
  listProfiles,
  parseWhoamiOutput,
  getActiveProfileName
} = require('../src/profiles');

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

describe('Profiles & Resolution', () => {
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

  it('resolves active profile by default', () => {
    const active = resolveProfile();
    assert.ok(active);
    assert.equal(active.name, getActiveProfileName());
  });

  it('resolves profile by country case-insensitively', () => {
    const prof = resolveProfile('us');
    assert.ok(prof);
    assert.equal(prof.country, 'US');
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

  it('respects --country flag', () => {
    const res = spawnSync('node', [WRAPPER_BIN, '--country', 'US', '--version'], { encoding: 'utf8' });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /Account Email:.*\[Country: US\]/);
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

  it('lists profiles and accounts with wrangler country list', () => {
    const res = spawnSync('node', [WRAPPER_BIN, 'country', 'list'], { encoding: 'utf8' });
    assert.equal(res.status, 0);
    assert.ok(res.stdout.includes('Cloudflare Wrangler Profiles & Accounts:'));
    assert.ok(res.stdout.includes('US'));
    assert.ok(res.stdout.includes('connectwithsanthoshmk@gmail.com'));
  });

  it('displays wrapper commands and flags in global --help output', () => {
    const res = spawnSync('node', [WRAPPER_BIN, '--help'], { encoding: 'utf8' });
    assert.equal(res.status, 0);
    assert.ok(res.stdout.includes('WRAPPER COMMANDS (Multi-Country & Multi-Account for AI Agents)'));
    assert.ok(res.stdout.includes('wrangler country list'));
    assert.ok(res.stdout.includes('wrangler country switch'));
    assert.ok(res.stdout.includes('WRAPPER FLAGS (Applicable to ANY Wrangler command)'));
    assert.ok(res.stdout.includes('--country <code|name>'));
    assert.ok(res.stdout.includes('WRAPPER ENVIRONMENT VARIABLES'));
    assert.ok(res.stdout.includes('WRANGLER_COUNTRY=<code|name>'));
  });

  it('displays domain-specific help for country --help and account --help', () => {
    const resCountry = spawnSync('node', [WRAPPER_BIN, 'country', '--help'], { encoding: 'utf8' });
    assert.equal(resCountry.status, 0);
    assert.ok(resCountry.stdout.includes('wrangler country - Manage and switch Cloudflare accounts by country tag'));
    assert.ok(resCountry.stdout.includes('wrangler country switch <country_code>'));

    const resAccount = spawnSync('node', [WRAPPER_BIN, 'account', '--help'], { encoding: 'utf8' });
    assert.equal(resAccount.status, 0);
    assert.ok(resAccount.stdout.includes('wrangler account - Multi-account profile management'));
    assert.ok(resAccount.stdout.includes('wrangler account switch'));
  });
});
