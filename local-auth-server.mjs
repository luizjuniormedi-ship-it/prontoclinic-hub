/**
 * Local Auth Server — substitui GoTrue/Supabase Cloud
 * Simula os endpoints que o supabase-js usa:
 *   POST /auth/v1/token?grant_type=password
 *   GET  /auth/v1/user
 *   POST /auth/v1/logout
 *   GET  /rest/v1/* (proxy PostgREST simplificado)
 *
 * Roda em http://localhost:8000
 */
import { createServer } from 'http';
import { createHash, randomUUID } from 'crypto';
import pg from 'pg';
const { Pool } = pg;

const PORT = Number(process.env.LOCAL_AUTH_PORT || 8000);
const JWT_SECRET = process.env.LOCAL_AUTH_JWT_SECRET || 'local-dev-insecure-secret-change-me';

// Fix: pg retorna Date objects pra colunas 'date' — forçar string YYYY-MM-DD
const types = pg.types;
types.setTypeParser(1082, (val) => val); // date -> string as-is
types.setTypeParser(1114, (val) => val); // timestamp without tz -> string
types.setTypeParser(1184, (val) => val); // timestamptz -> string

const pool = new Pool({
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: process.env.PGDATABASE || 'prontoclinic',
});

// Simple JWT (HS256)
function base64url(str) {
  return Buffer.from(str).toString('base64url');
}

import { createHmac } from 'crypto';

function signJwt(payload) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const sig = createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyJwt(token) {
  try {
    const [header, body, sig] = token.split('.');
    const expected = createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    if (sig !== expected) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    // SEGURANÇA: rejeita token expirado
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
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

// ─────────────────────────────────────────────────────────────
// AUTORIZAÇÃO SERVER-SIDE (RBAC por role × módulo × ação)
// Mapeia tabela física → módulo lógico da matriz role_permissions.
// ─────────────────────────────────────────────────────────────
function tableToModule(table) {
  const t = table.toLowerCase();
  // match por prefixo/nome exato
  const map = [
    // prontuário/clínico ANTES de pacientes (patient_allergies, patient_problem_list, patient_medications são atos clínicos)
    // NOTA: 'cid' (catálogo CID-10) é tabela de REFERÊNCIA universal — NÃO entra aqui,
    // cai no default (leitura livre p/ qualquer perfil autenticado, escrita só admin).
    [/^encounters?$|^encounter_|^medical_records|^clinical_|^prescricoes|^prontuar|^diagnos|^patient_allergies|^patient_problem|^patient_medication|^alergias/, 'prontuario'],
    [/^patients$|^paciente|^patient_phones|^telxpac/, 'pacientes'],
    [/^appointments$|^agenda|^professional_schedules|^escala/, 'agenda'],
    // Evolução/procedimentos/incidentes de enfermagem = conteúdo clínico sensível → módulo prontuario (recepção bloqueada por LGPD)
    [/^nursing_notes|^nursing_procedures|^nursing_incidents|^nursing_medication|^nursing_evolution/, 'prontuario'],
    // Fila de triagem e classificação de risco = módulo enfermagem (recepção pode ver p/ chamar paciente)
    [/^triagens?$|^triagem_|^nursing_|^mnct_/, 'enfermagem'],
    [/^exames_lab|^lab_/, 'laboratorio'],
    [/^dicom|^report|^radiolog|^imaging|^pacs/, 'dicom'],
    [/^dispensa|^brasindice|^simpro|^medicament|^farmac|^estoque|^lote/, 'farmacia'],
    // caixa/contas/movimento bancário = financeiro (recebe/paga dinheiro)
    [/^contas_|^movimento|^caixa/, 'financeiro'],
    // financial_transactions/billing/tiss/fatura = faturamento (gera a conta/cobrança). SoD: faturamento cria, financeiro recebe.
    [/^financial_|^billing|^tiss|^fatura|^valores|^commission|^price_tab|^servxlanc/, 'faturamento'],
    [/^insurance|^convenio|^plano|^fonte_pagadora/, 'faturamento'],
    // recepção: check-in, autorização, elegibilidade, guias, senhas, documentos
    [/^reception_|^senhas_atendimento/, 'recepcao'],
    [/^scheduling_contact_logs|^scheduling_call_center_tasks/, 'recepcao'],
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
  return null; // tabela de referência (bairros, cbos, municipios...) → liberada p/ leitura
}

const METHOD_TO_ACTION = { GET: 'can_view', HEAD: 'can_view', POST: 'can_create', PATCH: 'can_edit', PUT: 'can_edit', DELETE: 'can_delete' };

// cache de permissões por role (evita query a cada request)
const permCache = new Map();
async function loadRolePerms(role) {
  if (permCache.has(role)) return permCache.get(role);
  const r = await pool.query(
    `SELECT rp.module, rp.can_view, rp.can_create, rp.can_edit, rp.can_delete
       FROM role_permissions rp JOIN roles ro ON ro.id = rp.role_id
      WHERE ro.name = $1`, [role]);
  const m = {};
  for (const row of r.rows) m[row.module] = row;
  permCache.set(role, m);
  return m;
}

/** Retorna {ok:true} ou {ok:false, reason}. admin tem bypass total. */
async function authorize(profile, table, method) {
  if (!profile) return { ok: false, reason: 'sem perfil' };
  if (!profile.lg_ativo) return { ok: false, reason: 'usuário inativo' };
  const role = (profile.role_name || '').toLowerCase();
  if (role === 'admin' || role === 'adm_medicos' || role === 'diretoria' || role === 'administracao') return { ok: true };
  const module = tableToModule(table);
  if (module === null) {
    // tabelas de referência: leitura liberada, escrita só admin (já retornou acima)
    return METHOD_TO_ACTION[method] === 'can_view' ? { ok: true } : { ok: false, reason: 'escrita em tabela de referência exige admin' };
  }
  const perms = await loadRolePerms(role);
  const rule = perms[module];
  if (!rule) return { ok: false, reason: `role '${role}' sem acesso ao módulo '${module}'` };
  const action = METHOD_TO_ACTION[method] || 'can_view';
  if (!rule[action]) return { ok: false, reason: `role '${role}' não pode '${action}' em '${module}'` };
  return { ok: true };
}

function cors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // Reflete QUALQUER header que o cliente pedir (wildcard CORS)
  const requestedHeaders = req.headers['access-control-request-headers'] || '*';
  res.setHeader('Access-Control-Allow-Headers', requestedHeaders);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'content-range');
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch { resolve({}); }
    });
  });
}

