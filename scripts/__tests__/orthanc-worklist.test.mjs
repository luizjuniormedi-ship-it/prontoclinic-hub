import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOrthancWorklist,
  compactDate,
  compactTime,
  createBasicAuthorization,
  dicomPersonName,
  nextRetryDate,
} from '../lib/orthanc-worklist.mjs';

test('normalizes DICOM dates and person names', () => {
  assert.equal(compactDate('2026-07-15'), '20260715');
  assert.equal(compactDate('invalid'), undefined);
  assert.equal(dicomPersonName('Maria  da Silva'), 'Maria^da^Silva');
});

test('formats PostgreSQL Date values in the clinic timezone', () => {
  const value = new Date('2026-07-15T12:30:00.000Z');
  assert.equal(compactDate(value), '20260715');
  assert.equal(compactTime(value), '093000');
});

test('builds an Orthanc MWL payload from a queue row', () => {
  const payload = buildOrthancWorklist({
    patient_id: 92795,
    patient_identifier: '92795',
    patient_name: 'Maria da Silva',
    patient_birth_date: '1985-03-22',
    patient_sex: 'F',
    accession_number: 'ACC-2026-001',
    requested_procedure_description: 'RX TORAX PA',
    requested_procedure_id: 'RX-TORAX',
    scheduled_procedure_step_id: 'SPS-001',
    modality_type: 'CR',
    scheduled_station_aetitle: 'ORTHANIC',
    scheduled_datetime: '2026-07-15T09:30:00-03:00',
    referring_physician_name: 'Dr Carlos Souza',
  });

  assert.equal(payload.Tags.PatientID, '92795');
  assert.equal(payload.Tags.PatientName, 'Maria^da^Silva');
  assert.equal(payload.Tags.PatientBirthDate, '19850322');
  assert.equal(payload.Tags.PatientSex, 'F');
  assert.equal(payload.Tags.AccessionNumber, 'ACC-2026-001');
  assert.equal(payload.Tags.ScheduledProcedureStepSequence[0].Modality, 'CR');
  assert.equal(
    payload.Tags.ScheduledProcedureStepSequence[0].ScheduledStationAETitle,
    'ORTHANIC',
  );
  assert.equal(
    payload.Tags.ScheduledProcedureStepSequence[0].ScheduledProcedureStepStartDate,
    '20260715',
  );
});

test('rejects incomplete queue rows', () => {
  assert.throws(() => buildOrthancWorklist({ patient_name: 'Paciente' }), /missing/);
});

test('creates auth headers without exposing the password', () => {
  const header = createBasicAuthorization('orthanc', 'secret');
  assert.match(header, /^Basic /);
  assert.equal(Buffer.from(header.slice(6), 'base64').toString(), 'orthanc:secret');
});

test('uses bounded exponential retry delays', () => {
  const now = new Date('2026-07-15T12:00:00Z');
  assert.equal(nextRetryDate(1, now).toISOString(), '2026-07-15T12:00:10.000Z');
  assert.equal(nextRetryDate(99, now).toISOString(), '2026-07-15T12:05:00.000Z');
});
