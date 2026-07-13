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
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';
import pg from 'pg';
const { Pool } = pg;

const PORT = Number(process.env.LOCAL_AUTH_PORT || 8000);
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET obrigatorio e deve ter pelo menos 32 caracteres');
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
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE || 'prontoclinic',
});

pool.on('error', (error) => {
  console.error('[PG_POOL_ERROR]', error);
});

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
    if (typeof payload.sub !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.sub)) return null;
    if (payload.aud !== 'authenticated') return null;
    if (!Number.isFinite(payload.exp) || Date.now() / 1000 >= payload.exp) return null;
    if (!Number.isFinite(payload.iat) || payload.iat > Date.now() / 1000 + 60) return null;
    return payload;
  } catch { return null; }
}

// Bcrypt verify via Postgres (uses pgcrypto)
async function verifyPassword(email, password) {
  const res = await pool.query(
    `SELECT id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data
     FROM auth.users WHERE email = $1`,
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

async function getUserProfile(userId) {
  const res = await pool.query(
    `SELECT id, full_name, email, role_name, company_id, primary_unit_id, lg_ativo
     FROM public.user_profiles WHERE id = $1`,
    [userId]
  );
  return res.rows[0] || null;
}

async function withAuthenticatedDbSession(payload, operation) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('request.jwt.claim.sub', $1, true),
              set_config('request.jwt.claims', $2, true),
              set_config('request.jwt.claim.role', 'authenticated', true)`,
      [payload.sub, JSON.stringify({ ...payload, role: 'authenticated' })],
    );
    await client.query('SET LOCAL ROLE authenticated');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('[DB_SESSION_ROLLBACK_ERROR]', rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// AUTORIZAÃ‡ÃƒO SERVER-SIDE (RBAC por role Ã— mÃ³dulo Ã— aÃ§Ã£o)
// Mapeia tabela fÃ­sica â†’ mÃ³dulo lÃ³gico da matriz role_permissions.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const REFERENCE_TABLES = new Set([
  'bairros', 'cbos', 'cids', 'cid', 'municipios', 'profissoes',
  'countries', 'states', 'racas', 'etnias', 'nacionalidades',
]);

const SCHEDULING_CATALOG_TABLES = new Set([
  'professionals', 'specialties', 'appointment_types', 'services_catalog',
]);

function tableToModule(table, method = 'GET') {
  const t = table.toLowerCase();
  // O nome canonico do papel e necessario para montar a sessao de qualquer
  // usuario autenticado. O catalogo e global e somente leitura; as permissoes
  // detalhadas continuam protegidas pelo modulo administrativo.
  if (t === 'roles') {
    return method === 'GET' || method === 'HEAD' ? null : 'admin';
  }
  // Unidade e catalogo operacional compartilhado: leitura autenticada e
  // tenant-scoped; escrita continua restrita ao modulo administrativo.
  if (t === 'units') {
    return method === 'GET' || method === 'HEAD' ? null : 'admin';
  }
  if (SCHEDULING_CATALOG_TABLES.has(t)) {
    return method === 'GET' || method === 'HEAD' ? 'agenda' : 'admin';
  }
  // match por prefixo/nome exato
  const map = [
    // prontuÃ¡rio/clÃ­nico ANTES de pacientes (patient_allergies, patient_problem_list, patient_medications sÃ£o atos clÃ­nicos)
    // NOTA: 'cid' (catÃ¡logo CID-10) Ã© tabela de REFERÃŠNCIA universal â€” NÃƒO entra aqui,
    // cai no default (leitura livre p/ qualquer perfil autenticado, escrita sÃ³ admin).
    [/^encounters?$|^encounter_|^medical_records|^clinical_|^prescricoes|^prontuar|^diagnos|^patient_allergies|^patient_problem|^patient_medication|^alergias/, 'prontuario'],
    [/^patients$|^paciente|^patient_phones|^telxpac/, 'pacientes'],
    [/^appointments$|^agenda|^professional_schedules|^escala/, 'agenda'],
    // EvoluÃ§Ã£o/procedimentos/incidentes de enfermagem = conteÃºdo clÃ­nico sensÃ­vel â†’ mÃ³dulo prontuario (recepÃ§Ã£o bloqueada por LGPD)
    [/^nursing_notes|^nursing_procedures|^nursing_incidents|^nursing_medication|^nursing_shift|^nursing_evolution/, 'enfermagem'],
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
    [/^scheduling_contact_logs|^scheduling_call_center_tasks|^scheduling_confirmation_/, 'recepcao'],
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

const METHOD_TO_ACTION = { GET: 'can_view', HEAD: 'can_view', POST: 'can_create', PATCH: 'can_edit', PUT: 'can_edit', DELETE: 'can_delete' };
const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const isIdentifier = (value) => IDENT.test(value);
const quoteIdent = (value) => `"${value}"`;

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

async function requiredCompanyScope(profile, table) {
  if (!(await tableHasCompanyId(table))) return null;
  if (!profile?.company_id) {
    const error = new Error(`perfil sem company_id para acessar tabela '${table}'`);
    error.statusCode = 403;
    throw error;
  }
  return profile.company_id;
}

// Somente leituras podem usar cache curto. Mutacoes sempre consultam o catalogo
// para que uma revogacao tenha efeito na chamada seguinte.
const VIEW_PERMISSION_CACHE_TTL_MS = 5_000;
const viewPermissionCache = new Map();
async function loadRolePerms(role, action = 'can_view') {
  const cacheable = action === 'can_view';
  const cached = cacheable ? viewPermissionCache.get(role) : null;
  if (cached?.expiresAt > Date.now()) return cached.permissions;
  if (cached) viewPermissionCache.delete(role);
  try {
    const r = await pool.query(
      `SELECT rp.module, rp.can_view, rp.can_create, rp.can_edit, rp.can_delete
         FROM role_permissions rp JOIN roles ro ON ro.id = rp.role_id
        WHERE ro.name = $1`, [role]);
    const m = {};
    for (const row of r.rows) m[row.module] = row;
    if (cacheable) {
      viewPermissionCache.set(role, {
        permissions: m,
        expiresAt: Date.now() + VIEW_PERMISSION_CACHE_TTL_MS,
      });
    }
    return m;
  } catch (error) {
    // Missing permission catalog is fail-closed: deny non-admin access without
    // turning a missing deployment prerequisite into an HTTP 500.
    if (error?.code === '42P01') {
      console.error(`[RBAC_CATALOG_MISSING] role_permissions/roles for role ${role}`);
      const denied = {};
      if (cacheable) {
        viewPermissionCache.set(role, {
          permissions: denied,
          expiresAt: Date.now() + VIEW_PERMISSION_CACHE_TTL_MS,
        });
      }
      return denied;
    }
    throw error;
  }
}

/** Retorna {ok:true} ou {ok:false, reason}. Somente admin tem bypass total. */
async function authorize(profile, table, method) {
  if (!profile) return { ok: false, reason: 'sem perfil' };
  if (!profile.lg_ativo) return { ok: false, reason: 'usuÃ¡rio inativo' };
  const role = (profile.role_name || '').toLowerCase();
  if (role === 'admin') return { ok: true };
  const module = tableToModule(table, method);
  if (module === '__unmapped__') {
    return { ok: false, reason: `tabela '${table}' nao esta explicitamente autorizada` };
  }
  if (module === null) {
    // tabelas de referÃªncia: leitura liberada, escrita sÃ³ admin (jÃ¡ retornou acima)
    return METHOD_TO_ACTION[method] === 'can_view' ? { ok: true } : { ok: false, reason: 'escrita em tabela de referÃªncia exige admin' };
  }
  const action = METHOD_TO_ACTION[method] || 'can_view';
  const perms = await loadRolePerms(role, action);
  const rule = perms[module];
  if (!rule) return { ok: false, reason: `role '${role}' sem acesso ao mÃ³dulo '${module}'` };
  if (!rule[action]) return { ok: false, reason: `role '${role}' nÃ£o pode '${action}' em '${module}'` };
  return { ok: true };
}

const RPC_PERMISSIONS = {
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
  current_company_id: { module: 'admin', action: 'can_view' },
  calc_imc: { module: 'prontuario', action: 'can_view' },
  create_medical_record_secure: { module: 'prontuario', action: 'can_create' },
  update_medical_record_secure: { module: 'prontuario', action: 'can_edit' },
  sign_medical_record_secure: { module: 'prontuario', action: 'can_edit' },
  finalize_medical_attendance_secure: { module: 'prontuario', action: 'can_create' },
  create_appointment_with_requirements_secure: { module: 'agenda', action: 'can_create' },
  refresh_confirmation_queue_secure: { module: 'agenda', action: 'can_edit' },
  record_confirmation_attempt_secure: { module: 'agenda', action: 'can_edit' },
  mark_overdue_appointments_no_show_secure: { module: 'agenda', action: 'can_edit' },
  get_reception_checkin_readiness: { module: 'recepcao', action: 'can_view' },
  perform_reception_checkin_secure: { module: 'recepcao', action: 'can_create' },
  update_reception_authorization_secure: { module: 'recepcao', action: 'can_edit' },
  update_reception_eligibility_secure: { module: 'recepcao', action: 'can_edit' },
  create_billing_secure: { module: 'faturamento', action: 'can_create' },
  update_billing_status_secure: { module: 'faturamento', action: 'can_edit' },
  list_billing_production_secure: { module: 'faturamento', action: 'can_view' },
  list_tiss_read_model_secure: { module: 'faturamento', action: 'can_view' },
  list_tiss_glosas_read_secure: { module: 'faturamento', action: 'can_view' },
  list_tiss_protocols_read_secure: { module: 'faturamento', action: 'can_view' },
  list_billing_financial_summary_secure: { module: 'financeiro', action: 'can_view' },
  get_billing_balance_secure: { module: 'financeiro', action: 'can_view' },
  record_billing_receipt_secure: { module: 'financeiro', action: 'can_create' },
  reverse_billing_receipt_secure: { module: 'financeiro', action: 'can_edit' },
  create_professional_payment: { module: 'financeiro', action: 'can_create' },
  list_professional_payments: { module: 'financeiro', action: 'can_view' },
  transition_professional_payment: { module: 'financeiro', action: 'can_edit' },
  save_or_release_lab_result_secure: { module: 'laboratorio', action: 'can_edit' },
  create_nursing_medication_secure: { module: 'enfermagem', action: 'can_edit' },
  bedside_check: { module: 'enfermagem', action: 'can_view' },
  administer_nursing_medication_secure: { module: 'enfermagem', action: 'can_edit' },
  refuse_nursing_medication_secure: { module: 'enfermagem', action: 'can_edit' },
  report_nursing_incident_secure: { module: 'enfermagem', action: 'can_create' },
  record_nursing_procedure_secure: { module: 'enfermagem', action: 'can_create' },
  create_nursing_shift_handoff_secure: { module: 'enfermagem', action: 'can_create' },
  enqueue_nursing_triage_secure: { module: 'enfermagem', action: 'can_create' },
  call_nursing_triage_secure: { module: 'enfermagem', action: 'can_edit' },
  complete_nursing_triage_secure: { module: 'enfermagem', action: 'can_edit' },
};

const CENTRAL_PERMISSION_RPCS = new Set([
  'list_tiss_glosas_read_secure',
  'list_tiss_protocols_read_secure',
]);

const STRUCTURED_ROW_RPCS = new Set([
  'create_professional_payment',
  'list_professional_payments',
  'transition_professional_payment',
]);

function buildRpcQuery(functionName, parameterNames) {
  if (!Object.prototype.hasOwnProperty.call(RPC_PERMISSIONS, functionName) || !isIdentifier(functionName)) {
    throw new Error(`RPC '${functionName}' nao autorizada`);
  }
  for (const parameterName of parameterNames) {
    if (!isIdentifier(parameterName)) {
      throw new Error(`parametro RPC invalido: ${parameterName}`);
    }
  }

  const namedArgs = parameterNames
    .map((parameterName, index) => `${quoteIdent(parameterName)} => $${index + 1}`)
    .join(', ');
  const qualifiedFunction = `public.${quoteIdent(functionName)}`;
  if (STRUCTURED_ROW_RPCS.has(functionName)) {
    return `SELECT to_jsonb(r) AS result FROM ${qualifiedFunction}(${namedArgs}) AS r`;
  }
  return `SELECT ${qualifiedFunction}(${namedArgs}) AS result`;
}

function serializeRpcResult(functionName, rows) {
  if (STRUCTURED_ROW_RPCS.has(functionName)) {
    return rows.map((row) => row.result);
  }
  if (rows.length === 0) return [];
  if (rows.length > 1) return rows.map((row) => row.result);
  return rows[0].result;
}

const RPC_ONLY_TABLES = new Set([
  'medical_records',
  'nursing_medication_administrations',
  'nursing_incidents',
  'nursing_procedures',
  'nursing_shift_handoffs',
  'triagens',
  'news2_avaliacoes',
  'triagem_fila',
]);

const RPC_ONLY_METHODS = new Set(['POST', 'PATCH', 'DELETE']);

function requiresSecureRpc(table, method) {
  return RPC_ONLY_TABLES.has(table) && RPC_ONLY_METHODS.has(method);
}

async function authorizeRpc(profile, functionName) {
  const required = RPC_PERMISSIONS[functionName];
  if (!required) return { ok: false, reason: `RPC '${functionName}' nao autorizada` };
  if (!profile || !profile.lg_ativo) return { ok: false, reason: 'usuario invalido/inativo' };

  const role = (profile.role_name || '').toLowerCase();
  if (role === 'admin' && !CENTRAL_PERMISSION_RPCS.has(functionName)) {
    return { ok: true };
  }

  const permissions = await loadRolePerms(role, required.action);
  const rule = permissions[required.module];
  if (!rule?.[required.action]) {
    return { ok: false, reason: `role '${role}' nao pode '${required.action}' em '${required.module}'` };
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
  res.setHeader('Access-Control-Allow-Headers', 'authorization, apikey, content-type, prefer, range, x-client-info, x-application-name, x-supabase-api-version, accept-profile, content-profile, x-retry-count');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'content-range');
  return true;
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function databaseError(res, scope, context, error, code = 'PGRST000') {
  console.error(`[${scope}]`, context, error);
  return json(res, {
    error: 'database_error',
    message: 'Database request failed',
    code,
  }, 400);
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
    const hProfile = await getUserProfile(hPayload.sub);
    const hDecision = await authorize(hProfile, table, 'GET');
    if (!hDecision.ok) { res.writeHead(403); res.end(); return; }
    try {
      const hCompanyId = await requiredCompanyScope(hProfile, table);
      const countResult = await withAuthenticatedDbSession(hPayload, (client) =>
        hCompanyId
          ? client.query(`SELECT count(*) FROM public."${table}" WHERE company_id = $1`, [hCompanyId])
          : client.query(`SELECT count(*) FROM public."${table}"`)
      );
      const total = countResult.rows[0].count;
      res.writeHead(200, { 'content-range': `0-0/${total}` });
    } catch (error) {
      console.error('[REST_HEAD_ERROR]', { table, userId: hPayload.sub, message: error.message });
      res.writeHead(500);
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
      const accessToken = signJwt({
        sub: user.id,
        email: user.email,
        role: 'authenticated',
        aud: 'authenticated',
        iat: now,
        exp: now + 3600,
        app_metadata: user.raw_app_meta_data,
        user_metadata: user.raw_user_meta_data,
      });
      const refreshToken = randomUUID();
      // Save refresh token
      await pool.query(
        `INSERT INTO auth.refresh_tokens (token, user_id) VALUES ($1, $2)`,
        [refreshToken, user.id]
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
          created_at: user.created_at,
        },
      });
    }

    // â”€â”€â”€ AUTH: Get user â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (path === '/auth/v1/user' && req.method === 'GET') {
      const auth = req.headers.authorization?.replace('Bearer ', '');
      const payload = verifyJwt(auth);
      if (!payload) return json(res, { error: 'unauthorized' }, 401);
      const userRes = await pool.query(
        `SELECT u.*
           FROM auth.users u
           JOIN public.user_profiles p ON p.id = u.id
          WHERE u.id = $1 AND p.lg_ativo IS TRUE`,
        [payload.sub],
      );
      if (userRes.rows.length === 0) return json(res, { error: 'user not found' }, 404);
      const u = userRes.rows[0];
      return json(res, {
        id: u.id, aud: u.aud, role: u.role, email: u.email,
        email_confirmed_at: u.email_confirmed_at,
        app_metadata: u.raw_app_meta_data,
        user_metadata: u.raw_user_meta_data,
        created_at: u.created_at,
      });
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
      }
      return json(res, {});
    }

    // (refresh token handler moved to top of chain)

    // â”€â”€â”€ AUTH: Password recovery (local adapter)
    // Always returns a generic success response; no user existence is disclosed.
    if (path === '/auth/v1/recover' && req.method === 'POST') {
      await parseBody(req);
      return json(res, {});
    }

    // â”€â”€â”€ AUTH: Settings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (path === '/auth/v1/settings') {
      return json(res, { external: {}, disable_signup: false, mailer_autoconfirm: true });
    }

    // â”€â”€â”€ RPC: chamada de funcao Postgres (supabase.rpc) â”€â”€â”€â”€â”€â”€â”€
    if (path.startsWith('/rest/v1/rpc/') && req.method === 'POST') {
      const auth = req.headers.authorization?.replace('Bearer ', '');
      const payload = verifyJwt(auth);
      if (!payload || !payload.sub) return json(res, { error: 'unauthorized', message: 'JWT vÃ¡lido obrigatÃ³rio' }, 401);
      const profile = await getUserProfile(payload.sub);
      if (!profile || !profile.lg_ativo) return json(res, { error: 'forbidden', message: 'usuÃ¡rio invÃ¡lido/inativo' }, 403);
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
      const vals = keys.map((k) => body[k]);
      try {
        const rpcQuery = buildRpcQuery(fnName, keys);
        const result = await withAuthenticatedDbSession(payload, (client) =>
          client.query(rpcQuery, vals)
        );
        const val = serializeRpcResult(fnName, result.rows);
        return json(res, val);
      } catch (e) {
        return databaseError(
          res,
          'RPC_ERROR',
          { function: fnName, userId: payload.sub },
          e,
          'PGRST202',
        );
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
      if (!payload || !payload.sub) return json(res, { error: 'unauthorized', message: 'JWT vÃ¡lido obrigatÃ³rio' }, 401);

      // Enforcement RBAC: role Ã— mÃ³dulo Ã— aÃ§Ã£o
      const profile = await getUserProfile(payload.sub);
      if (!profile || !profile.lg_ativo) {
        return json(res, { error: 'forbidden', message: 'usuÃ¡rio invÃ¡lido/inativo' }, 403);
      }
      const isSelfProfileRead =
        req.method === 'GET' &&
        table === 'user_profiles' &&
        url.searchParams.get('id') === `eq.${payload.sub}`;
      const decision = isSelfProfileRead ? { ok: true } : await authorize(profile, table, req.method);
      if (!decision.ok) return json(res, { error: 'forbidden', message: decision.reason }, 403);
      const companyId = await requiredCompanyScope(profile, table);

      if (requiresSecureRpc(table, req.method)) {
        return json(res, { error: 'forbidden', message: 'Mutacao permitida somente por RPC segura' }, 403);
      }

      if (req.method === 'GET') {
        // Parse select columns (strip embedded relations like "payment_source:payment_sources(name,type)")
        const selectParam = url.searchParams.get('select');
        let columns = '*';
        if (selectParam && selectParam !== '*') {
          // Remove embedded relations: alias:table(cols) e table(cols)
          const withoutAliasEmbeds = selectParam.replace(/,?\s*\w+:\w+\([^)]*\)/g, '');
          const withoutEmbeds = withoutAliasEmbeds.replace(/,?\s*\w+\([^)]*\)/g, '');
          const rawCols = withoutEmbeds.split(',').map(c => c.trim()).filter(c => c.length > 0);
          // SEGURANÃ‡A: cada coluna DEVE ser um identificador SQL simples (anti SQL-injection).
          // Rejeita subqueries, parÃªnteses, espaÃ§os, aspas, operadores â€” bloqueia select=id,(SELECT ...).
          for (const col of rawCols) {
            if (!isIdentifier(col)) {
              return json(res, { error: 'bad_request', message: `coluna invÃ¡lida no select: ${col}` }, 400);
            }
          }
          const safe = rawCols.map(quoteIdent).join(', ');
          columns = safe || '*';
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
          const prefer = req.headers.prefer || '';
          const { result, totalCount } = await withAuthenticatedDbSession(payload, async (client) => {
            const result = await client.query(query, values);
            let totalCount = result.rows.length;
            if (prefer.includes('count=exact')) {
              const countQuery = `SELECT COUNT(*) FROM public."${table}"` + (conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '');
              const countResult = await client.query(countQuery, values);
              totalCount = parseInt(countResult.rows[0].count);
            }
            return { result, totalCount };
          });

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
          return databaseError(res, 'REST_READ_ERROR', { table, userId: payload.sub }, e);
        }
      }

      if (req.method === 'POST') {
        const body = await parseBody(req);
        if (companyId) {
          if (body.company_id && body.company_id !== companyId) {
            return json(res, { error: 'forbidden', message: 'company_id nao pertence ao perfil autenticado' }, 403);
          }
          body.company_id = companyId;
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
        try {
          const result = await withAuthenticatedDbSession(payload, (client) => client.query(
            `INSERT INTO public."${table}" (${columns}) VALUES (${placeholders}) RETURNING *`,
            vals
          ));
          const prefer = req.headers.prefer || '';
          if (prefer.includes('return=representation')) {
            return json(res, result.rows[0], 201);
          }
          return json(res, {}, 201);
        } catch (e) {
          return databaseError(res, 'REST_INSERT_ERROR', { table, userId: payload.sub }, e);
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
        try {
          const result = await withAuthenticatedDbSession(payload, (client) => client.query(
            `UPDATE public."${table}" SET ${setClause} WHERE id = $${keys.length + 1}${companyId ? ` AND company_id = $${keys.length + 2}` : ''} RETURNING *`,
            companyId ? [...vals, id, companyId] : [...vals, id]
          ));
          return json(res, result.rows[0] || {});
        } catch (e) {
          return databaseError(res, 'REST_UPDATE_ERROR', { table, userId: payload.sub }, e);
        }
      }
    }

    // â”€â”€â”€ Fallback: 404 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    json(res, { error: 'not found', path }, 404);

  } catch (err) {
    console.error('[ERROR]', err);
    const status = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    json(
      res,
      status < 500
        ? { error: 'request_error', message: err.message }
        : { error: 'internal_error', message: 'Internal server error' },
      status,
    );
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(``);
  console.log(`  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”`);
  console.log(`  â”‚  ProntoClinic Local Auth Server               â”‚`);
  console.log(`  â”‚  http://localhost:${PORT}                       â”‚`);
  console.log(`  â”‚  Postgres: 127.0.0.1:5432/prontoclinic       â”‚`);
  console.log(`  â”‚  Admin: use usuario seedado no banco local     â”‚`);
  console.log(`  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜`);
  console.log(``);
});

