/**
 * Local Auth Server â€” substitui GoTrue/Supabase Cloud
 * Simula os endpoints que o supabase-js usa:
 *   POST /auth/v1/token?grant_type=password
 *   GET  /auth/v1/user
 *   POST /auth/v1/logout
 *   GET  /rest/v1/* (proxy PostgREST simplificado)
 *
 * Roda em http://localhost:8000
 */
import { createServer } from 'http';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import QRCode from 'qrcode';
import { scopeInsertBody, scopePatchBody } from './local-auth-security.mjs';
import {
  CARE_PROTOCOL_EXECUTION_RPC_ROLE_POLICY,
  CARE_PROTOCOL_GOVERNANCE_RPC_ROLE_POLICY,
  EXAM_REQUEST_DISPATCH_RPC_ROLE_POLICY,
  EXAM_REQUEST_ORDER_RPC_ROLE_POLICY,
  IMAGING_RPC_ROLE_POLICY,
  INSURANCE_RPC_ROLE_POLICY,
  LABORATORY_COLLECTION_RPC_ROLE_POLICY,
  LABORATORY_COMMUNICATION_RPC_ROLE_POLICY,
  LABORATORY_MANAGEMENT_RPC_ROLE_POLICY,
  LABORATORY_ORDER_RPC_ROLE_POLICY,
  LABORATORY_PROCESSING_RPC_ROLE_POLICY,
  LABORATORY_VALIDATION_RPC_ROLE_POLICY,
  MEDICAL_RECORD_RPC_ROLE_POLICY,
  PHARMACY_REVIEW_RPC_ROLE_POLICY,
  PRESCRIBER_RPC_ROLE_POLICY,
  TISS_GUIDE_RPC_ROLE_POLICY,
  TRIAGE_RPC_ROLE_POLICY,
  applyUserPermissionOverrides,
  clinicalWaveDirectWriteDenied,
  decideRpcAuthorization,
  normalizeRole,
  resolveClinicalWaveTableModule,
} from './scripts/rpc-role-policy.mjs';
const { Pool } = pg;

const PORT = Number(process.env.LOCAL_AUTH_PORT || 8000);
const HOST = process.env.LOCAL_AUTH_HOST || '127.0.0.1';
if (!['127.0.0.1', 'localhost', '::1'].includes(HOST)) {
  throw new Error('LOCAL_AUTH_HOST deve permanecer em loopback na VPS');
}
function readSecret(envName, fileEnvName) {
  const filePath = process.env[fileEnvName];
  if (filePath) {
    const value = readFileSync(filePath, 'utf8').trim();
    if (!value) throw new Error(`${fileEnvName} aponta para um arquivo vazio`);
    return value;
  }
  return process.env[envName];
}

const JWT_SECRET = readSecret('JWT_SECRET', 'JWT_SECRET_FILE');
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET obrigatorio e deve ter pelo menos 32 caracteres');
}
if (!process.env.PGPASSWORD) {
  throw new Error('PGPASSWORD obrigatorio para conectar ao PostgreSQL local pre-provisionado');
}
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) {
  throw new Error('LOCAL_AUTH_PORT deve ser uma porta nao privilegiada entre 1024 e 65535');
}
if (!['127.0.0.1', 'localhost', '::1'].includes(HOST) && process.env.LOCAL_ALLOW_NON_LOOPBACK !== 'true') {
  throw new Error('LOCAL_AUTH_HOST fora de loopback exige LOCAL_ALLOW_NON_LOOPBACK=true');
}

// Fix: pg retorna Date objects pra colunas 'date' â€” forÃ§ar string YYYY-MM-DD
const types = pg.types;
types.setTypeParser(1082, (val) => val); // date -> string as-is
types.setTypeParser(1114, (val) => val); // timestamp without tz -> string
types.setTypeParser(1184, (val) => val); // timestamptz -> string

const pool = new Pool({
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'app_prontomedic',
  password: readSecret('PGPASSWORD', 'PGPASSWORD_FILE'),
  database: process.env.PGDATABASE || 'prontoclinic',
});

pool.on('error', (error) => {
  console.error('[PG_POOL_ERROR]', error);
});

