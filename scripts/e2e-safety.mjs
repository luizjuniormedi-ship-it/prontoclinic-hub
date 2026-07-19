const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const PRODUCTION_HOST_PATTERNS = [
  /(^|\.)prod(uction)?\./i,
  /(^|\.)production\./i,
  /(^|\.)medilife\./i,
  /(^|\.)datasigh\./i,
  /vps/i
];

export const E2E_MODES = new Set(['readonly', 'mutating', 'destructive']);

export function parseUrl(value, label = 'E2E_BASE_URL') {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`[e2e-safety] ${label} deve ser uma URL absoluta: ${value}`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error(`[e2e-safety] ${label} deve usar HTTP(S) sem credenciais embutidas`);
  }
  return url;
}

export function isProductionHost(hostname) {
  return PRODUCTION_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
}

export function assertE2ESafety(env = process.env) {
  const baseURL = env.E2E_BASE_URL || 'http://127.0.0.1:8080';
  const url = parseUrl(baseURL);
  const mode = env.E2E_MODE || 'readonly';
  const environment = env.E2E_ENV || 'local';
  const allowedHosts = new Set([
    ...Array.from(LOCAL_HOSTS),
    ...(env.E2E_ALLOWED_HOSTS || '').split(',').map((host) => host.trim()).filter(Boolean)
  ]);

  if (!E2E_MODES.has(mode)) throw new Error(`[e2e-safety] E2E_MODE inválido: ${mode}`);
  if (!['local', 'staging'].includes(environment)) {
    throw new Error(`[e2e-safety] E2E_ENV deve ser local ou staging, recebido: ${environment}`);
  }
  if (isProductionHost(url.hostname) || !allowedHosts.has(url.hostname)) {
    throw new Error(`[e2e-safety] URL fora da allowlist ou potencialmente produtiva: ${url.origin}`);
  }
  if (environment === 'local' && !LOCAL_HOSTS.has(url.hostname)) {
    throw new Error('[e2e-safety] E2E_ENV=local só permite localhost/loopback');
  }
  if (environment === 'staging' && LOCAL_HOSTS.has(url.hostname)) {
    throw new Error('[e2e-safety] E2E_ENV=staging exige host de homologação explícito');
  }
  if (mode !== 'readonly' && environment === 'local' && env.E2E_ALLOW_LOCAL_MUTATIONS !== 'true') {
    throw new Error(`[e2e-safety] E2E_MODE=${mode} local exige E2E_ALLOW_LOCAL_MUTATIONS=true`);
  }
  if (mode === 'destructive' && env.E2E_ALLOW_DESTRUCTIVE !== 'true') {
    throw new Error('[e2e-safety] testes destructive exigem E2E_ALLOW_DESTRUCTIVE=true');
  }
  if (env.CI && !env.E2E_AUTH_READY) {
    throw new Error('[e2e-safety] CI exige usuários de teste pré-provisionados (E2E_AUTH_READY=true)');
  }
  return { baseURL: url.toString(), mode, environment };
}
