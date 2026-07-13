import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const origin = 'http://localhost:4173';
const host = '127.0.0.1';

async function reservePort() {
  const socket = createServer();
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(0, host, resolve);
  });
  const { port } = socket.address();
  await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForServer(url, child) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`local-auth-server encerrou antes do preflight (exit ${child.exitCode})`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // O processo ainda pode estar abrindo a porta.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('local-auth-server nao ficou pronto em 5 segundos');
}

const port = await reservePort();
const baseUrl = `http://${host}:${port}`;
const child = spawn(process.execPath, ['local-auth-server.mjs'], {
  cwd: new URL('..', import.meta.url),
  env: {
    ...process.env,
    LOCAL_AUTH_PORT: String(port),
    JWT_SECRET: 'cors-contract-test-secret-at-least-32-characters',
    CORS_ALLOWED_ORIGINS: origin,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stderr = '';
child.stderr.on('data', (chunk) => { stderr += chunk; });

try {
  await waitForServer(`${baseUrl}/auth/v1/settings`, child);

  const response = await fetch(`${baseUrl}/rest/v1/user_profiles`, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-profile',
    },
  });

  assert.equal(response.status, 204, 'preflight deve responder HTTP 204');
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  assert.equal(response.headers.get('vary'), 'Origin');

  const allowedHeaders = (response.headers.get('access-control-allow-headers') || '')
    .split(',')
    .map((header) => header.trim().toLowerCase());
  assert.ok(allowedHeaders.includes('content-profile'), 'content-profile deve ser permitido no preflight');

  const allowedMethods = (response.headers.get('access-control-allow-methods') || '')
    .split(',')
    .map((method) => method.trim().toUpperCase());
  assert.ok(allowedMethods.includes('OPTIONS'), 'OPTIONS deve constar nos metodos permitidos');
  assert.equal(await response.text(), '', 'preflight 204 nao deve retornar corpo');

  console.log('CORS preflight contract passed: content-profile is allowed.');
} finally {
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
  if (stderr) process.stderr.write(stderr);
}