const server = createServer(async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // Support HEAD with count (supabase-js uses HEAD for count)
  if (req.method === 'HEAD' && path.startsWith('/rest/v1/')) {
    const table = path.replace('/rest/v1/', '').split('?')[0];
    // SEGURANÇA: HEAD count exige JWT válido + autorização (antes vazava contagem sem auth)
    const hAuth = req.headers.authorization?.replace('Bearer ', '');
    const hPayload = verifyJwt(hAuth);
    if (!hPayload || !hPayload.sub) { res.writeHead(401); res.end(); return; }
    // valida nome de tabela (anti-injection) e permissão
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) { res.writeHead(400); res.end(); return; }
    const hProfile = await getUserProfile(hPayload.sub);
    const hDecision = await authorize(hProfile, table, 'GET');
    if (!hDecision.ok) { res.writeHead(403); res.end(); return; }
    try {
      const countResult = await pool.query(`SELECT count(*) FROM public."${table}"`);
      const total = countResult.rows[0].count;
      res.writeHead(200, { 'content-range': `0-0/${total}` });
    } catch {
      res.writeHead(200, { 'content-range': '0-0/0' });
    }
    res.end();
    return;
  }

  try {
    // ─── AUTH: Refresh Token (MUST come before login) ────────
    if (path === '/auth/v1/token' && req.method === 'POST' && url.searchParams.get('grant_type') === 'refresh_token') {
      const body = await parseBody(req);
      const tokenValue = body.refresh_token || '';
      if (!tokenValue) {
        return json(res, { error: 'refresh_token is required' }, 400);
      }
      const rt = await pool.query(
        'SELECT user_id FROM auth.refresh_tokens WHERE token = $1 AND revoked = false',
        [tokenValue]
      );
      if (rt.rows.length === 0) {
        // Token invalido - retornar 401 pra forcar re-login
        return json(res, { error: 'invalid refresh token', error_description: 'Token expired or revoked' }, 401);
      }
      const userRes = await pool.query('SELECT * FROM auth.users WHERE id = $1', [rt.rows[0].user_id]);
      const u = userRes.rows[0];
      const now = Math.floor(Date.now() / 1000);
      const accessToken = signJwt({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 3600, app_metadata: u.raw_app_meta_data, user_metadata: u.raw_user_meta_data });
      const newRefreshToken = randomUUID();
      await pool.query('INSERT INTO auth.refresh_tokens (token, user_id) VALUES ($1, $2)', [newRefreshToken, u.id]);
      return json(res, {
        access_token: accessToken,
        token_type: 'bearer',
        expires_in: 3600,
        refresh_token: newRefreshToken,
        user: { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: u.email_confirmed_at, app_metadata: u.raw_app_meta_data, user_metadata: u.raw_user_meta_data }
      });
    }

    // ─── AUTH: Login ───────────────────────────────────────────
    if (path === '/auth/v1/token' && req.method === 'POST') {
      const body = await parseBody(req);
      const user = await verifyPassword(body.email, body.password);
      if (!user) {
        return json(res, { error: 'invalid_grant', error_description: 'Invalid login credentials' }, 400);
      }
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

    // ─── AUTH: Get user ───────────────────────────────────────
    if (path === '/auth/v1/user' && req.method === 'GET') {
      const auth = req.headers.authorization?.replace('Bearer ', '');
      const payload = verifyJwt(auth);
      if (!payload) return json(res, { error: 'unauthorized' }, 401);
      const userRes = await pool.query('SELECT * FROM auth.users WHERE id = $1', [payload.sub]);
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

    // ─── AUTH: Logout ─────────────────────────────────────────
    if (path === '/auth/v1/logout' && req.method === 'POST') {
      return json(res, {});
    }

    // (refresh token handler moved to top of chain)

    // ─── AUTH: Settings ───────────────────────────────────────
    if (path === '/auth/v1/settings') {
      return json(res, { external: {}, disable_signup: false, mailer_autoconfirm: true });
    }

    // ─── RPC: chamada de funcao Postgres (supabase.rpc) ───────
    if (path.startsWith('/rest/v1/rpc/') && req.method === 'POST') {
      const auth = req.headers.authorization?.replace('Bearer ', '');
      const payload = verifyJwt(auth);
      if (!payload || !payload.sub) return json(res, { error: 'unauthorized', message: 'JWT válido obrigatório' }, 401);
      const profile = await getUserProfile(payload.sub);
      if (!profile || !profile.lg_ativo) return json(res, { error: 'forbidden', message: 'usuário inválido/inativo' }, 403);
      const fnName = decodeURIComponent(path.replace('/rest/v1/rpc/', '').split('?')[0]);
      const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
      if (!IDENT.test(fnName)) {
        return json(res, { error: 'bad_request', message: `função RPC inválida: ${fnName}` }, 400);
      }
      const body = await parseBody(req);
      const keys = Object.keys(body);
      for (const key of keys) {
        if (!IDENT.test(key)) {
          return json(res, { error: 'bad_request', message: `parâmetro RPC inválido: ${key}` }, 400);
        }
      }
      // monta SELECT fn(p1 => $1, p2 => $2) com params nomeados
      const namedArgs = keys.map((k, i) => `"${k}" => $${i + 1}`).join(', ');
      const vals = keys.map((k) => body[k]);
      try {
        const result = await pool.query(`SELECT public."${fnName}"(${namedArgs}) AS result`, vals);
        const val = result.rows[0]?.result;
        return json(res, val);
      } catch (e) {
        return json(res, { error: e.message, code: 'PGRST202' }, 400);
      }
    }

    // ─── REST: PostgREST-compatible proxy ─────────────────────
    if (path.startsWith('/rest/v1/')) {
      const table = path.replace('/rest/v1/', '').split('?')[0];
      const auth = req.headers.authorization?.replace('Bearer ', '');
      const payload = verifyJwt(auth);

      // Exige JWT válido (apikey sozinho NÃO autentica mais)
      if (!payload || !payload.sub) return json(res, { error: 'unauthorized', message: 'JWT válido obrigatório' }, 401);

      // Enforcement RBAC: role × módulo × ação
      const profile = await getUserProfile(payload.sub);
      const decision = await authorize(profile, table, req.method);
      if (!decision.ok) return json(res, { error: 'forbidden', message: decision.reason }, 403);

      if (req.method === 'GET') {
        // Parse select columns (strip embedded relations like "payment_source:payment_sources(name,type)")
        const selectParam = url.searchParams.get('select');
        let columns = '*';
        if (selectParam && selectParam !== '*') {
          // Remove embedded relations: alias:table(cols) e table(cols)
          const withoutAliasEmbeds = selectParam.replace(/,?\s*\w+:\w+\([^)]*\)/g, '');
          const withoutEmbeds = withoutAliasEmbeds.replace(/,?\s*\w+\([^)]*\)/g, '');
          const rawCols = withoutEmbeds.split(',').map(c => c.trim()).filter(c => c.length > 0);
          // SEGURANÇA: cada coluna DEVE ser um identificador SQL simples (anti SQL-injection).
          // Rejeita subqueries, parênteses, espaços, aspas, operadores — bloqueia select=id,(SELECT ...).
          const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
          for (const col of rawCols) {
            if (!IDENT.test(col)) {
              return json(res, { error: 'bad_request', message: `coluna inválida no select: ${col}` }, 400);
            }
          }
          const safe = rawCols.map(c => `"${c}"`).join(', ');
          columns = safe || '*';
        }

        let query = `SELECT ${columns} FROM public."${table}"`;
        const conditions = [];
        const values = [];
        let paramIdx = 1;

        // Parse PostgREST filters (eq, neq, gt, gte, lt, lte, like, ilike, is, or, in)
        const IDENT_COL = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
        for (const [key, val] of url.searchParams) {
          if (['select', 'limit', 'offset', 'order'].includes(key)) continue;

          // SEGURANÇA: nome de coluna (key) deve ser identificador simples (anti SQL-injection).
          // 'or' é palavra reservada de filtro, tratada abaixo.
          if (key !== 'or' && !IDENT_COL.test(key)) {
            return json(res, { error: 'bad_request', message: `coluna de filtro inválida: ${key}` }, 400);
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
              if (!IDENT_COL.test(col)) continue; // ignora coluna inválida (anti-injection)
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
                // IS só aceita null/true/false (anti-injection: nada de valor cru interpolado)
                const isVal = v === 'null' ? 'NULL' : v === 'true' ? 'TRUE' : v === 'false' ? 'FALSE' : null;
                if (isVal === null) {
                  return json(res, { error: 'bad_request', message: `valor IS inválido: ${v}` }, 400);
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

        // Order (coluna validada — anti-injection)
        const orderParam = url.searchParams.get('order');
        if (orderParam) {
          const parts = [];
          for (const p of orderParam.split(',')) {
            const [col, dir] = p.split('.');
            if (!IDENT_COL.test(col)) {
              return json(res, { error: 'bad_request', message: `coluna de order inválida: ${col}` }, 400);
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
          const result = await pool.query(query, values);

          // Count total if Prefer: count=exact
          const prefer = req.headers.prefer || '';
          let totalCount = result.rows.length;
          if (prefer.includes('count=exact')) {
            const countQuery = `SELECT COUNT(*) FROM public."${table}"` + (conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '');
            const countResult = await pool.query(countQuery, values);
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
        const body = await parseBody(req);
        const keys = Object.keys(body);
        const vals = Object.values(body);
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
        try {
          const result = await pool.query(
            `INSERT INTO public."${table}" (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`,
            vals
          );
          const prefer = req.headers.prefer || '';
          if (prefer.includes('return=representation')) {
            return json(res, result.rows[0], 201);
          }
          return json(res, {}, 201);
        } catch (e) {
          return json(res, { error: e.message }, 400);
        }
      }

      if (req.method === 'PATCH') {
        const body = await parseBody(req);
        const keys = Object.keys(body);
        const vals = Object.values(body);
        const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
        // Get ID from query params
        const idParam = url.searchParams.get('id');
        const id = idParam?.replace('eq.', '');
        if (!id) return json(res, { error: 'id required for PATCH' }, 400);
        try {
          const result = await pool.query(
            `UPDATE public."${table}" SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`,
            [...vals, id]
          );
          return json(res, result.rows[0] || {});
        } catch (e) {
          return json(res, { error: e.message }, 400);
        }
      }
    }

    // ─── Fallback: 404 ───────────────────────────────────────
    json(res, { error: 'not found', path }, 404);

  } catch (err) {
    console.error('[ERROR]', err);
    json(res, { error: err.message }, 500);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(``);
  console.log(`  ┌──────────────────────────────────────────────┐`);
  console.log(`  │  ProntoClinic Local Auth Server               │`);
  console.log(`  │  http://localhost:${PORT}                       │`);
  console.log(`  │  Postgres: 127.0.0.1:5432/prontoclinic       │`);
  console.log(`  │  Admin: use usuario seedado no banco local     │`);
  console.log(`  └──────────────────────────────────────────────┘`);
  console.log(``);
});
