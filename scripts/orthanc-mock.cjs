#!/usr/bin/env node
/**
 * Orthanc PACS Server Mock
 *
 * Simula um servidor Orthanc (DICOM PACS) para desenvolvimento e testes.
 * Implementa os endpoints REST mais comuns usados pelo ProntoClinic Hub.
 *
 * Endpoints mockados:
 *   GET  /system                    -> info do servidor
 *   GET  /system/statistics         -> estatísticas
 *   GET  /patients                  -> lista de pacientes (mock)
 *   GET  /patients/{id}             -> detalhes de paciente
 *   GET  /studies                   -> lista de estudos
 *   GET  /modalities                -> modalidades configuradas
 *   GET  /tools/ping                -> health check
 *   GET  /instances/{id}/file       -> DICOM file (binário mock)
 *   POST /modalities/{name}/query   -> DICOM C-FIND
 *   POST /worklists/create          -> Orthanc Worklists plugin create
 *   GET  /worklists                 -> created worklist IDs
 *   DELETE /worklists/{id}          -> remove a created worklist
 *
 * Uso:
 *   node scripts/orthanc-mock.js [port]
 *
 * Default port: 8042 (padrão Orthanc)
 */

const http = require('http');
const crypto = require('crypto');
const url = require('url');

const PORT = parseInt(process.argv[2] || process.env.ORTHANC_PORT || '8042', 10);
const HOST = process.env.ORTHANC_HOST || '0.0.0.0';

// Banco mock em memória
const mockDB = {
  patients: [
    {
      ID: crypto.randomUUID(),
      MainDicomTags: {
        PatientID: 'PAT001',
        PatientName: 'SANTOS^JOSE^DA^SILVA',
        PatientBirthDate: '19700515',
        PatientSex: 'M',
      },
      Studies: ['study-001', 'study-002'],
    },
    {
      ID: crypto.randomUUID(),
      MainDicomTags: {
        PatientID: 'PAT002',
        PatientName: 'OLIVEIRA^MARIA^APARECIDA',
        PatientBirthDate: '19850322',
        PatientSex: 'F',
      },
      Studies: ['study-003'],
    },
  ],
  studies: [
    {
      ID: 'study-001',
      MainDicomTags: {
        StudyInstanceUID: '1.2.840.113619.2.55.3.604688119.971.1734567890.001',
        StudyID: 'STD001',
        StudyDate: '20260601',
        StudyTime: '143000',
        StudyDescription: 'RX TORAX PA',
        AccessionNumber: 'ACC001',
        ReferringPhysicianName: 'DR^SILVA',
      },
      PatientMainDicomTags: {
        PatientID: 'PAT001',
        PatientName: 'SANTOS^JOSE^DA^SILVA',
      },
      Series: ['series-001'],
    },
    {
      ID: 'study-002',
      MainDicomTags: {
        StudyInstanceUID: '1.2.840.113619.2.55.3.604688119.971.1734567890.002',
        StudyID: 'STD002',
        StudyDate: '20260615',
        StudyTime: '091500',
        StudyDescription: 'USG ABDOMEN TOTAL',
        AccessionNumber: 'ACC002',
      },
      PatientMainDicomTags: {
        PatientID: 'PAT001',
        PatientName: 'SANTOS^JOSE^DA^SILVA',
      },
      Series: ['series-002'],
    },
    {
      ID: 'study-003',
      MainDicomTags: {
        StudyInstanceUID: '1.2.840.113619.2.55.3.604688119.971.1734567890.003',
        StudyID: 'STD003',
        StudyDate: '20260620',
        StudyTime: '110000',
        StudyDescription: 'RM COLUNA LOMBAR',
        AccessionNumber: 'ACC003',
      },
      PatientMainDicomTags: {
        PatientID: 'PAT002',
        PatientName: 'OLIVEIRA^MARIA^APARECIDA',
      },
      Series: ['series-003'],
    },
  ],
  series: [
    {
      ID: 'series-001',
      MainDicomTags: {
        SeriesInstanceUID: '1.2.840.113619.2.55.3.604688119.971.1734567890.001.1',
        SeriesNumber: '1',
        Modality: 'CR',
        SeriesDescription: 'RX PA',
        BodyPartExamined: 'CHEST',
      },
      Instances: ['instance-001', 'instance-002'],
    },
    {
      ID: 'series-002',
      MainDicomTags: {
        SeriesInstanceUID: '1.2.840.113619.2.55.3.604688119.971.1734567890.002.1',
        SeriesNumber: '1',
        Modality: 'US',
        SeriesDescription: 'USG ABDOMEN',
        BodyPartExamined: 'ABDOMEN',
      },
      Instances: ['instance-003'],
    },
    {
      ID: 'series-003',
      MainDicomTags: {
        SeriesInstanceUID: '1.2.840.113619.2.55.3.604688119.971.1734567890.003.1',
        SeriesNumber: '1',
        Modality: 'MR',
        SeriesDescription: 'SAG T1',
        BodyPartExamined: 'LUMBAR SPINE',
      },
      Instances: ['instance-004', 'instance-005'],
    },
  ],
  instances: [
    { ID: 'instance-001', FileSize: 524288, FileUuid: crypto.randomUUID() },
    { ID: 'instance-002', FileSize: 498432, FileUuid: crypto.randomUUID() },
    { ID: 'instance-003', FileSize: 1048576, FileUuid: crypto.randomUUID() },
    { ID: 'instance-004', FileSize: 2097152, FileUuid: crypto.randomUUID() },
    { ID: 'instance-005', FileSize: 1984000, FileUuid: crypto.randomUUID() },
  ],
};

