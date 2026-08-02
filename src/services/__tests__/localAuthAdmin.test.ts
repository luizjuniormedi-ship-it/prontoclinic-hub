import { describe, expect, it, vi } from 'vitest';
import { createLocalAuthAdmin, createWebhookMailProvider, mailProviderFromEnv } from '../../../local-auth-admin.mjs';

function harness(overrides: Record<string, unknown> = {}) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const responses: Array<{ rowCount: number; rows: any[] }> = [];
  const client = {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      if (/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL ROLE service_role)$/.test(sql)) {
        return { rowCount: 0, rows: [] };
      }
      return responses.shift() ?? { rowCount: 0, rows: [] };
    }),
    release: vi.fn(),
  };
  const mailProvider = { send: vi.fn(async () => undefined) };
  const service = createLocalAuthAdmin({
    pool: { connect: vi.fn(async () => client) },
    signJwt: vi.fn(() => 'signed.jwt'),
    mailProvider,
    publicAuthUrl: 'https://auth.example.test',
    now: () => new Date('2026-08-02T12:00:00.000Z'),
    randomToken: () => 'raw-secret-token',
    uuid: vi.fn()
      .mockReturnValueOnce('10000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('10000000-0000-4000-8000-000000000002')
      .mockReturnValueOnce('10000000-0000-4000-8000-000000000003')
      .mockReturnValueOnce('10000000-0000-4000-8000-000000000004'),
    ...overrides,
  } as any);
  return { service, client, calls, responses, mailProvider };
}

describe('local auth admin challenges', () => {
  it('persiste apenas o hash e confirma o convite somente depois da entrega', async () => {
    const h = harness();
    h.responses.push(
      { rowCount: 0, rows: [] },
      { rowCount: 1, rows: [{ id: 'user-1', email: 'nova@example.test', raw_user_meta_data: {} }] },
      { rowCount: 1, rows: [] },
    );
    const result = await h.service.invite({
      email: ' Nova@Example.Test ', data: { full_name: 'Nova' }, redirectTo: 'https://app.example.test/reset-password',
    });
    expect(result.status).toBe(200);
    const challenge = h.calls.find((call) => call.sql.includes('INSERT INTO private.local_auth_challenges'))!;
    expect(challenge.values).not.toContain('raw-secret-token');
    expect(String(challenge.values?.[2])).toMatch(/^[a-f0-9]{64}$/);
    expect(h.mailProvider.send).toHaveBeenCalledWith(expect.objectContaining({
      template: 'invite',
      actionUrl: expect.stringContaining('token=raw-secret-token'),
    }));
    expect(h.calls.at(-1)?.sql).toBe('COMMIT');
  });

  it('remove o desafio quando o convite não pode ser entregue', async () => {
    const h = harness({ mailProvider: { send: vi.fn(async () => { throw new Error('provider down'); }) } });
    h.responses.push(
      { rowCount: 0, rows: [] },
      { rowCount: 1, rows: [{ id: 'user-1', email: 'nova@example.test' }] },
      { rowCount: 1, rows: [] },
    );
    await expect(h.service.invite({ email: 'nova@example.test', redirectTo: 'https://app.example.test/reset-password' }))
      .rejects.toThrow('provider down');
    expect(h.calls.some((call) => call.sql.includes('DELETE FROM private.local_auth_challenges'))).toBe(true);
    expect(h.calls.at(-1)?.sql).toBe('ROLLBACK');
  });

  it('mantém recuperação não enumerável e reverte falha de entrega', async () => {
    const h = harness({ mailProvider: { send: vi.fn(async () => { throw new Error('provider down'); }) } });
    h.responses.push(
      { rowCount: 1, rows: [{ id: 'user-1', email: 'known@example.test' }] },
      { rowCount: 1, rows: [] },
    );
    await expect(h.service.recover({
      email: 'known@example.test', redirectTo: 'https://app.example.test/reset-password',
    }))
      .resolves.toEqual({ status: 200, body: {} });
    expect(h.calls.some((call) => call.sql.includes("type = 'recovery' AND consumed_at IS NULL"))).toBe(true);
    expect(h.calls.some((call) => call.sql.includes('DELETE FROM private.local_auth_challenges'))).toBe(true);
    expect(h.calls.at(-1)?.sql).toBe('COMMIT');
  });

  it.each([
    ['inexistente', []],
    ['fora da empresa', []],
    ['sem email', []],
  ])('responde uniformemente para alvo %s sem entregar mensagem', async (_case, rows) => {
    const h = harness();
    h.responses.push({ rowCount: rows.length, rows });
    await expect(h.service.recover({
      email: 'target@example.test', redirectTo: 'https://app.example.test/reset-password',
    })).resolves.toEqual({ status: 200, body: {} });
    expect(h.mailProvider.send).not.toHaveBeenCalled();
    expect(h.calls[2].sql).toContain('FROM auth.users');
  });

  it('não consulta o alvo quando o payload público é inválido', async () => {
    const h = harness();
    await expect(h.service.recover({
      email: '', redirectTo: 'https://app.example.test/reset-password',
    })).resolves.toEqual({ status: 200, body: {} });
    expect(h.client.query).not.toHaveBeenCalled();
  });

  it('consome uma única vez e devolve sessão no fragmento esperado pelo frontend', async () => {
    const h = harness();
    h.responses.push({
      rowCount: 1,
      rows: [{
        id: 'user-1', email: 'known@example.test', redirect_to: 'https://app.example.test/reset-password',
        raw_app_meta_data: {}, raw_user_meta_data: {},
      }],
    }, { rowCount: 1, rows: [] });
    const result = await h.service.consume({ token: 'raw-secret-token', type: 'recovery' });
    expect(result.status).toBe(302);
    expect(result.location).toContain('#access_token=signed.jwt');
    expect(result.location).toContain('type=recovery');
    expect(h.calls[2].sql).toContain('consumed_at IS NULL');
    expect(h.calls[2].sql).toContain('expires_at > NOW()');
  });

  it('rejeita token expirado ou já consumido sem emitir sessão', async () => {
    const h = harness();
    h.responses.push({ rowCount: 0, rows: [] });
    await expect(h.service.consume({ token: 'old', type: 'invite' }))
      .resolves.toEqual({ status: 400, body: { message: 'Token expired or already used' } });
    expect(h.calls.at(-1)?.sql).toBe('ROLLBACK');
  });

  it('configura entrega webhook server-side sem expor token de autenticação na URL', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 202 }));
    const provider = createWebhookMailProvider({
      url: 'https://mailer.example.test/send', bearerToken: 'server-secret', fetchImpl: fetchImpl as any,
    });
    await provider.send({ to: 'user@example.test', actionUrl: 'https://auth.example.test/verify' });
    expect(fetchImpl).toHaveBeenCalledWith('https://mailer.example.test/send', expect.objectContaining({
      headers: expect.objectContaining({ authorization: 'Bearer server-secret' }),
    }));
  });

  it('exige configuração SMTP completa em modo smtp', () => {
    expect(() => mailProviderFromEnv({
      LOCAL_AUTH_MAIL_PROVIDER: 'smtp', LOCAL_AUTH_SMTP_HOST: 'smtp.example.test',
      LOCAL_AUTH_SMTP_PORT: '587', LOCAL_AUTH_MAIL_FROM: 'no-reply@example.test',
    } as any)).not.toThrow();
    expect(() => mailProviderFromEnv({ LOCAL_AUTH_MAIL_PROVIDER: 'smtp' } as any)).toThrow(/SMTP/);
  });
});