// Keep the tenant claim scoped to one pooled connection transaction. A
// session-level SET would leak one company's context into the next request.
async function queryWithTenantContext(companyId, text, values = [], userId = null, claims = null) {
  const client = await pool.connect();
  const databaseClaims = claims?.jti && !claims.session_id
    ? { ...claims, session_id: claims.jti }
    : claims;
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('request.jwt.claim.sub', $1, true),
              set_config('request.jwt.claim.role', $2, true),
              set_config('request.jwt.claim.company_id', $3, true),
              set_config('request.jwt.claims', $4, true)`,
      [userId || '', 'authenticated', companyId || '', JSON.stringify(databaseClaims || {})],
    );
    const result = await client.query(text, values);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function queryWithAuthContext(payload, text, values = []) {
  if (!payload?.sub) throw new Error('contexto de autenticacao ausente');
  return queryWithTenantContext(payload.company_id || '', text, values, payload.sub, payload);
}

process.on('uncaughtException', (error) => {
  console.error('[UNCAUGHT_EXCEPTION]', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED_REJECTION]', reason);
});

// Simple JWT (HS256)
function base64url(str) {
  return Buffer.from(str).toString('base64url');
}

function signJwt(payload) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const sig = createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function requestIp(req) {
  const forwarded = process.env.TRUST_PROXY === 'true' ? req.headers['x-forwarded-for'] : null;
  return String(forwarded || req.socket.remoteAddress || 'unknown').split(',')[0].trim().slice(0, 64);
}

function requestUserAgent(req) {
  return String(req.headers['user-agent'] || '').slice(0, 1000) || null;
}

function hashOpaqueToken(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

async function recordSecurityEvent(userId, eventType, req, metadata = {}, success = true, companyId = null, client = null) {
  if (!userId) return;
  try {
    const query = client
      ? (text, values) => client.query(text, values)
      : companyId
        ? (text, values) => queryWithTenantContext(companyId, text, values, userId, { sub: userId, company_id: companyId })
        : (text, values) => pool.query(text, values);
    await query(
      `INSERT INTO public.auth_security_events
        (user_id, company_id, event_type, success, metadata, user_agent, ip_address)
       SELECT $1, p.company_id, $2, $3, $4::jsonb, $5, $6::inet
         FROM public.user_profiles p WHERE p.id = $1`,
      [userId, eventType, success, JSON.stringify(metadata), requestUserAgent(req), requestIp(req)],
    );
  } catch (error) {
    if (!/auth_security_events|relation .* does not exist/i.test(String(error?.message || error))) throw error;
  }
}

function deviceIdFromRequest(req) {
  const supplied = String(req.headers['x-device-id'] || '');
  if (/^[a-f0-9-]{16,128}$/i.test(supplied)) return supplied;
  return hashOpaqueToken(`${requestUserAgent(req) || 'unknown'}:${requestIp(req)}`).slice(0, 32);
}

async function createSession(user, req) {
  const jti = randomUUID();
  const deviceId = deviceIdFromRequest(req);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  try {
    await queryWithTenantContext(user.company_id || '',
      `INSERT INTO public.auth_sessions (user_id, device_id, jti, user_agent, ip_address, expires_at)
       VALUES ($1, $2, $3, $4, $5::inet, $6)`,
      [user.id, deviceId, jti, requestUserAgent(req), requestIp(req), expiresAt], user.id,
      { sub: user.id, company_id: user.company_id || '' },
    );
    await queryWithTenantContext(user.company_id || '',
      `INSERT INTO public.auth_session_devices
        (user_id, company_id, device_id, device_label, user_agent, ip_address, last_seen_at, revoked_at)
       SELECT $1, p.company_id, $2, 'Navegador', $3, $4::inet, now(), NULL
         FROM public.user_profiles p WHERE p.id = $1
       ON CONFLICT (user_id, device_id) DO UPDATE SET
         user_agent = EXCLUDED.user_agent, ip_address = EXCLUDED.ip_address,
         last_seen_at = now(), revoked_at = NULL`,
      [user.id, deviceId, requestUserAgent(req), requestIp(req)], user.id,
      { sub: user.id, company_id: user.company_id || '' },
    );
  } catch (error) {
    const message = String(error?.message || error);
    if (!/relation .* does not exist/i.test(message)) {
      console.error('[AUTH_SESSION_REGISTRY]', message);
      throw error;
    }
  }
  return { jti, deviceId, expiresAt };
}

async function sessionIsActive(payload) {
  if (!payload?.jti) return true; // compatibility for tokens issued before session registry.
  try {
    const result = await queryWithAuthContext(payload,
      `SELECT 1 FROM public.auth_sessions
        WHERE jti = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > now()`,
      [payload.jti, payload.sub],
    );
    return result.rowCount === 1;
  } catch (error) {
    if (/auth_sessions|relation .* does not exist/i.test(String(error?.message || error))) return true;
    throw error;
  }
}

export function buildAuthSessionResponse(user, accessToken, refreshToken) {
  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: 3600,
    refresh_token: refreshToken,
    user: {
      id: user.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: user.email,
      email_confirmed_at: user.email_confirmed_at,
      app_metadata: user.raw_app_meta_data,
      user_metadata: user.raw_user_meta_data,
      factors: Array.isArray(user.factors) ? user.factors : [],
      created_at: user.created_at,
    },
  };
}

async function loadMfaFactors(userId, authContext) {
  const result = await queryWithAuthContext(
    authContext,
    `SELECT id, friendly_name, factor_type, status, created_at, updated_at
       FROM public.auth_mfa_factors
      WHERE user_id = $1
      ORDER BY created_at`,
    [userId],
  );
  return result.rows;
}

async function issueTokens(user, req, { aal = 'aal1', amrMethod = 'password' } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const session = await createSession(user, req);
  const accessToken = signJwt({
    sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', company_id: user.company_id,
    iat: now, exp: Math.floor(session.expiresAt.getTime() / 1000), jti: session.jti, session_id: session.jti,
    aal, amr: [{ method: amrMethod, timestamp: now }],
    app_metadata: user.raw_app_meta_data, user_metadata: user.raw_user_meta_data,
  });
  const refreshToken = randomUUID();
  await pool.query('INSERT INTO auth.refresh_tokens (token, user_id) VALUES ($1, $2)', [refreshToken, user.id]);
  return { accessToken, refreshToken, session };
}

function verifyJwt(token) {
  try {
    if (typeof token !== 'string') return null;
    const [header, body, sig] = token.split('.');
    if (!header || !body || !sig) return null;
    const parsedHeader = JSON.parse(Buffer.from(header, 'base64url').toString());
    if (parsedHeader.alg !== 'HS256' || parsedHeader.typ !== 'JWT') return null;
    const expected = createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    const actualBuffer = Buffer.from(sig || '', 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    // PostgreSQL accepts legacy UUIDs that do not set RFC 4122 variant bits.
    if (typeof payload.sub !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.sub)) return null;
    if (payload.aud !== 'authenticated') return null;
    if (!Number.isFinite(payload.exp) || Date.now() / 1000 >= payload.exp) return null;
    if (!Number.isFinite(payload.iat) || payload.iat > Date.now() / 1000 + 60) return null;
    return payload;
  } catch { return null; }
}

// Bcrypt verify via Postgres (uses pgcrypto)
async function verifyPassword(email, password) {
  let res;
  try {
    res = await pool.query(
      `SELECT * FROM private.lookup_auth_user($1)`,
      [email.toLowerCase().trim()]
    );
  } catch (error) {
    if (!/lookup_auth_user|function .* does not exist|auth_account_security|relation .* does not exist/i.test(String(error?.message || error))) throw error;
    res = await pool.query(
      `SELECT u.id, u.email, u.encrypted_password, u.email_confirmed_at, u.raw_app_meta_data, u.raw_user_meta_data,
              p.company_id,
              p.lg_ativo, false AS must_change_password, NULL::timestamptz AS password_expires_at, false AS mfa_required
         FROM auth.users u
         JOIN public.user_profiles p ON p.id = u.id
         WHERE (lower(u.email) = lower($1)
                OR lower(COALESCE(u.raw_user_meta_data->>'username', '')) = lower($1)
                OR regexp_replace(COALESCE(u.raw_user_meta_data->>'cpf', ''), '\\D', '', 'g') = regexp_replace($1, '\\D', '', 'g'))
           AND p.lg_ativo IS TRUE
           AND p.blocked_at IS NULL
           AND (p.access_valid_until IS NULL OR p.access_valid_until > now())`,
      [email.toLowerCase().trim()]
    );
  }
  if (res.rows.length === 0) return null;
  const user = res.rows[0];
  const check = await pool.query(
    `SELECT ($1 = crypt($2, $1)) as valid`,
    [user.encrypted_password, password]
  );
  if (!check.rows[0]?.valid) {
    await updateAuthSecurity(user.id, false, user.company_id);
    return null;
  }
  await updateAuthSecurity(user.id, true, user.company_id);
  return user;
}

async function getUserProfile(userId, companyId = null) {
  const query = companyId
    ? (text, values) => queryWithTenantContext(companyId, text, values, userId, { sub: userId, company_id: companyId })
    : (text, values) => pool.query(text, values);
  const res = await query(
    `SELECT p.id, p.full_name, p.email, p.role_name, p.company_id, p.primary_unit_id,
            p.lg_ativo, p.blocked_at, p.access_valid_until,
            COALESCE(s.must_change_password, false) AS must_change_password,
            s.password_expires_at
       FROM public.user_profiles p
       LEFT JOIN public.auth_account_security s ON s.user_id = p.id
      WHERE p.id = $1`,
    [userId]
  );
  return res.rows[0] || null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isAdminProfile(profile) {
  return ['admin', 'administrador'].includes(String(profile?.role_name || '').toLowerCase());
}

function profileRequiresPasswordChange(profile) {
  return Boolean(profile?.must_change_password)
    || Boolean(profile?.password_expires_at && new Date(profile.password_expires_at).getTime() <= Date.now());
}

async function requireAdminRequest(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const payload = verifyJwt(token);
  if (!payload?.jti || !(await sessionIsActive(payload))) {
    const error = new Error('JWT válido obrigatório');
    error.statusCode = 401;
    throw error;
  }
  const actor = await getUserProfile(payload.sub, payload.company_id);
  const accessExpired = actor?.access_valid_until && new Date(actor.access_valid_until).getTime() <= Date.now();
  if (!actor || !actor.lg_ativo || actor.blocked_at || accessExpired || !isAdminProfile(actor)) {
    const error = new Error('acesso administrativo obrigatório');
    error.statusCode = 403;
    throw error;
  }
  if (profileRequiresPasswordChange(actor)) {
    const error = new Error('troca de senha obrigatória');
    error.statusCode = 403;
    error.code = 'password_change_required';
    throw error;
  }
  return { payload, actor };
}

async function selectAdminUser(id, companyId, actorId, actorClaims) {
  const result = await queryWithTenantContext(companyId,
    `SELECT p.id, p.full_name, COALESCE(u.email, p.email) AS email,
            u.raw_user_meta_data->>'username' AS username,
            p.role_id, p.role_name, p.company_id, p.primary_unit_id,
            COALESCE(to_jsonb(unit)->>'name', to_jsonb(unit)->>'ds_nome', to_jsonb(unit)->>'nm_unidade') AS unit_name,
            p.phone, p.cpf, p.lg_ativo,
            p.blocked_at, p.access_valid_until, p.created_at, p.updated_at,
            u.email_confirmed_at,
            s.must_change_password, s.password_expires_at, s.mfa_required
       FROM public.user_profiles p
       JOIN auth.users u ON u.id = p.id
       LEFT JOIN public.units unit ON unit.id = p.primary_unit_id
       LEFT JOIN public.auth_account_security s ON s.user_id = p.id
      WHERE p.id = $1 AND p.company_id = $2`,
    [id, companyId],
    actorId,
    actorClaims,
  );
  return result.rows[0] || null;
}

async function selectAdminUsers(companyId, filters = {}, actorId, actorClaims) {
  const values = [companyId];
  const conditions = ['p.company_id = $1'];
  if (filters.lg_ativo === 'true' || filters.lg_ativo === 'false') {
    values.push(filters.lg_ativo === 'true');
    conditions.push(`p.lg_ativo = $${values.length}`);
  }
  if (filters.search) {
    values.push(`%${String(filters.search).slice(0, 120)}%`);
    conditions.push(`(p.full_name ILIKE $${values.length} OR COALESCE(u.email, p.email) ILIKE $${values.length} OR p.role_name ILIKE $${values.length} OR COALESCE(u.raw_user_meta_data->>'username', '') ILIKE $${values.length})`);
  }
  const result = await queryWithTenantContext(companyId,
    `SELECT p.id, p.full_name, COALESCE(u.email, p.email) AS email,
            u.raw_user_meta_data->>'username' AS username,
            p.role_id, p.role_name, p.company_id, p.primary_unit_id,
            COALESCE(to_jsonb(unit)->>'name', to_jsonb(unit)->>'ds_nome', to_jsonb(unit)->>'nm_unidade') AS unit_name,
            p.phone, p.cpf, p.lg_ativo,
            p.blocked_at, p.access_valid_until, p.created_at, p.updated_at,
            u.email_confirmed_at,
            COALESCE(s.must_change_password, false) AS must_change_password,
            s.password_expires_at, COALESCE(s.mfa_required, false) AS mfa_required
       FROM public.user_profiles p
       JOIN auth.users u ON u.id = p.id
       LEFT JOIN public.units unit ON unit.id = p.primary_unit_id
       LEFT JOIN public.auth_account_security s ON s.user_id = p.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY p.full_name`,
    values,
    actorId,
    actorClaims,
  );
  return result.rows;
}

function adminUserUpdatePayload(body) {
  const allowed = ['full_name', 'email', 'username', 'role_name', 'primary_unit_id', 'phone', 'cpf', 'lg_ativo', 'blocked_at', 'access_valid_until', 'must_change_password'];
  const update = {};
  for (const key of allowed) if (Object.prototype.hasOwnProperty.call(body, key)) update[key] = body[key];
  if (Object.keys(update).length === 0) {
    const error = new Error('nenhum campo administrativo informado');
    error.statusCode = 400;
    throw error;
  }
  if (update.full_name !== undefined && (typeof update.full_name !== 'string' || update.full_name.trim().length < 2)) throw Object.assign(new Error('nome inválido'), { statusCode: 422 });
  if (update.email !== undefined && (typeof update.email !== 'string' || !/^\S+@\S+\.\S+$/.test(update.email.trim()))) throw Object.assign(new Error('e-mail inválido'), { statusCode: 422 });
  if (update.username !== undefined && update.username !== null && (typeof update.username !== 'string' || !/^[a-zA-Z0-9._-]{3,120}$/.test(update.username.trim()))) throw Object.assign(new Error('nome de usuário inválido'), { statusCode: 422 });
  if (update.primary_unit_id !== undefined && update.primary_unit_id !== null && (!Number.isInteger(Number(update.primary_unit_id)) || Number(update.primary_unit_id) <= 0)) throw Object.assign(new Error('unidade inválida'), { statusCode: 422 });
  if (update.lg_ativo !== undefined && typeof update.lg_ativo !== 'boolean') throw Object.assign(new Error('status inválido'), { statusCode: 422 });
  if (update.must_change_password !== undefined && typeof update.must_change_password !== 'boolean') throw Object.assign(new Error('política de senha inválida'), { statusCode: 422 });
  if (update.full_name !== undefined) update.full_name = update.full_name.trim();
  if (update.email !== undefined) update.email = update.email.trim().toLowerCase();
  if (update.username !== undefined) update.username = update.username === null ? null : update.username.trim().toLowerCase();
  if (update.role_name !== undefined) update.role_name = String(update.role_name).trim().toLowerCase();
  if (update.primary_unit_id !== undefined) update.primary_unit_id = update.primary_unit_id === null ? null : Number(update.primary_unit_id);
  if (update.phone !== undefined) update.phone = update.phone === null ? null : String(update.phone).trim() || null;
  if (update.cpf !== undefined) update.cpf = update.cpf === null ? null : String(update.cpf).replace(/\D/g, '') || null;
  return update;
}

async function updateAuthSecurity(userId, success, companyId = null) {
  try {
    const query = companyId
      ? (text, values) => queryWithTenantContext(companyId, text, values, userId, { sub: userId, company_id: companyId })
      : (text, values) => pool.query(text, values);
    await query(
      `INSERT INTO public.auth_account_security (user_id, failed_login_attempts, account_locked_until, last_login_at)
       VALUES ($1, CASE WHEN $2 THEN 0 ELSE 1 END,
               NULL,
               CASE WHEN $2 THEN now() ELSE NULL END)
       ON CONFLICT (user_id) DO UPDATE SET
         failed_login_attempts = CASE WHEN $2 THEN 0 ELSE public.auth_account_security.failed_login_attempts + 1 END,
         account_locked_until = CASE
           WHEN $2 THEN NULL
           WHEN public.auth_account_security.failed_login_attempts + 1 >= 5 THEN now() + interval '15 minutes'
           ELSE public.auth_account_security.account_locked_until
         END,
         last_login_at = CASE WHEN $2 THEN now() ELSE public.auth_account_security.last_login_at END,
         updated_at = now()`,
      [userId, success],
    );
  } catch (error) {
    if (!/auth_account_security|relation .* does not exist/i.test(String(error?.message || error))) throw error;
  }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// AUTORIZAÃ‡ÃƒO SERVER-SIDE (RBAC por role Ã— mÃ³dulo Ã— aÃ§Ã£o)
// Mapeia tabela fÃ­sica â†’ mÃ³dulo lÃ³gico da matriz role_permissions.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const REFERENCE_TABLES = new Set([
  'bairros', 'cbos', 'cids', 'cid', 'municipios', 'profissoes',
  'countries', 'states', 'racas', 'etnias', 'nacionalidades',
  // Catálogo operacional: leitura necessária para agenda/recepção,
  // escrita continua restrita a admin e o escopo company_id permanece ativo.
  'professionals', 'specialties', 'appointment_types', 'services_catalog',
]);

// Organizational structure is protected by the database's company/unit RLS.
// Keep the proxy explicit: reads may reach the RLS layer for authorized users,
// while writes are limited to the same manager roles used by the migration.
const ORGANIZATION_TABLES = new Set([
  'sectors', 'organizational_resources', 'unit_schedules', 'unit_services',
]);
const ORGANIZATION_MANAGER_ROLES = new Set([
  'admin', 'administrador', 'gestor', 'gerente', 'administrativo',
]);

// Módulo 4: profissionais e habilitações. Leituras seguem o tenant/RLS;
// alterações exigem gestão administrativa, sem liberar acesso global.
  const PROFESSIONAL_TABLES = new Set([
    'professionals', 'professional_specialties', 'professional_units',
    'professional_services', 'professional_documents', 'professional_block_rules',
    'professional_remuneration_rules',
    'professional_insurances', 'professional_licenses', 'professional_contracts',
    'professional_signatures', 'professional_equipment',
  ]);
const PROFESSIONAL_MANAGER_ROLES = new Set([
  'admin', 'administrador', 'gestor', 'gerente', 'administrativo',
]);

// Módulo 5: configurações e preferências. Segredos de infraestrutura não
// devem ser persistidos nessas tabelas nem retornados pelo proxy REST.
const SETTINGS_TABLES = new Set([
  'system_settings', 'unit_settings', 'user_preferences', 'feature_flags',
  'numbering_sequences', 'document_templates', 'sla_rules', 'workflow_rules',
  'notification_settings', 'integration_settings',
]);
const SETTINGS_MANAGER_ROLES = new Set([
  'admin', 'administrador', 'gestor', 'gerente', 'administrativo',
]);

function tableToModule(table) {
  const t = table.toLowerCase();
  const clinicalWaveModule = resolveClinicalWaveTableModule(t);
  if (clinicalWaveModule) return clinicalWaveModule;
  // match por prefixo/nome exato
  const map = [
    // prontuÃ¡rio/clÃ­nico ANTES de pacientes (patient_allergies, patient_problem_list, patient_medications sÃ£o atos clÃ­nicos)
    // NOTA: 'cid' (catÃ¡logo CID-10) Ã© tabela de REFERÃŠNCIA universal â€” NÃƒO entra aqui,
    // cai no default (leitura livre p/ qualquer perfil autenticado, escrita sÃ³ admin).
    [/^encounters?$|^encounter_|^medical_records|^clinical_|^prescricoes|^prontuar|^diagnos|^patient_allergies|^patient_problem|^patient_medication|^alergias/, 'prontuario'],
    [/^patients$|^paciente|^patient_phones|^telxpac/, 'pacientes'],
    [/^appointments$|^agenda|^professional_schedules|^escala|^scheduling_waitlist|^scheduling_blocks/, 'agenda'],
    // EvoluÃ§Ã£o/procedimentos/incidentes de enfermagem = conteÃºdo clÃ­nico sensÃ­vel â†’ mÃ³dulo prontuario (recepÃ§Ã£o bloqueada por LGPD)
    [/^nursing_notes|^nursing_procedures|^nursing_incidents|^nursing_medication|^nursing_evolution/, 'prontuario'],
    // Fila de triagem e classificaÃ§Ã£o de risco = mÃ³dulo enfermagem (recepÃ§Ã£o pode ver p/ chamar paciente)
    [/^triagens?$|^triagem_|^nursing_|^mnct_/, 'enfermagem'],
    [/^exames_lab|^lab_/, 'laboratorio'],
    [/^dicom|^report|^radiolog|^imaging|^pacs/, 'dicom'],
    [/^dispensa|^brasindice|^simpro|^medicament|^farmac|^estoque|^lote/, 'farmacia'],
    // caixa/contas/movimento bancÃ¡rio = financeiro (recebe/paga dinheiro)
    [/^contas_|^movimento|^caixa/, 'financeiro'],
    // financial_transactions/billing/tiss/fatura = faturamento (gera a conta/cobranÃ§a). SoD: faturamento cria, financeiro recebe.
    [/^financial_|^billing|^tiss|^fatura|^valores|^commission|^price_tab|^servxlanc/, 'faturamento'],
    [/^insurance|^convenio|^plano|^fonte_pagadora/, 'faturamento'],
    // recepÃ§Ã£o: check-in, autorizaÃ§Ã£o, elegibilidade, guias, senhas, documentos
    [/^reception_|^senhas_atendimento/, 'recepcao'],
    [/^scheduling_contact_logs|^scheduling_call_center_tasks|^scheduling_confirmation_|^call_center_/, 'call_center'],
    [/^bi_|^nps_|^dashboard/, 'bi'],
    [/^telemedicina/, 'telemedicina'],
    [/^internacao|^leito/, 'internacao'],
    [/^cirurgia|^centro_cir/, 'cirurgia'],
    [/^ia_|^ai_/, 'ia'],
    [/^audit|^sigh_log|^lgpd|^log_/, 'auditoria'],
    [/^roles?$|^role_|^menu_actions|^user_|^usuarios|^companies|^units|^permission/, 'admin'],
    [/^system_settings$|^unit_settings$|^user_preferences$|^feature_flags$/, 'admin'],
    [/^whatsapp|^notification|^pre_cadastro/, 'recepcao'],
  ];
  for (const [re, mod] of map) if (re.test(t)) return mod;
  return REFERENCE_TABLES.has(t) ? null : '__unmapped__';
}

const METHOD_TO_ACTION = { GET: 'can_view', HEAD: 'can_view', POST: 'can_create', PATCH: 'can_edit', PUT: 'can_edit', DELETE: 'can_delete' };
const AUTH_SELF_SERVICE_METHODS = new Map([
  ['auth_account_security', new Set(['GET', 'HEAD'])],
  ['auth_session_devices', new Set(['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'])],
  ['auth_security_events', new Set(['GET', 'HEAD', 'POST'])],
]);
const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const isIdentifier = (value) => IDENT.test(value);
const quoteIdent = (value) => `"${value}"`;

export function isAuthSelfServiceRequestAllowed(table, method) {
  return AUTH_SELF_SERVICE_METHODS.get(String(table).toLowerCase())?.has(String(method).toUpperCase()) === true;
}

function splitRestSelectItems(input) {
  const items = [];
  let depth = 0;
  let start = 0;

  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (char === '(') {
      depth++;
    } else if (char === ')') {
      depth--;
      if (depth < 0) throw new Error('parenteses desbalanceados');
    } else if (char === ',' && depth === 0) {
      const item = input.slice(start, index).trim();
      if (!item) throw new Error('item vazio');
      items.push(item);
      start = index + 1;
    }
  }

  if (depth !== 0) throw new Error('parenteses desbalanceados');
  const lastItem = input.slice(start).trim();
  if (!lastItem) throw new Error('item vazio');
  items.push(lastItem);
  return items;
}

function isValidRestEmbed(item) {
  const openIndex = item.indexOf('(');
  if (openIndex <= 0 || !item.endsWith(')')) return false;

  const prefix = item.slice(0, openIndex);
  const identifier = '[a-zA-Z_][a-zA-Z0-9_]*';
  const embedPrefix = new RegExp(`^(?:${identifier}:)?${identifier}(?:!${identifier})*$`);
  if (!embedPrefix.test(prefix)) return false;

  const inner = item.slice(openIndex + 1, -1).trim();
  if (!inner) return true;

  try {
    return splitRestSelectItems(inner).every((nestedItem) => (
      nestedItem === '*' ||
      isIdentifier(nestedItem) ||
      isValidRestEmbed(nestedItem)
    ));
  } catch {
    return false;
  }
}

export function parseRestSelectProjection(selectParam) {
  const input = String(selectParam ?? '').trim();
  if (!input || input === '*') return '*';

  let items;
  try {
    items = splitRestSelectItems(input);
  } catch (error) {
    throw new Error(`select invalido: ${error.message}`);
  }

  const rootColumns = [];
  for (const item of items) {
    if (item === '*') {
      rootColumns.push(item);
      continue;
    }
    if (isIdentifier(item)) {
      rootColumns.push(item);
      continue;
    }
    if (isValidRestEmbed(item)) continue;
    throw new Error(`item invalido no select: ${item}`);
  }

  if (rootColumns.includes('*') || rootColumns.length === 0) return '*';
  return [...new Set(rootColumns)].map(quoteIdent).join(', ');
}

const companyScopedTableCache = new Map();
async function tableHasCompanyId(table) {
  if (companyScopedTableCache.has(table)) return companyScopedTableCache.get(table);
  const result = await pool.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'company_id'
     ) AS scoped`,
    [table],
  );
  const scoped = result.rows[0]?.scoped === true;
  companyScopedTableCache.set(table, scoped);
  return scoped;
}