// Worklist mock (MWL)
const worklist = [
  {
    AccessionNumber: 'WL001',
    PatientID: 'PAT001',
    PatientName: 'SANTOS^JOSE^DA^SILVA',
    PatientBirthDate: '19700515',
    PatientSex: 'M',
    StudyInstanceUID: '1.2.840.113619.2.55.3.604688119.971.1734567890.WL001',
    RequestedProcedureDescription: 'RX TORAX PA',
    RequestedProcedureID: 'RP001',
    Modality: 'CR',
    ScheduledProcedureStepSequence: [
      {
        ScheduledProcedureStepStartDate: '20260625',
        ScheduledProcedureStepStartTime: '080000',
        ScheduledProcedureStepDescription: 'RX TORAX PA',
        ScheduledStationAETitle: 'MOCK_ORTHANC',
      },
    ],
  },
  {
    AccessionNumber: 'WL002',
    PatientID: 'PAT002',
    PatientName: 'OLIVEIRA^MARIA^APARECIDA',
    PatientBirthDate: '19850322',
    PatientSex: 'F',
    StudyInstanceUID: '1.2.840.113619.2.55.3.604688119.971.1734567890.WL002',
    RequestedProcedureDescription: 'USG ABDOMEN',
    RequestedProcedureID: 'RP002',
    Modality: 'US',
    ScheduledProcedureStepSequence: [
      {
        ScheduledProcedureStepStartDate: '20260625',
        ScheduledProcedureStepStartTime: '093000',
        ScheduledProcedureStepDescription: 'USG ABDOMEN TOTAL',
        ScheduledStationAETitle: 'MOCK_ORTHANC',
      },
    ],
  },
];

// Worklists created through the official Worklists plugin REST contract.
const createdWorklists = new Map();

// Stats
const stats = {
  startTime: new Date().toISOString(),
  requestsServed: 0,
  errors: 0,
};

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Server': 'OrthancMock/1.0.0',
};

function sendJSON(res, code, body) {
  stats.requestsServed++;
  res.writeHead(code, JSON_HEADERS);
  res.end(JSON.stringify(body, null, 2));
}

function sendError(res, code, msg) {
  stats.errors++;
  stats.requestsServed++;
  res.writeHead(code, {
    ...JSON_HEADERS,
    'Content-Type': 'application/json',
  });
  res.end(JSON.stringify({
    HttpStatus: code,
    HttpError: msg,
    Message: msg,
    Method: 'GET',
  }));
}

function sendText(res, code, text) {
  stats.requestsServed++;
  res.writeHead(code, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Server': 'OrthancMock/1.0.0',
  });
  res.end(text);
}

