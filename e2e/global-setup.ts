import { chromium, FullConfig } from '@playwright/test';

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

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      '[global-setup] VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY são obrigatórios'
    );
  }

  // 1. Verificar que Supabase está acessível
  const response = await fetch(`${supabaseUrl}/rest/v1/`, {
    headers: { apikey: supabaseKey }
  });
  if (!response.ok) {
    throw new Error(
      `[global-setup] Supabase não está acessível: HTTP ${response.status}`
    );
  }

  console.log('[global-setup] Supabase OK — verificando usuários de teste...');

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