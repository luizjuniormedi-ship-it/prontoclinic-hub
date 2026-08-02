const path = require('node:path');

const runtimeRoot = process.env.PRONTOMEDIC_AUTH_ROOT || '/opt/prontomedic/auth-runtime';
const current = path.join(runtimeRoot, 'current');

module.exports = {
  apps: [{
    name: process.env.PRONTOMEDIC_AUTH_PM2_PROCESS || 'prontomedic-auth',
    script: path.join(current, 'local-auth-server.mjs'),
    cwd: current,
    interpreter: 'node',
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    max_restarts: 5,
    min_uptime: '10s',
    kill_timeout: 10000,
    listen_timeout: 10000,
    env: { LOCAL_AUTH_MODE: 'production' },
  }],
};
