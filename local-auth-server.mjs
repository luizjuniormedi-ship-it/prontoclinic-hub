/**
 * ProntoMedic Auth Gateway.
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
import pg from 'pg';
import QRCode from 'qrcode';
import { parseSelectProjection } from './local-auth-projection.mjs';
import {
  createLocalAuthAdmin,
  ensureLocalAuthAdminSchema,
  mailProviderFromEnv,
} from './local-auth-admin.mjs';
const { Pool } = pg;

const LOCAL_AUTH_MODE = process.env.LOCAL_AUTH_MODE;
if (!['development', 'test', 'production'].includes(LOCAL_AUTH_MODE)) {
  throw new Error('LOCAL_AUTH_MODE deve ser development, test ou production');
}
if (LOCAL_AUTH_MODE === 'production') {
  const productionOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (
    productionOrigins.length === 0
    || productionOrigins.some((origin) => origin === '*' || /localhost|127\.0\.0\.1/i.test(origin))
  ) {
    throw new Error('CORS_ALLOWED_ORIGINS de producao deve conter somente origens publicas explicitas');
  }
  if (!process.env.PGPASSWORD) {
    throw new Error('PGPASSWORD obrigatorio em producao');
  }
}

const PORT = Number(process.env.LOCAL_AUTH_PORT || 8000);
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET obrigatorio e deve ter pelo menos 32 caracteres');
}
const SERVICE_API_KEY = process.env.LOCAL_AUTH_SERVICE_KEY;
const AUTH_PUBLIC_URL = process.env.LOCAL_AUTH_PUBLIC_URL;
const AUTH_REDIRECT_ORIGINS = new Set(
  (process.env.LOCAL_AUTH_REDIRECT_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);
if (LOCAL_AUTH_MODE === 'production' && (!AUTH_PUBLIC_URL || AUTH_REDIRECT_ORIGINS.size === 0)) {
  throw new Error('LOCAL_AUTH_PUBLIC_URL e LOCAL_AUTH_REDIRECT_ORIGINS sao obrigatorios em producao');
}

// Fix: pg retorna Date objects pra colunas 'date' â€” forÃ§ar string YYYY-MM-DD
const types = pg.types;
types.setTypeParser(1082, (val) => val); // date -> string as-is
types.setTypeParser(1114, (val) => val); // timestamp without tz -> string
types.setTypeParser(1184, (val) => val); // timestamptz -> string

const PGHOST = process.env.PGHOST || '127.0.0.1';
const PGPORT = Number(process.env.PGPORT || 5432);
const PGUSER = process.env.PGUSER || 'app_prontomedic';
const PGDATABASE = process.env.PGDATABASE || 'prontoclinic';
function positiveIntegerEnv(name, fallback, maximum) {
  const raw = process.env[name];
  const value = raw == null || raw === '' ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} deve ser inteiro entre 1 e ${maximum}`);
  }
  return value;
}

const POOL_TIMEOUT_MS = positiveIntegerEnv('LOCAL_AUTH_POOL_TIMEOUT_MS', 5000, 60000);
const pool = new Pool({
  host: PGHOST,
  port: PGPORT,
  user: PGUSER,
  password: process.env.PGPASSWORD,
  database: PGDATABASE,
  max: positiveIntegerEnv('LOCAL_AUTH_POOL_MAX', 10, 100),
  connectionTimeoutMillis: POOL_TIMEOUT_MS,
});

const SERVICE_PGUSER = process.env.LOCAL_AUTH_SERVICE_PGUSER;
const SERVICE_PGPASSWORD = process.env.LOCAL_AUTH_SERVICE_PGPASSWORD;
if (Boolean(SERVICE_PGUSER) !== Boolean(SERVICE_PGPASSWORD)) {
  throw new Error('LOCAL_AUTH_SERVICE_PGUSER e LOCAL_AUTH_SERVICE_PGPASSWORD devem ser definidos juntos');
}
if (SERVICE_PGUSER && (!SERVICE_API_KEY || SERVICE_API_KEY.length < 32)) {
  throw new Error('pool service_role exige LOCAL_AUTH_SERVICE_KEY com 32+ caracteres');
}
if (SERVICE_API_KEY === JWT_SECRET) {
  throw new Error('LOCAL_AUTH_SERVICE_KEY deve ser diferente de JWT_SECRET');
}
if (SERVICE_PGUSER && SERVICE_PGUSER === PGUSER) {
  throw new Error('LOCAL_AUTH_SERVICE_PGUSER deve ser exclusivo e diferente de PGUSER');
}
if (SERVICE_PGUSER === 'app_prontomedic') {
  throw new Error('app_prontomedic nao pode ser o login do pool service_role');
}
if (LOCAL_AUTH_MODE === 'production' && !SERVICE_PGUSER) {
  throw new Error('pool PostgreSQL service_role exclusivo e obrigatorio em producao');
}
const servicePool = SERVICE_PGUSER && SERVICE_PGPASSWORD
  ? new Pool({
      host: PGHOST,
      port: PGPORT,
      user: SERVICE_PGUSER,
      password: SERVICE_PGPASSWORD,
      database: PGDATABASE,
      max: positiveIntegerEnv('LOCAL_AUTH_SERVICE_POOL_MAX', 3, 20),
      connectionTimeoutMillis: POOL_TIMEOUT_MS,
    })
  : null;
let localAuthAdmin = null;

function allowedAuthRedirect(value) {
  try {
    const target = new URL(value);
    return target.protocol === 'https:' && AUTH_REDIRECT_ORIGINS.has(target.origin)
      ? target.toString()
      : null;
  } catch {
    return null;
  }
}

function poolForPayload(payload) {
  if (payload.role !== 'service_role') return pool;
  if (!servicePool) {
    const error = new Error('service role database pool is not configured');
    error.statusCode = 503;
    throw error;
  }
  return servicePool;
}

async function validateServicePoolContract() {
  if (!servicePool) return;
  const client = await servicePool.connect();
  try {
    const result = await client.query(
      `SELECT session_user,
              current_user,
              login.rolsuper,
              login.rolinherit,
              login.rolcreaterole,
              login.rolcreatedb,
              login.rolreplication,
              login.rolbypassrls,
              pg_has_role(session_user, 'service_role', 'MEMBER') AS service_member,
              CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_prontomedic')
                   THEN pg_has_role('app_prontomedic', 'service_role', 'MEMBER')
                   ELSE false
               END AS app_is_service_member
         FROM pg_roles login
        WHERE login.rolname = session_user`,
    );
    const contract = result.rows[0];
    const invalid = !contract
      || contract.session_user !== SERVICE_PGUSER
      || contract.current_user !== SERVICE_PGUSER
      || contract.rolsuper
      || contract.rolinherit
      || contract.rolcreaterole
      || contract.rolcreatedb
      || contract.rolreplication
      || contract.rolbypassrls
      || !contract.service_member
      || contract.app_is_service_member;
    if (invalid) {
      throw new Error('login service_role viola o contrato de menor privilegio');
    }
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE service_role');
    const roleResult = await client.query('SELECT current_user');
    await client.query('ROLLBACK');
    if (roleResult.rows[0]?.current_user !== 'service_role') {
      throw new Error('login exclusivo nao consegue assumir service_role');
    }
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* connection may already be aborted */ }
    throw new Error(`pool service_role recusado: ${error.message}`);
  } finally {
    client.release();
  }
}

async function queryWithJwtInTransaction(client, payload, text, values = []) {
  const databaseRole = payload.role === 'service_role' ? 'service_role' : 'authenticated';
  await client.query(
    `SELECT set_config('request.jwt.claim.sub', $1, true),
            set_config('request.jwt.claim.role', $2, true),
            set_config('request.jwt.claims', $3, true)`,
    [payload.sub || '', databaseRole, JSON.stringify(payload)],
  );
  if (databaseRole === 'service_role') await client.query('SET LOCAL ROLE service_role');
  else await client.query('SET LOCAL ROLE authenticated');
  const result = await client.query(text, values);
  await client.query('RESET ROLE');
  return result;
}

