const fs = require('fs');
const path = require('path');
const { HOME } = require('./constants');

function detectShellConfigFile() {
  const isWindows = process.platform === 'win32';
  if (isWindows) {
    const userProfile = process.env.USERPROFILE || HOME;
    const psProfile = path.join(userProfile, 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1');
    const winPsProfile = path.join(userProfile, 'Documents', 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1');
    if (fs.existsSync(psProfile)) return { file: psProfile, type: 'powershell' };
    if (fs.existsSync(winPsProfile)) return { file: winPsProfile, type: 'powershell' };
    return { file: psProfile, type: 'powershell' };
  }

  const shell = process.env.SHELL || '';
  if (shell.includes('zsh')) {
    const zshrc = path.join(HOME, '.zshrc');
    return { file: zshrc, type: 'posix' };
  }
  if (shell.includes('fish')) {
    const fishConfig = path.join(HOME, '.config', 'fish', 'config.fish');
    return { file: fishConfig, type: 'fish' };
  }

  const bashrc = path.join(HOME, '.bashrc');
  const bashProfile = path.join(HOME, '.bash_profile');
  if (fs.existsSync(bashrc)) return { file: bashrc, type: 'posix' };
  if (fs.existsSync(bashProfile)) return { file: bashProfile, type: 'posix' };
  return { file: bashrc, type: 'posix' };
}

function getAliasCommand(type) {
  if (type === 'powershell') {
    return 'Set-Alias -Name wrangler -Value wrangler-wrapper';
  }
  if (type === 'fish') {
    return 'alias wrangler wrangler-wrapper';
  }
  return 'alias wrangler="wrangler-wrapper"';
}

function setupAlias() {
  const { file, type } = detectShellConfigFile();
  const aliasLine = getAliasCommand(type);

  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let content = '';
  if (fs.existsSync(file)) {
    content = fs.readFileSync(file, 'utf8');
  }

  if (content.includes(aliasLine) || content.includes('alias wrangler=')) {
    console.log(`Alias already present in ${file}.`);
    console.log(`Run 'source ${file}' or open a new terminal to use it.`);
    return true;
  }

  const separator = content.endsWith('\n') || content.length === 0 ? '' : '\n';
  fs.appendFileSync(file, `${separator}# Cloudflare wrangler-wrapper alias\n${aliasLine}\n`);

  console.log(`Added alias to ${file}:`);
  console.log(`  ${aliasLine}`);
  console.log(`\nRun 'source ${file}' or open a new terminal tab to start using 'wrangler'.`);
  return true;
}

function removeAlias() {
  const { file, type } = detectShellConfigFile();
  const aliasLine = getAliasCommand(type);

  if (!fs.existsSync(file)) {
    console.log(`Config file ${file} does not exist.`);
    return true;
  }

  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');
  const filtered = lines.filter(line =>
    !line.includes(aliasLine) &&
    !line.includes('wrangler-wrapper alias')
  );

  if (lines.length === filtered.length) {
    console.log(`No wrangler alias found in ${file}.`);
    return true;
  }

  fs.writeFileSync(file, filtered.join('\n'), 'utf8');
  console.log(`Removed wrangler alias from ${file}.`);
  return true;
}

module.exports = {
  detectShellConfigFile,
  getAliasCommand,
  setupAlias,
  removeAlias
};
