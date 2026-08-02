import { createHash, randomBytes, randomUUID } from 'crypto';
import { connect as connectTcp } from 'net';
import { connect as connectTls } from 'tls';

const TOKEN_TYPES = new Set(['invite', 'recovery']);
const DEFAULT_TTL_MS = 60 * 60 * 1000;

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function publicAuthUser(user) {
  return {
    id: user.id,
    email: user.email,
    email_confirmed_at: user.email_confirmed_at ?? null,
    invited_at: user.invited_at ?? null,
    user_metadata: user.raw_user_meta_data ?? {},
  };
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

function appendFragment(url, values) {
  const target = new URL(url);
  target.hash = new URLSearchParams(values).toString();
  return target.toString();
}

export function createWebhookMailProvider({ url, bearerToken, fetchImpl = fetch }) {
  if (!url) throw new Error('LOCAL_AUTH_MAIL_WEBHOOK_URL obrigatorio para o provedor webhook');
  return {
    async send(message) {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {}),
        },
        body: JSON.stringify(message),
      });
      if (!response.ok) throw new Error(`mail provider rejected request (${response.status})`);
    },
  };
}

export function mailProviderFromEnv(env = process.env, fetchImpl = fetch) {
  if (env.LOCAL_AUTH_MAIL_PROVIDER === 'webhook') {
    return createWebhookMailProvider({
      url: env.LOCAL_AUTH_MAIL_WEBHOOK_URL,
      bearerToken: env.LOCAL_AUTH_MAIL_WEBHOOK_TOKEN,
      fetchImpl,
    });
  }
  if (env.LOCAL_AUTH_MAIL_PROVIDER !== 'smtp') {
    throw new Error('LOCAL_AUTH_MAIL_PROVIDER deve ser smtp ou webhook');
  }
  return createSmtpMailProvider({
    host: env.LOCAL_AUTH_SMTP_HOST,
    port: Number(env.LOCAL_AUTH_SMTP_PORT || 587),
    secure: env.LOCAL_AUTH_SMTP_SECURE === 'true',
    username: env.LOCAL_AUTH_SMTP_USERNAME,
    password: env.LOCAL_AUTH_SMTP_PASSWORD,
    from: env.LOCAL_AUTH_MAIL_FROM,
  });
}

function sanitizeHeader(value) {
  const text = String(value ?? '');
  if (/\r|\n/.test(text)) throw new Error('invalid mail header');
  return text;
}

function smtpConversation(socket) {
  let buffer = '';
  let waiter = null;
  socket.setEncoding('utf8');
  const onData = (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\r\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (/^\d{3} /.test(line) && waiter) {
        const { resolve, onError } = waiter;
        waiter = null;
        socket.off('error', onError);
        resolve(line);
      }
    }
  };
  socket.on('data', onData);
  const read = () => new Promise((resolve, reject) => {
    const onError = (error) => {
      waiter = null;
      reject(error);
    };
    waiter = { resolve, reject, onError };
    socket.once('error', onError);
  });
  const command = async (value, accepted) => {
    const responsePromise = read();
    if (value != null) socket.write(`${value}\r\n`);
    const response = await responsePromise;
    if (!accepted.includes(Number(response.slice(0, 3)))) throw new Error(`SMTP command failed (${response.slice(0, 3)})`);
    return response;
  };
  const dispose = () => {
    socket.off('data', onData);
    if (waiter) socket.off('error', waiter.onError);
    waiter = null;
  };
  return { command, dispose };
}

export function createSmtpMailProvider({ host, port = 587, secure = false, username, password, from }) {
  if (!host || !from || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SMTP host, port e remetente validos sao obrigatorios');
  }
  if (Boolean(username) !== Boolean(password)) throw new Error('SMTP usuario e senha devem ser definidos juntos');
  return {
    async send(message) {
      const recipient = sanitizeHeader(message.to);
      const sender = sanitizeHeader(from);
      const subject = message.template === 'invite' ? 'Convite ProntoMedic' : 'Recuperacao de senha ProntoMedic';
      const body = `Use o link abaixo ate ${message.expiresAt}:\r\n\r\n${message.actionUrl}`;
      const payload = [
        `From: ${sender}`, `To: ${recipient}`, `Subject: ${subject}`,
        'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', body,
      ].join('\r\n').replace(/\r\n\./g, '\r\n..');
      let socket = secure
        ? connectTls({ host, port, servername: host, rejectUnauthorized: true })
        : connectTcp({ host, port });
      socket.setTimeout(15000, () => socket.destroy(new Error('SMTP timeout')));
      let smtp = smtpConversation(socket);
      try {
        await smtp.command(null, [220]);
        await smtp.command('EHLO prontomedic.local', [250]);
        if (!secure) {
          await smtp.command('STARTTLS', [220]);
          smtp.dispose();
          socket = connectTls({ socket, servername: host, rejectUnauthorized: true });
          smtp = smtpConversation(socket);
          await smtp.command('EHLO prontomedic.local', [250]);
        }
        if (username) {
          await smtp.command('AUTH LOGIN', [334]);
          await smtp.command(Buffer.from(username).toString('base64'), [334]);
          await smtp.command(Buffer.from(password).toString('base64'), [235]);
        }
        await smtp.command(`MAIL FROM:<${sender}>`, [250]);
        await smtp.command(`RCPT TO:<${recipient}>`, [250, 251]);
        await smtp.command('DATA', [354]);
        await smtp.command(`${payload}\r\n.`, [250]);
        await smtp.command('QUIT', [221]);
      } finally {
        socket.destroy();
      }
    },
  };
}

