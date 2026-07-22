const DICOM_SEX = new Set(['F', 'M', 'O']);

function dateParts(value, timeZone) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
}

export function compactDate(value, timeZone = 'America/Sao_Paulo') {
  if (!value) return undefined;
  const plainDate = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (plainDate) return `${plainDate[1]}${plainDate[2]}${plainDate[3]}`;
  const parts = dateParts(value, timeZone);
  return parts ? `${parts.year}${parts.month}${parts.day}` : undefined;
}

export function compactTime(value, timeZone = 'America/Sao_Paulo') {
  if (!value) return undefined;
  const parts = dateParts(value, timeZone);
  return parts ? `${parts.hour}${parts.minute}${parts.second}` : undefined;
}

export function dicomPersonName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '^')
    .slice(0, 64);
}

export function buildOrthancWorklist(row, { timeZone = 'America/Sao_Paulo' } = {}) {
  if (!row?.patient_name || !row?.accession_number || !row?.modality_type) {
    throw new Error('Worklist item is missing patient, accession or modality');
  }

  const scheduledDate = compactDate(row.scheduled_datetime, timeZone);
  const scheduledTime = compactTime(row.scheduled_datetime, timeZone);
  const sex = String(row.patient_sex || '').toUpperCase();
  const procedureId = row.requested_procedure_id || row.accession_number;
  const stepId = row.scheduled_procedure_step_id || `${row.accession_number}-1`;

  const scheduledStep = {
    Modality: String(row.modality_type).toUpperCase(),
    ScheduledProcedureStepID: String(stepId),
    ScheduledProcedureStepDescription:
      row.requested_procedure_description || String(row.modality_type).toUpperCase(),
  };

  if (row.scheduled_station_aetitle) {
    scheduledStep.ScheduledStationAETitle = row.scheduled_station_aetitle;
  }
  if (row.scheduled_station_name) {
    scheduledStep.ScheduledStationName = row.scheduled_station_name;
  }
  if (scheduledDate) scheduledStep.ScheduledProcedureStepStartDate = scheduledDate;
  if (scheduledTime) scheduledStep.ScheduledProcedureStepStartTime = scheduledTime;

  const tags = {
    SpecificCharacterSet: 'ISO_IR 192',
    PatientID: String(row.patient_identifier || row.patient_id),
    PatientName: dicomPersonName(row.patient_name),
    AccessionNumber: String(row.accession_number),
    RequestedProcedureID: String(procedureId),
    RequestedProcedureDescription: row.requested_procedure_description || '',
    ReferringPhysicianName: dicomPersonName(row.referring_physician_name),
    ScheduledProcedureStepSequence: [scheduledStep],
  };

  const birthDate = compactDate(row.patient_birth_date);
  if (birthDate) tags.PatientBirthDate = birthDate;
  if (DICOM_SEX.has(sex)) tags.PatientSex = sex;

  return { Tags: tags };
}

export function nextRetryDate(attempt, now = new Date()) {
  const boundedAttempt = Math.max(1, Math.min(Number(attempt) || 1, 8));
  const seconds = Math.min(300, 2 ** boundedAttempt * 5);
  return new Date(now.getTime() + seconds * 1000);
}

export function createBasicAuthorization(username, password) {
  if (!username || !password) return undefined;
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}
