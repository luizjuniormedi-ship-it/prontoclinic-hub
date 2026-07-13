#!/usr/bin/env node

const baseUrl = (process.env.LOCAL_AUTH_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const apiKey = process.env.LOCAL_AUTH_API_KEY || 'ci-local-auth';
const password = process.env.LOCAL_AUTH_TEST_PASSWORD || 'TestPassword123!';
const marker = `ci-medical-record-${Date.now()}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(label, path, { method = 'GET', token, body, expected = 200 } = {}) {
  const headers = { apikey: apiKey };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  console.log(`${label}_http=${response.status}`);
  if (response.status !== expected) {
    throw new Error(`${label}: expected HTTP ${expected}, received ${response.status}: ${text}`);
  }
  return payload;
}

async function login(email) {
  const payload = await request(`login_${email.split('@')[0]}`, '/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email, password },
  });
  assert(payload?.access_token, `login ${email} did not return an access token`);
  return payload.access_token;
}

function medicalRecordPath(params) {
  const search = new URLSearchParams({
    select: 'id,appointment_id,status,signed_at,signed_by,content_hash,evolution,notes',
    ...params,
  });
  return `/rest/v1/medical_records?${search}`;
}

const createPayload = {
  p_patient_id: 991302,
  p_professional_id: 991302,
  p_appointment_id: null,
  p_record_date: '2026-07-22',
  p_anamnesis: 'CI HTTP anamnesis',
  p_evolution: 'CI HTTP draft',
  p_diagnosis: 'CI HTTP diagnosis',
  p_prescription: 'CI HTTP prescription',
  p_vital_signs: { blood_pressure: '120/80' },
  p_notes: marker,
};

const finalizePayload = {
  p_appointment_id: 991302,
  p_record_date: '2026-07-22',
  p_anamnesis: 'CI HTTP final anamnesis',
  p_evolution: 'CI HTTP final evolution',
  p_diagnosis: 'CI HTTP final diagnosis',
  p_prescription: 'CI HTTP final prescription',
  p_vital_signs: { blood_pressure: '118/78' },
  p_notes: `${marker}-finalized`,
};

try {
  await request('medical_record_rpc_without_jwt', '/rest/v1/rpc/create_medical_record_secure', {
    method: 'POST', body: createPayload, expected: 401,
  });

  const doctorToken = await login('doctor@prontomedic.test');
  const receptionToken = await login('recepcao@prontomedic.test');

  await request('medical_record_rpc_without_permission', '/rest/v1/rpc/create_medical_record_secure', {
    method: 'POST', token: receptionToken, body: createPayload, expected: 403,
  });

  for (const method of ['POST', 'PATCH', 'DELETE']) {
    await request(`medical_records_direct_${method.toLowerCase()}`, '/rest/v1/medical_records?id=eq.1', {
      method,
      token: doctorToken,
      body: method === 'DELETE' ? undefined : {},
      expected: 403,
    });
  }

  await request('create_medical_record_secure', '/rest/v1/rpc/create_medical_record_secure', {
    method: 'POST', token: doctorToken, body: createPayload,
  });
  const createdRows = await request(
    'created_medical_record_read',
    medicalRecordPath({ notes: `eq.${marker}` }),
    { token: doctorToken },
  );
  assert(Array.isArray(createdRows) && createdRows.length === 1, 'secure create did not persist exactly one draft');
  const recordId = createdRows[0].id;
  assert(createdRows[0].status === 'draft', 'secure create did not produce a draft record');

  await request('update_medical_record_secure', '/rest/v1/rpc/update_medical_record_secure', {
    method: 'POST',
    token: doctorToken,
    body: {
      p_record_id: recordId,
      p_patch: { evolution: 'CI HTTP updated through can_edit', notes: `${marker}-updated` },
    },
  });
  const updatedRows = await request(
    'updated_medical_record_read',
    medicalRecordPath({ id: `eq.${recordId}` }),
    { token: doctorToken },
  );
  assert(updatedRows.length === 1 && updatedRows[0].evolution === 'CI HTTP updated through can_edit',
    'secure update did not persist the can_edit change');

  await request('sign_medical_record_secure', '/rest/v1/rpc/sign_medical_record_secure', {
    method: 'POST', token: doctorToken, body: { p_record_id: recordId },
  });
  const signedRows = await request(
    'signed_medical_record_read',
    medicalRecordPath({ id: `eq.${recordId}` }),
    { token: doctorToken },
  );
  assert(signedRows.length === 1 && signedRows[0].status === 'signed', 'secure sign did not sign the draft');
  assert(typeof signedRows[0].content_hash === 'string' && signedRows[0].content_hash.length === 64,
    'secure sign did not produce a SHA-256 content hash');

  await request('finalize_medical_attendance_secure', '/rest/v1/rpc/finalize_medical_attendance_secure', {
    method: 'POST', token: doctorToken, body: finalizePayload,
  });
  const finalizedRows = await request(
    'finalized_medical_record_read',
    medicalRecordPath({ appointment_id: 'eq.991302' }),
    { token: doctorToken },
  );
  assert(finalizedRows.length === 1 && finalizedRows[0].status === 'signed',
    'secure finalization did not create exactly one signed record');
  const firstFinalization = finalizedRows[0];

  await request('finalize_medical_attendance_secure_retry', '/rest/v1/rpc/finalize_medical_attendance_secure', {
    method: 'POST', token: doctorToken, body: finalizePayload,
  });
  const retryRows = await request(
    'finalized_medical_record_retry_read',
    medicalRecordPath({ appointment_id: 'eq.991302' }),
    { token: doctorToken },
  );
  assert(retryRows.length === 1, 'finalization retry duplicated the medical record');
  assert(retryRows[0].id === firstFinalization.id, 'finalization retry changed the medical record id');
  assert(retryRows[0].signed_at === firstFinalization.signed_at, 'finalization retry changed the signature timestamp');

  console.log('P0_MEDICAL_RECORD_HTTP_SMOKE=PASS');
} catch (error) {
  console.error(`P0_MEDICAL_RECORD_HTTP_SMOKE=FAIL: ${error.message}`);
  process.exitCode = 1;
}

