import { chromium, FullConfig } from '@playwright/test';

/**
 * Global setup — runs once before all tests.
 *
 * Pré-requisitos:
 *   - Supabase de staging acessível (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY)
 *   - Empresa padrão + usuários de teste já criados (admin, doctor, reception, patient)
 *     com senha "TestPassword123!" — seed efêmero em scripts/ci-seed-e2e.sql
 *   - Banco resetado antes de cada CI run (ver supabase/seed/reset.sql)
 */
export default async function globalSetup(config: FullConfig) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
  const allowUserProvisioning = process.env.E2E_ALLOW_USER_PROVISIONING === 'true';
  const serviceRoleKey = process.env.E2E_SERVICE_ROLE_KEY;
  const isLocalAuth = /^https?:\/\/(127\.0\.0\.1|localhost):8000\b/.test(supabaseUrl || '');

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
    console.log('[global-setup] Local auth OK — usando usuários já migrados/seedados no PostgreSQL.');
    return;
  }

  if (!allowUserProvisioning) {
    console.log(
      '[global-setup] Supabase OK — provisionamento remoto desabilitado; usando usuários existentes.'
    );
    return;
  }

  if (!serviceRoleKey) {
    throw new Error(
      '[global-setup] E2E_SERVICE_ROLE_KEY é obrigatório quando E2E_ALLOW_USER_PROVISIONING=true'
    );
  }

  console.log('[global-setup] Supabase OK — provisionamento remoto explicitamente habilitado...');

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
        // Endpoint de admin requer service role. Nunca reutilizar a chave pública.
        method: 'POST',
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: u.email,
          password: 'TestPassword123!',
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

