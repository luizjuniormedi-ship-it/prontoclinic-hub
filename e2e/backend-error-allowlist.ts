export type BackendErrorAllowance = {
  id: string;
  testTitle: string;
  method: 'POST';
  pathname: '/auth/v1/token';
  status: 400;
  errorCode: 'invalid_grant';
  query: Readonly<Record<string, string>>;
  expiresOn: string;
  reason: string;
};

export const BACKEND_ERROR_ALLOWLIST: readonly BackendErrorAllowance[] = [
  {
    id: 'invalid-email-login',
    testTitle: 'login com email inválido mostra erro',
    method: 'POST',
    pathname: '/auth/v1/token',
    status: 400,
    errorCode: 'invalid_grant',
    query: { grant_type: 'password' },
    expiresOn: '2026-12-31',
    reason: 'Teste negativo deliberado: credencial inexistente deve ser rejeitada.',
  },
  {
    id: 'invalid-password-login',
    testTitle: 'login com senha errada mostra erro',
    method: 'POST',
    pathname: '/auth/v1/token',
    status: 400,
    errorCode: 'invalid_grant',
    query: { grant_type: 'password' },
    expiresOn: '2026-12-31',
    reason: 'Teste negativo deliberado: senha incorreta deve ser rejeitada.',
  },
] as const;

export type BackendErrorCandidate = {
  testTitle: string;
  method: string;
  url: URL;
  status: number;
  errorCode: string | null;
};

export function findBackendErrorAllowance(
  candidate: BackendErrorCandidate,
  now = Date.now()
): BackendErrorAllowance | undefined {
  return BACKEND_ERROR_ALLOWLIST.find((allowance) => {
    const expiresAt = Date.parse(`${allowance.expiresOn}T23:59:59.999Z`);
    const queryMatches = Object.entries(allowance.query).every(
      ([key, value]) => candidate.url.searchParams.get(key) === value
    );

    return (
      now <= expiresAt &&
      candidate.testTitle === allowance.testTitle &&
      candidate.method === allowance.method &&
      candidate.url.pathname === allowance.pathname &&
      candidate.status === allowance.status &&
      candidate.errorCode === allowance.errorCode &&
      queryMatches
    );
  });
}
