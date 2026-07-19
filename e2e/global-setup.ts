import { FullConfig } from '@playwright/test';

/**
 * Global setup — runs once before all tests.
 *
 * Usuários e dados devem ser provisionados fora deste processo, em ambiente de teste.
 * Este setup é deliberadamente somente leitura: não usa service role, não cria usuários
 * administrativos e não chama endpoints de reset/seed.
 */
export default async function globalSetup(config: FullConfig) {
  void config;
  if (process.env.E2E_AUTH_READY !== 'true') {
    throw new Error('[global-setup] E2E_AUTH_READY=true é obrigatório; provisionamento fica fora do Playwright.');
  }
  console.log('[global-setup] autenticação pré-provisionada confirmada; nenhuma mutação executada.');
}
