import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expect, loginAsRole, test } from './fixtures/auth';

const A = { company: 'eeeeeeee-1000-4000-8000-000000000001', unit: 91001 };
const B = { company: 'eeeeeeee-1000-4000-8000-000000000002', unit: 92001 };
const projection = 'id,company_id,unit_id,full_name';
type Patient = { id: string; company_id: string; unit_id: string; full_name: string };

function numericId(value: unknown, field: string): string {
  if ((typeof value !== 'string' && typeof value !== 'number')
    || (typeof value === 'number' && !Number.isSafeInteger(value))
    || !/^[1-9]\d*$/.test(String(value))) {
    throw new Error(`Invalid or missing ${field} in REST response`);
  }
  return String(value);
}

function requireLocalUrl(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password) throw new Error(`${name} must be a loopback URL`);
  return url.origin;
}

async function http(page: Page, method: string, query: string, body?: object) {
  const origin = requireLocalUrl(process.env.VITE_SUPABASE_URL, 'VITE_SUPABASE_URL');
  const apikey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!apikey) throw new Error('VITE_SUPABASE_ANON_KEY is required');
  return page.evaluate(async ({ origin, apikey, method, query, body }) => {
    const key = Object.keys(localStorage).find((item) => item.startsWith('sb-') && item.endsWith('-auth-token'));
    const session = key ? JSON.parse(localStorage.getItem(key) || 'null') : null;
    if (!session?.access_token) throw new Error('Authenticated browser session missing');
    const response = await fetch(`${origin}/rest/v1/patients?${query}`, {
      method, redirect: 'error',
      headers: { apikey, authorization: `Bearer ${session.access_token}`,
        'content-type': 'application/json', prefer: 'return=representation,count=exact' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, text: await response.text(), count: response.headers.get('content-range') };
  }, { origin, apikey, method, query, body });
}

function rows(text: string): Patient[] {
  const value = JSON.parse(text);
  const records = Array.isArray(value) ? value
    : value && typeof value === 'object' && Object.keys(value).length === 0 ? [] : [value];
  return records.map((record) => {
    if (!record || typeof record.company_id !== 'string' || !record.company_id
      || typeof record.full_name !== 'string') throw new Error('Invalid patient REST response');
    return { ...record, id: numericId(record.id, 'id'), unit_id: numericId(record.unit_id, 'unit_id') };
  });
}

test.describe('HTTP company isolation on real PostgreSQL', () => {
  test.describe.configure({ mode: 'serial', retries: 0 });

  test('GET COUNT POST PATCH isolate A/B with positive controls and owner readback', async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(180_000);
    if (process.env.E2E_ENV !== 'local' || process.env.E2E_MODE !== 'mutating'
      || process.env.E2E_ALLOW_LOCAL_MUTATIONS !== 'true') {
      throw new Error('Requires E2E_ENV=local E2E_MODE=mutating E2E_ALLOW_LOCAL_MUTATIONS=true');
    }
    if (testInfo.project.name !== 'chromium') throw new Error('Run this mutating gate with --project=chromium');
    requireLocalUrl(baseURL, 'E2E_BASE_URL');
    requireLocalUrl(process.env.VITE_SUPABASE_URL, 'VITE_SUPABASE_URL');
    if (!['localhost', '127.0.0.1', '::1'].includes(process.env.PGHOST || '')
      || !/(^|[_-])(e2e|test)([_-]|$)|^migrations_(first|second)$/i.test(process.env.PGDATABASE || '')) {
      throw new Error('Requires local disposable PGDATABASE (same database as the auth server)');
    }
    for (const key of ['PGPORT', 'PGUSER', 'E2E_PASSWORD', 'E2E_MFA_SECRET', 'AUTH_MFA_ENCRYPTION_KEY']) {
      if (!process.env[key]) throw new Error(`${key} is required by the existing seed/auth harness`);
    }

    const contexts = [await browser.newContext({ baseURL }), await browser.newContext({ baseURL })];
    const marker = `HTTP-ISOLATION-${randomUUID()}`;
    await testInfo.attach('synthetic-marker', { body: marker, contentType: 'text/plain' });
    try {
      const pages = [await contexts[0].newPage(), await contexts[1].newPage()];
      await loginAsRole(pages[0], 'admin');
      await loginAsRole(pages[1], 'adminB');
      for (const [index, page] of pages.entries()) {
        const selector = page.getByRole('button', { name: 'Selecionar empresa, unidade e perfil' });
        await expect(selector).toBeEnabled();
        await selector.click();
        await page.getByRole('menuitem', {
          name: index === 0 ? /Empresa E2E.*Unidade E2E A.*admin/ : /Empresa E2E Isolamento B.*Unidade E2E Isolamento B.*admin/,
        }).click();
        await expect(page.locator('#main-content')).toHaveAttribute('data-access-context-status', 'ready');
      }
      const tenants = [A, B];
      const patients: Patient[] = [];
      const additionalPatients: Patient[] = [];
      for (let i = 0; i < 2; i++) {
        await test.step(`POST positive tenant ${i}`, async () => {
          const result = await http(pages[i], 'POST', `select=${projection}`, {
            company_id: tenants[i].company, unit_id: tenants[i].unit,
            full_name: `${marker}-${i}`, birth_date: '1992-01-01', lg_ativo: true,
          });
          expect(result.status, result.text).toBe(201);
          const created = rows(result.text);
          expect(created).toHaveLength(1);
          expect(created[0]).toMatchObject({ company_id: tenants[i].company, unit_id: String(tenants[i].unit) });
          patients.push(created[0]);
        });
        await test.step(`POST second positive tenant ${i}`, async () => {
          const result = await http(pages[i], 'POST', `select=${projection}`, {
            company_id: tenants[i].company, unit_id: tenants[i].unit,
            full_name: `${marker}-${i}-second`, birth_date: '1993-01-01', lg_ativo: true,
          });
          expect(result.status, result.text).toBe(201);
          const created = rows(result.text);
          expect(created).toHaveLength(1);
          additionalPatients.push(created[0]);
        });
      }
      for (let i = 0; i < 2; i++) {
        const other = 1 - i;
        const ownQuery = `select=${projection}&id=eq.${patients[i].id}`;
        const foreignQuery = `select=${projection}&id=eq.${patients[other].id}`;
        await test.step(`GET/COUNT/HEAD tenant ${i} cannot see ${other}`, async () => {
          const invalidHead = await http(pages[i], 'HEAD', 'e2e_nonexistent_column=eq.invalid');
          expect(invalidHead.status).toBe(400);
          expect(invalidHead.count).toBeNull();
          for (const method of ['GET', 'HEAD']) {
            for (const [query, count] of [[ownQuery, 1], [foreignQuery, 0],
              [`select=${projection}&id=in.(${patients[0].id},${patients[1].id})&limit=1`, 1]] as const) {
              const result = await http(pages[i], method, query);
              expect(result.status, result.text).toBe(200);
              expect(result.count).toMatch(new RegExp(`/${count}$`));
              if (method === 'GET') {
                expect(rows(result.text)).toEqual(count ? [patients[i]] : []);
              }
            }
          }
          const pagedQuery = `select=${projection}&id=in.(${patients[i].id},${additionalPatients[i].id},${patients[other].id})&limit=1`;
          for (const method of ['GET', 'HEAD']) {
            const pagedCount = await http(pages[i], method, pagedQuery);
            expect(pagedCount.status, pagedCount.text).toBe(200);
            expect(pagedCount.count).toMatch(/\/2$/);
            if (method === 'GET') {
              const pagedRows = rows(pagedCount.text);
              expect(pagedRows).toHaveLength(1);
              expect(pagedRows[0].company_id).toBe(tenants[i].company);
            }
          }
        });
        await test.step(`POST foreign tenant ${i} to ${other} rejected with readback`, async () => {
          const name = `${marker}-blocked-${i}`;
          const result = await http(pages[i], 'POST', `select=${projection}`, {
            company_id: tenants[other].company, unit_id: tenants[other].unit,
            full_name: name, birth_date: '1992-01-01', lg_ativo: true,
          });
          expect([400, 403]).toContain(result.status);
          expect(result.text).toMatch(/row.level security|permission|scope|context|empresa|unidade|42501/i);
          for (const page of pages) {
            const readback = await http(page, 'GET', `select=${projection}&full_name=eq.${name}`);
            expect(readback.status, readback.text).toBe(200);
            expect(rows(readback.text)).toEqual([]);
            expect(readback.count).toMatch(/\/0$/);
          }
        });
        await test.step(`PATCH own/foreign tenant ${i} with owner readback`, async () => {
          const name = `${marker}-updated-${i}`;
          const positive = await http(pages[i], 'PATCH', ownQuery, { full_name: name });
          expect(positive.status, positive.text).toBe(200);
          patients[i] = { ...patients[i], full_name: name };
          expect(rows(positive.text)).toEqual([patients[i]]);
          const negative = await http(pages[i], 'PATCH', foreignQuery, { full_name: `${marker}-corrupted` });
          expect([200, 204, 400, 403]).toContain(negative.status);
          if (negative.status === 200) expect(rows(negative.text)).toEqual([]);
          const transfer = await http(pages[i], 'PATCH', ownQuery, {
            company_id: tenants[other].company, unit_id: tenants[other].unit,
          });
          expect([400, 403]).toContain(transfer.status);
          expect(transfer.text).toMatch(/row.level security|permission|scope|context|empresa|unidade|42501/i);
          for (let owner = 0; owner < 2; owner++) {
            const readback = await http(pages[owner], 'GET', `select=${projection}&id=eq.${patients[owner].id}`);
            expect(readback.status, readback.text).toBe(200);
            expect(rows(readback.text)).toEqual([patients[owner]]);
          }
        });
      }
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });
});