export function isPasswordChangeBootstrapRead(method, table, searchParams, userId) {
  if (method !== 'GET' || !userId) return false;
  const selfFilter = `eq.${userId}`;
  return (
    (table === 'user_profiles' && searchParams.get('id') === selfFilter)
    || (table === 'auth_account_security' && searchParams.get('user_id') === selfFilter)
  );
}

async function requiredCompanyScope(profile, table) {
  if (!(await tableHasCompanyId(table))) return null;
  if (!profile?.company_id) {
    const error = new Error(`perfil sem company_id para acessar tabela '${table}'`);
    error.statusCode = 403;
    throw error;
  }
  return profile.company_id;
}

const configuredPermissionCacheTtl = Number(process.env.RBAC_CACHE_TTL_MS || 30_000);
const PERMISSION_CACHE_TTL_MS = Number.isFinite(configuredPermissionCacheTtl)
  ? Math.max(1_000, Math.min(configuredPermissionCacheTtl, 300_000))
  : 30_000;

// O cache inclui usuário e empresa para impedir que overrides vazem entre contas.
const permCache = new Map();
async function loadRolePerms(role, userId = null, companyId = null) {
  const normalizedRole = normalizeRole(role);
  if (!normalizedRole || !userId || !companyId) return {};

  const cacheKey = `${companyId}:${userId}:${normalizedRole}`;
  const cached = permCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.permissions;
  if (cached) permCache.delete(cacheKey);

  try {
    const query = (text, values) => queryWithTenantContext(companyId, text, values, userId, {
      sub: userId,
      company_id: companyId,
      role: 'authenticated',
    });
    const roleResult = await query(
      `SELECT rp.module, rp.can_view, rp.can_create, rp.can_edit, rp.can_delete
         FROM role_permissions rp JOIN roles ro ON ro.id = rp.role_id
        WHERE lower(ro.name) = $1
          AND COALESCE(ro.lg_ativo, TRUE) = TRUE
          AND (ro.company_id IS NULL OR ro.company_id = $2)`,
      [normalizedRole, companyId],
    );
    const overrideResult = await query(
      `SELECT p.module, p.action, up.effect, up.unit_id, up.sector_code
         FROM user_permissions up
         JOIN permissions p ON p.id = up.permission_id
        WHERE up.user_id = $1
          AND up.company_id = $2
          AND up.permission_id IS NOT NULL
          AND up.effect IN ('grant', 'deny')
          AND up.valid_from <= NOW()
          AND (up.valid_until IS NULL OR up.valid_until > NOW())`,
      [userId, companyId],
    );

    const basePermissions = {};
    for (const row of roleResult.rows) basePermissions[row.module] = row;
    const permissions = applyUserPermissionOverrides(basePermissions, overrideResult.rows);
    permCache.set(cacheKey, {
      permissions,
      expiresAt: Date.now() + PERMISSION_CACHE_TTL_MS,
    });
    return permissions;
  } catch (error) {
    const denied = {};
    permCache.set(cacheKey, {
      permissions: denied,
      expiresAt: Date.now() + Math.min(PERMISSION_CACHE_TTL_MS, 5_000),
    });
    console.error('[RBAC_LOAD_FAILED]', {
      userId,
      companyId,
      role: normalizedRole,
      code: error?.code || null,
      message: error?.message || String(error),
    });
    return denied;
  }
}

/** Retorna {ok:true} ou {ok:false, reason}. Somente admin tem bypass total. */
async function authorize(profile, table, method) {
  if (!profile) return { ok: false, reason: 'sem perfil' };
  if (!profile.lg_ativo) return { ok: false, reason: 'usuÃ¡rio inativo' };
  if (isAuthSelfServiceRequestAllowed(table, method)) {
    return { ok: true };
  }
  if (clinicalWaveDirectWriteDenied(table, method)) {
    return { ok: false, reason: `tabela '${table}' aceita mutacoes somente por RPC auditavel` };
  }
  const role = (profile.role_name || '').toLowerCase();
  if (role === 'admin') return { ok: true };
  if (ORGANIZATION_TABLES.has(table.toLowerCase())) {
    if (METHOD_TO_ACTION[method] === 'can_view') return { ok: true };
    return ORGANIZATION_MANAGER_ROLES.has(role)
      ? { ok: true }
      : { ok: false, reason: 'somente gestores podem alterar a estrutura organizacional' };
  }
  if (PROFESSIONAL_TABLES.has(table.toLowerCase())) {
    if (METHOD_TO_ACTION[method] === 'can_view') return { ok: true };
    return PROFESSIONAL_MANAGER_ROLES.has(role)
      ? { ok: true }
      : { ok: false, reason: 'somente gestores podem alterar o cadastro profissional' };
  }
  if (SETTINGS_TABLES.has(table.toLowerCase())) {
    if (METHOD_TO_ACTION[method] === 'can_view') return { ok: true };
    if (table.toLowerCase() === 'user_preferences') return { ok: true };
    return SETTINGS_MANAGER_ROLES.has(role)
      ? { ok: true }
      : { ok: false, reason: 'somente gestores podem alterar configuracoes' };
  }
  const module = tableToModule(table);
  if (module === '__unmapped__') {
    return { ok: false, reason: `tabela '${table}' nao esta explicitamente autorizada` };
  }
  if (module === null) {
    // tabelas de referÃªncia: leitura liberada, escrita sÃ³ admin (jÃ¡ retornou acima)
    return METHOD_TO_ACTION[method] === 'can_view' ? { ok: true } : { ok: false, reason: 'escrita em tabela de referÃªncia exige admin' };
  }
  const perms = await loadRolePerms(role, profile.id, profile.company_id);
  const rule = perms[module];
  if (!rule) return { ok: false, reason: `role '${role}' sem acesso ao mÃ³dulo '${module}'` };
  const action = METHOD_TO_ACTION[method] || 'can_view';
  if (!rule[action]) return { ok: false, reason: `role '${role}' nÃ£o pode '${action}' em '${module}'` };
  return { ok: true };
}