async function queryAsAuthenticated(payload, text, values = []) {
  const client = await poolForPayload(payload).connect();
  try {
    await client.query('BEGIN');
    const result = await queryWithJwtInTransaction(client, payload, text, values);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

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

function verifySignedJwt(token, secret = JWT_SECRET) {
  try {
    if (typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    if (!header || !body || !sig) return null;
    const parsedHeader = JSON.parse(Buffer.from(header, 'base64url').toString());
    if (parsedHeader.alg !== 'HS256' || parsedHeader.typ !== 'JWT') return null;
    const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
    const actualBuffer = Buffer.from(sig || '', 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp != null && (!Number.isFinite(payload.exp) || Date.now() / 1000 >= payload.exp)) return null;
    if (payload.iat != null && (!Number.isFinite(payload.iat) || payload.iat > Date.now() / 1000 + 60)) return null;
    return payload;
  } catch { return null; }
}

async function queryAsAuthenticatedInTransaction(client, payload, text, values = []) {
  return queryWithJwtInTransaction(client, payload, text, values);
}

function verifyUserJwt(token) {
  const payload = verifySignedJwt(token);
  if (!payload || payload.role !== 'authenticated' || payload.aud !== 'authenticated') return null;
  if (payload.auth_flow != null) return null;
  if (typeof payload.sub !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.sub)) return null;
  if (!Number.isFinite(payload.exp) || !Number.isFinite(payload.iat)) return null;
  return payload;
}

function verifyPasswordFlowJwt(token) {
  const payload = verifySignedJwt(token);
  if (!payload || payload.role !== 'authenticated' || payload.aud !== 'authenticated') return null;
  if (!['invite', 'recovery'].includes(payload.auth_flow)) return null;
  if (typeof payload.sub !== 'string' || typeof payload.session_id !== 'string') return null;
  if (!Number.isFinite(payload.exp) || !Number.isFinite(payload.iat)) return null;
  return payload;
}

function constantTimeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyServiceRoleKey(req) {
  if (!SERVICE_API_KEY) return null;
  const bearer = bearerToken(req);
  const apiKey = req.headers.apikey;
  if (!constantTimeEqual(bearer, SERVICE_API_KEY) || !constantTimeEqual(apiKey, SERVICE_API_KEY)) return null;
  return { sub: 'auth-admin', role: 'service_role', aud: 'local-auth-admin' };
}

function bearerToken(req) {
  const header = req.headers.authorization;
  const match = typeof header === 'string' ? header.match(/^Bearer\s+(.+)$/i) : null;
  return match?.[1] || null;
}

function authUserResponse(user) {
  return {
    id: user.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: user.email,
    email_confirmed_at: user.email_confirmed_at || null,
    invited_at: user.invited_at || null,
    banned_until: user.banned_until || null,
    app_metadata: user.raw_app_meta_data || {},
    user_metadata: user.raw_user_meta_data || {},
    created_at: user.created_at,
    updated_at: user.updated_at,
  };
}

const SERVICE_ROUTE_ALLOWLIST = Object.freeze([
  ['POST', /^\/auth\/v1\/invite$/],
  ['PUT', /^\/auth\/v1\/admin\/users\/[0-9a-f-]{36}$/i],
  ['DELETE', /^\/auth\/v1\/admin\/users\/[0-9a-f-]{36}$/i],
  ['POST', /^\/auth\/v1\/admin\/users\/[0-9a-f-]{36}\/logout$/i],
]);

function requireServiceRole(req) {
  const path = new URL(req.url, `http://localhost:${PORT}`).pathname;
  if (!SERVICE_ROUTE_ALLOWLIST.some(([method, pattern]) => req.method === method && pattern.test(path))) return null;
  return verifyServiceRoleKey(req);
}

const SERVICE_RPC_ALLOWLIST = new Set([
  'admin_record_auth_operation',
  'finalize_user_access_active',
  'prepare_user_access_active',
  'provision_user_access',
  'restore_user_access_active',
]);
const SERVICE_READ_TABLE_ALLOWLIST = new Set(['memberships', 'user_profiles']);

function validateServiceReadContract(table, url) {
  const keys = [...url.searchParams.keys()];
  if (keys.some((key) => !['select', 'id', 'email', 'user_id', 'company_id', 'limit'].includes(key))) return false;
  const select = url.searchParams.get('select');
  if (table === 'user_profiles') {
    const byId = /^eq\.[0-9a-f-]{36}$/i.test(url.searchParams.get('id') || '');
    const byEmail = /^eq\.[^@\s]+@[^@\s]+$/i.test(url.searchParams.get('email') || '');
    return (select === 'id' || select === 'id,email')
      && (byId !== byEmail)
      && !url.searchParams.has('user_id')
      && !url.searchParams.has('company_id');
  }
  if (table === 'memberships') {
    return select === 'id'
      && /^eq\.[0-9a-f-]{36}$/i.test(url.searchParams.get('user_id') || '')
      && /^eq\.[0-9a-f-]{36}$/i.test(url.searchParams.get('company_id') || '')
      && !url.searchParams.has('id')
      && !url.searchParams.has('email');
  }
  return false;
}

// Bcrypt verify via Postgres (uses pgcrypto)
async function verifyPassword(email, password) {
  const res = await pool.query(
    `SELECT id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data
     FROM auth.users
    WHERE email = $1
      AND (banned_until IS NULL OR banned_until <= now())`,
    [email.toLowerCase().trim()]
  );
  if (res.rows.length === 0) return null;
  const user = res.rows[0];
  const check = await pool.query(
    `SELECT ($1 = crypt($2, $1)) as valid`,
    [user.encrypted_password, password]
  );
  if (!check.rows[0]?.valid) return null;
  return user;
}

async function isUserSessionActive(payload, client = pool) {
  if (typeof payload.session_id !== 'string') return false;
  const result = await client.query(
    `SELECT EXISTS (
       SELECT 1
         FROM auth.users u
        WHERE u.id = $1
          AND (u.banned_until IS NULL OR u.banned_until <= now())
          AND EXISTS (
            SELECT 1
              FROM auth.refresh_tokens rt
             WHERE rt.user_id = u.id
               AND rt.session_jti = $2
               AND rt.revoked = false
          )
     ) AS active`,
    [payload.sub, payload.session_id],
  );
  return Boolean(result.rows[0]?.active);
}

async function getUserProfile(payload) {
  const res = await queryAsAuthenticated(
    payload,
    `SELECT id, full_name, email, role_name, company_id, primary_unit_id, lg_ativo
     FROM public.user_profiles WHERE id = $1`,
    [payload.sub],
  );
  return res.rows[0] || null;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// AUTORIZAÃ‡ÃƒO SERVER-SIDE (RBAC por role Ã— mÃ³dulo Ã— aÃ§Ã£o)
// Mapeia tabela fÃ­sica â†’ mÃ³dulo lÃ³gico da matriz role_permissions.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const REFERENCE_TABLES = new Set([
  'bairros', 'cbos', 'cids', 'cid', 'municipios', 'profissoes',
  'countries', 'states', 'racas', 'etnias', 'nacionalidades',
]);

const SHARED_CATALOG_ACCESS = Object.freeze({
  companies: { readModules: [], writeModule: 'admin' },
  units: { readModules: [], writeModule: 'admin' },
  roles: { readModules: [], writeModule: 'admin' },
  insurance_companies: { readModules: ['recepcao', 'faturamento'], writeModule: 'faturamento' },
  insurance_plans: { readModules: ['recepcao', 'faturamento'], writeModule: 'faturamento' },
  payment_sources: { readModules: ['recepcao', 'faturamento'], writeModule: 'faturamento' },
  lgpd_termos: { readModules: ['recepcao', 'auditoria'], writeModule: 'auditoria' },
});

function tableToModule(table) {
  const t = table.toLowerCase();
  // match por prefixo/nome exato
  const map = [
    // prontuÃ¡rio/clÃ­nico ANTES de pacientes (patient_allergies, patient_problem_list, patient_medications sÃ£o atos clÃ­nicos)
    // NOTA: 'cid' (catÃ¡logo CID-10) Ã© tabela de REFERÃŠNCIA universal â€” NÃƒO entra aqui,
    // cai no default (leitura livre p/ qualquer perfil autenticado, escrita sÃ³ admin).
    [/^exam_requests?$|^exam_request_/, 'solicitacoes_exames'],
    [/^encounters?$|^encounter_|^medical_records|^clinical_|^prescricoes|^prontuar|^diagnos|^patient_allergies|^patient_problem|^patient_medication|^alergias/, 'prontuario'],
    [/^patients$|^paciente|^patient_phones|^telxpac/, 'pacientes'],
    [/^scheduling_contact_logs|^scheduling_call_center_tasks|^scheduling_confirmation_/, 'recepcao'],
    [/^appointments$|^agenda|^scheduling_|^professional_schedules|^escala|^professionals$|^specialties$|^appointment_types$|^services_catalog$/, 'agenda'],
    // EvoluÃ§Ã£o/procedimentos/incidentes de enfermagem = conteÃºdo clÃ­nico sensÃ­vel â†’ mÃ³dulo prontuario (recepÃ§Ã£o bloqueada por LGPD)
    [/^nursing_notes|^nursing_procedures|^nursing_incidents|^nursing_medication|^nursing_evolution/, 'prontuario'],
    [/^care_protocol_/, 'protocolos_assistenciais'],
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
    [/^bi_|^nps_|^dashboard/, 'bi'],
    [/^telemedicina/, 'telemedicina'],
    [/^internacao|^leito/, 'internacao'],
    [/^cirurgia|^centro_cir/, 'cirurgia'],
    [/^ia_|^ai_/, 'ia'],
    [/^audit|^sigh_log|^lgpd|^log_/, 'auditoria'],
    [/^roles?$|^role_|^menu_actions|^user_|^usuarios|^companies|^units|^permission/, 'admin'],
    [/^whatsapp|^notification|^pre_cadastro/, 'recepcao'],
  ];
  for (const [re, mod] of map) if (re.test(t)) return mod;
  return REFERENCE_TABLES.has(t) ? null : '__unmapped__';
}

const METHOD_TO_ACTION = { GET: 'view', HEAD: 'view', POST: 'create', PATCH: 'edit', PUT: 'edit', DELETE: 'delete' };
const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const isIdentifier = (value) => IDENT.test(value);
const quoteIdent = (value) => `"${value}"`;

async function getActiveAccessContext(payload) {
  const result = await queryAsAuthenticated(
    payload,
    `SELECT m.company_id, ctx.unit_id, r.name AS role_name
       FROM public.user_access_context ctx
       JOIN public.memberships m
         ON m.id = ctx.membership_id
        AND m.user_id = ctx.user_id
        AND m.status = 'active'
       JOIN public.membership_roles mr
         ON mr.membership_id = ctx.membership_id
        AND mr.role_id = ctx.role_id
       JOIN public.roles r
         ON r.id = ctx.role_id
        AND r.lg_ativo = true
      WHERE ctx.user_id = $1
        AND ctx.session_id = $2::uuid
        AND m.company_id = public.active_company_id()
        AND ctx.unit_id IS NOT DISTINCT FROM public.active_unit_id()
      LIMIT 1`,
    [payload.sub, payload.session_id],
  );
  return result.rows[0] || null;
}

async function canAccess(payload, module, action) {
  const result = await queryAsAuthenticated(
    payload,
    `SELECT public.active_company_id() AS company_id,
            public.can_access($1, $2) AS allowed`,
    [module, action],
  );
  return Boolean(result.rows[0]?.company_id && result.rows[0]?.allowed);
}

function permissionAction(action) {
  return {
    can_view: 'view',
    can_create: 'create',
    can_edit: 'edit',
    can_delete: 'delete',
    can_export: 'export',
  }[action] || action;
}

/** Retorna {ok:true} ou {ok:false, reason} usando o contexto ativo da sessão. */
async function authorize(profile, table, method, payload) {
  if (!profile) return { ok: false, reason: 'sem perfil' };
  if (!profile.lg_ativo) return { ok: false, reason: 'usuÃ¡rio inativo' };
  const context = await getActiveAccessContext(payload);
  if (!context) return { ok: false, reason: 'contexto de acesso inativo' };
  const action = METHOD_TO_ACTION[method] || 'view';
  const sharedCatalog = SHARED_CATALOG_ACCESS[table.toLowerCase()];
  if (sharedCatalog) {
    if (action === 'view') {
      if (sharedCatalog.readModules.length === 0) return { ok: true };
      for (const readModule of sharedCatalog.readModules) {
        if (await canAccess(payload, readModule, 'view')) return { ok: true };
      }
      return { ok: false, reason: `contexto ativo nao pode consultar o catalogo '${table}'` };
    }
    if (!(await canAccess(payload, sharedCatalog.writeModule, action))) {
      return {
        ok: false,
        reason: `contexto ativo nao pode '${action}' no catalogo '${table}'`,
      };
    }
    return { ok: true };
  }
  const module = tableToModule(table);
  if (module === '__unmapped__') {
    return { ok: false, reason: `tabela '${table}' nao esta explicitamente autorizada` };
  }
  if (module === null) {
    return METHOD_TO_ACTION[method] === 'view'
      ? { ok: true }
      : { ok: false, reason: 'escrita em tabela de referencia nao autorizada pelo gateway' };
  }
  if (!(await canAccess(payload, module, action))) {
    return { ok: false, reason: `contexto ativo nao pode '${action}' em '${module}'` };
  }
  return { ok: true };
}

const RPC_PERMISSIONS = {
  list_authorized_access_contexts: { scope: 'self' },
  activate_application_context: { scope: 'self' },
  heartbeat_application_session: { scope: 'self' },
  is_application_session_allowed: { scope: 'self' },
  revoke_application_session: { scope: 'self' },
  revoke_all_application_sessions: { module: 'admin', action: 'can_edit' },
  list_company_users_admin: { module: 'admin', action: 'can_view' },
  current_context_is_company_admin: { module: 'admin', action: 'can_view' },
  update_active_company_admin: { module: 'admin', action: 'can_edit' },
  upsert_active_company_unit_admin: { module: 'admin', action: 'can_edit' },
  create_appointment_secure: { module: 'agenda', action: 'can_create' },
  update_appointment_status_secure: { module: 'agenda', action: 'can_edit' },
  reschedule_appointment_secure: { module: 'agenda', action: 'can_edit' },
  create_waitlist_entry_secure: { module: 'agenda', action: 'can_create' },
  close_waitlist_entry_secure: { module: 'agenda', action: 'can_edit' },
  convert_waitlist_to_appointment_secure: { module: 'agenda', action: 'can_edit' },
  create_schedule_block_secure: { module: 'agenda', action: 'can_edit' },
  cancel_schedule_block_secure: { module: 'agenda', action: 'can_edit' },
  get_professional_available_slots: { module: 'agenda', action: 'can_view' },
  get_scheduling_requirements: { module: 'agenda', action: 'can_view' },
  create_appointment_with_requirements_secure: { module: 'agenda', action: 'can_create' },
  refresh_confirmation_queue_secure: { module: 'agenda', action: 'can_edit' },
  record_confirmation_attempt_secure: { module: 'agenda', action: 'can_edit' },
  mark_overdue_appointments_no_show_secure: { module: 'agenda', action: 'can_edit' },
  record_call_center_contact_secure: { module: 'recepcao', action: 'can_create' },
  complete_call_center_task_secure: { module: 'recepcao', action: 'can_edit' },
  search_patients_secure: { module: 'pacientes', action: 'can_view' },
  get_reception_checkin_readiness: { module: 'recepcao', action: 'can_view' },
  get_reception_precheckin_context: { module: 'recepcao', action: 'can_view' },
  get_reception_patient_appointments_secure: { module: 'recepcao', action: 'can_view' },
  get_reception_exception_capability: { module: 'recepcao', action: 'can_view' },
  find_price: { module: 'recepcao', action: 'can_view' },
  perform_reception_checkin_secure: { module: 'recepcao', action: 'can_create' },
  transition_reception_queue_ticket_secure: { module: 'recepcao', action: 'can_edit' },
  create_insurance_authorization_secure: { module: 'recepcao', action: 'can_create' },
  transition_insurance_authorization_secure: { module: 'recepcao', action: 'can_edit' },
  create_insurance_authorization_followup_secure: { module: 'recepcao', action: 'can_create' },
  add_insurance_authorization_attachment_secure: { module: 'recepcao', action: 'can_create' },
  consume_insurance_authorization: { module: 'recepcao', action: 'can_edit' },
  create_insurance_eligibility_check_secure: { module: 'recepcao', action: 'can_create' },
  update_insurance_eligibility_check_secure: { module: 'recepcao', action: 'can_edit' },
  record_reception_term_acceptance_secure: { module: 'recepcao', action: 'can_create' },
  create_reception_document_pickup_secure: { module: 'recepcao', action: 'can_create' },
  release_reception_document_pickup_secure: { module: 'recepcao', action: 'can_edit' },
  resolve_reception_document_issue_secure: { module: 'recepcao', action: 'can_edit' },
  create_reception_walkin_secure: { module: 'recepcao', action: 'can_create' },
  start_reception_checkin_workflow_secure: { module: 'recepcao', action: 'can_create' },
  advance_reception_checkin_workflow_secure: { module: 'recepcao', action: 'can_edit' },
  ensure_billing_preaccount_for_checkin_secure: { module: 'recepcao', action: 'can_create' },
  ensure_tiss_guide_for_checkin_secure: { module: 'recepcao', action: 'can_create' },
  ensure_financial_receivable_for_checkin_secure: { module: 'recepcao', action: 'can_create' },
  finalize_attendance_secure: { module: 'prontuario', action: 'can_create' },
  finalize_attendance_with_billing_secure: { module: 'prontuario', action: 'can_create' },
  tiss_get_stats: { module: 'faturamento', action: 'can_view' },
  m16_list_xml_secure: { module: 'faturamento', action: 'can_view' },
  m16_get_xml_document_secure: { module: 'faturamento', action: 'can_view' },
  m16_list_denials_secure: { module: 'faturamento', action: 'can_view' },
  m16_list_protocols_secure: { module: 'faturamento', action: 'can_view' },
  m16_list_guides_secure: { module: 'faturamento', action: 'can_view' },
  m16_generate_monthly_batch_secure: { module: 'faturamento', action: 'can_edit' },
  m16_persist_xml_secure: { module: 'faturamento', action: 'can_edit' },
  m16_process_return_secure: { module: 'faturamento', action: 'can_edit' },
  m16_record_manual_denial_secure: { module: 'faturamento', action: 'can_edit' },
  m16_save_protocol_secure: { module: 'faturamento', action: 'can_edit' },
  m39_list_billing_accounts_secure: { module: 'faturamento', action: 'can_view' },
  m39_review_billing_account_secure: { module: 'faturamento', action: 'can_edit' },
  m39_reopen_billing_account_secure: { module: 'faturamento', action: 'can_edit' },
  m39_list_billing_competences_secure: { module: 'faturamento', action: 'can_view' },
  m39_close_billing_competence_secure: { module: 'faturamento', action: 'can_edit' },
  m39_reopen_billing_competence_secure: { module: 'faturamento', action: 'can_edit' },
  m37_list_billing_audit_queue_secure: { module: 'faturamento', action: 'can_view' },
  m37_claim_billing_audit_secure: { module: 'faturamento', action: 'can_edit' },
  m37_decide_billing_audit_secure: { module: 'faturamento', action: 'can_edit' },
  patient_portal_list_appointments_secure: { scope: 'self' },
  patient_portal_confirm_appointment_secure: { scope: 'self' },
  patient_portal_cancel_appointment_secure: { scope: 'self' },
  patient_portal_reschedule_appointment_secure: { scope: 'self' },
  current_company_id: { scope: 'self' },
  save_secure_clinical_draft: { scope: 'self' },
  get_secure_clinical_draft: { scope: 'self' },
  list_secure_clinical_drafts: { scope: 'self' },
  delete_secure_clinical_draft: { scope: 'self' },
  list_application_devices: { scope: 'self' },
  revoke_application_device: { scope: 'self' },
  log_data_access: { scope: 'self' },
  request_anonymize_patient: { module: 'auditoria', action: 'can_edit' },
  criar_sala_telemedicina: { module: 'telemedicina', action: 'can_create' },
  detectar_alertas_bi: { module: 'bi', action: 'can_edit' },
  gerar_senha_triagem: { module: 'enfermagem', action: 'can_create' },
  upsert_role_permission: { module: 'admin', action: 'can_edit' },
  m23_upsert_exam_catalog_secure: { module: 'laboratorio', action: 'can_edit' },
  m23_upsert_reference_range_secure: { module: 'laboratorio', action: 'can_edit' },
  m23_create_lab_order_secure: { module: 'laboratorio', action: 'can_create' },
  m23_collect_specimen_secure: { module: 'laboratorio', action: 'can_create' },
  m23_transition_specimen_secure: { module: 'laboratorio', action: 'can_edit' },
  m23_record_results_secure: { module: 'laboratorio', action: 'can_create' },
  m23_record_results_idempotent_secure: { module: 'laboratorio', action: 'can_create' },
  m23_validate_result_secure: { module: 'laboratorio', action: 'can_edit' },
  m23_acknowledge_critical_alert_secure: { module: 'laboratorio', action: 'can_edit' },
  m23_deliver_order_secure: { module: 'laboratorio', action: 'can_edit' },
};

async function authorizeRpc(profile, functionName, payload) {
  const required = RPC_PERMISSIONS[functionName];
  if (!required) return { ok: false, reason: `RPC '${functionName}' nao autorizada` };
  if (!profile || !profile.lg_ativo) return { ok: false, reason: 'usuario invalido/inativo' };
  if (required.scope === 'self') return { ok: true };

  if (!await getActiveAccessContext(payload)) {
    return { ok: false, reason: 'contexto de acesso inativo' };
  }
  const action = permissionAction(required.action);
  if (!(await canAccess(payload, required.module, action))) {
    return { ok: false, reason: `contexto ativo nao pode '${action}' em '${required.module}'` };
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
  res.setHeader(
    'Access-Control-Allow-Headers',
    'authorization, apikey, content-type, prefer, range, accept-profile, content-profile, x-application-name, x-client-info, x-supabase-api-version',
  );
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
const recoveryAttempts = new Map();
const LOGIN_MAX_ATTEMPTS = Number(process.env.LOGIN_MAX_ATTEMPTS || 5);
const LOGIN_WINDOW_MS = Number(process.env.LOGIN_WINDOW_MS || 15 * 60 * 1000);
const LOGIN_BLOCK_MS = Number(process.env.LOGIN_BLOCK_MS || 15 * 60 * 1000);
const LOGIN_RATE_LIMIT_ENABLED = process.env.LOCAL_AUTH_MODE !== 'test';
const RECOVERY_MAX_ATTEMPTS = Number(process.env.RECOVERY_MAX_ATTEMPTS || 3);
const RECOVERY_WINDOW_MS = Number(process.env.RECOVERY_WINDOW_MS || 15 * 60 * 1000);

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function decodeBase32(value) {
  const normalized = String(value || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) throw new Error('segredo TOTP invalido');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  }
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
  for (let i = 0; i < bits.length; i += 5) {
    result += BASE32_ALPHABET[Number.parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  }
  return result;
}

function requireMfaEncryptionKey() {
  const key = process.env.AUTH_MFA_ENCRYPTION_KEY;
  if (!key || key.length < 16) {
    const error = new Error('AUTH_MFA_ENCRYPTION_KEY nao configurada');
    error.statusCode = 503;
    throw error;
  }
  return key;
}

async function loadMfaFactors(payload) {
  const result = await queryAsAuthenticated(
    payload,
    `SELECT id, friendly_name, factor_type, status, created_at, updated_at
       FROM public.auth_mfa_factors
      WHERE user_id = $1
      ORDER BY created_at`,
    [payload.sub],
  );
  return result.rows;
}

async function decryptMfaSecret(payload, ciphertext) {
  const key = requireMfaEncryptionKey();
  const result = await queryAsAuthenticated(
    payload,
    'SELECT pgp_sym_decrypt($1::bytea, $2) AS secret',
    [ciphertext, key],
  );
  return result.rows[0]?.secret;
}

async function issueMfaVerifiedSession(user, factors) {
  const now = Math.floor(Date.now() / 1000);
  const sessionId = randomUUID();
  const refreshToken = randomUUID();
  const payload = {
    sub: user.id,
    email: user.email,
    role: 'authenticated',
    aud: 'authenticated',
    aal: 'aal2',
    session_id: sessionId,
    iat: now,
    exp: now + 3600,
    app_metadata: user.raw_app_meta_data,
    user_metadata: user.raw_user_meta_data,
  };
  const accessToken = signJwt(payload);
  await pool.query(
    'INSERT INTO auth.refresh_tokens (token, user_id, session_jti) VALUES ($1, $2, $3)',
    [refreshToken, user.id, sessionId],
  );
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
      factors,
      created_at: user.created_at,
    },
  };
}

function loginAttemptKey(req, email) {
  const forwarded = process.env.TRUST_PROXY === 'true' ? req.headers['x-forwarded-for'] : null;
  const ip = String(forwarded || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  return `${ip}:${String(email || '').trim().toLowerCase()}`;
}

function loginBlocked(key, now = Date.now()) {
  if (!LOGIN_RATE_LIMIT_ENABLED) return false;
  const attempt = loginAttempts.get(key);
  if (!attempt) return false;
  if (attempt.blockedUntil > now) return true;
  if (now - attempt.firstAttempt > LOGIN_WINDOW_MS) loginAttempts.delete(key);
  return false;
}

function recordLoginFailure(key, now = Date.now()) {
  if (!LOGIN_RATE_LIMIT_ENABLED) return;
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

  if (req.method === 'GET' && path === '/health') {
    try {
      await pool.query('SELECT 1');
      return json(res, { status: 'ok', database: 'reachable' });
    } catch {
      return json(res, { status: 'error', database: 'unreachable' }, 503);
    }
  }

  // Support HEAD with count (supabase-js uses HEAD for count)
  if (req.method === 'HEAD' && path.startsWith('/rest/v1/')) {
    const table = path.replace('/rest/v1/', '').split('?')[0];
    // SEGURANÃ‡A: HEAD count exige JWT vÃ¡lido + autorizaÃ§Ã£o (antes vazava contagem sem auth)
    const hAuth = req.headers.authorization?.replace('Bearer ', '');
    const hPayload = verifyUserJwt(hAuth);
    if (!hPayload) { res.writeHead(401); res.end(); return; }
    if (!await isUserSessionActive(hPayload)) { res.writeHead(401); res.end(); return; }
    // valida nome de tabela (anti-injection) e permissÃ£o
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) { res.writeHead(400); res.end(); return; }
    const hProfile = await getUserProfile(hPayload);
    const hDecision = await authorize(hProfile, table, 'GET', hPayload);
    if (!hDecision.ok) { res.writeHead(403); res.end(); return; }
    try {
      const countResult = await queryAsAuthenticated(
        hPayload,
        `SELECT count(*) FROM public."${table}"`,
      );
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
          RETURNING user_id, session_jti`,
          [tokenValue],
        );
        if (rt.rows.length === 0) {
          await client.query('ROLLBACK');
          return json(res, { error: 'invalid refresh token', error_description: 'Token expired or revoked' }, 401);
        }
        const pendingPasswordFlow = await client.query(
          `SELECT EXISTS (
             SELECT 1
               FROM private.local_auth_challenges
              WHERE user_id = $1
                AND session_id = $2
                AND consumed_at IS NOT NULL
                AND password_updated_at IS NULL
                AND expires_at > NOW()
           ) AS pending`,
          [rt.rows[0].user_id, rt.rows[0].session_jti],
        );
        if (pendingPasswordFlow.rows[0]?.pending) {
          await client.query('ROLLBACK');
          return json(res, { error: 'password_update_required' }, 401);
        }
        const userRes = await client.query(
          `SELECT *
             FROM auth.users
            WHERE id = $1
              AND (banned_until IS NULL OR banned_until <= now())`,
          [rt.rows[0].user_id],
        );
        if (userRes.rows.length === 0) {
          await client.query('ROLLBACK');
          return json(res, { error: 'invalid refresh token', error_description: 'User inactive or missing' }, 401);
        }
        const u = userRes.rows[0];
        const now = Math.floor(Date.now() / 1000);
        const sessionId = rt.rows[0].session_jti || randomUUID();
        const nextPayload = { sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', aal: 'aal1', session_id: sessionId, iat: now, exp: now + 3600, app_metadata: u.raw_app_meta_data, user_metadata: u.raw_user_meta_data };
        const profileResult = await queryAsAuthenticatedInTransaction(
          client,
          nextPayload,
          `SELECT id, full_name, email, role_name, company_id, primary_unit_id, lg_ativo
             FROM public.user_profiles
            WHERE id = $1`,
          [u.id],
        );
        const profile = profileResult.rows[0] || null;
        if (!profile?.lg_ativo) {
          await client.query('ROLLBACK');
          return json(res, { error: 'invalid refresh token', error_description: 'User inactive or missing' }, 401);
        }
        const accessToken = signJwt(nextPayload);
        const newRefreshToken = randomUUID();
        await client.query(
          'INSERT INTO auth.refresh_tokens (token, user_id, parent, session_jti) VALUES ($1, $2, $3, $4)',
          [newRefreshToken, u.id, tokenValue, sessionId],
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
      if (loginBlocked(attemptKey)) {
        return json(res, { error: 'rate_limit', error_description: 'Too many login attempts' }, 429);
      }
      const user = await verifyPassword(body.email, body.password);
      if (!user) {
        recordLoginFailure(attemptKey);
        return json(res, { error: 'invalid_grant', error_description: 'Invalid login credentials' }, 400);
      }
      loginAttempts.delete(attemptKey);
      const now = Math.floor(Date.now() / 1000);
      const sessionId = randomUUID();
      const refreshToken = randomUUID();
      const loginPayload = {
        sub: user.id,
        email: user.email,
        role: 'authenticated',
        aud: 'authenticated',
        aal: 'aal1',
        session_id: sessionId,
        iat: now,
        exp: now + 3600,
        app_metadata: user.raw_app_meta_data,
        user_metadata: user.raw_user_meta_data,
      };
      const profile = await getUserProfile(loginPayload);
      if (!profile?.lg_ativo) {
        recordLoginFailure(attemptKey);
        return json(res, { error: 'invalid_grant', error_description: 'Invalid login credentials' }, 400);
      }
      const accessToken = signJwt(loginPayload);
      const factors = await loadMfaFactors(loginPayload);
      // Save refresh token
      await pool.query(
        `INSERT INTO auth.refresh_tokens (token, user_id, session_jti) VALUES ($1, $2, $3)`,
        [refreshToken, user.id, sessionId]
      );
      return json(res, {
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
          factors,
          created_at: user.created_at,
        },
      });
    }

    // â”€â”€â”€ AUTH: Get user â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // AUTH ADMIN: minimal GoTrue-compatible contract used by auth-admin Edge Function.
    if (path === '/auth/v1/invite' && req.method === 'POST') {
      if (!requireServiceRole(req)) return json(res, { message: 'Invalid service role JWT' }, 401);
      if (!localAuthAdmin) return json(res, { message: 'Auth admin unavailable' }, 503);
      const body = await parseBody(req);
      const redirectTo = allowedAuthRedirect(body.redirect_to);
      if (!redirectTo) return json(res, { message: 'Invalid redirect target' }, 400);
      const result = await localAuthAdmin.invite({
        email: body.email,
        data: body.data,
        redirectTo,
      });
      return json(res, result.body, result.status);
    }

    if (path === '/auth/v1/recover' && req.method === 'POST') {
      if (!localAuthAdmin) return json(res, {}, 200);
      const body = await parseBody(req);
      if (!allowRecoveryAttempt(loginAttemptKey(req, body.email))) return json(res, {}, 200);
      const redirectTo = allowedAuthRedirect(body.redirect_to);
      if (!redirectTo) return json(res, {}, 200);
      const result = await localAuthAdmin.recover({ email: body.email, redirectTo });
      return json(res, result.body, result.status);
    }

    if (path === '/auth/v1/verify' && req.method === 'GET') {
      if (!localAuthAdmin) return json(res, { message: 'Auth admin unavailable' }, 503);
      const redirectTo = allowedAuthRedirect(url.searchParams.get('redirect_to'));
      if (!redirectTo) return json(res, { message: 'Invalid redirect target' }, 400);
      const result = await localAuthAdmin.consume({
        token: url.searchParams.get('token'),
        type: url.searchParams.get('type'),
        redirectTo,
      });
      if (result.status === 302) {
        res.writeHead(302, {
          location: result.location,
          'cache-control': 'no-store',
          'referrer-policy': 'no-referrer',
        });
        res.end();
        return;
      }
      return json(res, result.body, result.status);
    }

    const adminUserMatch = path.match(/^\/auth\/v1\/admin\/users\/([0-9a-f-]{36})$/i);
    const adminLogoutMatch = path.match(/^\/auth\/v1\/admin\/users\/([0-9a-f-]{36})\/logout$/i);
    if (adminLogoutMatch && req.method === 'POST') {
      const servicePayload = requireServiceRole(req);
      if (!servicePayload) return json(res, { message: 'Invalid service role key' }, 401);
      const client = await servicePool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE service_role');
        await client.query(
          'UPDATE auth.refresh_tokens SET revoked = true, updated_at = NOW() WHERE user_id = $1 AND revoked = false',
          [adminLogoutMatch[1]],
        );
        await client.query(
          'UPDATE public.auth_sessions SET revoked_at = COALESCE(revoked_at, NOW()) WHERE user_id = $1 AND revoked_at IS NULL',
          [adminLogoutMatch[1]],
        );
        await client.query(
          `UPDATE public.application_sessions
              SET revoked_at = COALESCE(revoked_at, NOW()),
                  revocation_reason = COALESCE(revocation_reason, 'admin_logout_global')
            WHERE user_id = $1 AND revoked_at IS NULL`,
          [adminLogoutMatch[1]],
        );
        await client.query('COMMIT');
        return json(res, {});
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
    if (adminUserMatch && req.method === 'PUT') {
      const servicePayload = requireServiceRole(req);
      if (!servicePayload) return json(res, { message: 'Invalid service role JWT' }, 401);
      const body = await parseBody(req);
      if (typeof body.ban_duration !== 'string' || !/^(none|\d+[smhd])$/.test(body.ban_duration)) {
        return json(res, { message: 'Unsupported admin user update' }, 422);
      }
      const capability = await queryAsAuthenticated(servicePayload,
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'banned_until'
         ) AS supported`,
      );
      if (!capability.rows[0]?.supported) {
        return json(res, { message: 'Admin user update is not supported by the current auth schema' }, 501);
      }
      const unitMs = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
      const bannedUntil = body.ban_duration === 'none' ? null : new Date(Date.now() + Number.parseInt(body.ban_duration, 10) * unitMs[body.ban_duration.slice(-1)]).toISOString();
      const client = await servicePool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `SELECT set_config('request.jwt.claim.sub', $1, true),
                  set_config('request.jwt.claim.role', 'service_role', true),
                  set_config('request.jwt.claims', $2, true)`,
          [servicePayload.sub, JSON.stringify(servicePayload)],
        );
        await client.query('SET LOCAL ROLE service_role');
        const result = await client.query(
          'UPDATE auth.users SET banned_until = $1, updated_at = now() WHERE id = $2 RETURNING *',
          [bannedUntil, adminUserMatch[1]],
        );
        if (!result.rowCount) {
          await client.query('ROLLBACK');
          return json(res, { message: 'User not found' }, 404);
        }
        if (bannedUntil) {
          await client.query(
            'UPDATE auth.refresh_tokens SET revoked = true, updated_at = now() WHERE user_id = $1 AND revoked = false',
            [adminUserMatch[1]],
          );
        }
        await client.query('COMMIT');
        return json(res, authUserResponse(result.rows[0]));
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }

    if (adminUserMatch && req.method === 'DELETE') {
      const servicePayload = requireServiceRole(req);
      if (!servicePayload) return json(res, { message: 'Invalid service role JWT' }, 401);
      const client = await poolForPayload(servicePayload).connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `SELECT set_config('request.jwt.claim.sub', $1, true),
                  set_config('request.jwt.claim.role', 'service_role', true),
                  set_config('request.jwt.claims', $2, true)`,
          [servicePayload.sub || '', JSON.stringify(servicePayload)],
        );
        await client.query('SET LOCAL ROLE service_role');
        const result = await client.query(
          `DELETE FROM auth.users u
            WHERE u.id = $1
              AND u.email_confirmed_at IS NULL
              AND EXISTS (
                SELECT 1 FROM private.local_auth_challenges c
                 WHERE c.user_id = u.id AND c.type = 'invite'
                   AND c.consumed_at IS NULL
                   AND c.created_at > NOW() - INTERVAL '5 minutes'
              )
          RETURNING u.*`,
          [adminUserMatch[1]],
        );
        if (!result.rowCount) {
          await client.query('ROLLBACK');
          return json(res, { message: 'Compensating delete not allowed' }, 409);
        }
        await client.query('DELETE FROM auth.refresh_tokens WHERE user_id = $1', [adminUserMatch[1]]);
        await client.query('COMMIT');
        return json(res, authUserResponse(result.rows[0]));
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }

    if (path === '/auth/v1/user' && req.method === 'PUT') {
      const payload = verifyPasswordFlowJwt(bearerToken(req));
      if (!payload) {
        return json(res, { message: 'Password update is not authorized' }, 401);
      }
      const body = await parseBody(req);
      if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128) {
        return json(res, { message: 'Password must contain 8 to 128 characters' }, 422);
      }
      if (!servicePool) return json(res, { message: 'Auth admin unavailable' }, 503);
      const client = await servicePool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE service_role');
        const authorization = await client.query(
          `UPDATE private.local_auth_challenges
              SET password_updated_at = NOW()
            WHERE user_id = $1 AND session_id = $2 AND type = $3
              AND consumed_at IS NOT NULL AND password_updated_at IS NULL
              AND expires_at > NOW()
        RETURNING id`,
          [payload.sub, payload.session_id, payload.auth_flow],
        );
        if (!authorization.rowCount) {
          await client.query('ROLLBACK');
          return json(res, { message: 'Password authorization expired or already used' }, 409);
        }
        const updated = await client.query(
          `UPDATE auth.users
              SET encrypted_password = crypt($1, gen_salt('bf', 12)),
                  email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
                  updated_at = NOW()
            WHERE id = $2 AND (banned_until IS NULL OR banned_until <= NOW())
        RETURNING *`,
          [body.password, payload.sub],
        );
        if (!updated.rowCount) {
          await client.query('ROLLBACK');
          return json(res, { message: 'User not found or inactive' }, 404);
        }
        await client.query(
          'UPDATE auth.refresh_tokens SET revoked = true, updated_at = NOW() WHERE user_id = $1 AND revoked = false',
          [payload.sub],
        );
        await client.query('COMMIT');
        return json(res, authUserResponse(updated.rows[0]));
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }

    if (path === '/auth/v1/user' && req.method === 'GET') {
      const auth = req.headers.authorization?.replace('Bearer ', '');
      const payload = verifyUserJwt(auth);
      if (!payload) return json(res, { error: 'unauthorized' }, 401);
      if (!await isUserSessionActive(payload)) return json(res, { error: 'unauthorized' }, 401);
      const profile = await getUserProfile(payload);
      if (!profile?.lg_ativo) return json(res, { error: 'user not found' }, 404);
      const userRes = await pool.query(
        `SELECT *
           FROM auth.users
          WHERE id = $1`,
        [payload.sub],
      );
      if (userRes.rows.length === 0) return json(res, { error: 'user not found' }, 404);
      const u = userRes.rows[0];
      const factors = await loadMfaFactors(payload);
      return json(res, {
        id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email,
        email_confirmed_at: u.email_confirmed_at,
        app_metadata: u.raw_app_meta_data,
        user_metadata: u.raw_user_meta_data,
        factors,
        created_at: u.created_at,
      });
    }

    // â”€â”€â”€ AUTH: Logout â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (path === '/auth/v1/logout' && req.method === 'POST') {
      const token = req.headers.authorization?.replace('Bearer ', '');
      const payload = verifyUserJwt(token);
      if (payload?.sub) {
        await pool.query(
          'UPDATE auth.refresh_tokens SET revoked = true, updated_at = now() WHERE user_id = $1 AND revoked = false',
          [payload.sub],
        );
      }
      return json(res, {});
    }

    // (refresh token handler moved to top of chain)

    if (path === '/auth/v1/factors' && req.method === 'GET') {
      const payload = verifyUserJwt(req.headers.authorization?.replace('Bearer ', ''));
      if (!payload) return json(res, { error: 'unauthorized' }, 401);
      if (!await isUserSessionActive(payload)) return json(res, { error: 'unauthorized' }, 401);
      const factors = await loadMfaFactors(payload);
      return json(res, { all: factors, totp: factors, phone: [] });
    }

    if (path === '/auth/v1/factors' && req.method === 'POST') {
      const payload = verifyUserJwt(req.headers.authorization?.replace('Bearer ', ''));
      if (!payload) return json(res, { error: 'unauthorized' }, 401);
      if (!await isUserSessionActive(payload)) return json(res, { error: 'unauthorized' }, 401);
      const encryptionKey = requireMfaEncryptionKey();
      const body = await parseBody(req);
      if (body.factor_type && body.factor_type !== 'totp') {
        return json(res, { error: 'unsupported_factor_type' }, 422);
      }
      const secret = randomBase32Secret();
      const friendlyName = typeof body.friendly_name === 'string' && body.friendly_name.trim()
        ? body.friendly_name.trim().slice(0, 80)
        : 'ProntoMedic';
      const result = await queryAsAuthenticated(
        payload,
        `INSERT INTO public.auth_mfa_factors (user_id, friendly_name, secret_ciphertext, status)
         VALUES ($1, $2, pgp_sym_encrypt($3, $4), 'unverified')
         ON CONFLICT (user_id, friendly_name) DO UPDATE SET
           updated_at = public.auth_mfa_factors.updated_at
         WHERE public.auth_mfa_factors.status = 'unverified'
         RETURNING id, friendly_name, status, created_at,
           pgp_sym_decrypt(secret_ciphertext, $4) AS persisted_secret`,
        [payload.sub, friendlyName, secret, encryptionKey],
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
      });
    }

    const factorChallenge = path.match(/^\/auth\/v1\/factors\/([0-9a-f-]{36})\/challenge$/i);
    if (factorChallenge && req.method === 'POST') {
      const payload = verifyUserJwt(req.headers.authorization?.replace('Bearer ', ''));
      if (!payload) return json(res, { error: 'unauthorized' }, 401);
      if (!await isUserSessionActive(payload)) return json(res, { error: 'unauthorized' }, 401);
      const factor = await queryAsAuthenticated(
        payload,
        'SELECT id FROM public.auth_mfa_factors WHERE id = $1 AND user_id = $2',
        [factorChallenge[1], payload.sub],
      );
      if (!factor.rowCount) return json(res, { error: 'factor_not_found' }, 404);
      return json(res, {
        id: randomUUID(),
        factor_id: factorChallenge[1],
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      });
    }

    const factorVerify = path.match(/^\/auth\/v1\/factors\/([0-9a-f-]{36})\/verify$/i);
    if (factorVerify && req.method === 'POST') {
      const payload = verifyUserJwt(req.headers.authorization?.replace('Bearer ', ''));
      if (!payload) return json(res, { error: 'unauthorized' }, 401);
      if (!await isUserSessionActive(payload)) return json(res, { error: 'unauthorized' }, 401);
      const body = await parseBody(req);
      if (!/^\d{6}$/.test(String(body.code || ''))) {
        return json(res, { error: 'invalid_code' }, 403);
      }
      const factor = await queryAsAuthenticated(
        payload,
        `SELECT id, secret_ciphertext
           FROM public.auth_mfa_factors
          WHERE id = $1 AND user_id = $2 AND status <> 'disabled'`,
        [factorVerify[1], payload.sub],
      );
      if (!factor.rowCount) return json(res, { error: 'factor_not_found' }, 404);
      const secret = await decryptMfaSecret(payload, factor.rows[0].secret_ciphertext);
      const valid = [-30_000, 0, 30_000].some(
        (offset) => totpCode(secret, Date.now() + offset) === String(body.code),
      );
      if (!valid) return json(res, { error: 'invalid_code' }, 403);
      await queryAsAuthenticated(
        payload,
        `UPDATE public.auth_mfa_factors
            SET status = 'verified', updated_at = now()
          WHERE id = $1 AND user_id = $2`,
        [factorVerify[1], payload.sub],
      );
      const userResult = await pool.query(
        'SELECT * FROM auth.users WHERE id = $1',
        [payload.sub],
      );
      if (!userResult.rowCount) return json(res, { error: 'user_not_found' }, 404);
      const factors = await loadMfaFactors(payload);
      return json(res, await issueMfaVerifiedSession(userResult.rows[0], factors));
    }

    const factorDelete = path.match(/^\/auth\/v1\/factors\/([0-9a-f-]{36})$/i);
    if (factorDelete && req.method === 'DELETE') {
      const payload = verifyUserJwt(req.headers.authorization?.replace('Bearer ', ''));
      if (!payload) return json(res, { error: 'unauthorized' }, 401);
      if (!await isUserSessionActive(payload)) return json(res, { error: 'unauthorized' }, 401);
      const result = await queryAsAuthenticated(
        payload,
        'DELETE FROM public.auth_mfa_factors WHERE id = $1 AND user_id = $2 RETURNING id',
        [factorDelete[1], payload.sub],
      );
      return json(res, {}, result.rowCount ? 200 : 404);
    }

    // â”€â”€â”€ AUTH: Settings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (path === '/auth/v1/settings') {
      return json(res, { external: {}, disable_signup: false, mailer_autoconfirm: true });
    }

    // â”€â”€â”€ RPC: chamada de funcao Postgres (supabase.rpc) â”€â”€â”€â”€â”€â”€â”€
    if (path.startsWith('/rest/v1/rpc/') && req.method === 'POST') {
      const fnName = decodeURIComponent(path.replace('/rest/v1/rpc/', '').split('?')[0]);
      const servicePayload = SERVICE_RPC_ALLOWLIST.has(fnName) ? verifyServiceRoleKey(req) : null;
      const payload = servicePayload || verifyUserJwt(bearerToken(req));
      if (!payload) return json(res, { error: 'unauthorized', message: 'JWT vÃ¡lido obrigatÃ³rio' }, 401);
      if (!servicePayload && !await isUserSessionActive(payload)) return json(res, { error: 'unauthorized', message: 'sessao inativa' }, 401);
      const profile = servicePayload ? null : await getUserProfile(payload);
      if (!servicePayload && (!profile || !profile.lg_ativo)) return json(res, { error: 'forbidden', message: 'usuÃ¡rio invÃ¡lido/inativo' }, 403);
      const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
      if (!IDENT.test(fnName)) {
        return json(res, { error: 'bad_request', message: `funÃ§Ã£o RPC invÃ¡lida: ${fnName}` }, 400);
      }
      const rpcDecision = servicePayload ? { ok: true } : await authorizeRpc(profile, fnName, payload);
      if (!rpcDecision.ok) {
        return json(res, { error: 'forbidden', message: rpcDecision.reason }, 403);
      }
      const body = await parseBody(req);
      if (
        fnName === 'update_appointment_status_secure' &&
        body.p_new_status === 'waiting'
      ) {
        return json(
          res,
          {
            error: 'forbidden',
            message: 'Entrada em espera exige o workflow transacional da recepcao',
            code: '42501',
          },
          403,
        );
      }
      const keys = Object.keys(body);
      for (const key of keys) {
        if (!IDENT.test(key)) {
          return json(res, { error: 'bad_request', message: `parÃ¢metro RPC invÃ¡lido: ${key}` }, 400);
        }
      }
      // monta SELECT fn(p1 => $1, p2 => $2) com params nomeados
      const namedArgs = keys.map((k, i) => `"${k}" => $${i + 1}`).join(', ');
      const vals = keys.map((k) => body[k]);
      const client = await poolForPayload(payload).connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `SELECT set_config('request.jwt.claim.sub', $1, true),
                  set_config('request.jwt.claim.role', $2, true),
                  set_config('request.jwt.claims', $3, true)`,
          [payload.sub, servicePayload ? 'service_role' : 'authenticated', JSON.stringify(payload)],
        );
        await client.query(servicePayload ? 'SET LOCAL ROLE service_role' : 'SET LOCAL ROLE authenticated');
        const functionMetadata = await client.query(
          `SELECT routine.proretset
             FROM pg_catalog.pg_proc routine
             JOIN pg_catalog.pg_namespace namespace
               ON namespace.oid = routine.pronamespace
            WHERE namespace.nspname = 'public'
              AND routine.proname = $1
            LIMIT 1`,
          [fnName],
        );
        const returnsSet = Boolean(functionMetadata.rows[0]?.proretset);
        const rpcQuery = returnsSet
          ? `SELECT to_jsonb(result_row) AS result
               FROM public."${fnName}"(${namedArgs}) AS result_row`
          : `SELECT to_jsonb(public."${fnName}"(${namedArgs})) AS result`;
        const result = await client.query(
          rpcQuery,
          vals,
        );
        await client.query('COMMIT');
        const val = returnsSet
          ? result.rows.map((row) => row.result)
          : result.rows.length === 0
            ? null
            : result.rows[0].result;
        return json(res, val);
      } catch (e) {
        await client.query('ROLLBACK');
        const status = e.code === '42501' ? 403 : 400;
        return json(
          res,
          { error: e.message, message: e.message, code: e.code || 'PGRST202' },
          status,
        );
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
      const servicePayload = req.method === 'GET' && SERVICE_READ_TABLE_ALLOWLIST.has(table)
        ? verifyServiceRoleKey(req)
        : null;
      const payload = servicePayload || verifyUserJwt(bearerToken(req));

      // Exige JWT vÃ¡lido (apikey sozinho NÃƒO autentica mais)
      if (!payload) return json(res, { error: 'unauthorized', message: 'JWT vÃ¡lido obrigatÃ³rio' }, 401);
      if (servicePayload && !validateServiceReadContract(table, url)) {
        return json(res, { error: 'forbidden', message: 'Service read contract denied' }, 403);
      }
      if (!servicePayload && !await isUserSessionActive(payload)) return json(res, { error: 'unauthorized', message: 'sessao inativa' }, 401);

      // Enforcement RBAC: role Ã— mÃ³dulo Ã— aÃ§Ã£o
      const profile = servicePayload ? null : await getUserProfile(payload);
      const isSelfProfileRead =
        req.method === 'GET' &&
        table === 'user_profiles' &&
        url.searchParams.get('id') === `eq.${payload.sub}`;
      const decision = servicePayload || isSelfProfileRead ? { ok: true } : await authorize(profile, table, req.method, payload);
      if (!decision.ok) return json(res, { error: 'forbidden', message: decision.reason }, 403);
      if (req.method === 'GET') {
        // Parse select columns (strip embedded relations like "payment_source:payment_sources(name,type)")
        const columns = parseSelectProjection(url.searchParams.get('select')) || '*';

        let query = `SELECT ${columns} FROM public."${table}"`;
        const conditions = [];
        const values = [];
        let paramIdx = 1;


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
          const result = await queryAsAuthenticated(payload, query, values);

          // Count total if Prefer: count=exact
          const prefer = req.headers.prefer || '';
          let totalCount = result.rows.length;
          if (prefer.includes('count=exact')) {
            const countQuery = `SELECT COUNT(*) FROM public."${table}"` + (conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '');
            const countResult = await queryAsAuthenticated(payload, countQuery, values);
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
          return json(res, { error: e.message, message: e.message, code: 'PGRST000' }, 400);
        }
      }

      if (req.method === 'POST') {
        const parsedBody = await parseBody(req);
        if (Array.isArray(parsedBody) && parsedBody.length !== 1) {
          return json(
            res,
            { error: 'bad_request', message: 'insert em lote ainda não suportado no auth local' },
            400,
          );
        }
        const body = Array.isArray(parsedBody) ? parsedBody[0] : parsedBody;
        if (!body || typeof body !== 'object') {
          return json(res, { error: 'bad_request', message: 'body inválido' }, 400);
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
        const returningProjection = parseSelectProjection(url.searchParams.get('select'));
        const returningClause = returningProjection ? ` RETURNING ${returningProjection}` : '';
        try {
          const result = await queryAsAuthenticated(payload,
            `INSERT INTO public."${table}" (${columns}) VALUES (${placeholders})${returningClause}`,
            vals
          );
          const prefer = req.headers.prefer || '';
          if (prefer.includes('return=representation') && returningProjection) {
            return json(res, result.rows[0], 201);
          }
          return json(res, {}, 201);
        } catch (e) {
          return json(res, { error: e.message, message: e.message }, 400);
        }
      }

      if (req.method === 'PATCH') {
        const body = await parseBody(req);
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
        const returningProjection = parseSelectProjection(url.searchParams.get('select'));
        const returningClause = returningProjection ? ` RETURNING ${returningProjection}` : '';
        try {
          const result = await queryAsAuthenticated(payload,
            `UPDATE public."${table}" SET ${setClause} WHERE id = $${keys.length + 1}${returningClause}`,
            [...vals, id]
          );
          return json(res, returningProjection ? (result.rows[0] || {}) : {});
        } catch (e) {
          return json(res, { error: e.message, message: e.message }, 400);
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
  await pool.query('SELECT 1');
  await validateServicePoolContract();
  if (servicePool) {
    await ensureLocalAuthAdminSchema(servicePool);
    localAuthAdmin = createLocalAuthAdmin({
      pool: servicePool,
      signJwt,
      mailProvider: mailProviderFromEnv(),
      publicAuthUrl: AUTH_PUBLIC_URL,
    });
  }
  server.listen(PORT, '0.0.0.0', () => {
  console.log(``);
  console.log(`  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”`);
  console.log(`  â”‚  ProntoClinic Local Auth Server               â”‚`);
  console.log(`  â”‚  http://localhost:${PORT}                       â”‚`);
  console.log(`  â”‚  Postgres: ${PGHOST}:${PGPORT}/${PGDATABASE}`);
  console.log(`  â”‚  Admin: use usuario seedado no banco local     â”‚`);
  console.log(`  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜`);
  console.log(``);
  });
}

function allowRecoveryAttempt(key, now = Date.now()) {
  if (!LOGIN_RATE_LIMIT_ENABLED) return true;
  const previous = recoveryAttempts.get(key);
  const attempt = !previous || now - previous.firstAttempt > RECOVERY_WINDOW_MS
    ? { count: 0, firstAttempt: now }
    : previous;
  attempt.count += 1;
  recoveryAttempts.set(key, attempt);
  if (recoveryAttempts.size > 10000) {
    for (const [entryKey, entry] of recoveryAttempts) {
      if (now - entry.firstAttempt > RECOVERY_WINDOW_MS) recoveryAttempts.delete(entryKey);
    }
  }
  return attempt.count <= RECOVERY_MAX_ATTEMPTS;
}

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[SHUTDOWN] ${signal}`);
  server.close(async () => {
    const results = await Promise.allSettled([pool.end(), servicePool?.end()]);
    process.exitCode = results.some((result) => result.status === 'rejected') ? 1 : 0;
  });
  setTimeout(() => {
    console.error('[SHUTDOWN] timeout ao encerrar conexoes');
    process.exit(1);
  }, 10000).unref();
}

pool.on('error', (error) => console.error('[PG_POOL_ERROR] authenticated', error.message));
servicePool?.on('error', (error) => console.error('[PG_POOL_ERROR] service_role', error.message));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

startServer().catch(async (error) => {
  console.error('[STARTUP_REFUSED]', error.message);
  await Promise.allSettled([pool.end(), servicePool?.end()]);
  process.exitCode = 1;
});
