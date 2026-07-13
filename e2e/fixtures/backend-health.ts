import {
  test as base,
  expect,
  type Page,
  type Response,
  type TestInfo,
} from '@playwright/test';
import { findBackendErrorAllowance } from '../backend-error-allowlist';

type BackendHealthFixtures = {
  backendHealth: void;
};

type BackendResponseRecord = {
  method: string;
  path: string;
  status: number;
  code?: string;
  result: 'ok' | 'allowlisted' | 'failed';
  allowance?: string;
};

const MONITORED_PATH_PREFIXES = ['/rest/v1', '/auth/v1', '/functions/v1'] as const;
const NEVER_ALLOWLIST_CODES = new Set(['PGRST000', 'PGRST202']);

function isMonitoredPath(pathname: string): boolean {
  return MONITORED_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

function extractErrorCode(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;

  const record = payload as Record<string, unknown>;
  for (const key of ['code', 'error', 'error_code']) {
    if (typeof record[key] === 'string') return record[key];
  }

  return null;
}

async function readErrorResponse(response: Response): Promise<{
  code: string | null;
  signature: string;
}> {
  const body = await response.text().catch(() => '');
  let payload: unknown;

  try {
    payload = JSON.parse(body);
  } catch {
    payload = null;
  }

  return {
    code: extractErrorCode(payload),
    signature: body.toLowerCase(),
  };
}

function getSupabaseOrigin(): string {
  const configuredUrl = process.env.VITE_SUPABASE_URL;
  if (!configuredUrl) {
    throw new Error('[backend-health] VITE_SUPABASE_URL não está definida.');
  }

  try {
    return new URL(configuredUrl).origin;
  } catch {
    throw new Error('[backend-health] VITE_SUPABASE_URL não é uma URL válida.');
  }
}

async function inspectResponse(
  response: Response,
  testInfo: TestInfo,
  records: BackendResponseRecord[],
  failures: string[]
): Promise<void> {
  const url = new URL(response.url());
  const method = response.request().method();
  const status = response.status();
  const baseRecord = { method, path: url.pathname, status };

  if (status < 400) {
    records.push({ ...baseRecord, result: 'ok' });
    return;
  }

  const error = await readErrorResponse(response);
  const normalizedCode = error.code?.toUpperCase() ?? null;
  const isNeverAllowlisted =
    status >= 500 ||
    (normalizedCode !== null && NEVER_ALLOWLIST_CODES.has(normalizedCode)) ||
    error.signature.includes('permission denied');
  const allowance = isNeverAllowlisted
    ? undefined
    : findBackendErrorAllowance({
        testTitle: testInfo.title,
        method,
        url,
        status,
        errorCode: error.code,
      });

  if (allowance) {
    records.push({
      ...baseRecord,
      ...(error.code ? { code: error.code } : {}),
      result: 'allowlisted',
      allowance: allowance.id,
    });
    return;
  }

  const codeLabel = error.code ? ` code=${error.code}` : '';
  records.push({
    ...baseRecord,
    ...(error.code ? { code: error.code } : {}),
    result: 'failed',
  });
  failures.push(`${method} ${url.pathname} -> HTTP ${status}${codeLabel}`);
}

export const test = base.extend<BackendHealthFixtures>({
  backendHealth: [
    async ({ page }, use, testInfo) => {
      const supabaseOrigin = getSupabaseOrigin();
      const records: BackendResponseRecord[] = [];
      const failures: string[] = [];
      const pending = new Set<Promise<void>>();

      const onResponse = (response: Response) => {
        let url: URL;
        try {
          url = new URL(response.url());
        } catch {
          return;
        }

        if (url.origin !== supabaseOrigin || !isMonitoredPath(url.pathname)) return;

        const inspection = inspectResponse(response, testInfo, records, failures).catch(
          (error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            failures.push(`Falha ao inspecionar resposta backend: ${message}`);
          }
        );
        pending.add(inspection);
        void inspection.then(() => pending.delete(inspection));
      };

      page.on('response', onResponse);

      await use();

      page.off('response', onResponse);
      await Promise.all([...pending]);

      const report = {
        origin: supabaseOrigin,
        responses: records,
        summary: {
          total: records.length,
          allowlisted: records.filter((record) => record.result === 'allowlisted').length,
          failed: failures.length,
        },
      };
      await testInfo.attach('backend-health.json', {
        body: Buffer.from(JSON.stringify(report)),
        contentType: 'application/json',
      });

      if (failures.length > 0) {
        throw new Error(
          `[backend-health] ${failures.length} resposta(s) inválida(s):\n${failures.join('\n')}`
        );
      }
    },
    { auto: true },
  ],
});

export { expect };
export type { Page };
