const path = require('node:path');
const fs = require('node:fs');

const runtimeRoot = process.env.PRONTOMEDIC_AUTH_ROOT || '/opt/prontomedic/auth-runtime';
const current = path.join(runtimeRoot, 'current');
const envPath = process.env.PRONTOMEDIC_AUTH_ENV_JSON || path.join(runtimeRoot, 'secrets', '.env.auth.json');
const runtimeEnv = fs.existsSync(envPath) ? JSON.parse(fs.readFileSync(envPath, 'utf8')) : {};
const appScript = process.env.PRONTOMEDIC_AUTH_SCRIPT || path.join(current, 'local-auth-server.mjs');
const cwd = process.env.PRONTOMEDIC_AUTH_CWD || current;
const nodeBinary = process.env.PRONTOMEDIC_AUTH_NODE || '/usr/bin/node';

module.exports = {
  apps: [{
    name: process.env.PRONTOMEDIC_AUTH_PM2_PROCESS || 'prontomedic-auth',
    script: nodeBinary,
    args: [appScript],
    cwd,
    interpreter: 'none',
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    max_restarts: 5,
    min_uptime: '10s',
    kill_timeout: 10000,
    listen_timeout: 10000,
    env: { ...runtimeEnv, LOCAL_AUTH_MODE: 'production' },
  }],
};
