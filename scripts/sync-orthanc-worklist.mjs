#!/usr/bin/env node
import pg from 'pg';
import {
  buildOrthancWorklist,
  createBasicAuthorization,
  nextRetryDate,
} from './lib/orthanc-worklist.mjs';

const { Pool } = pg;
const once = process.argv.includes('--once');
const databaseUrl = process.env.DATABASE_URL;
const orthancUrl = (process.env.ORTHANC_URL || 'http://127.0.0.1:8042').replace(/\/$/, '');
const worklistTimeZone = process.env.WORKLIST_TIME_ZONE || 'America/Sao_Paulo';
const pollMs = Math.max(1_000, Number(process.env.WORKLIST_POLL_MS || 5_000));
const allowAnonymous = process.env.ORTHANC_ALLOW_ANONYMOUS === 'true';
const authorization = createBasicAuthorization(
  process.env.ORTHANC_USERNAME,
  process.env.ORTHANC_PASSWORD,
);

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}
if (!authorization && !allowAnonymous) {
  throw new Error(
    'ORTHANC_USERNAME and ORTHANC_PASSWORD are required unless ORTHANC_ALLOW_ANONYMOUS=true',
  );
}

const pool = new Pool({ connectionString: databaseUrl, max: 2 });
let stopping = false;

async function assertDatabaseRole() {
  const result = await pool.query(`
    SELECT
      current_user AS role_name,
      (roles.rolsuper OR roles.rolbypassrls) AS bypasses_rls,
      has_table_privilege(
        current_user,
        'public.dicom_worklist_queue',
        'SELECT'
      ) AS can_select,
      has_table_privilege(
        current_user,
        'public.dicom_worklist_queue',
        'UPDATE'
      ) AS can_update
    FROM pg_roles roles
    WHERE roles.rolname = current_user
  `);
  const role = result.rows[0];
  if (!role?.bypasses_rls || !role?.can_select || !role?.can_update) {
    throw new Error(
      'DATABASE_URL must use a dedicated SUPERUSER/BYPASSRLS role with SELECT and UPDATE on dicom_worklist_queue',
    );
  }
}

async function claimNext() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`
      SELECT *
      FROM public.dicom_worklist_queue
      WHERE status = 'pending'
        AND exported_to_worklist = FALSE
        AND export_state IN ('pending', 'failed')
        AND next_export_at <= NOW()
      ORDER BY scheduled_datetime NULLS LAST, created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);

    const row = result.rows[0];
    if (!row) {
      await client.query('COMMIT');
      return null;
    }

    await client.query(
      `UPDATE public.dicom_worklist_queue
       SET export_state = 'exporting',
           export_claimed_at = NOW(),
           export_attempts = export_attempts + 1,
           last_export_error = NULL
       WHERE id = $1`,
      [row.id],
    );
    await client.query('COMMIT');
    return { ...row, export_attempts: Number(row.export_attempts) + 1 };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function postToOrthanc(row) {
  const headers = { 'content-type': 'application/json' };
  if (authorization) headers.authorization = authorization;

  const response = await fetch(`${orthancUrl}/worklists/create`, {
    method: 'POST',
    headers,
    body: JSON.stringify(buildOrthancWorklist(row, { timeZone: worklistTimeZone })),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Orthanc HTTP ${response.status}: ${body.slice(0, 300)}`);
  }

  const parsed = body ? JSON.parse(body) : {};
  return parsed.ID || parsed.Id || parsed.id || null;
}

