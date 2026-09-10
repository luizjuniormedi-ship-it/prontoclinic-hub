import { chromium, FullConfig } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { E2E_PASSWORD } from './env';

function runLocalSeed(seedPath: string): void {
  const psqlArgs = ['-X', '-v', 'ON_ERROR_STOP=1', '-f', seedPath];
  const seedEnv = {
    ...process.env,
    E2E_PASSWORD,
    PGCONNECT_TIMEOUT: process.env.PGCONNECT_TIMEOUT || '5',
  };

  try {
    execFileSync('psql', psqlArgs, {
      env: seedEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 45_000,
    });
    return;
  } catch (error) {
    const isMissingPsql =
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT';
    const container = process.env.E2E_PSQL_DOCKER_CONTAINER?.trim();
    if (!isMissingPsql || !container) throw error;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(container)) {
      throw new Error('[global-setup] Nome de container PostgreSQL inválido.');
    }
    if (process.env.DOCKER_HOST) {
      throw new Error('[global-setup] Seed recusado: DOCKER_HOST não pode sobrescrever o contexto local.');
    }

    const dockerHost = execFileSync(
      'docker',
      ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'],
      { encoding: 'utf8', timeout: 10_000 },
    ).trim();
    if (!/^(npipe|unix):/i.test(dockerHost)) {
      throw new Error('[global-setup] Seed recusado: o contexto Docker não é local.');
    }
    const publishedPorts = execFileSync(
      'docker',
      ['port', container, '5432/tcp'],
      { encoding: 'utf8', timeout: 10_000 },
    ).trim().split(/\r?\n/);
    const expectedPort = process.env.PGPORT!;
    const localPublishedPort = new RegExp(
      `^(?:127\\.0\\.0\\.1|0\\.0\\.0\\.0|\\[::1?\\]):${expectedPort}$`,
    );
    if (!publishedPorts.some((address) => localPublishedPort.test(address))) {
      throw new Error(
        '[global-setup] Seed recusado: o container não publica a porta PostgreSQL validada.',
      );
    }

    const containerSeedPath = `/tmp/prontomedic-e2e-seed-${process.pid}.sql`;
    execFileSync('docker', ['cp', seedPath, `${container}:${containerSeedPath}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15_000,
    });
    try {
      const dockerArgs = [
        'exec',
        '-e', 'E2E_PASSWORD',
        '-e', 'E2E_MFA_SECRET',
        '-e', 'AUTH_MFA_ENCRYPTION_KEY',
        container,
        'psql',
        '-X',
        '-v', 'ON_ERROR_STOP=1',
        '-h', '/var/run/postgresql',
        '-U', process.env.PGUSER!,
        '-d', process.env.PGDATABASE!,
        '-f', containerSeedPath,
      ];
      execFileSync('docker', dockerArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 45_000,
      });
    } finally {
      execFileSync('docker', ['exec', container, 'rm', '-f', containerSeedPath], {
        stdio: 'ignore',
        timeout: 10_000,
      });
    }
  }
}

function acquireLocalMutationLock(port: string, database: string): () => void {
  const safeDatabase = database.replace(/[^a-zA-Z0-9_-]/g, '_');
  const lockPath = resolve(tmpdir(), `prontomedic-e2e-${port}-${safeDatabase}.lock`);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const descriptor = openSync(lockPath, 'wx');
      writeFileSync(descriptor, String(process.pid));
      closeSync(descriptor);
      return () => {
        try {
          if (readFileSync(lockPath, 'utf8').trim() === String(process.pid)) {
            unlinkSync(lockPath);
          }
        } catch {
          // O lock pode ter sido removido após uma interrupção do processo.
        }
      };
    } catch (error) {
      const currentPid = Number.parseInt(readFileSync(lockPath, 'utf8').trim(), 10);
      let ownerIsAlive = Number.isInteger(currentPid);
      if (ownerIsAlive) {
        try {
          process.kill(currentPid, 0);
        } catch {
          ownerIsAlive = false;
        }
      }
      if (ownerIsAlive) {
        throw new Error(
          `[global-setup] Banco E2E já está em uso pelo processo ${currentPid}. ` +
          'Não execute suítes mutáveis em paralelo.',
        );
      }
      unlinkSync(lockPath);
      if (attempt === 1) throw error;
    }
  }

  throw new Error('[global-setup] Não foi possível adquirir o lock do banco E2E.');
}

/**
 * Global setup — runs once before all tests.
 *
 * Pré-requisitos:
 *   - Supabase de staging acessível (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY)
 *   - Empresa padrão + usuários de teste já criados (admin, doctor, reception, patient)
 *     com senha fornecida por E2E_PASSWORD — script SQL idempotente em scripts/seed-e2e-users.sql
 *   - Banco resetado antes de cada CI run (ver supabase/seed/reset.sql)
 */
export default async function globalSetup(config: FullConfig) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
  const isLocalAuth = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\b/.test(supabaseUrl || '');

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      '[global-setup] VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY são obrigatórios'
    );
  }

  // 1. Verificar que o backend de auth/rest está acessível.
  // Em staging, validamos o endpoint REST do Supabase. No ambiente local,
  // o servidor customizado expõe /auth/v1/settings como health check.
  const healthUrl = isLocalAuth ? `${supabaseUrl}/auth/v1/settings` : `${supabaseUrl}/rest/v1/`;
  const response = await fetch(healthUrl, {
    headers: { apikey: supabaseKey }
  });
  if (!response.ok) {
    throw new Error(
      `[global-setup] Backend de autenticação não está acessível: HTTP ${response.status}`
    );
  }

  if (isLocalAuth) {
    if (
      process.env.E2E_ENV !== 'local'
      || process.env.E2E_MODE !== 'mutating'
      || process.env.E2E_ALLOW_LOCAL_MUTATIONS !== 'true'
    ) {
      throw new Error(
        '[global-setup] Seed local exige E2E_ENV=local, E2E_MODE=mutating e autorização explícita.',
      );
    }
    const requiredDatabaseEnv = ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER'] as const;
    const missingDatabaseEnv = requiredDatabaseEnv.filter((name) => !process.env[name]);
    if (missingDatabaseEnv.length > 0) {
      throw new Error(
        `[global-setup] Ambiente PostgreSQL local incompleto: ${missingDatabaseEnv.join(', ')}`
      );
    }
    const requiredSeedSecrets = ['E2E_MFA_SECRET', 'AUTH_MFA_ENCRYPTION_KEY'] as const;
    const missingSeedSecrets = requiredSeedSecrets.filter((name) => !process.env[name]);
    if (missingSeedSecrets.length > 0) {
      throw new Error(
        `[global-setup] Segredos das fixtures locais ausentes: ${missingSeedSecrets.join(', ')}`,
      );
    }
    const databaseHost = process.env.PGHOST!.trim().toLowerCase();
    const databaseName = process.env.PGDATABASE!.trim();
    const localDatabaseHosts = new Set(['127.0.0.1', 'localhost', '::1']);
    const disposableDatabaseName =
      /(^|[_-])(e2e|test)([_-]|$)/i.test(databaseName) ||
      /^migrations_(first|second)$/i.test(databaseName);
    if (!localDatabaseHosts.has(databaseHost) || !disposableDatabaseName) {
      throw new Error(
        '[global-setup] Seed recusado: use apenas PostgreSQL local e banco descartável E2E/test.'
      );
    }

    const releaseMutationLock = acquireLocalMutationLock(
      process.env.PGPORT!,
      process.env.PGDATABASE!,
    );
    try {
      runLocalSeed(resolve(process.cwd(), 'scripts/seed-e2e-users.sql'));
    } catch (error) {
      releaseMutationLock();
      const stderr = error instanceof Error && 'stderr' in error
        ? String((error as Error & { stderr?: Buffer }).stderr || '')
        : '';
      const sensitiveValues = [
        E2E_PASSWORD,
        process.env.E2E_MFA_SECRET,
        process.env.AUTH_MFA_ENCRYPTION_KEY,
      ].filter((value): value is string => Boolean(value));
      const safeDetails = sensitiveValues
        .reduce((details, value) => details.replaceAll(value, '<redacted>'), stderr)
        .trim();
      throw new Error(
        `[global-setup] Falha restaurando fixtures locais.${safeDetails ? ` ${safeDetails}` : ''}`,
      );
    }
    console.log('[global-setup] Local auth OK — fixtures E2E restauradas no PostgreSQL.');
    return releaseMutationLock;
  }

  console.log('[global-setup] Supabase OK — verificando usuários de teste...');

  if (process.env.E2E_ALLOW_REMOTE_USER_PROVISIONING !== 'true') {
    console.log('[global-setup] Provisionamento remoto desativado; usando usuários pré-existentes.');
    return;
  }

  // 2. Criar/atualizar usuários de teste (idempotente via signUp + error handling).
  //    Em staging, desabilitar confirmação de e-mail para que login funcione direto.
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  const users = [
    { email: 'admin@prontomedic.test', role: 'admin' as const },
    { email: 'doctor@prontomedic.test', role: 'doctor' as const },
    { email: 'recepcao@prontomedic.test', role: 'reception' as const },
    { email: 'paciente@prontomedic.test', role: 'patient' as const }
  ];

  for (const u of users) {
    try {
      const res = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
        // Endpoint de admin requer service role — em staging usa-se chave de serviço.
        // Como fallback, usa signUp público; falha de "already registered" é OK.
        method: 'POST',
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: u.email,
          password: E2E_PASSWORD,
          email_confirm: true,
          user_metadata: { role: u.role, e2e_seed: true }
        })
      });
      if (!res.ok && res.status !== 422) {
        const body = await res.text();
        console.warn(`[global-setup] Falha criando ${u.email}: ${res.status} ${body}`);
      }
    } catch (err) {
      console.warn(`[global-setup] Erro ao criar ${u.email}:`, err);
    }
  }

  await browser.close();
  console.log('[global-setup] Pronto.');
}
