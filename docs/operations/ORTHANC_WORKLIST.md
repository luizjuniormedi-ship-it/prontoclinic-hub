# Orthanc Worklist bridge

This bridge exports ProntoMedic-owned rows from `dicom_worklist_queue` to the
official Orthanc Worklists REST API. It never connects to or writes to
DataSIGH.

## Coexistence

- Existing DataSIGH/DICOMDS MWL: `datasigh` on port `104` (unchanged).
- ProntoMedic Orthanc MWL: `PRONTOMEDIC` on port `4242`.
- Orthanc administration: loopback-only HTTP on port `8042`.

Do not assign port `104` or AE Title `datasigh` to Orthanc while DICOMDS is
running.

## Required environment

```text
DATABASE_URL=postgresql://...
ORTHANC_URL=http://127.0.0.1:8042
ORTHANC_USERNAME=...
ORTHANC_PASSWORD=...
WORKLIST_TIME_ZONE=America/Sao_Paulo
```

`DATABASE_URL` must use a dedicated worker role. Create its password in the
deployment secret store, never in SQL files or Git:

```sql
CREATE ROLE prontomedic_worklist_worker
  LOGIN BYPASSRLS PASSWORD '<managed-secret>';
GRANT USAGE ON SCHEMA public TO prontomedic_worklist_worker;
GRANT SELECT, UPDATE ON public.dicom_worklist_queue
  TO prontomedic_worklist_worker;
```

Do not reuse the browser application's `authenticated` role. The worker fails
closed at startup unless the connection role has `SUPERUSER`/`BYPASSRLS` and
the two required table privileges.

Run one export attempt:

```text
node scripts/sync-orthanc-worklist.mjs --once
```

Run continuously:

```text
node scripts/sync-orthanc-worklist.mjs
```

Use a Windows service wrapper or the Linux service manager in production. Do
not expose ports `4242` or `8042` directly to the public Internet.

## Acceptance

1. DICOMDS remains listening on port `104`.
2. Orthanc listens on DICOM port `4242` and HTTP port `8042` locally.
3. Creating an imaging order produces one queue row.
4. The bridge records an `orthanc_worklist_id` and marks the row exported.
5. A DCMTK `findscu -W` query returns the same accession and patient.
6. A failed export is retried without changing DataSIGH.
7. Run `scripts/verify-worklist-rls.sql` against an ephemeral migration replay.