async function deleteFromOrthanc(orthancWorklistId) {
  if (!orthancWorklistId) return;
  const headers = {};
  if (authorization) headers.authorization = authorization;
  const response = await fetch(
    `${orthancUrl}/worklists/${encodeURIComponent(orthancWorklistId)}`,
    {
      method: 'DELETE',
      headers,
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok && response.status !== 404) {
    const body = await response.text();
    throw new Error(`Orthanc delete HTTP ${response.status}: ${body.slice(0, 300)}`);
  }
}

async function markSuccess(row, orthancWorklistId) {
  const result = await pool.query(
    `UPDATE public.dicom_worklist_queue
     SET status = 'exported',
         exported_to_worklist = TRUE,
         export_state = 'exported',
         orthanc_worklist_id = $2,
         delete_state = 'not_required',
         last_export_at = NOW(),
         export_claimed_at = NULL,
         last_export_error = NULL
     WHERE id = $1 AND status = 'pending'`,
    [row.id, orthancWorklistId],
  );
  return result.rowCount === 1;
}

async function markFailure(row, error) {
  await pool.query(
    `UPDATE public.dicom_worklist_queue
     SET export_state = 'failed',
         export_claimed_at = NULL,
         last_export_error = $2,
         next_export_at = $3
     WHERE id = $1`,
    [row.id, String(error?.message || error).slice(0, 1_000), nextRetryDate(row.export_attempts)],
  );
}

async function releaseStaleClaims() {
  await pool.query(`
    UPDATE public.dicom_worklist_queue
    SET export_state = 'failed',
        export_claimed_at = NULL,
        last_export_error = 'stale export claim recovered',
        next_export_at = NOW()
    WHERE export_state = 'exporting'
      AND export_claimed_at < NOW() - INTERVAL '5 minutes'
  `);
  await pool.query(`
    UPDATE public.dicom_worklist_queue
    SET delete_state = 'failed',
        export_claimed_at = NULL,
        last_delete_error = 'stale delete claim recovered',
        next_delete_at = NOW()
    WHERE delete_state = 'deleting'
      AND export_claimed_at < NOW() - INTERVAL '5 minutes'
  `);
}

async function claimCancellation() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`
      SELECT *
      FROM public.dicom_worklist_queue
      WHERE status = 'cancelled'
        AND orthanc_worklist_id IS NOT NULL
        AND orthanc_deleted_at IS NULL
        AND delete_state IN ('pending', 'failed')
        AND next_delete_at <= NOW()
      ORDER BY updated_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);
    const row = result.rows[0];
    if (!row) {
      await client.query('COMMIT');
      return null;
    }
    await client.query(
      `UPDATE public.dicom_worklist_queue
       SET delete_state = 'deleting',
           export_claimed_at = NOW(),
           delete_attempts = delete_attempts + 1,
           last_delete_error = NULL
       WHERE id = $1`,
      [row.id],
    );
    await client.query('COMMIT');
    return { ...row, delete_attempts: Number(row.delete_attempts) + 1 };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function processCancellation() {
  const row = await claimCancellation();
  if (!row) return false;
  try {
    await deleteFromOrthanc(row.orthanc_worklist_id);
    await pool.query(
      `UPDATE public.dicom_worklist_queue
       SET delete_state = 'deleted',
           orthanc_deleted_at = NOW(),
           export_claimed_at = NULL,
           last_delete_error = NULL
       WHERE id = $1`,
      [row.id],
    );
    console.log(`WORKLIST_DELETED id=${row.id} accession=${row.accession_number}`);
  } catch (error) {
    await pool.query(
      `UPDATE public.dicom_worklist_queue
       SET delete_state = 'failed',
           export_claimed_at = NULL,
           last_delete_error = $2,
           next_delete_at = $3
       WHERE id = $1`,
      [
        row.id,
        String(error?.message || error).slice(0, 1_000),
        nextRetryDate(row.delete_attempts),
      ],
    );
    console.error(`WORKLIST_DELETE_FAILED id=${row.id} reason=${String(error?.message || error)}`);
  }
  return true;
}

async function processOne() {
  const row = await claimNext();
  if (!row) return false;

  try {
    const orthancWorklistId = await postToOrthanc(row);
    const accepted = await markSuccess(row, orthancWorklistId);
    if (accepted) {
      console.log(`WORKLIST_EXPORTED id=${row.id} accession=${row.accession_number}`);
    } else {
      await deleteFromOrthanc(orthancWorklistId);
      console.log(`WORKLIST_EXPORT_REVERSED id=${row.id} accession=${row.accession_number}`);
    }
  } catch (error) {
    await markFailure(row, error);
    console.error(`WORKLIST_EXPORT_FAILED id=${row.id} reason=${String(error?.message || error)}`);
  }
  return true;
}

async function main() {
  await assertDatabaseRole();
  await releaseStaleClaims();
  do {
    const deleted = await processCancellation();
    const processed = deleted || await processOne();
    if (once) break;
    if (!processed) await new Promise((resolve) => setTimeout(resolve, pollMs));
  } while (!stopping);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopping = true;
  });
}

try {
  await main();
} finally {
  await pool.end();
}
