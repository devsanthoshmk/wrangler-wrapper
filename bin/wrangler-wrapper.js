#!/usr/bin/env node
// WRANGLER_WRAPPER
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') process.exit(0);
});
process.stderr.on('error', (err) => {
  if (err.code === 'EPIPE') process.exit(0);
});

const { main } = require('../src/cli');

main().catch((err) => {
  if (err.code === 'EPIPE') process.exit(0);
  console.error('Wrangler wrapper error:', err);
  process.exit(1);
});
