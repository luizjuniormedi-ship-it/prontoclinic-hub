/**
 * P0 integration proof for the custom auth proxy.
 *
 * Required environment:
 *   E2E_BASE_URL
 *   TENANT_A_EMAIL / TENANT_A_PASSWORD
 *   TENANT_B_EMAIL / TENANT_B_PASSWORD
 *
 * The script only reads existing patient data and attempts two mutations that
 * must be rejected or become a no-op. It never connects to DataSIGH.
 */

const baseUrl = (process.env.E2E_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const required = [
  'TENANT_A_EMAIL',
  'TENANT_A_PASSWORD',
  'TENANT_B_EMAIL',
  'TENANT_B_PASSWORD',
];
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(2);
}

const checks = [];

function check(name, condition, detail = '') {
  checks.push({ name, condition, detail });
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      apikey: process.env.VITE_SUPABASE_ANON_KEY || 'integration-smoke',
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { response, body };
}

async function login(email, password) {
  const { response, body } = await request('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok || !body?.access_token || !body?.user?.id) {
    throw new Error(`login failed for ${email}: HTTP ${response.status}`);
  }
  return { token: body.access_token, userId: body.user.id };
}

async function rest(token, path, options = {}) {
  return request(path, {
    ...options,
    headers: { authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
}

function rowsOf(body) {
  return Array.isArray(body) ? body : body ? [body] : [];
}

const tenantA = await login(process.env.TENANT_A_EMAIL, process.env.TENANT_A_PASSWORD);
const tenantB = await login(process.env.TENANT_B_EMAIL, process.env.TENANT_B_PASSWORD);

const profileAResult = await rest(tenantA.token, `/rest/v1/user_profiles?id=eq.${tenantA.userId}&select=id,company_id`);
const profileBResult = await rest(tenantB.token, `/rest/v1/user_profiles?id=eq.${tenantB.userId}&select=id,company_id`);
const profileA = rowsOf(profileAResult.body)[0];
const profileB = rowsOf(profileBResult.body)[0];
check('tenant A profile is readable', profileAResult.response.ok && Boolean(profileA?.company_id));
check('tenant B profile is readable', profileBResult.response.ok && Boolean(profileB?.company_id));
check('users belong to different companies', profileA?.company_id && profileB?.company_id && profileA.company_id !== profileB.company_id);

const ownPatients = await rest(tenantA.token, '/rest/v1/patients?select=id,full_name&order=id.asc&limit=1', {
  headers: { prefer: 'count=exact' },
});
const patientA = rowsOf(ownPatients.body)[0];
check('tenant A can read a controlled patient row', ownPatients.response.ok && Boolean(patientA?.id));

if (patientA?.id && profileA?.company_id && profileB?.company_id) {
  const crossRead = await rest(tenantB.token, `/rest/v1/patients?id=eq.${patientA.id}&select=id,company_id`, {
    headers: { prefer: 'count=exact' },
  });
  check('tenant B cannot read tenant A patient', crossRead.response.ok && rowsOf(crossRead.body).length === 0, `HTTP ${crossRead.response.status}`);

  const crossCount = await rest(tenantB.token, `/rest/v1/patients?id=eq.${patientA.id}&select=id`, {
    headers: { prefer: 'count=exact' },
  });
  const contentRange = crossCount.response.headers.get('content-range') || '';
  check('tenant B count excludes tenant A patient', crossCount.response.ok && /\/0$/.test(contentRange), contentRange || `HTTP ${crossCount.response.status}`);

  const crossInsert = await rest(tenantB.token, '/rest/v1/patients', {
    method: 'POST',
    body: JSON.stringify({ company_id: profileA.company_id, full_name: 'SHOULD NOT PERSIST' }),
  });
  check('tenant B cannot insert with tenant A company_id', crossInsert.response.status === 403, `HTTP ${crossInsert.response.status}`);

  const crossPatch = await rest(tenantB.token, `/rest/v1/patients?id=eq.${patientA.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ full_name: 'SHOULD NOT CHANGE' }),
  });
  check('tenant B cannot update tenant A patient', [200, 204, 403].includes(crossPatch.response.status), `HTTP ${crossPatch.response.status}`);

  const verifyOwner = await rest(tenantA.token, `/rest/v1/patients?id=eq.${patientA.id}&select=id,full_name`);
  const unchanged = rowsOf(verifyOwner.body)[0]?.full_name === patientA.full_name;
  check('tenant A patient remains unchanged after cross-tenant PATCH', verifyOwner.response.ok && unchanged);

  const crossTenantPatch = await rest(tenantB.token, `/rest/v1/patients?id=eq.${patientA.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ company_id: profileA.company_id }),
  });
  check('tenant B cannot submit an explicit cross-tenant company_id', crossTenantPatch.response.status === 403, `HTTP ${crossTenantPatch.response.status}`);
}

const failed = checks.filter((item) => !item.condition);
console.log(`TENANT_ISOLATION=${failed.length === 0 ? 'PASS' : 'FAIL'} checks=${checks.length} failures=${failed.length}`);
process.exit(failed.length === 0 ? 0 : 1);
