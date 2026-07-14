const path = require('node:path');

module.exports = {
  apps: [{
    name: 'prontomedic-auth',
    cwd: '/opt/prontomedic/backend',
    script: path.join('/opt/prontomedic/backend', 'local-auth-server.mjs'),
    interpreter: 'node',
    env: {
      NODE_ENV: 'production',
      LOCAL_AUTH_PORT: '8000',
      JWT_SECRET_FILE: '/etc/prontomedic/secrets/jwt_secret',
      PGPASSWORD_FILE: '/etc/prontomedic/secrets/postgres_password',
      PGHOST: '127.0.0.1',
      PGPORT: '5432',
      PGUSER: 'app_prontomedic',
      PGDATABASE: 'prontoclinic'
    },
    max_memory_restart: '512M',
    merge_logs: true,
    time: true
  }]
};