const RPC_PERMISSIONS = {
  create_appointment_secure: { module: 'agenda', action: 'can_create' },
  m9_create_appointment_secure: { module: 'agenda', action: 'can_create' },
  update_appointment_status_secure: { module: 'agenda', action: 'can_edit' },
  reschedule_appointment_secure: { module: 'agenda', action: 'can_edit' },
  m9_get_patient_appointments_timeline_secure: { module: 'agenda', action: 'can_view' },
  m9_check_patient_appointment_conflicts_secure: { module: 'agenda', action: 'can_view' },
  m9_reschedule_appointment_linked_secure: { module: 'agenda', action: 'can_edit' },
  m9_save_professional_schedule_grade_secure: { module: 'agenda', action: 'can_edit' },
  m9_add_schedule_exception_secure: { module: 'agenda', action: 'can_edit' },
  m9_publish_schedule_grade_secure: { module: 'agenda', action: 'can_edit' },
  m9_get_professional_schedule_windows_secure: { module: 'agenda', action: 'can_view' },
  create_waitlist_entry_secure: { module: 'agenda', action: 'can_create' },
  close_waitlist_entry_secure: { module: 'agenda', action: 'can_edit' },
  convert_waitlist_to_appointment_secure: { module: 'agenda', action: 'can_edit' },
  create_schedule_block_secure: { module: 'agenda', action: 'can_edit' },
  cancel_schedule_block_secure: { module: 'agenda', action: 'can_edit' },
  get_professional_available_slots: { module: 'agenda', action: 'can_view' },
  get_scheduling_requirements: { module: 'agenda', action: 'can_view' },
  update_appointment_secure: { module: 'agenda', action: 'can_edit' },
  create_call_center_contact_secure: { module: 'call_center', action: 'can_create' },
  create_call_center_task_secure: { module: 'call_center', action: 'can_create' },
  complete_call_center_task_secure: { module: 'call_center', action: 'can_edit' },
  create_call_center_script_secure: { module: 'call_center', action: 'can_create' },
  create_call_center_campaign_secure: { module: 'call_center', action: 'can_create' },
  enqueue_call_center_campaign_member_secure: { module: 'call_center', action: 'can_create' },
  convert_call_center_contact_secure: { module: 'call_center', action: 'can_edit' },
  patient_create_with_duplicate_decision: { module: 'pacientes', action: 'can_create' },
  patient_merge_patients: { module: 'pacientes', action: 'can_edit' },
  search_patients_secure: { module: 'pacientes', action: 'can_view' },
  get_call_center_indicators: { module: 'call_center', action: 'can_view' },
  create_medical_record_secure: { module: 'prontuario', action: 'can_create' },
  update_medical_record_secure: { module: 'prontuario', action: 'can_edit' },
  update_patient_secure: { module: 'pacientes', action: 'can_edit' },
  criar_sala_telemedicina: { module: 'telemedicina', action: 'can_create' },
  registrar_consentimento_gravacao: { module: 'telemedicina', action: 'can_edit' },
  finalizar_sala_telemedicina: { module: 'telemedicina', action: 'can_edit' },
  current_company_id: { module: 'admin', action: 'can_view' },
  calc_imc: { module: 'prontuario', action: 'can_view' },
  create_appointment_with_requirements_secure: { module: 'agenda', action: 'can_create' },
  create_appointment_series_secure: { module: 'agenda', action: 'can_create' },
  create_appointment_overbooked_secure: { module: 'agenda', action: 'can_create' },
  refresh_confirmation_queue_secure: { module: 'agenda', action: 'can_edit' },
  record_confirmation_attempt_secure: { module: 'agenda', action: 'can_edit' },
  mark_overdue_appointments_no_show_secure: { module: 'agenda', action: 'can_edit' },
  get_reception_checkin_readiness: { module: 'recepcao', action: 'can_view' },
  get_reception_precheckin_context: { module: 'recepcao', action: 'can_view' },
  perform_reception_checkin_secure: { module: 'recepcao', action: 'can_create' },
  start_reception_checkin_workflow_secure: { module: 'recepcao', action: 'can_create' },
  advance_reception_checkin_workflow_secure: { module: 'recepcao', action: 'can_edit' },
  ensure_billing_preaccount_for_checkin_secure: { module: 'recepcao', action: 'can_create' },
  ensure_tiss_guide_for_checkin_secure: { module: 'recepcao', action: 'can_create' },
  ensure_financial_receivable_for_checkin_secure: { module: 'recepcao', action: 'can_create' },
  update_reception_authorization_secure: { module: 'recepcao', action: 'can_edit' },
  update_reception_eligibility_secure: { module: 'recepcao', action: 'can_edit' },
  record_reception_term_acceptance_secure: { module: 'recepcao', action: 'can_edit' },
  create_reception_document_pickup_secure: { module: 'recepcao', action: 'can_create' },
  release_reception_document_pickup_secure: { module: 'recepcao', action: 'can_edit' },
  create_reception_walkin_secure: { module: 'recepcao', action: 'can_create' },
  resolve_insurance_rule: { module: 'faturamento', action: 'can_view', allowedRoles: INSURANCE_RPC_ROLE_POLICY },
  create_insurance_eligibility_check_secure: { module: 'faturamento', action: 'can_create', allowedRoles: INSURANCE_RPC_ROLE_POLICY },
  update_insurance_eligibility_check_secure: { module: 'faturamento', action: 'can_edit', allowedRoles: INSURANCE_RPC_ROLE_POLICY },
  create_insurance_authorization_secure: { module: 'faturamento', action: 'can_create', allowedRoles: INSURANCE_RPC_ROLE_POLICY },
  transition_insurance_authorization_secure: { module: 'faturamento', action: 'can_edit', allowedRoles: INSURANCE_RPC_ROLE_POLICY },
  create_insurance_authorization_followup_secure: { module: 'faturamento', action: 'can_edit', allowedRoles: INSURANCE_RPC_ROLE_POLICY },
  add_insurance_authorization_attachment_secure: { module: 'faturamento', action: 'can_edit', allowedRoles: INSURANCE_RPC_ROLE_POLICY },
  consume_insurance_authorization: { module: 'faturamento', action: 'can_edit', allowedRoles: INSURANCE_RPC_ROLE_POLICY },
  create_tiss_guide_secure: { module: 'faturamento', action: 'can_edit', allowedRoles: TISS_GUIDE_RPC_ROLE_POLICY },
  validate_tiss_guide_secure: { module: 'faturamento', action: 'can_edit', allowedRoles: TISS_GUIDE_RPC_ROLE_POLICY },
  sign_tiss_guide_secure: { module: 'faturamento', action: 'can_edit', allowedRoles: TISS_GUIDE_RPC_ROLE_POLICY },
  cancel_tiss_guide_secure: { module: 'faturamento', action: 'can_edit', allowedRoles: TISS_GUIDE_RPC_ROLE_POLICY },
  substitute_tiss_guide_secure: { module: 'faturamento', action: 'can_edit', allowedRoles: TISS_GUIDE_RPC_ROLE_POLICY },
  link_tiss_xml_guide_secure: { module: 'faturamento', action: 'can_edit', allowedRoles: TISS_GUIDE_RPC_ROLE_POLICY },
  get_billing_dossier_secure: { module: 'faturamento', action: 'can_view', allowedRoles: INSURANCE_RPC_ROLE_POLICY },
  record_tiss_patient_acknowledgement_secure: { module: 'recepcao', action: 'can_edit', allowedRoles: INSURANCE_RPC_ROLE_POLICY },
  refresh_billing_readiness_secure: { module: 'faturamento', action: 'can_edit', allowedRoles: TISS_GUIDE_RPC_ROLE_POLICY },
  upsert_billing_account_item_secure: { module: 'faturamento', action: 'can_edit', allowedRoles: TISS_GUIDE_RPC_ROLE_POLICY },
  cancel_billing_account_item_secure: { module: 'faturamento', action: 'can_edit', allowedRoles: TISS_GUIDE_RPC_ROLE_POLICY },
  seal_billing_tiss_guide_secure: { module: 'faturamento', action: 'can_edit', allowedRoles: TISS_GUIDE_RPC_ROLE_POLICY },
  register_billing_tiss_xml_secure: { module: 'faturamento', action: 'can_edit', allowedRoles: TISS_GUIDE_RPC_ROLE_POLICY },
  resolve_billing_issue_secure: { module: 'faturamento', action: 'can_edit', allowedRoles: TISS_GUIDE_RPC_ROLE_POLICY },
  reopen_billing_account_secure: { module: 'faturamento', action: 'can_edit', allowedRoles: TISS_GUIDE_RPC_ROLE_POLICY },
  settle_financial_receivable_secure: { module: 'financeiro', action: 'can_edit', allowedRoles: TISS_GUIDE_RPC_ROLE_POLICY },
  apply_tiss_return_secure: { module: 'faturamento', action: 'can_edit', allowedRoles: TISS_GUIDE_RPC_ROLE_POLICY },
  settle_insurance_receivable_secure: { module: 'financeiro', action: 'can_edit', allowedRoles: TISS_GUIDE_RPC_ROLE_POLICY },
  issue_triage_queue_ticket_secure: { module: 'enfermagem', action: 'can_create' },
  transition_triage_queue_secure: { module: 'enfermagem', action: 'can_edit' },
  transition_reception_queue_ticket_secure: { module: 'recepcao', action: 'can_edit' },
  request_anonymize_patient: { module: 'auditoria', action: 'can_edit' },
  calcular_kpis_diarios: { module: 'bi', action: 'can_edit' },
  detectar_alertas_bi: { module: 'bi', action: 'can_edit' },
  find_price: { module: 'faturamento', action: 'can_view' },
  queue_notification: { module: 'recepcao', action: 'can_create' },
  tiss_get_stats: { module: 'faturamento', action: 'can_view' },
  calcular_valor_estoque: { module: 'farmacia', action: 'can_view' },
  cancel_pre_cadastro: { module: 'recepcao', action: 'can_edit' },
  confirm_pre_cadastro: { module: 'recepcao', action: 'can_create' },
  create_pre_cadastro: { module: 'recepcao', action: 'can_create' },
  gerar_senha_triagem: { module: 'enfermagem', action: 'can_create' },
  log_data_access: { module: 'auditoria', action: 'can_create' },
  promote_pre_cadastro: { module: 'recepcao', action: 'can_edit' },
  publish_dicom_report: { module: 'dicom', action: 'can_edit' },
  registrar_movimentacao_estoque: { module: 'farmacia', action: 'can_edit' },
  recalc_tiss_total_glosa: { module: 'faturamento', action: 'can_edit' },
  bedside_check: { module: 'enfermagem', action: 'can_view' },
  billing_check_pending: { module: 'faturamento', action: 'can_edit' },
  check_prescription_safety: { module: 'prontuario', action: 'can_view' },
  create_imaging_order_from_attendance: { module: 'prontuario', action: 'can_edit',
    allowedRoles: IMAGING_RPC_ROLE_POLICY.create_imaging_order_from_attendance,
  },
  sign_and_release_radiology_report: { module: 'dicom', action: 'can_edit',
    allowedRoles: IMAGING_RPC_ROLE_POLICY.sign_and_release_radiology_report,
  },
  deliver_radiology_report: { module: 'dicom', action: 'can_edit',
    allowedRoles: IMAGING_RPC_ROLE_POLICY.deliver_radiology_report,
  },
  rectify_radiology_report: { module: 'dicom', action: 'can_edit',
    allowedRoles: IMAGING_RPC_ROLE_POLICY.rectify_radiology_report,
  },
  m17_create_medical_record_secure: { module: 'prontuario', action: 'can_create', allowedRoles: MEDICAL_RECORD_RPC_ROLE_POLICY },
  m17_sign_medical_record_secure: { module: 'prontuario', action: 'can_edit', allowedRoles: MEDICAL_RECORD_RPC_ROLE_POLICY },
  m17_rectify_medical_record_secure: { module: 'prontuario', action: 'can_edit', allowedRoles: MEDICAL_RECORD_RPC_ROLE_POLICY },
  m17_register_emergency_access_secure: { module: 'prontuario', action: 'can_view', allowedRoles: MEDICAL_RECORD_RPC_ROLE_POLICY },
  m18_open_attendance_secure: { module: 'prontuario', action: 'can_create', allowedRoles: MEDICAL_RECORD_RPC_ROLE_POLICY },
  m18_save_attendance_secure: { module: 'prontuario', action: 'can_edit', allowedRoles: MEDICAL_RECORD_RPC_ROLE_POLICY },
  m18_finalize_attendance_secure: { module: 'prontuario', action: 'can_edit', allowedRoles: MEDICAL_RECORD_RPC_ROLE_POLICY },
  m18_complete_attendance_secure: { module: 'prontuario', action: 'can_edit', allowedRoles: MEDICAL_RECORD_RPC_ROLE_POLICY },
  sync_completed_appointment_billing_secure: { module: 'prontuario', action: 'can_edit', allowedRoles: MEDICAL_RECORD_RPC_ROLE_POLICY },
  flag_billing_sync_pending_secure: { module: 'prontuario', action: 'can_edit', allowedRoles: MEDICAL_RECORD_RPC_ROLE_POLICY },
  m19_complete_triage_secure: { module: 'triagem_clinica', action: 'can_create', allowedRoles: TRIAGE_RPC_ROLE_POLICY },
  m19_reclassify_triage_secure: { module: 'triagem_clinica', action: 'can_edit', allowedRoles: TRIAGE_RPC_ROLE_POLICY },
  m20_create_prescription_secure: { module: 'prescricao_eletronica', action: 'can_create', allowedRoles: PRESCRIBER_RPC_ROLE_POLICY },
  m20_upsert_prescription_item_secure: { module: 'prescricao_eletronica', action: 'can_edit', allowedRoles: PRESCRIBER_RPC_ROLE_POLICY },
  m20_remove_prescription_item_secure: { module: 'prescricao_eletronica', action: 'can_edit', allowedRoles: PRESCRIBER_RPC_ROLE_POLICY },
  m20_validate_prescription_secure: { module: 'prescricao_eletronica', action: 'can_edit', allowedRoles: PRESCRIBER_RPC_ROLE_POLICY },
  m20_resolve_safety_event_secure: { module: 'prescricao_eletronica', action: 'can_edit', allowedRoles: PRESCRIBER_RPC_ROLE_POLICY },
  m20_record_pharmaceutical_review_secure: { module: 'revisao_farmaceutica', action: 'can_edit', allowedRoles: PHARMACY_REVIEW_RPC_ROLE_POLICY },
  m20_transition_prescription_secure: { module: 'prescricao_eletronica', action: 'can_edit', allowedRoles: PRESCRIBER_RPC_ROLE_POLICY },
  m21_create_protocol_definition_secure: { module: 'protocolos_governanca', action: 'can_create', allowedRoles: CARE_PROTOCOL_GOVERNANCE_RPC_ROLE_POLICY },
  m21_publish_protocol_version_secure: { module: 'protocolos_governanca', action: 'can_edit', allowedRoles: CARE_PROTOCOL_GOVERNANCE_RPC_ROLE_POLICY },
  m21_transition_protocol_definition_secure: { module: 'protocolos_governanca', action: 'can_edit', allowedRoles: CARE_PROTOCOL_GOVERNANCE_RPC_ROLE_POLICY },
  m21_start_protocol_execution_secure: { module: 'protocolos_execucao', action: 'can_create', allowedRoles: CARE_PROTOCOL_EXECUTION_RPC_ROLE_POLICY },
  m21_transition_protocol_execution_secure: { module: 'protocolos_execucao', action: 'can_edit', allowedRoles: CARE_PROTOCOL_EXECUTION_RPC_ROLE_POLICY },
  m21_transition_protocol_step_secure: { module: 'protocolos_execucao', action: 'can_edit', allowedRoles: CARE_PROTOCOL_EXECUTION_RPC_ROLE_POLICY },
  m21_add_protocol_observation_secure: { module: 'protocolos_execucao', action: 'can_create', allowedRoles: CARE_PROTOCOL_EXECUTION_RPC_ROLE_POLICY },
  m21_raise_protocol_alert_secure: { module: 'protocolos_execucao', action: 'can_create', allowedRoles: CARE_PROTOCOL_EXECUTION_RPC_ROLE_POLICY },
  m21_transition_protocol_alert_secure: { module: 'protocolos_execucao', action: 'can_edit', allowedRoles: CARE_PROTOCOL_EXECUTION_RPC_ROLE_POLICY },
  m21_escalate_protocol_secure: { module: 'protocolos_execucao', action: 'can_edit', allowedRoles: CARE_PROTOCOL_EXECUTION_RPC_ROLE_POLICY },
  m21_add_protocol_override_secure: { module: 'protocolos_execucao', action: 'can_edit', allowedRoles: CARE_PROTOCOL_EXECUTION_RPC_ROLE_POLICY },
  m22_create_exam_request_secure: { module: 'solicitacoes_exames', action: 'can_create', allowedRoles: EXAM_REQUEST_ORDER_RPC_ROLE_POLICY },
  m22_sign_exam_request_secure: { module: 'solicitacoes_exames', action: 'can_edit', allowedRoles: EXAM_REQUEST_ORDER_RPC_ROLE_POLICY },
  m22_dispatch_exam_request_item_secure: { module: 'execucao_exames', action: 'can_create', allowedRoles: EXAM_REQUEST_DISPATCH_RPC_ROLE_POLICY },
  m22_transition_exam_request_item_secure: { module: 'execucao_exames', action: 'can_edit', allowedRoles: EXAM_REQUEST_DISPATCH_RPC_ROLE_POLICY },
  m22_cancel_exam_request_secure: { module: 'solicitacoes_exames', action: 'can_edit', allowedRoles: EXAM_REQUEST_ORDER_RPC_ROLE_POLICY },
  m23_upsert_exam_catalog_secure: { module: 'laboratorio', action: 'can_edit', allowedRoles: LABORATORY_MANAGEMENT_RPC_ROLE_POLICY },
  m23_upsert_reference_range_secure: { module: 'laboratorio', action: 'can_edit', allowedRoles: LABORATORY_MANAGEMENT_RPC_ROLE_POLICY },
  m23_upsert_equipment_secure: { module: 'laboratorio', action: 'can_edit', allowedRoles: LABORATORY_MANAGEMENT_RPC_ROLE_POLICY },
  m23_create_lab_order_secure: { module: 'laboratorio', action: 'can_create', allowedRoles: LABORATORY_ORDER_RPC_ROLE_POLICY },
  m23_collect_specimen_secure: { module: 'laboratorio', action: 'can_create', allowedRoles: LABORATORY_COLLECTION_RPC_ROLE_POLICY },
  m23_transition_specimen_secure: { module: 'laboratorio', action: 'can_edit', allowedRoles: LABORATORY_PROCESSING_RPC_ROLE_POLICY },
  m23_record_qc_run_secure: { module: 'laboratorio', action: 'can_create', allowedRoles: LABORATORY_PROCESSING_RPC_ROLE_POLICY },
  m23_record_results_secure: { module: 'laboratorio', action: 'can_create', allowedRoles: LABORATORY_PROCESSING_RPC_ROLE_POLICY },
  m23_validate_result_secure: { module: 'laboratorio', action: 'can_edit', allowedRoles: LABORATORY_VALIDATION_RPC_ROLE_POLICY },
  m23_acknowledge_critical_alert_secure: { module: 'laboratorio', action: 'can_edit', allowedRoles: LABORATORY_COMMUNICATION_RPC_ROLE_POLICY },
  m23_deliver_order_secure: { module: 'laboratorio', action: 'can_edit', allowedRoles: LABORATORY_COMMUNICATION_RPC_ROLE_POLICY },
};

const RPC_JSON_RESULT_FUNCTIONS = new Set([
  'create_tiss_guide_secure',
  'validate_tiss_guide_secure',
  'sign_tiss_guide_secure',
  'cancel_tiss_guide_secure',
  'substitute_tiss_guide_secure',
  'get_billing_dossier_secure',
  'record_tiss_patient_acknowledgement_secure',
  'refresh_billing_readiness_secure',
  'upsert_billing_account_item_secure',
  'cancel_billing_account_item_secure',
  'seal_billing_tiss_guide_secure',
  'register_billing_tiss_xml_secure',
  'resolve_billing_issue_secure',
  'reopen_billing_account_secure',
  'settle_financial_receivable_secure',
  'apply_tiss_return_secure',
  'settle_insurance_receivable_secure',
  'm17_create_medical_record_secure',
  'm17_sign_medical_record_secure',
  'm17_rectify_medical_record_secure',
  'm17_register_emergency_access_secure',
  'm18_open_attendance_secure',
  'm18_save_attendance_secure',
  'm18_finalize_attendance_secure',
  'm18_complete_attendance_secure',
  'sync_completed_appointment_billing_secure',
  'flag_billing_sync_pending_secure',
  'm19_complete_triage_secure',
  'm19_reclassify_triage_secure',
  'm20_create_prescription_secure',
  'm20_upsert_prescription_item_secure',
  'm20_remove_prescription_item_secure',
  'm20_validate_prescription_secure',
  'm20_resolve_safety_event_secure',
  'm20_record_pharmaceutical_review_secure',
  'm20_transition_prescription_secure',
  'm21_create_protocol_definition_secure',
  'm21_publish_protocol_version_secure',
  'm21_transition_protocol_definition_secure',
  'm21_start_protocol_execution_secure',
  'm21_transition_protocol_execution_secure',
  'm21_transition_protocol_step_secure',
  'm21_add_protocol_observation_secure',
  'm21_raise_protocol_alert_secure',
  'm21_transition_protocol_alert_secure',
  'm21_escalate_protocol_secure',
  'm21_add_protocol_override_secure',
  'm22_create_exam_request_secure',
  'm22_sign_exam_request_secure',
  'm22_dispatch_exam_request_item_secure',
  'm22_transition_exam_request_item_secure',
  'm22_cancel_exam_request_secure',
  'm23_upsert_exam_catalog_secure',
  'm23_upsert_reference_range_secure',
  'm23_upsert_equipment_secure',
  'm23_create_lab_order_secure',
  'm23_collect_specimen_secure',
  'm23_transition_specimen_secure',
  'm23_record_qc_run_secure',
  'm23_record_results_secure',
  'm23_validate_result_secure',
  'm23_acknowledge_critical_alert_secure',
  'm23_deliver_order_secure',
]);

