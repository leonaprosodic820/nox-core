const os = require('os');
const USER = os.userInfo().username;

module.exports = {
  apps: [
    {
      name: 'claude-relay',
      script: 'server.js',
      cwd: `/Users/${USER}/claude-relay`,
      watch: false,
      autorestart: true,
      max_restarts: 999999,
      restart_delay: 1000,
      min_uptime: '5s',
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 7777,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || ''
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      out_file: `/Users/${USER}/claude-relay/logs/pm2-out.log`,
      error_file: `/Users/${USER}/claude-relay/logs/pm2-error.log`,
      exp_backoff_restart_delay: 100
    },
    {
      name: 'cloudflared',
      script: 'cloudflared',
      interpreter: 'none',
      args: `tunnel --config /Users/${USER}/.cloudflared/config.yml run claude-relay`,
      watch: false,
      autorestart: true,
      max_restarts: 999999,
      restart_delay: 3000,
      out_file: `/Users/${USER}/claude-relay/logs/cf-out.log`,
      error_file: `/Users/${USER}/claude-relay/logs/cf-error.log`
    }
  ]
};