export async function ensureLocalAuthAdminSchema(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE service_role');
    const result = await client.query(`
      SELECT
        to_regclass('private.local_auth_challenges') IS NOT NULL AS table_installed,
        (SELECT count(*) = 10
           FROM information_schema.columns
          WHERE table_schema = 'private'
            AND table_name = 'local_auth_challenges'
            AND column_name = ANY (ARRAY[
              'id','user_id','token_hash','type','redirect_to','expires_at',
              'consumed_at','session_id','password_updated_at','created_at'
            ])) AS columns_installed,
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'auth' AND table_name = 'users'
                   AND column_name = 'banned_until') AS ban_installed,
        has_table_privilege('service_role', 'private.local_auth_challenges', 'SELECT,INSERT,UPDATE,DELETE') AS challenge_acl,
        EXISTS (SELECT 1 FROM public.prontomedic_deployment_migrations
                 WHERE filename = '20260802183000_local_auth_admin_contract.sql') AS migration_registered
    `);
    await client.query('ROLLBACK');
    const contract = result.rows[0];
    if (!contract?.table_installed || !contract.columns_installed || !contract.ban_installed
      || !contract.challenge_acl || !contract.migration_registered) {
      throw new Error('migration auth-admin ausente ou incompleta');
    }
  } finally {
    client.release();
  }
}