const SELF_SERVICE_RPC_FUNCTIONS = new Set([
  'list_authorized_access_contexts',
  'set_access_context',
  'activate_application_context',
  'heartbeat_application_session',
  'is_application_session_allowed',
  'list_application_devices',
  'revoke_application_device',
  'revoke_application_session',
  'revoke_all_application_sessions',
]);

async function authorizeRpc(profile, functionName) {
  if (!profile || !profile.lg_ativo) return { ok: false, reason: 'usuario invalido/inativo' };
  if (SELF_SERVICE_RPC_FUNCTIONS.has(functionName)) return { ok: true };

  const required = RPC_PERMISSIONS[functionName];
  if (!required) return { ok: false, reason: `RPC '${functionName}' nao autorizada` };

  const role = normalizeRole(profile.role_name);
  if (role === 'admin') return { ok: true };

  const permissions = await loadRolePerms(role, profile.id, profile.company_id);
  const rule = permissions[required.module];
  if (!decideRpcAuthorization({
    role,
    allowedRoles: required.allowedRoles,
    permissionRule: rule,
    action: required.action,
  })) {
    return { ok: false, reason: `acesso negado para RPC '${functionName}'` };
  }
  return { ok: true };
}

const configuredOrigins = new Set(
  (process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);

function cors(req, res) {
  const origin = req.headers.origin;
  const host = req.headers.host;
  const sameOrigin = !origin || origin === `http://${host}` || origin === `https://${host}`;
  if (!sameOrigin && !configuredOrigins.has(origin)) return false;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'authorization, apikey, content-type, prefer, range, x-client-info, x-application-name, x-supabase-api-version, accept-profile, x-retry-count, x-device-id');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'content-range');
  return true;
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function parseBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > maxBytes) {
        const error = new Error('request body excede o limite de 1 MB');
        error.statusCode = 413;
        reject(error);
        return;
      }
      body += c;
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch { resolve({}); }
    });
  });
}

const loginAttempts = new Map();
const LOGIN_MAX_ATTEMPTS = Number(process.env.LOGIN_MAX_ATTEMPTS || 5);
const LOGIN_WINDOW_MS = Number(process.env.LOGIN_WINDOW_MS || 15 * 60 * 1000);
const LOGIN_BLOCK_MS = Number(process.env.LOGIN_BLOCK_MS || 15 * 60 * 1000);

