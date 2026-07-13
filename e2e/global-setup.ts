import { FullConfig } from '@playwright/test';

/**
 * Global setup — runs once before all tests.
 *
 * Pré-requisitos:
 *   - Supabase de staging acessível (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY)
 *   - Empresa padrão + usuários de teste já criados (admin, doctor, reception, patient)
 *     com senha "TestPassword123!" — script SQL idempotente em supabase/seed/e2e_seed.sql
 *   - Banco resetado antes de cada CI run (ver supabase/seed/reset.sql)
 */
export default async function globalSetup(config: FullConfig) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
  const isLocalAuth = /^https?:\/\/(127\.0\.0\.1|localhost):8000\b/.test(supabaseUrl || '');
  const baseUrl = config.projects[0]?.use?.baseURL || process.env.E2E_BASE_URL || '';
  const isLocalTarget = /^https?:\/\/(127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/.test(String(baseUrl));

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      '[global-setup] VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY são obrigatórios'
    );
  }

  if (!isLocalTarget && process.env.E2E_ALLOW_REMOTE !== 'true') {
    throw new Error(
      '[global-setup] E2E remoto bloqueado por seguranca. Use banco descartavel local ou autorize explicitamente E2E_ALLOW_REMOTE=true.'
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
    console.log('[global-setup] Local auth OK — usando usuários já migrados/seedados no PostgreSQL.');
    return;
  }

  console.log('[global-setup] Backend externo acessivel. Usuarios de teste devem existir previamente; o setup nao executa mutacoes.');
}
