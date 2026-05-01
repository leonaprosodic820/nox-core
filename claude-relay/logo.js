const logo = `
\x1b[38;5;51m
    ██████╗ ██████╗  ██████╗ ███╗   ███╗███████╗████████╗██╗  ██╗███████╗██╗   ██╗███████╗
    ██╔══██╗██╔══██╗██╔═══██╗████╗ ████║██╔════╝╚══██╔══╝██║  ██║██╔════╝██║   ██║██╔════╝
    ██████╔╝██████╔╝██║   ██║██╔████╔██║█████╗     ██║   ███████║█████╗  ██║   ██║███████╗
    ██╔═══╝ ██╔══██╗██║   ██║██║╚██╔╝██║██╔══╝     ██║   ██╔══██║██╔══╝  ██║   ██║╚════██║
    ██║     ██║  ██║╚██████╔╝██║ ╚═╝ ██║███████╗   ██║   ██║  ██║███████╗╚██████╔╝███████║
    ╚═╝     ╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚══════╝   ╚═╝   ╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚══════╝
\x1b[0m`;

const sep = '\x1b[38;5;27m' + '\u2550'.repeat(88) + '\x1b[0m';

const badge = (label, value, color = '51') =>
  `  \x1b[38;5;240m${label.padEnd(22)}\x1b[0m \x1b[38;5;${color}m${value}\x1b[0m`;

function printLogo() {
  console.log(logo);
  console.log(sep);
  console.log();
  console.log(
    '  \x1b[1m\x1b[38;5;51m\u26A1  CLAUDE RELAY\x1b[0m' +
    '\x1b[38;5;240m  \u00D7  \x1b[0m' +
    '\x1b[38;5;171mPROMETHEUS v7.2\x1b[0m' +
    '\x1b[38;5;240m  \u00D7  \x1b[0m' +
    '\x1b[38;5;82mIntelligence Autonome\x1b[0m'
  );
  console.log();
  console.log(badge('Brain', 'Claude Max CLI  (claude -p)'));
  console.log(badge('Port', '7777  \u2192  http://localhost:7777'));
  console.log(badge('Remote', 'https://cmd.omnixai.tech'));
  console.log(badge('Modules', '35+ modules backend'));
  console.log(badge('Security', 'AES-256-GCM + Zero Trust + JWT'));
  console.log(badge('Status', '\u26A1 OPERATIONNEL', '82'));
  console.log();
  console.log(sep);
  console.log();
}

module.exports = { printLogo };