export function createLocalAuthAdmin({
  pool,
  signJwt,
  mailProvider,
  publicAuthUrl,
  ttlMs = DEFAULT_TTL_MS,
  now = () => new Date(),
  randomToken = () => randomBytes(32).toString('base64url'),
  uuid = randomUUID,
}) {
  if (!pool || !signJwt || !mailProvider || !publicAuthUrl) {
    throw new Error('pool, signJwt, mailProvider e publicAuthUrl sao obrigatorios');
  }

  async function persistChallenge(client, { userId, type, redirectTo }) {
    const rawToken = randomToken();
    const expiresAt = new Date(now().getTime() + ttlMs);
    await client.query(
      `INSERT INTO private.local_auth_challenges
         (id, user_id, token_hash, type, redirect_to, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [uuid(), userId, tokenHash(rawToken), type, redirectTo, expiresAt],
    );
    return { rawToken, tokenHash: tokenHash(rawToken), expiresAt };
  }

  async function beginServiceTransaction(client) {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE service_role');
  }

  function verificationUrl(rawToken, type, redirectTo) {
    const url = new URL('/auth/v1/verify', publicAuthUrl);
    url.searchParams.set('token', rawToken);
    url.searchParams.set('type', type);
    url.searchParams.set('redirect_to', redirectTo);
    return url.toString();
  }

  async function sendChallenge({ user, type, redirectTo, challenge }) {
    await mailProvider.send({
      to: user.email,
      template: type,
      expiresAt: challenge.expiresAt.toISOString(),
      actionUrl: verificationUrl(challenge.rawToken, type, redirectTo),
    });
  }

  async function discardChallenge(challenge) {
    const cleanup = await pool.connect();
    try {
      await beginServiceTransaction(cleanup);
      await cleanup.query(
        'DELETE FROM private.local_auth_challenges WHERE token_hash = $1 AND consumed_at IS NULL',
        [challenge.tokenHash],
      );
      await cleanup.query('COMMIT');
    } catch (error) {
      await cleanup.query('ROLLBACK');
      throw error;
    } finally {
      cleanup.release();
    }
  }

  async function invite({ email, data = {}, redirectTo }) {
    const normalized = normalizeEmail(email);
    if (!normalized || !redirectTo) return { status: 400, body: { message: 'Invalid invite payload' } };
    const client = await pool.connect();
    try {
      await beginServiceTransaction(client);
      const existing = await client.query('SELECT id FROM auth.users WHERE lower(email) = $1 FOR UPDATE', [normalized]);
      let user;
      if (existing.rowCount) {
        const existingUser = await client.query('SELECT * FROM auth.users WHERE id = $1', [existing.rows[0].id]);
        user = existingUser.rows[0];
        if (user.email_confirmed_at) {
          await client.query('ROLLBACK');
          return { status: 422, body: { message: 'A user with this email address has already been registered' } };
        }
        await client.query(
          `DELETE FROM private.local_auth_challenges
            WHERE user_id = $1 AND type = 'invite' AND consumed_at IS NULL`,
          [user.id],
        );
      } else {
        const userId = uuid();
        const inserted = await client.query(
          `INSERT INTO auth.users
           (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
         VALUES ($1, $2, NULL, NULL, '{}'::jsonb, $3::jsonb, NOW(), NOW()) RETURNING *`,
          [userId, normalized, JSON.stringify(data ?? {})],
        );
        user = inserted.rows[0];
      }
      const challenge = await persistChallenge(client, { userId: user.id, type: 'invite', redirectTo });
      await client.query('COMMIT');
      try {
        await sendChallenge({ user, type: 'invite', redirectTo, challenge });
      } catch (error) {
        await discardChallenge(challenge);
        throw error;
      }
      return { status: 200, body: publicAuthUser(user) };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function recover({ email, redirectTo }) {
    const normalized = normalizeEmail(email);
    if (!normalized || !redirectTo) return { status: 200, body: {} };
    const client = await pool.connect();
    try {
      await beginServiceTransaction(client);
      const found = await client.query(
        `SELECT u.* FROM auth.users u
          WHERE lower(u.email) = $1
            AND (u.banned_until IS NULL OR u.banned_until <= NOW())
          FOR UPDATE`,
        [normalized],
      );
      if (found.rowCount) {
        await client.query(
          `DELETE FROM private.local_auth_challenges
            WHERE user_id = $1 AND type = 'recovery' AND consumed_at IS NULL`,
          [found.rows[0].id],
        );
        const challenge = await persistChallenge(client, {
          userId: found.rows[0].id,
          type: 'recovery',
          redirectTo,
        });
        await client.query('COMMIT');
        try {
          await sendChallenge({ user: found.rows[0], type: 'recovery', redirectTo, challenge });
        } catch {
          await discardChallenge(challenge);
        }
        return { status: 200, body: {} };
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      // Recovery is intentionally non-enumerating, including provider failures.
    } finally {
      client.release();
    }
    return { status: 200, body: {} };
  }

  async function consume({ token, type, redirectTo }) {
    if (!token || !TOKEN_TYPES.has(type)) return { status: 400, body: { message: 'Invalid token' } };
    const client = await pool.connect();
    try {
      await beginServiceTransaction(client);
      const sessionId = uuid();
      const consumed = await client.query(
        `UPDATE private.local_auth_challenges c
            SET consumed_at = NOW(), session_id = $3
           FROM auth.users u
          WHERE c.token_hash = $1 AND c.type = $2 AND c.user_id = u.id
            AND c.consumed_at IS NULL AND c.expires_at > NOW()
          RETURNING u.*, c.redirect_to`,
        [tokenHash(token), type, sessionId],
      );
      if (!consumed.rowCount) {
        await client.query('ROLLBACK');
        return { status: 400, body: { message: 'Token expired or already used' } };
      }
      const user = consumed.rows[0];
      if (redirectTo && redirectTo !== user.redirect_to) {
        await client.query('ROLLBACK');
        return { status: 400, body: { message: 'Invalid redirect target' } };
      }
      if (type === 'invite') {
        await client.query('UPDATE auth.users SET email_confirmed_at = COALESCE(email_confirmed_at, NOW()), updated_at = NOW() WHERE id = $1', [user.id]);
      }
      const issuedAt = Math.floor(now().getTime() / 1000);
      const refreshToken = uuid();
      const accessToken = signJwt({
        sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated',
        aal: 'aal1', session_id: sessionId, iat: issuedAt, exp: issuedAt + 3600,
        auth_flow: type,
        app_metadata: user.raw_app_meta_data ?? {}, user_metadata: user.raw_user_meta_data ?? {},
      });
      await client.query(
        'INSERT INTO auth.refresh_tokens (token, user_id, session_jti) VALUES ($1, $2, $3)',
        [refreshToken, user.id, sessionId],
      );
      await client.query('COMMIT');
      return {
        status: 302,
        location: appendFragment(user.redirect_to, {
          access_token: accessToken,
          token_type: 'bearer',
          expires_in: '3600',
          refresh_token: refreshToken,
          type,
        }),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  return { invite, recover, consume };
}
