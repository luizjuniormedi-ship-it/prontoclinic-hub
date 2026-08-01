import { expect, test as base } from '@playwright/test';
import { test as authed } from './fixtures/auth';

const NOTIFICATIONS_ROUTE = '/admin/notifications';

type ExternalDependency = {
  name: string;
  readyEnv: string;
  healthUrlEnv: string;
};

const externalDependencies: ExternalDependency[] = [
  {
    name: 'worker de notificações',
    readyEnv: 'E2E_NOTIFICATIONS_WORKER_READY',
    healthUrlEnv: 'E2E_NOTIFICATIONS_WORKER_HEALTH_URL',
  },
  {
    name: 'provedor de e-mail',
    readyEnv: 'E2E_EMAIL_PROVIDER_READY',
    healthUrlEnv: 'E2E_EMAIL_PROVIDER_HEALTH_URL',
  },
  {
    name: 'provedor de SMS',
    readyEnv: 'E2E_SMS_PROVIDER_READY',
    healthUrlEnv: 'E2E_SMS_PROVIDER_HEALTH_URL',
  },
  {
    name: 'provedor de WhatsApp',
    readyEnv: 'E2E_WHATSAPP_PROVIDER_READY',
    healthUrlEnv: 'E2E_WHATSAPP_PROVIDER_HEALTH_URL',
  },
];

authed.describe('Central de Notificações', () => {
  authed.beforeEach(async ({ loginAs }) => {
    await loginAs('admin');
  });

  authed('abre a rota canônica e exibe os controles disponíveis', async ({ page }) => {
    await page.goto(NOTIFICATIONS_ROUTE);

    await expect(page).toHaveURL(new RegExp(`${NOTIFICATIONS_ROUTE}$`));
    await expect(page.getByRole('heading', { name: 'Central de Notificações' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Não lidas' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Todas' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Configurações' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Marcar todas como lidas' })).toBeVisible();
  });

  authed('alterna entre notificações não lidas e todas', async ({ page }) => {
    await page.goto(NOTIFICATIONS_ROUTE);

    const unreadTab = page.getByRole('tab', { name: 'Não lidas' });
    const allTab = page.getByRole('tab', { name: 'Todas' });

    await expect(unreadTab).toHaveAttribute('aria-selected', 'true');
    await allTab.click();
    await expect(allTab).toHaveAttribute('aria-selected', 'true');

    const visibleState = page
      .getByText('Sem notificações', { exact: true })
      .or(page.getByRole('button', { name: 'Marcar como lida' }).first());
    await expect(visibleState).toBeVisible();
  });

  authed('exibe somente as preferências de canais implementadas', async ({ page }) => {
    await page.goto(NOTIFICATIONS_ROUTE);
    await page.getByRole('tab', { name: 'Configurações' }).click();

    await expect(page.getByRole('heading', { name: 'Canais de comunicação' })).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Ativar Notificações no app' })).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Ativar E-mail' })).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Ativar SMS' })).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Ativar WhatsApp' })).toBeVisible();
    await expect(page.getByText(/notificações críticas.*não podem ser desativadas/i)).toBeVisible();
  });
});

for (const dependency of externalDependencies) {
  base(`${dependency.name} responde no endpoint de readiness configurado`, async ({ request }) => {
    const ready = process.env[dependency.readyEnv] === 'true';
    const healthUrl = process.env[dependency.healthUrlEnv];

    base.skip(
      !ready,
      `Defina ${dependency.readyEnv}=true somente após homologar a dependência externa.`,
    );
    expect(
      healthUrl,
      `${dependency.healthUrlEnv} é obrigatório quando ${dependency.readyEnv}=true.`,
    ).toBeTruthy();

    const response = await request.get(healthUrl!);
    expect(
      response.ok(),
      `${dependency.name} indisponível: HTTP ${response.status()}.`,
    ).toBeTruthy();
  });
}