function isStrongPassword(password) {
  return typeof password === 'string'
    && password.length >= 10
    && /[A-Z]/.test(password)
    && /[a-z]/.test(password)
    && /\d/.test(password)
    && /[^\w\s]/.test(password);
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function decodeBase32(value) {
  const normalized = String(value || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const char of normalized) bits += BASE32_ALPHABET.indexOf(char).toString(2).padStart(5, '0');
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function totpCode(secret, timestamp = Date.now()) {
  const counter = Math.floor(timestamp / 1000 / 30);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', decodeBase32(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1000000).padStart(6, '0');
}

function randomBase32Secret() {
  const bytes = randomBytes(20);
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  let result = '';
  for (let i = 0; i < bits.length; i += 5) result += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return result;
}

async function decryptMfaSecret(ciphertext) {
  const key = process.env.AUTH_MFA_ENCRYPTION_KEY;
  if (!key || key.length < 16) throw new Error('AUTH_MFA_ENCRYPTION_KEY nao configurada');
  const result = await pool.query('SELECT pgp_sym_decrypt($1::bytea, $2) AS secret', [ciphertext, key]);
  return result.rows[0]?.secret;
}

function loginAttemptKey(req, email) {
  const forwarded = process.env.TRUST_PROXY === 'true' ? req.headers['x-forwarded-for'] : null;
  const ip = String(forwarded || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  return `${ip}:${String(email || '').trim().toLowerCase()}`;
}

function loginBlocked(key, now = Date.now()) {
  const attempt = loginAttempts.get(key);
  if (!attempt) return false;
  if (attempt.blockedUntil > now) return true;
  if (now - attempt.firstAttempt > LOGIN_WINDOW_MS) loginAttempts.delete(key);
  return false;
}

function recordLoginFailure(key, now = Date.now()) {
  const previous = loginAttempts.get(key);
  const attempt = !previous || now - previous.firstAttempt > LOGIN_WINDOW_MS
    ? { count: 0, firstAttempt: now, blockedUntil: 0 }
    : previous;
  attempt.count += 1;
  if (attempt.count >= LOGIN_MAX_ATTEMPTS) attempt.blockedUntil = now + LOGIN_BLOCK_MS;
  loginAttempts.set(key, attempt);
  if (loginAttempts.size > 10000) {
    for (const [entryKey, entry] of loginAttempts) {
      if (entry.blockedUntil <= now && now - entry.firstAttempt > LOGIN_WINDOW_MS) loginAttempts.delete(entryKey);
    }
  }
}

const server = createServer(async (req, res) => {
  const corsAllowed = cors(req, res);
  if (!corsAllowed) return json(res, { error: 'forbidden_origin' }, 403);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // Support HEAD with count (supabase-js uses HEAD for count)
  if (req.method === 'HEAD' && path.startsWith('/rest/v1/')) {
    const table = path.replace('/rest/v1/', '').split('?')[0];
    // SEGURANÃ‡A: HEAD count exige JWT vÃ¡lido + autorizaÃ§Ã£o (antes vazava contagem sem auth)
    const hAuth = req.headers.authorization?.replace('Bearer ', '');
    const hPayload = verifyJwt(hAuth);
    if (!hPayload || !hPayload.sub) { res.writeHead(401); res.end(); return; }
    // valida nome de tabela (anti-injection) e permissÃ£o
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) { res.writeHead(400); res.end(); return; }
    const hProfile = await getUserProfile(hPayload.sub, hPayload.company_id);
    const hDecision = await authorize(hProfile, table, 'GET');
    if (!hDecision.ok) { res.writeHead(403); res.end(); return; }
    try {
      const hCompanyId = await requiredCompanyScope(hProfile, table);
      const countResult = hCompanyId
        ? await queryWithTenantContext(hCompanyId, `SELECT count(*) FROM public."${table}" WHERE company_id = $1`, [hCompanyId])
        : await queryWithTenantContext(null, `SELECT count(*) FROM public."${table}"`);
      const total = countResult.rows[0].count;
      res.writeHead(200, { 'content-range': `0-0/${total}` });
    } catch {
      res.writeHead(200, { 'content-range': '0-0/0' });
    }
    res.end();
    return;
  }

  try {
    // â”€â”€â”€ AUTH: Refresh Token (MUST come before login) â”€â”€â”€â”€â”€â”€â”€â”€
    if (path === '/auth/v1/token' && req.method === 'POST' && url.searchParams.get('grant_type') === 'refresh_token') {
      const body = await parseBody(req);
      const tokenValue = body.refresh_token || '';
      if (!tokenValue) {
        return json(res, { error: 'refresh_token is required' }, 400);
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const rt = await client.query(
          `UPDATE auth.refresh_tokens
              SET revoked = true, updated_at = now()
            WHERE token = $1 AND revoked = false
          RETURNING user_id`,
          [tokenValue],
        );
        if (rt.rows.length === 0) {
          await client.query('ROLLBACK');
          return json(res, { error: 'invalid refresh token', error_description: 'Token expired or revoked' }, 401);
        }
        const userRes = await client.query(
          `SELECT u.*
             FROM auth.users u
             JOIN public.user_profiles p ON p.id = u.id
            WHERE u.id = $1 AND p.lg_ativo IS TRUE`,
          [rt.rows[0].user_id],
        );
        if (userRes.rows.length === 0) {
          await client.query('ROLLBACK');
          return json(res, { error: 'invalid refresh token', error_description: 'User inactive or missing' }, 401);
        }
        const u = userRes.rows[0];
        const now = Math.floor(Date.now() / 1000);
        const accessToken = signJwt({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 3600, app_metadata: u.raw_app_meta_data, user_metadata: u.raw_user_meta_data });
        const newRefreshToken = randomUUID();
        await client.query(
          'INSERT INTO auth.refresh_tokens (token, user_id, parent) VALUES ($1, $2, $3)',
          [newRefreshToken, u.id, tokenValue],
        );
        await client.query('COMMIT');
        return json(res, {
          access_token: accessToken,
          token_type: 'bearer',
          expires_in: 3600,
          refresh_token: newRefreshToken,
          user: { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: u.email_confirmed_at, app_metadata: u.raw_app_meta_data, user_metadata: u.raw_user_meta_data }
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }

    // â”€â”€â”€ AUTH: Login â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (path === '/auth/v1/token' && req.method === 'POST') {
      const body = await parseBody(req);
      const attemptKey = loginAttemptKey(req, body.email);
      if (typeof body.email !== 'string' || typeof body.password !== 'string' || !body.email.trim() || !body.password) {
        recordLoginFailure(attemptKey);
        return json(res, { error: 'invalid_grant', error_description: 'Invalid login credentials' }, 400);
      }
      if (loginBlocked(attemptKey)) {
        return json(res, { error: 'rate_limit', error_description: 'Too many login attempts' }, 429);
      }
      const user = await verifyPassword(body.email, body.password);
      if (!user) {
        recordLoginFailure(attemptKey);
        return json(res, { error: 'invalid_grant', error_description: 'Invalid login credentials' }, 400);
      }
      loginAttempts.delete(attemptKey);
      user.factors = await loadMfaFactors(user.id, {
        sub: user.id,
        company_id: user.company_id,
      });
      const { accessToken, refreshToken, session } = await issueTokens(user, req);
      await recordSecurityEvent(user.id, 'login_success', req, { device_id: session.deviceId }, true, user.company_id);
      return json(res, buildAuthSessionResponse(user, accessToken, refreshToken));
    }

    // â”€â”€â”€ AUTH: Get user â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (path === '/auth/v1/user' && req.method === 'GET') {
      const auth = req.headers.authorization?.replace('Bearer ', '');
      const payload = verifyJwt(auth);
      if (!payload || !(await sessionIsActive(payload))) return json(res, { error: 'unauthorized' }, 401);
      const userRes = await queryWithAuthContext(
        payload,
        `SELECT u.*
           FROM auth.users u
           JOIN public.user_profiles p ON p.id = u.id
          WHERE u.id = $1
            AND p.company_id = $2
            AND p.lg_ativo IS TRUE`,
        [payload.sub, payload.company_id],
      );
      if (userRes.rows.length === 0) return json(res, { error: 'user not found' }, 404);
      const u = userRes.rows[0];
      u.factors = await loadMfaFactors(u.id, payload);
      return json(res, {
        id: u.id, aud: u.aud, role: u.role, email: u.email,
        email_confirmed_at: u.email_confirmed_at,
        app_metadata: u.raw_app_meta_data,
        user_metadata: u.raw_user_meta_data,
        factors: u.factors,
        created_at: u.created_at,
      });
    }

    // AUTH: Update the authenticated user's password (first access/recovery).
    // The bearer token is the only authority accepted here; admin password
    // changes must use a separate audited flow and are not exposed by this route.
    if (path === '/auth/v1/user' && req.method === 'PUT') {
      const auth = req.headers.authorization?.replace('Bearer ', '');
      const payload = verifyJwt(auth);
      if (!payload || !(await sessionIsActive(payload))) return json(res, { error: 'unauthorized' }, 401);

      const body = await parseBody(req);
      const password = typeof body.password === 'string' ? body.password : '';
      if (!isStrongPassword(password) || password.length > 64 || Buffer.byteLength(password, 'utf8') > 72) {
        return json(res, {
          error: 'weak_password',
          error_description: 'Password must contain 10 to 64 characters, uppercase, lowercase, number and symbol',
        }, 422);
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `SELECT set_config('request.jwt.claim.sub', $1, true),
                  set_config('request.jwt.claim.role', 'authenticated', true),
                  set_config('request.jwt.claim.company_id', $2, true),
                  set_config('request.jwt.claims', $3, true)`,
          [payload.sub, payload.company_id || '', JSON.stringify(payload)],
        );
        const userRes = await client.query(
          `UPDATE auth.users
              SET encrypted_password = crypt($1, gen_salt('bf')),
                  updated_at = now()
            WHERE id = $2
            RETURNING id, aud, role, email, email_confirmed_at,
                      raw_app_meta_data, raw_user_meta_data, created_at, updated_at`,
          [password, payload.sub],
        );
        if (!userRes.rowCount) {
          await client.query('ROLLBACK');
          return json(res, { error: 'user not found' }, 404);
        }
        await client.query(
          `INSERT INTO public.auth_account_security
            (user_id, must_change_password, password_changed_at, password_expires_at, failed_login_attempts, account_locked_until, updated_at)
           VALUES ($1, false, now(), now() + interval '180 days', 0, NULL, now())
           ON CONFLICT (user_id) DO UPDATE SET
             must_change_password = false,
             password_changed_at = now(),
             password_expires_at = now() + interval '180 days',
             failed_login_attempts = 0,
             account_locked_until = NULL,
             updated_at = now()`,
          [payload.sub],
        );
        await client.query('UPDATE auth.refresh_tokens SET revoked = true, updated_at = now() WHERE user_id = $1 AND revoked = false', [payload.sub]);
        await client.query('UPDATE public.auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [payload.sub]);
        await recordSecurityEvent(payload.sub, 'password_changed', req, { via: 'authenticated_update' }, true, payload.company_id, client);
        await client.query('COMMIT');

        const u = userRes.rows[0];
        return json(res, {
          user: {
            id: u.id,
            aud: u.aud,
            role: u.role,
            email: u.email,
            email_confirmed_at: u.email_confirmed_at,
            app_metadata: u.raw_app_meta_data,
            user_metadata: u.raw_user_meta_data,
            created_at: u.created_at,
            updated_at: u.updated_at,
          },
        });
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    }

    // â”€â”€â”€ AUTH: Logout â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (path === '/auth/v1/logout' && req.method === 'POST') {
      const token = req.headers.authorization?.replace('Bearer ', '');
      const payload = verifyJwt(token);
      if (payload?.sub) {
        await pool.query(
          'UPDATE auth.refresh_tokens SET revoked = true, updated_at = now() WHERE user_id = $1 AND revoked = false',
          [payload.sub],
        );
        if (payload.jti) await queryWithAuthContext(payload, 'UPDATE public.auth_sessions SET revoked_at = now() WHERE jti = $1', [payload.jti]);
        await recordSecurityEvent(payload.sub, 'logout', req, {}, true, payload.company_id);
      }
      return json(res, {});
    }

    // (refresh token handler moved to top of chain)

    // AUTH: Active sessions/devices. Tokens are never returned by these routes.
    if (path === '/auth/v1/sessions' && req.method === 'GET') {
      const token = req.headers.authorization?.replace('Bearer ', '');
      const payload = verifyJwt(token);
      if (!payload || !(await sessionIsActive(payload))) return json(res, { error: 'unauthorized' }, 401);
      const result = await queryWithAuthContext(payload,
        `SELECT id, device_id, user_agent, ip_address, created_at, last_seen_at, expires_at, revoked_at
           FROM public.auth_sessions WHERE user_id = $1 ORDER BY last_seen_at DESC`,
        [payload.sub],
      );
      return json(res, result.rows);
    }

    if (path === '/auth/v1/sessions' && req.method === 'DELETE') {
      const token = req.headers.authorization?.replace('Bearer ', '');
      const payload = verifyJwt(token);
      if (!payload || !(await sessionIsActive(payload))) return json(res, { error: 'unauthorized' }, 401);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `SELECT set_config('request.jwt.claim.sub', $1, true),
                  set_config('request.jwt.claim.role', 'authenticated', true),
                  set_config('request.jwt.claim.company_id', $2, true),
                  set_config('request.jwt.claims', $3, true)`,
          [payload.sub, payload.company_id || '', JSON.stringify(payload)],
        );
        const sessions = await client.query(
          `UPDATE public.auth_sessions
              SET revoked_at = now()
            WHERE user_id = $1 AND revoked_at IS NULL
            RETURNING id`,
          [payload.sub],
        );
        await client.query(
          `UPDATE public.auth_session_devices
              SET revoked_at = now(), last_seen_at = now()
            WHERE user_id = $1 AND revoked_at IS NULL`,
          [payload.sub],
        );
        await client.query(
          `UPDATE auth.refresh_tokens
              SET revoked = true, updated_at = now()
            WHERE user_id = $1 AND revoked = false`,
          [payload.sub],
        );
        await client.query('COMMIT');
        await recordSecurityEvent(payload.sub, 'logout_all', req, { revoked_sessions: sessions.rowCount }, true, payload.company_id);
        return json(res, { revoked_sessions: sessions.rowCount }, 200);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    }

    if (path.startsWith('/auth/v1/sessions/') && req.method === 'DELETE') {
      const token = req.headers.authorization?.replace('Bearer ', '');
      const payload = verifyJwt(token);
      if (!payload || !(await sessionIsActive(payload))) return json(res, { error: 'unauthorized' }, 401);
      const sessionId = decodeURIComponent(path.slice('/auth/v1/sessions/'.length));
      if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return json(res, { error: 'invalid session id' }, 400);
      const result = await queryWithAuthContext(payload,
        'UPDATE public.auth_sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2 RETURNING id',
        [sessionId, payload.sub],
      );
      if (result.rowCount) await recordSecurityEvent(payload.sub, 'device_revoked', req, { session_id: sessionId }, true, payload.company_id);
      return json(res, {}, result.rowCount ? 200 : 404);
    }

    if (path === '/auth/v1/factors' && req.method === 'GET') {
      const token = req.headers.authorization?.replace('Bearer ', '');
      const payload = verifyJwt(token);
      if (!payload || !(await sessionIsActive(payload))) return json(res, { error: 'unauthorized' }, 401);
      const result = await queryWithAuthContext(payload,
        `SELECT id, friendly_name, factor_type AS factor_type, status, created_at, updated_at
           FROM public.auth_mfa_factors WHERE user_id = $1 ORDER BY created_at`,
        [payload.sub],
      );
      return json(res, { all: result.rows, totp: result.rows, phone: [] });
    }

    if (path === '/auth/v1/factors' && req.method === 'POST') {
      const token = req.headers.authorization?.replace('Bearer ', '');
      const payload = verifyJwt(token);
      if (!payload || !(await sessionIsActive(payload))) return json(res, { error: 'unauthorized' }, 401);
      if (!process.env.AUTH_MFA_ENCRYPTION_KEY) return json(res, { error: 'mfa_not_configured' }, 503);
      const body = await parseBody(req);
      const secret = randomBase32Secret();
      const friendlyName = typeof body.friendly_name === 'string' && body.friendly_name.trim()
        ? body.friendly_name.trim().slice(0, 80) : 'ProntoMedic';
      const result = await queryWithAuthContext(payload,
        `INSERT INTO public.auth_mfa_factors (user_id, friendly_name, secret_ciphertext, status)
         VALUES ($1, $2, pgp_sym_encrypt($3, $4), 'unverified')
         ON CONFLICT (user_id, friendly_name) DO UPDATE SET
           updated_at = public.auth_mfa_factors.updated_at
         WHERE public.auth_mfa_factors.status = 'unverified'
         RETURNING id, friendly_name, status, created_at,
           pgp_sym_decrypt(secret_ciphertext, $4) AS persisted_secret`,
        [payload.sub, friendlyName, secret, process.env.AUTH_MFA_ENCRYPTION_KEY],
      );
      if (!result.rowCount) return json(res, { error: 'verified_factor_exists' }, 409);
      const factor = result.rows[0];
      const persistedSecret = factor.persisted_secret;
      const issuer = encodeURIComponent('ProntoMedic');
      const account = encodeURIComponent(payload.email || payload.sub);
      const otpauth = `otpauth://totp/${issuer}:${account}?secret=${persistedSecret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
      const qrSvg = await QRCode.toString(otpauth, {
        type: 'svg',
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 240,
      });
      return json(res, {
        id: factor.id,
        type: 'totp',
        status: factor.status,
        totp: { secret: persistedSecret, uri: otpauth, qr_code: encodeURIComponent(qrSvg) },
      }, 200);
    }

    const factorChallenge = path.match(/^\/auth\/v1\/factors\/([0-9a-f-]{36})\/challenge$/i);
    if (factorChallenge && req.method === 'POST') {
      const token = req.headers.authorization?.replace('Bearer ', '');
      const payload = verifyJwt(token);
      if (!payload || !(await sessionIsActive(payload))) return json(res, { error: 'unauthorized' }, 401);
      const factorId = factorChallenge[1];
      const factor = await queryWithAuthContext(payload,
        'SELECT id, status FROM public.auth_mfa_factors WHERE id = $1 AND user_id = $2',
        [factorId, payload.sub],
      );
      if (!factor.rowCount) return json(res, { error: 'factor_not_found' }, 404);
      const challengeId = randomUUID();
      await recordSecurityEvent(payload.sub, 'mfa_challenge', req, { factor_id: factorId, challenge_id: challengeId }, true, payload.company_id);
      return json(res, { id: challengeId, factor_id: factorId, expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString() }, 200);
    }

    const factorVerify = path.match(/^\/auth\/v1\/factors\/([0-9a-f-]{36})\/verify$/i);
    if (factorVerify && req.method === 'POST') {
      const token = req.headers.authorization?.replace('Bearer ', '');
      const payload = verifyJwt(token);
      if (!payload || !(await sessionIsActive(payload))) return json(res, { error: 'unauthorized' }, 401);
      const body = await parseBody(req);
      if (!/^\d{6}$/.test(String(body.code || ''))) return json(res, { error: 'invalid_code' }, 403);
      const factor = await queryWithAuthContext(payload,
        'SELECT id, secret_ciphertext FROM public.auth_mfa_factors WHERE id = $1 AND user_id = $2 AND status <> $3',
        [factorVerify[1], payload.sub, 'disabled'],
      );
      if (!factor.rowCount) return json(res, { error: 'factor_not_found' }, 404);
      const secret = await decryptMfaSecret(factor.rows[0].secret_ciphertext);
      const valid = [ -30_000, 0, 30_000 ].some((offset) => totpCode(secret, Date.now() + offset) === String(body.code));
      if (!valid) {
        await recordSecurityEvent(payload.sub, 'mfa_failure', req, { factor_id: factorVerify[1] }, false, payload.company_id);
        return json(res, { error: 'invalid_code' }, 403);
      }
      await queryWithAuthContext(payload, 'UPDATE public.auth_mfa_factors SET status = \'verified\', updated_at = now() WHERE id = $1', [factorVerify[1]]);
      await recordSecurityEvent(payload.sub, 'mfa_success', req, { factor_id: factorVerify[1] }, true, payload.company_id);
      const userResult = await queryWithAuthContext(payload,
        `SELECT u.*, p.company_id
           FROM auth.users u
           JOIN public.user_profiles p ON p.id = u.id
          WHERE u.id = $1 AND p.lg_ativo IS TRUE`,
        [payload.sub],
      );
      if (!userResult.rowCount) return json(res, { error: 'user_not_found' }, 404);

      const user = userResult.rows[0];
      user.factors = await loadMfaFactors(user.id, payload);
      const { accessToken, refreshToken } = await issueTokens(
        user,
        req,
        { aal: 'aal2', amrMethod: 'totp' },
      );
      if (payload.jti) {
        await queryWithAuthContext(payload,
          `UPDATE public.auth_sessions
              SET revoked_at = now()
            WHERE jti = $1 AND user_id = $2`,
          [payload.jti, payload.sub],
        );
      }
      return json(res, buildAuthSessionResponse(user, accessToken, refreshToken));
    }

    // AUTH: Password recovery. The raw token is never returned in production.
    if (path === '/auth/v1/recover' && req.method === 'POST') {
      const body = await parseBody(req);
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const userResult = email ? await pool.query(
        `SELECT u.id FROM auth.users u JOIN public.user_profiles p ON p.id = u.id
          WHERE lower(u.email) = $1 AND p.lg_ativo IS TRUE AND p.blocked_at IS NULL`, [email]
      ) : { rows: [] };
      let recoveryToken = null;
      if (userResult.rowCount) {
        recoveryToken = randomBytes(32).toString('hex');
        await pool.query(
          `UPDATE public.password_resets SET used = true, used_at = now()
             WHERE user_id = $1 AND used = false AND dt_exp > now()`, [userResult.rows[0].id]
        );
        await pool.query(
          `INSERT INTO public.password_resets (user_id, token, token_hash, dt_exp, ip_origem)
           VALUES ($1, $2, $3, now() + interval '1 hour', $4::inet)`,
          [userResult.rows[0].id, `legacy-${randomUUID()}`, hashOpaqueToken(recoveryToken), requestIp(req)],
        );
        await recordSecurityEvent(userResult.rows[0].id, 'password_recovery_requested', req);
      }
      if (process.env.AUTH_RECOVERY_RETURN_TOKEN === 'true' && recoveryToken) return json(res, { recovery_token: recoveryToken });
      return json(res, {});
    }

    if (path === '/auth/v1/recover/verify' && req.method === 'POST') {
      const body = await parseBody(req);
      const token = typeof body.token === 'string' ? body.token : '';
      const password = typeof body.password === 'string' ? body.password : '';
      if (!token || !isStrongPassword(password)) return json(res, { error: 'invalid_recovery_request' }, 422);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const reset = await client.query(
          `UPDATE public.password_resets SET used = true, used_at = now()
            WHERE token_hash = $1 AND used = false AND dt_exp > now()
            RETURNING user_id`, [hashOpaqueToken(token)]
        );
        if (!reset.rowCount) { await client.query('ROLLBACK'); return json(res, { error: 'invalid_or_expired_token' }, 400); }
        await client.query(
          `UPDATE auth.users SET encrypted_password = crypt($1, gen_salt('bf')), updated_at = now() WHERE id = $2`,
          [password, reset.rows[0].user_id]
        );
        await client.query(
          `INSERT INTO public.auth_account_security (user_id, must_change_password, password_changed_at, password_expires_at, failed_login_attempts, account_locked_until)
           VALUES ($1, false, now(), now() + interval '180 days', 0, NULL)
           ON CONFLICT (user_id) DO UPDATE SET must_change_password = false, password_changed_at = now(), password_expires_at = now() + interval '180 days', failed_login_attempts = 0, account_locked_until = NULL, updated_at = now()`,
          [reset.rows[0].user_id]
        );
        await client.query('COMMIT');
        await recordSecurityEvent(reset.rows[0].user_id, 'password_changed', req, { via: 'recovery' });
        return json(res, {});
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    }

    // â”€â”€â”€ AUTH: Settings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Edge Function-compatible admin invitation endpoint for the native VPS.
    if (path === '/functions/v1/admin-user-invite' && req.method === 'POST') {
      try {
        const { payload, actor } = await requireAdminRequest(req);
        const body = await parseBody(req, 32 * 1024);
        const email = String(body.email || '').trim().toLowerCase();
        const fullName = String(body.full_name || '').trim();
        const roleName = String(body.role_name || '').trim().toLowerCase();
        const username = body.username == null ? null : String(body.username).trim();
        const primaryUnitId = body.primary_unit_id == null ? null : Number(body.primary_unit_id);
        const temporaryPassword = typeof body.password === 'string' ? body.password : '';
        const phone = body.phone == null ? null : String(body.phone).trim().slice(0, 30);
        const cpf = body.cpf == null ? null : String(body.cpf).trim().slice(0, 20);
        if (!/^\S+@\S+\.\S+$/.test(email) || fullName.length < 2 || !/^[a-z0-9_ -]{1,80}$/i.test(roleName) || (username !== null && !/^[a-zA-Z0-9._-]{3,120}$/.test(username)) || (primaryUnitId !== null && (!Number.isInteger(primaryUnitId) || primaryUnitId <= 0))) {
          return json(res, { error: 'invalid_invitation' }, 422);
        }
        if (!isStrongPassword(temporaryPassword) || temporaryPassword.length > 64 || Buffer.byteLength(temporaryPassword, 'utf8') > 72) {
          return json(res, { error: 'weak_password', message: 'A senha temporária deve ter entre 10 e 64 caracteres, maiúscula, minúscula, número e símbolo.' }, 422);
        }
        const existing = await pool.query('SELECT id FROM auth.users WHERE lower(email) = $1', [email]);
        if (existing.rowCount) return json(res, { error: 'user_already_exists' }, 409);
        if (username) {
          const existingUsername = await pool.query(
            `SELECT p.id
               FROM public.user_profiles p
               JOIN auth.users u ON u.id = p.id
              WHERE lower(COALESCE(u.raw_user_meta_data->>'username', '')) = lower($1)
              LIMIT 1`,
            [username],
          );
          if (existingUsername.rowCount) return json(res, { error: 'username_already_exists' }, 409);
        }
        const userId = randomUUID();
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(
            `SELECT set_config('request.jwt.claim.sub', $1, true),
                    set_config('request.jwt.claim.role', 'authenticated', true),
                    set_config('request.jwt.claim.company_id', $2, true),
                    set_config('request.jwt.claims', $3, true)`,
            [payload.sub, payload.company_id || '', JSON.stringify(payload)],
          );
          const role = await client.query(
            'SELECT name FROM public.roles WHERE lower(name) = $1 AND lg_ativo IS TRUE AND (company_id = $2 OR company_id IS NULL) LIMIT 1',
            [roleName, actor.company_id],
          );
          if (!role.rowCount) {
            await client.query('ROLLBACK');
            return json(res, { error: 'invalid_role' }, 422);
          }
          let resolvedUnitId = actor.primary_unit_id;
          if (primaryUnitId !== null) {
            const unit = await client.query(
              'SELECT id FROM public.units WHERE id = $1 AND lg_ativo IS TRUE AND (company_id = $2 OR company_id IS NULL) LIMIT 1',
              [primaryUnitId, actor.company_id],
            );
            if (!unit.rowCount) {
              await client.query('ROLLBACK');
              return json(res, { error: 'invalid_unit' }, 422);
            }
            resolvedUnitId = primaryUnitId;
          }
          await client.query(
            `INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
             VALUES ($1, 'authenticated', 'authenticated', $2, crypt($3, gen_salt('bf')), now(), '{}'::jsonb, $4::jsonb)`,
             [userId, email, temporaryPassword, JSON.stringify({ full_name: fullName, username, cpf, invited: true })]
          );
          const resolvedRole = role.rows[0].name;
          await client.query(
             `INSERT INTO public.user_profiles (id, full_name, email, role_name, company_id, primary_unit_id, phone, cpf, lg_ativo)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)`,
             [userId, fullName, email, resolvedRole, actor.company_id, resolvedUnitId, phone, cpf]
          );
          await client.query(
            `INSERT INTO public.auth_account_security (user_id, must_change_password, password_expires_at)
             VALUES ($1, true, now() + interval '72 hours')
             ON CONFLICT (user_id) DO UPDATE SET
               must_change_password = true,
               password_expires_at = now() + interval '72 hours',
               updated_at = now()`, [userId]
          );
          await recordSecurityEvent(payload.sub, 'admin_user_invited', req, {
            invited_user_id: userId,
            role_name: roleName,
            primary_unit_id: resolvedUnitId,
          }, true, payload.company_id, client);
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK').catch(() => {});
          throw error;
        } finally {
          client.release();
        }
        return json(res, { user_id: userId, company_id: actor.company_id, role_name: roleName, delivery: 'administrator_set' }, 200);
      } catch (error) {
        const status = error.statusCode || 500;
        const code = error.code === 'password_change_required'
          ? 'password_change_required'
          : status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : 'admin_user_invite_failed';
        return json(res, { error: code, message: status >= 500 ? 'Não foi possível provisionar o usuário.' : error.message }, status);
      }
    }

    // ADMIN: user directory and controlled credential reset. These routes never
    // return password material and always scope the target to the actor company.
    if (path === '/auth/v1/admin/users' && req.method === 'GET') {
      try {
        const { payload, actor } = await requireAdminRequest(req);
        return json(res, await selectAdminUsers(actor.company_id, {
          search: url.searchParams.get('search') || '',
          lg_ativo: url.searchParams.get('lg_ativo') || '',
        }, payload.sub, payload));
      } catch (error) {
        return json(res, { error: error.statusCode === 401 ? 'unauthorized' : error.statusCode === 403 ? 'forbidden' : 'admin_users_failed', message: error.message }, error.statusCode || 500);
      }
    }

    if (path === '/auth/v1/admin/units' && req.method === 'GET') {
      try {
        const { actor } = await requireAdminRequest(req);
        const result = await queryWithTenantContext(actor.company_id,
          `SELECT id, COALESCE(to_jsonb(u)->>'name', to_jsonb(u)->>'ds_nome', to_jsonb(u)->>'nm_unidade') AS name
             FROM public.units u
            WHERE lg_ativo IS TRUE AND (company_id = $1 OR company_id IS NULL)
            ORDER BY name`, [actor.company_id]);
        return json(res, result.rows);
      } catch (error) {
        return json(res, { error: error.statusCode === 401 ? 'unauthorized' : error.statusCode === 403 ? 'forbidden' : 'admin_units_failed', message: error.message }, error.statusCode || 500);
      }
    }

    const adminUserMatch = path.match(/^\/auth\/v1\/admin\/users\/([^/]+)$/);
    if (adminUserMatch && req.method === 'PATCH') {
      try {
        const { payload, actor } = await requireAdminRequest(req);
        const targetId = decodeURIComponent(adminUserMatch[1]);
        if (!UUID_PATTERN.test(targetId)) return json(res, { error: 'invalid_user_id' }, 400);
        const body = adminUserUpdatePayload(await parseBody(req));
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(
            `SELECT set_config('request.jwt.claim.sub', $1, true),
                    set_config('request.jwt.claim.role', 'authenticated', true),
                    set_config('request.jwt.claim.company_id', $2, true),
                    set_config('request.jwt.claims', $3, true)`,
            [payload.sub, actor.company_id, JSON.stringify(payload)],
          );
          const target = await client.query('SELECT id FROM public.user_profiles WHERE id = $1 AND company_id = $2 FOR UPDATE', [targetId, actor.company_id]);
          if (!target.rowCount) { await client.query('ROLLBACK'); return json(res, { error: 'user_not_found' }, 404); }

          if (body.role_name !== undefined) {
            const role = await client.query(
              'SELECT name FROM public.roles WHERE lower(name) = lower($1) AND lg_ativo IS TRUE AND (company_id = $2 OR company_id IS NULL) LIMIT 1',
              [body.role_name, actor.company_id],
            );
            if (!role.rowCount) {
              await client.query('ROLLBACK');
              return json(res, { error: 'invalid_role' }, 422);
            }
            body.role_name = role.rows[0].name;
          }
          if (body.primary_unit_id !== undefined && body.primary_unit_id !== null) {
            const unit = await client.query(
              'SELECT id FROM public.units WHERE id = $1 AND lg_ativo IS TRUE AND (company_id = $2 OR company_id IS NULL) LIMIT 1',
              [Number(body.primary_unit_id), actor.company_id],
            );
            if (!unit.rowCount) {
              await client.query('ROLLBACK');
              return json(res, { error: 'invalid_unit' }, 422);
            }
          }
          if (body.username) {
            const duplicateUsername = await client.query(
              `SELECT p.id
                 FROM public.user_profiles p
                 JOIN auth.users u ON u.id = p.id
                WHERE p.id <> $1
                  AND lower(COALESCE(u.raw_user_meta_data->>'username', '')) = lower($2)
                LIMIT 1`,
              [targetId, body.username],
            );
            if (duplicateUsername.rowCount) {
              await client.query('ROLLBACK');
              return json(res, { error: 'username_already_exists' }, 409);
            }
          }

          const profileFields = ['full_name', 'email', 'role_name', 'primary_unit_id', 'phone', 'cpf', 'lg_ativo', 'blocked_at', 'access_valid_until'];
          const profileKeys = profileFields.filter((key) => Object.prototype.hasOwnProperty.call(body, key));
          if (profileKeys.length) {
            const values = profileKeys.map((key) => key === 'primary_unit_id' && body[key] !== null ? Number(body[key]) : body[key]);
            const setClause = profileKeys.map((key, index) => `"${key}" = $${index + 1}`).join(', ');
            await client.query(`UPDATE public.user_profiles SET ${setClause}, updated_at = now() WHERE id = $${values.length + 1} AND company_id = $${values.length + 2}`,
              [...values, targetId, actor.company_id]);
          }
          if (body.email !== undefined) {
            await client.query(
              'UPDATE auth.users SET email = $1, updated_at = now() WHERE id = $2',
              [body.email.trim().toLowerCase(), targetId],
            );
          }
          const metadataPatch = {};
          if (body.full_name !== undefined) metadataPatch.full_name = body.full_name.trim();
          if (body.username !== undefined) metadataPatch.username = body.username === null ? null : body.username.trim();
          if (body.cpf !== undefined) metadataPatch.cpf = body.cpf === null ? null : String(body.cpf).trim();
          if (Object.keys(metadataPatch).length) {
            await client.query(
              `UPDATE auth.users
                  SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || $1::jsonb,
                      updated_at = now()
                WHERE id = $2`,
              [JSON.stringify(metadataPatch), targetId],
            );
          }
          if (body.must_change_password !== undefined) {
            await client.query(
              `INSERT INTO public.auth_account_security (user_id, must_change_password, updated_at)
               VALUES ($1, $2, now())
               ON CONFLICT (user_id) DO UPDATE SET must_change_password = EXCLUDED.must_change_password, updated_at = now()`,
              [targetId, body.must_change_password],
            );
          }
          if (body.lg_ativo === false || body.blocked_at) {
            await client.query('UPDATE auth.refresh_tokens SET revoked = true, updated_at = now() WHERE user_id = $1 AND revoked = false', [targetId]);
            await client.query('UPDATE public.auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [targetId]);
          }
          await recordSecurityEvent(payload.sub, 'admin_user_updated', req, {
            target_user_id: targetId,
            fields: Object.keys(body),
          }, true, actor.company_id, client);
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK').catch(() => {});
          throw error;
        } finally { client.release(); }
        return json(res, await selectAdminUser(targetId, actor.company_id, payload.sub, payload));
      } catch (error) {
        const status = error.statusCode || 500;
        const code = error.code === 'password_change_required'
          ? 'password_change_required'
          : status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : 'admin_user_update_failed';
        return json(res, { error: code, message: status >= 500 ? 'Não foi possível atualizar o usuário.' : error.message }, status);
      }
    }

    const adminPasswordMatch = path.match(/^\/auth\/v1\/admin\/users\/([^/]+)\/password$/);
    if (adminPasswordMatch && req.method === 'PUT') {
      try {
        const { payload, actor } = await requireAdminRequest(req);
        const targetId = decodeURIComponent(adminPasswordMatch[1]);
        if (!UUID_PATTERN.test(targetId)) return json(res, { error: 'invalid_user_id' }, 400);
        const body = await parseBody(req);
        if (!isStrongPassword(body.password) || body.password.length > 64 || Buffer.byteLength(body.password, 'utf8') > 72) {
          return json(res, { error: 'weak_password', message: 'A senha deve ter entre 10 e 64 caracteres, maiúscula, minúscula, número e símbolo.' }, 422);
        }
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          // Keep the administrative reset inside the actor's tenant context so
          // auth_account_security RLS is enforced on the same transaction.
          await client.query(
            `SELECT set_config('request.jwt.claim.sub', $1, true),
                    set_config('request.jwt.claim.role', $2, true),
                    set_config('request.jwt.claim.company_id', $3, true),
                    set_config('request.jwt.claims', $4, true)`,
            [payload.sub, 'authenticated', actor.company_id, JSON.stringify(payload)],
          );
          const target = await client.query('SELECT id FROM public.user_profiles WHERE id = $1 AND company_id = $2 FOR UPDATE', [targetId, actor.company_id]);
          if (!target.rowCount) { await client.query('ROLLBACK'); return json(res, { error: 'user_not_found' }, 404); }
          await client.query('UPDATE auth.users SET encrypted_password = crypt($1, gen_salt(\'bf\')), updated_at = now() WHERE id = $2', [body.password, targetId]);
          await client.query(
            `INSERT INTO public.auth_account_security (user_id, must_change_password, password_changed_at, password_expires_at, failed_login_attempts, account_locked_until, updated_at)
             VALUES ($1, true, NULL, now() + interval '72 hours', 0, NULL, now())
             ON CONFLICT (user_id) DO UPDATE SET must_change_password = true, password_changed_at = NULL, password_expires_at = now() + interval '72 hours', failed_login_attempts = 0, account_locked_until = NULL, updated_at = now()`,
            [targetId],
          );
          await client.query('UPDATE auth.refresh_tokens SET revoked = true, updated_at = now() WHERE user_id = $1 AND revoked = false', [targetId]);
          await client.query('UPDATE public.auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [targetId]);
          await recordSecurityEvent(payload.sub, 'admin_password_reset', req, {
            target_user_id: targetId,
            must_change_password: true,
          }, true, actor.company_id, client);
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK').catch(() => {});
          throw error;
        } finally { client.release(); }
        return json(res, { ok: true, must_change_password: true });
      } catch (error) {
        const status = error.statusCode || 500;
        const code = error.code === 'password_change_required'
          ? 'password_change_required'
          : status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : 'admin_password_reset_failed';
        return json(res, { error: code, message: status >= 500 ? 'Não foi possível redefinir a senha.' : error.message }, status);
      }
    }

    if (path === '/auth/v1/settings') {
      return json(res, { external: {}, disable_signup: false, mailer_autoconfirm: true });
    }

    // Readiness real: confirma que o processo e o PostgreSQL pre-provisionado estao acessiveis.
    if (path === '/health' && req.method === 'GET') {
      try {
        await pool.query('SELECT 1');
        return json(res, { status: 'ok', database: 'reachable' });
      } catch {
        return json(res, { status: 'error', database: 'unreachable' }, 503);
      }
    }

    // â”€â”€â”€ RPC: chamada de funcao Postgres (supabase.rpc) â”€â”€â”€â”€â”€â”€â”€
    if (path.startsWith('/rest/v1/rpc/') && req.method === 'POST') {
      const auth = req.headers.authorization?.replace('Bearer ', '');
      const payload = verifyJwt(auth);
      if (!payload || !payload.sub || !(await sessionIsActive(payload))) return json(res, { error: 'unauthorized', message: 'JWT vÃ¡lido obrigatÃ³rio' }, 401);
      const profile = await getUserProfile(payload.sub, payload.company_id);
      if (!profile || !profile.lg_ativo) return json(res, { error: 'forbidden', message: 'usuÃ¡rio invÃ¡lido/inativo' }, 403);
      if (profileRequiresPasswordChange(profile)) {
        return json(res, { error: 'password_change_required', message: 'Troque a senha temporária antes de acessar os módulos.' }, 403);
      }
      const fnName = decodeURIComponent(path.replace('/rest/v1/rpc/', '').split('?')[0]);
      const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
      if (!IDENT.test(fnName)) {
        return json(res, { error: 'bad_request', message: `funÃ§Ã£o RPC invÃ¡lida: ${fnName}` }, 400);
      }
      const rpcDecision = await authorizeRpc(profile, fnName);
      if (!rpcDecision.ok) {
        return json(res, { error: 'forbidden', message: rpcDecision.reason }, 403);
      }
      const body = await parseBody(req);
      const keys = Object.keys(body);
      for (const key of keys) {
        if (!IDENT.test(key)) {
          return json(res, { error: 'bad_request', message: `parÃ¢metro RPC invÃ¡lido: ${key}` }, 400);
        }
      }
      // monta SELECT fn(p1 => $1, p2 => $2) com params nomeados
      const namedArgs = keys.map((k, i) => `"${k}" => $${i + 1}`).join(', ');
      const vals = keys.map((k) => {
        const value = body[k];
        return value !== null && typeof value === 'object' ? JSON.stringify(value) : value;
      });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const databaseClaims = payload.jti && !payload.session_id
          ? { ...payload, session_id: payload.jti }
          : payload;
        await client.query(
          `SELECT set_config('request.jwt.claim.sub', $1, true),
                  set_config('request.jwt.claim.company_id', $2, true),
                  set_config('request.jwt.claims', $3, true)`,
          [payload.sub, profile.company_id || '', JSON.stringify(databaseClaims)],
        );
        const invocation = RPC_JSON_RESULT_FUNCTIONS.has(fnName)
          ? `to_jsonb(public."${fnName}"(${namedArgs}))`
          : `public."${fnName}"(${namedArgs})`;
        const result = await client.query(`SELECT ${invocation} AS result`, vals);
        await client.query('COMMIT');
        const val = result.rows.length === 0
          ? []
          : result.rows.length > 1
            ? result.rows.map((row) => row.result)
            : result.rows[0].result;
        return json(res, val);
      } catch (e) {
        await client.query('ROLLBACK');
        const incidentId = randomUUID();
        console.error('[RPC_EXECUTION_FAILED]', {
          incidentId,
          functionName: fnName,
          userId: payload.sub,
          companyId: profile.company_id,
          code: e?.code || null,
          message: e?.message || String(e),
          detail: e?.detail || null,
          constraint: e?.constraint || null,
        });
        return json(res, {
          error: 'rpc_execution_failed',
          message: 'Nao foi possivel processar a operacao solicitada.',
          code: 'PGRST202',
          incident_id: incidentId,
        }, 400);
      } finally {
        client.release();
      }
    }

    // â”€â”€â”€ REST: PostgREST-compatible proxy â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (path.startsWith('/rest/v1/')) {
      const table = path.replace('/rest/v1/', '').split('?')[0];
      if (!isIdentifier(table)) {
        return json(res, { error: 'bad_request', message: `tabela invÃ¡lida: ${table}` }, 400);
      }
      const auth = req.headers.authorization?.replace('Bearer ', '');
      const payload = verifyJwt(auth);

      // Exige JWT vÃ¡lido (apikey sozinho NÃƒO autentica mais)
      if (!payload || !payload.sub || !(await sessionIsActive(payload))) return json(res, { error: 'unauthorized', message: 'JWT vÃ¡lido obrigatÃ³rio' }, 401);

      // Enforcement RBAC: role Ã— mÃ³dulo Ã— aÃ§Ã£o
      const profile = await getUserProfile(payload.sub, payload.company_id);
      if (!profile || !profile.lg_ativo) return json(res, { error: 'forbidden', message: 'usuÃ¡rio invÃ¡lido/inativo' }, 403);
      const isPasswordChangeBootstrap = isPasswordChangeBootstrapRead(
        req.method,
        table,
        url.searchParams,
        payload.sub,
      );
      if (profileRequiresPasswordChange(profile) && !isPasswordChangeBootstrap) {
        return json(res, { error: 'password_change_required', message: 'Troque a senha temporária antes de acessar os módulos.' }, 403);
      }
      const isSelfProfileRead =
        isPasswordChangeBootstrap && table === 'user_profiles';
      const decision = (isPasswordChangeBootstrap || isSelfProfileRead)
        ? { ok: true }
        : await authorize(profile, table, req.method);
      if (!decision.ok) return json(res, { error: 'forbidden', message: decision.reason }, 403);
      const companyId = await requiredCompanyScope(profile, table);

      if (req.method === 'GET') {
        const selectParam = url.searchParams.get('select');
        let columns;
        try {
          columns = parseRestSelectProjection(selectParam);
        } catch (error) {
          return json(res, { error: 'bad_request', message: error.message }, 400);
        }

        let query = `SELECT ${columns} FROM public."${table}"`;
        const conditions = [];
        const values = [];
        let paramIdx = 1;

        if (companyId) {
          conditions.push(`"company_id" = $${paramIdx}`);
          values.push(companyId);
          paramIdx++;
        }

        // Parse PostgREST filters (eq, neq, gt, gte, lt, lte, like, ilike, is, or, in)
        const IDENT_COL = IDENT;
        for (const [key, val] of url.searchParams) {
          if (['select', 'limit', 'offset', 'order'].includes(key)) continue;

          // SEGURANÃ‡A: nome de coluna (key) deve ser identificador simples (anti SQL-injection).
          // 'or' Ã© palavra reservada de filtro, tratada abaixo.
          if (key !== 'or' && !IDENT_COL.test(key)) {
            return json(res, { error: 'bad_request', message: `coluna de filtro invÃ¡lida: ${key}` }, 400);
          }

          // Support .or() filter: or=(col1.ilike.%val%,col2.ilike.%val%)
          if (key === 'or') {
            const orParts = val.replace(/^\(/, '').replace(/\)$/, '').split(',');
            const orConditions = [];
            for (const part of orParts) {
              const dotIdx = part.indexOf('.');
              if (dotIdx === -1) continue;
              const col = part.substring(0, dotIdx);
              const rest = part.substring(dotIdx + 1);
              if (!IDENT_COL.test(col)) continue; // ignora coluna invÃ¡lida (anti-injection)
              if (rest.startsWith('ilike.')) {
                orConditions.push(`"${col}" ILIKE $${paramIdx}`);
                values.push(rest.slice(6).replace(/\*/g, '%'));
                paramIdx++;
              } else if (rest.startsWith('eq.')) {
                orConditions.push(`"${col}" = $${paramIdx}`);
                values.push(rest.slice(3));
                paramIdx++;
              } else if (rest.startsWith('like.')) {
                orConditions.push(`"${col}" LIKE $${paramIdx}`);
                values.push(rest.slice(5).replace(/\*/g, '%'));
                paramIdx++;
              }
            }
            if (orConditions.length > 0) {
              conditions.push(`(${orConditions.join(' OR ')})`);
            }
            continue;
          }

          // Support .in() filter: id=in.(1,2,3)
          if (val.startsWith('in.(')) {
            const inValues = val.slice(4, -1).split(',');
            const placeholders = inValues.map(() => { const p = `$${paramIdx}`; paramIdx++; return p; }).join(',');
            conditions.push(`"${key}" IN (${placeholders})`);
            values.push(...inValues);
            continue;
          }

          const operators = [
            { prefix: 'eq.', op: '=' },
            { prefix: 'neq.', op: '!=' },
            { prefix: 'gt.', op: '>' },
            { prefix: 'gte.', op: '>=' },
            { prefix: 'lt.', op: '<' },
            { prefix: 'lte.', op: '<=' },
            { prefix: 'like.', op: 'LIKE' },
            { prefix: 'ilike.', op: 'ILIKE' },
            { prefix: 'is.', op: 'IS' },
          ];

          for (const {prefix, op} of operators) {
            if (val.startsWith(prefix)) {
              let v = val.slice(prefix.length);
              // PostgREST convention: `*` funciona como coringa em like/ilike (equivalente a %)
              if (op === 'LIKE' || op === 'ILIKE') {
                v = v.replace(/\*/g, '%');
              }
              if (op === 'IS') {
                // IS sÃ³ aceita null/true/false (anti-injection: nada de valor cru interpolado)
                const isVal = v === 'null' ? 'NULL' : v === 'true' ? 'TRUE' : v === 'false' ? 'FALSE' : null;
                if (isVal === null) {
                  return json(res, { error: 'bad_request', message: `valor IS invÃ¡lido: ${v}` }, 400);
                }
                conditions.push(`"${key}" IS ${isVal}`);
              } else if (v === 'true' || v === 'false') {
                conditions.push(`"${key}" ${op} ${v}`);
              } else {
                conditions.push(`"${key}" ${op} $${paramIdx}`);
                values.push(v);
                paramIdx++;
              }
              break;
            }
          }
        }

        if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');

        // Order (coluna validada â€” anti-injection)
        const orderParam = url.searchParams.get('order');
        if (orderParam) {
          const parts = [];
          for (const p of orderParam.split(',')) {
            const [col, dir] = p.split('.');
            if (!IDENT_COL.test(col)) {
              return json(res, { error: 'bad_request', message: `coluna de order invÃ¡lida: ${col}` }, 400);
            }
            parts.push(`"${col}" ${dir === 'desc' ? 'DESC' : 'ASC'}`);
          }
          if (parts.length > 0) query += ' ORDER BY ' + parts.join(', ');
        }

        // Range header support (PostgREST pagination)
        const rangeHeader = req.headers.range;
        let rangeStart = 0, rangeEnd = null;
        if (rangeHeader) {
          const match = rangeHeader.match(/(\d+)-(\d+)/);
          if (match) {
            rangeStart = parseInt(match[1]);
            rangeEnd = parseInt(match[2]);
          }
        }

        // Limit/Offset from query params OR from Range header
        const limitParam = url.searchParams.get('limit');
        const offsetParam = url.searchParams.get('offset');
        if (rangeEnd !== null && !limitParam) {
          query += ` LIMIT ${rangeEnd - rangeStart + 1} OFFSET ${rangeStart}`;
        } else {
          if (limitParam) query += ` LIMIT ${parseInt(limitParam)}`;
          if (offsetParam) query += ` OFFSET ${parseInt(offsetParam)}`;
        }

        try {
          const result = await queryWithTenantContext(companyId, query, values, payload.sub, payload);

          // Count total if Prefer: count=exact
          const prefer = req.headers.prefer || '';
          let totalCount = result.rows.length;
          if (prefer.includes('count=exact')) {
            const countQuery = `SELECT COUNT(*) FROM public."${table}"` + (conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '');
            const countResult = await queryWithTenantContext(companyId, countQuery, values, payload.sub, payload);
            totalCount = parseInt(countResult.rows[0].count);
          }

          const start = rangeEnd !== null ? rangeStart : (offsetParam ? parseInt(offsetParam) : 0);
          const end = start + result.rows.length - 1;
          res.setHeader('content-range', `${start}-${end}/${totalCount}`);

          // Support maybeSingle (Accept: application/vnd.pgrst.object+json)
          const accept = req.headers.accept || '';
          if (accept.includes('vnd.pgrst.object')) {
            return json(res, result.rows[0] || null);
          }
          return json(res, result.rows);
        } catch (e) {
          return json(res, { error: e.message, code: 'PGRST000' }, 400);
        }
      }

      if (req.method === 'POST') {
        let body = await parseBody(req);
        try {
          body = scopeInsertBody(body, companyId);
        } catch (error) {
          return json(res, { error: 'forbidden', message: error.message }, error.statusCode || 403);
        }
        const keys = Object.keys(body);
        if (keys.length === 0) return json(res, { error: 'bad_request', message: 'body vazio' }, 400);
        for (const key of keys) {
          if (!isIdentifier(key)) {
            return json(res, { error: 'bad_request', message: `coluna invÃ¡lida: ${key}` }, 400);
          }
        }
        const vals = Object.values(body);
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
        const columns = keys.map(quoteIdent).join(', ');
        const conflictParam = url.searchParams.get('on_conflict');
        const prefer = req.headers.prefer || '';
        let conflictClause = '';
        if (conflictParam) {
          const conflictColumns = conflictParam.split(',').map(value => value.trim()).filter(Boolean);
          if (conflictColumns.length === 0 || conflictColumns.some(key => !isIdentifier(key))) {
            return json(res, { error: 'bad_request', message: 'on_conflict inválido' }, 400);
          }
          const conflictSet = new Set(conflictColumns);
          const updateKeys = keys.filter(key => !conflictSet.has(key));
          const updateClause = updateKeys.length > 0
            ? `DO UPDATE SET ${updateKeys.map(key => `${quoteIdent(key)} = EXCLUDED.${quoteIdent(key)}`).join(', ')}`
            : 'DO NOTHING';
          conflictClause = ` ON CONFLICT (${conflictColumns.map(quoteIdent).join(', ')}) ${updateClause}`;
        } else if (prefer.includes('resolution=merge-duplicates')) {
          return json(res, { error: 'bad_request', message: 'on_conflict obrigatório para upsert' }, 400);
        }
        try {
          const result = await queryWithTenantContext(companyId,
            `INSERT INTO public."${table}" (${columns}) VALUES (${placeholders})${conflictClause} RETURNING *`,
            vals,
            payload.sub,
            payload,
          );
          if (prefer.includes('return=representation')) {
            return json(res, result.rows[0], 201);
          }
          return json(res, {}, 201);
        } catch (e) {
          return json(res, { error: e.message }, 400);
        }
      }

      if (req.method === 'PATCH') {
        let body = await parseBody(req);
        try {
          body = scopePatchBody(body, companyId);
        } catch (error) {
          return json(res, { error: 'forbidden', message: error.message }, error.statusCode || 403);
        }
        const keys = Object.keys(body);
        if (keys.length === 0) return json(res, { error: 'bad_request', message: 'body vazio' }, 400);
        for (const key of keys) {
          if (!isIdentifier(key)) {
            return json(res, { error: 'bad_request', message: `coluna invÃ¡lida: ${key}` }, 400);
          }
        }
        const vals = Object.values(body);
        const setClause = keys.map((k, i) => `${quoteIdent(k)} = $${i + 1}`).join(', ');
        // Get ID from query params
        const idParam = url.searchParams.get('id');
        const id = idParam?.replace('eq.', '');
        if (!id) return json(res, { error: 'id required for PATCH' }, 400);
        try {
          const result = await queryWithTenantContext(companyId,
            `UPDATE public."${table}" SET ${setClause} WHERE id = $${keys.length + 1}${companyId ? ` AND company_id = $${keys.length + 2}` : ''} RETURNING *`,
            companyId ? [...vals, id, companyId] : [...vals, id],
            payload.sub,
            payload,
          );
          return json(res, result.rows[0] || {});
        } catch (e) {
          return json(res, { error: e.message }, 400);
        }
      }
    }

    // â”€â”€â”€ Fallback: 404 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    json(res, { error: 'not found', path }, 404);

  } catch (err) {
    console.error('[ERROR]', err);
    json(res, { error: err.message }, err.statusCode || 500);
  }
});

async function startServer() {
  // Falha antes de abrir a porta HTTP quando a senha/base nao estao prontas.
  await pool.query('SELECT 1');
  server.listen(PORT, HOST, () => {
  console.log(``);
  console.log(`  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”`);
  console.log(`  â”‚  ProntoClinic Local Auth Server               â”‚`);
  console.log(`  â”‚  http://${HOST}:${PORT}                       â”‚`);
  console.log(`  â”‚  Postgres: ${pool.options.host}:${pool.options.port}/${pool.options.database}       â”‚`);
  console.log(`  â”‚  Admin: use usuario seedado no banco local     â”‚`);
  console.log(`  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜`);
  console.log(``);
  });
}

const modulePath = resolve(fileURLToPath(import.meta.url));
const directEntryPath = process.argv[1] ? resolve(process.argv[1]) : null;
const pm2EntryPath = process.env.pm_exec_path
  ? resolve(process.env.pm_exec_path)
  : null;
const isMainModule =
  directEntryPath === modulePath || pm2EntryPath === modulePath;

if (isMainModule) {
  startServer().catch((error) => {
    console.error('[STARTUP_ERROR]', error.message);
    pool.end().finally(() => process.exit(1));
  });
}