function logRequest(req) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${req.method} ${req.url}`);
}

const server = http.createServer((req, res) => {
  logRequest(req);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, JSON_HEADERS);
    res.end();
    return;
  }

  const parsed = url.parse(req.url, true);
  const path = parsed.pathname.replace(/\/+$/, '') || '/';
  const query = parsed.query;

  // === System ===
  if (path === '/system' && req.method === 'GET') {
    return sendJSON(res, 200, {
      Name: 'OrthancMock',
      Version: '1.12.4-mock',
      ApiVersion: 22,
      DatabaseVersion: 6,
      DicomAet: 'MOCK_ORTHANC',
      DicomPort: 4242,
      HttpPort: PORT,
      IsHttpServerSecure: false,
      StorageCompression: false,
      MaximumStorageSize: 0,
      MaximumPatientCount: 0,
      PluginsEnabled: false,
      OverwriteInstances: false,
      DefaultEncoding: 'Utf8',
      JobsHistorySize: 10,
      SaveJobs: true,
      TotalDiskSize: 6291456,
      TotalUncompressedSize: 6291456,
      TotalCompressedSize: 6291456,
      Uptime: Math.floor((Date.now() - new Date(stats.startTime).getTime()) / 1000),
    });
  }

  if (path === '/system/statistics' && req.method === 'GET') {
    return sendJSON(res, 200, {
      CountInstances: mockDB.instances.length,
      CountSeries: mockDB.series.length,
      CountStudies: mockDB.studies.length,
      CountPatients: mockDB.patients.length,
      TotalDiskSize: 6291456,
      TotalUncompressedSize: 6291456,
      TotalCompressedSize: 6291456,
    });
  }

  if (path === '/tools/ping' && req.method === 'GET') {
    return sendText(res, 200, 'OrthancMock ready\n');
  }

  if (path === '/tools/reset' && req.method === 'POST') {
    stats.requestsServed = 0;
    stats.errors = 0;
    return sendText(res, 200, 'Reset done\n');
  }

  // === Patients ===
  if (path === '/patients' && req.method === 'GET') {
    if (query.expand === 'true') {
      return sendJSON(res, 200, mockDB.patients);
    }
    return sendJSON(res, 200, mockDB.patients.map(p => p.ID));
  }

  const patientMatch = path.match(/^\/patients\/([^\/]+)$/);
  if (patientMatch && req.method === 'GET') {
    const patient = mockDB.patients.find(p => p.ID === patientMatch[1] || p.MainDicomTags.PatientID === patientMatch[1]);
    if (!patient) return sendError(res, 404, 'Patient not found');
    return sendJSON(res, 200, patient);
  }

  const patientStudiesMatch = path.match(/^\/patients\/([^\/]+)\/studies$/);
  if (patientStudiesMatch && req.method === 'GET') {
    const patient = mockDB.patients.find(p => p.ID === patientStudiesMatch[1] || p.MainDicomTags.PatientID === patientStudiesMatch[1]);
    if (!patient) return sendError(res, 404, 'Patient not found');
    const studies = mockDB.studies.filter(s => s.PatientMainDicomTags.PatientID === patient.MainDicomTags.PatientID);
    return sendJSON(res, 200, studies.map(s => s.ID));
  }

  // === Studies ===
  if (path === '/studies' && req.method === 'GET') {
    if (query.expand === 'true') return sendJSON(res, 200, mockDB.studies);
    return sendJSON(res, 200, mockDB.studies.map(s => s.ID));
  }

  const studyMatch = path.match(/^\/studies\/([^\/]+)$/);
  if (studyMatch && req.method === 'GET') {
    const study = mockDB.studies.find(s => s.ID === studyMatch[1]);
    if (!study) return sendError(res, 404, 'Study not found');
    return sendJSON(res, 200, study);
  }

  const studySeriesMatch = path.match(/^\/studies\/([^\/]+)\/series$/);
  if (studySeriesMatch && req.method === 'GET') {
    const study = mockDB.studies.find(s => s.ID === studySeriesMatch[1]);
    if (!study) return sendError(res, 404, 'Study not found');
    return sendJSON(res, 200, study.Series);
  }

  // === Series ===
  if (path === '/series' && req.method === 'GET') {
    if (query.expand === 'true') return sendJSON(res, 200, mockDB.series);
    return sendJSON(res, 200, mockDB.series.map(s => s.ID));
  }

  const seriesMatch = path.match(/^\/series\/([^\/]+)$/);
  if (seriesMatch && req.method === 'GET') {
    const series = mockDB.series.find(s => s.ID === seriesMatch[1]);
    if (!series) return sendError(res, 404, 'Series not found');
    return sendJSON(res, 200, series);
  }

  const seriesInstancesMatch = path.match(/^\/series\/([^\/]+)\/instances$/);
  if (seriesInstancesMatch && req.method === 'GET') {
    const series = mockDB.series.find(s => s.ID === seriesInstancesMatch[1]);
    if (!series) return sendError(res, 404, 'Series not found');
    return sendJSON(res, 200, series.Instances);
  }

  // === Instances ===
  if (path === '/instances' && req.method === 'GET') {
    if (query.expand === 'true') return sendJSON(res, 200, mockDB.instances);
    return sendJSON(res, 200, mockDB.instances.map(i => i.ID));
  }

  const instanceMatch = path.match(/^\/instances\/([^\/]+)$/);
  if (instanceMatch && req.method === 'GET') {
    const instance = mockDB.instances.find(i => i.ID === instanceMatch[1]);
    if (!instance) return sendError(res, 404, 'Instance not found');
    return sendJSON(res, 200, instance);
  }

  const instanceFileMatch = path.match(/^\/instances\/([^\/]+)\/file$/);
  if (instanceFileMatch && req.method === 'GET') {
    // Retorna um DICOM binário mock (1024 bytes com DICM magic)
    const dicom = Buffer.alloc(1024);
    dicom.write('DICM', 128); // Preamble + magic
    dicom.write('MockDicomFile\n', 132, 'ascii');
    dicom.write('Generated by OrthancMock for ProntoClinic Hub\n', 148, 'ascii');
    res.writeHead(200, {
      'Content-Type': 'application/dicom',
      'Content-Length': dicom.length,
      'Access-Control-Allow-Origin': '*',
    });
    return res.end(dicom);
  }

  const instanceTagsMatch = path.match(/^\/instances\/([^\/]+)\/tags$/);
  if (instanceTagsMatch && req.method === 'GET') {
    return sendJSON(res, 200, {
      '0010,0010': { Name: 'PatientName', Value: 'MOCK^PATIENT' },
      '0010,0020': { Name: 'PatientID', Value: 'MOCK001' },
      '0008,0060': { Name: 'Modality', Value: 'CR' },
    });
  }

  // === Modalities (DICOM peers) ===
  if (path === '/modalities' && req.method === 'GET') {
    return sendJSON(res, 200, ['mock-local', 'sigh-pacs']);
  }

  // === Modality worklist (C-FIND MWL) ===
  if (path === '/modalities/mock-local/worklist' && req.method === 'GET') {
    let result = worklist;
    if (query.PatientID) {
      result = result.filter(w => w.PatientID === query.PatientID);
    }
    if (query.Modality) {
      result = result.filter(w => w.Modality === query.Modality);
    }
    return sendJSON(res, 200, result);
  }

  if (path === '/modalities/mock-local/query' && req.method === 'POST') {
    // C-FIND query mock
    return sendJSON(res, 200, mockDB.studies);
  }

  // === Official Orthanc Worklists plugin REST contract ===
  if (path === '/worklists' && req.method === 'GET') {
    return sendJSON(res, 200, Array.from(createdWorklists.keys()));
  }

  if (path === '/worklists/create' && req.method === 'POST') {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const id = crypto.randomUUID();
        createdWorklists.set(id, payload);
        sendJSON(res, 200, { ID: id, Path: `/worklists/${id}` });
      } catch {
        sendError(res, 400, 'Invalid worklist JSON');
      }
    });
    return;
  }

  const worklistMatch = path.match(/^\/worklists\/([^\/]+)$/);
  if (worklistMatch && req.method === 'GET') {
    const item = createdWorklists.get(worklistMatch[1]);
    if (!item) return sendError(res, 404, 'Worklist not found');
    return sendJSON(res, 200, item);
  }

  if (worklistMatch && req.method === 'DELETE') {
    if (!createdWorklists.delete(worklistMatch[1])) {
      return sendError(res, 404, 'Worklist not found');
    }
    return sendText(res, 200, 'Worklist deleted\n');
  }

  // === Lookup (search) ===
  if (path === '/tools/lookup' && req.method === 'POST') {
    return sendJSON(res, 200, mockDB.studies.map(s => s.ID));
  }

  if (path === '/tools/find' && req.method === 'POST') {
    return sendJSON(res, 200, mockDB.studies);
  }

  // === Stats endpoint (custom) ===
  if (path === '/_mock/stats' && req.method === 'GET') {
    return sendJSON(res, 200, {
      ...stats,
      uptime: Math.floor((Date.now() - new Date(stats.startTime).getTime()) / 1000),
      patientCount: mockDB.patients.length,
      studyCount: mockDB.studies.length,
      seriesCount: mockDB.series.length,
      instanceCount: mockDB.instances.length,
    });
  }

  // 404 fallback
  sendError(res, 404, `Unknown endpoint: ${req.method} ${path}`);
});

server.listen(PORT, HOST, () => {
  console.log(`[OrthancMock] Listening on http://${HOST}:${PORT}`);
  console.log(`[OrthancMock] Endpoints disponíveis:`);
  console.log(`  GET  http://localhost:${PORT}/system`);
  console.log(`  GET  http://localhost:${PORT}/system/statistics`);
  console.log(`  GET  http://localhost:${PORT}/tools/ping`);
  console.log(`  GET  http://localhost:${PORT}/patients?expand=true`);
  console.log(`  GET  http://localhost:${PORT}/studies?expand=true`);
  console.log(`  GET  http://localhost:${PORT}/series?expand=true`);
  console.log(`  GET  http://localhost:${PORT}/instances`);
  console.log(`  GET  http://localhost:${PORT}/modalities`);
  console.log(`  GET  http://localhost:${PORT}/_mock/stats`);
  console.log(`\n[OrthancMock] Para parar: Ctrl+C`);
});

process.on('SIGINT', () => {
  console.log(`\n[OrthancMock] Shutting down. Stats: ${stats.requestsServed} requests, ${stats.errors} errors`);
  server.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
