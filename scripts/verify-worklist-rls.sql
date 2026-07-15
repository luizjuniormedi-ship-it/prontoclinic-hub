-- Runtime proof for the ProntoMedic Worklist tenant boundary.
-- Run only against an ephemeral ProntoMedic PostgreSQL replay. This script
-- never connects to or changes DataSIGH and rolls back all fixture rows.

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO public.companies (id, name)
VALUES
  ('f2000000-0000-4000-8000-000000000001', 'Worklist tenant A'),
  ('f2000000-0000-4000-8000-000000000002', 'Worklist tenant B');

INSERT INTO auth.users (id, email)
VALUES
  ('f2000000-0000-4000-8000-000000000011', 'worklist-a@example.invalid'),
  ('f2000000-0000-4000-8000-000000000012', 'worklist-b@example.invalid');

INSERT INTO public.user_profiles (id, user_id, full_name, company_id, role_name)
VALUES
  ('f2000000-0000-4000-8000-000000000011', 'f2000000-0000-4000-8000-000000000011',
   'Worklist user A', 'f2000000-0000-4000-8000-000000000001', 'admin'),
  ('f2000000-0000-4000-8000-000000000012', 'f2000000-0000-4000-8000-000000000012',
   'Worklist user B', 'f2000000-0000-4000-8000-000000000002', 'admin');

INSERT INTO public.patients (id, company_id, full_name, birth_date, sex)
VALUES
  (980001, 'f2000000-0000-4000-8000-000000000001', 'Worklist patient A', DATE '1980-01-02', 'F'),
  (980002, 'f2000000-0000-4000-8000-000000000002', 'Worklist patient B', DATE '1981-02-03', 'M');

DO $$
DECLARE
  v_table TEXT;
  v_rls BOOLEAN;
  v_force BOOLEAN;
  v_bypass BOOLEAN;
BEGIN
  SELECT rolbypassrls INTO v_bypass
  FROM pg_roles WHERE rolname = 'authenticated';

  IF v_bypass THEN
    RAISE EXCEPTION 'WORKLIST_RLS_FAIL: authenticated has BYPASSRLS';
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'imaging_orders', 'imaging_order_items', 'dicom_worklist_queue'
  ] LOOP
    SELECT c.relrowsecurity, c.relforcerowsecurity
      INTO v_rls, v_force
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = v_table;

    IF NOT v_rls OR NOT v_force THEN
      RAISE EXCEPTION 'WORKLIST_RLS_FAIL: % requires ENABLE and FORCE RLS', v_table;
    END IF;
  END LOOP;
END
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'f2000000-0000-4000-8000-000000000011', true);

INSERT INTO public.imaging_orders (
  id, company_id, patient_id, accession_number, referring_physician_name
) VALUES (
  'f2000000-0000-4000-8000-000000000101',
  'f2000000-0000-4000-8000-000000000001',
  980001,
  'WL-RLS-0001',
  'Dra Teste'
);

DO $$
DECLARE
  v_cross_insert_blocked BOOLEAN := FALSE;
BEGIN
  BEGIN
    INSERT INTO public.imaging_orders (
      company_id, patient_id, accession_number
    ) VALUES (
      'f2000000-0000-4000-8000-000000000002', 980002, 'WL-RLS-CROSS'
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_cross_insert_blocked := TRUE;
  END;

  IF NOT v_cross_insert_blocked THEN
    RAISE EXCEPTION 'WORKLIST_RLS_FAIL: tenant A inserted an order in tenant B';
  END IF;
END
$$;

-- The trigger must replace a spoofed company_id with the parent order scope
-- before the RLS WITH CHECK is evaluated.
INSERT INTO public.imaging_order_items (
  id, imaging_order_id, company_id, exam_name, modality_type,
  scheduled_datetime, requested_procedure_id, scheduled_procedure_step_id
) VALUES (
  'f2000000-0000-4000-8000-000000000201',
  'f2000000-0000-4000-8000-000000000101',
  'f2000000-0000-4000-8000-000000000002',
  'Radiografia de teste', 'DX',
  TIMESTAMPTZ '2026-07-16 09:30:00-03', 'WL-RLS-0001', 'SPS-WL-RLS-0001'
);

INSERT INTO public.dicom_worklist_queue (
  id, imaging_order_item_id, company_id, patient_id, patient_name,
  patient_birth_date, patient_sex, patient_identifier, accession_number,
  requested_procedure_description, requested_procedure_id,
  scheduled_procedure_step_id, modality_type, scheduled_station_aetitle,
  scheduled_datetime, referring_physician_name
) VALUES (
  'f2000000-0000-4000-8000-000000000301',
  'f2000000-0000-4000-8000-000000000201',
  'f2000000-0000-4000-8000-000000000002',
  980001, 'Worklist patient A', DATE '1980-01-02', 'F', '980001',
  'WL-RLS-0001', 'Radiografia de teste', 'WL-RLS-0001',
  'SPS-WL-RLS-0001', 'DX', 'PRONTOMEDIC',
  TIMESTAMPTZ '2026-07-16 09:30:00-03', 'Dra Teste'
);

DO $$
DECLARE
  v_company UUID;
  v_order_status TEXT;
  v_item_status TEXT;
BEGIN
  SELECT company_id, status INTO v_company, v_item_status
  FROM public.imaging_order_items
  WHERE id = 'f2000000-0000-4000-8000-000000000201';

  IF v_company <> 'f2000000-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'WORKLIST_RLS_FAIL: item escaped parent tenant';
  END IF;

  SELECT company_id INTO v_company
  FROM public.dicom_worklist_queue
  WHERE id = 'f2000000-0000-4000-8000-000000000301';

  IF v_company <> 'f2000000-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'WORKLIST_RLS_FAIL: queue escaped parent tenant';
  END IF;

  SELECT status INTO v_order_status
  FROM public.imaging_orders
  WHERE id = 'f2000000-0000-4000-8000-000000000101';

  SELECT status INTO v_item_status
  FROM public.imaging_order_items
  WHERE id = 'f2000000-0000-4000-8000-000000000201';

  IF v_order_status <> 'liberado_worklist' OR v_item_status <> 'liberado_worklist' THEN
    RAISE EXCEPTION 'WORKLIST_RLS_FAIL: queue did not release order/item atomically';
  END IF;
END
$$;

SELECT set_config('request.jwt.claim.sub', 'f2000000-0000-4000-8000-000000000012', true);

DO $$
DECLARE
  v_orders INTEGER;
  v_items INTEGER;
  v_queue INTEGER;
BEGIN
  SELECT count(*) INTO v_orders FROM public.imaging_orders;
  SELECT count(*) INTO v_items FROM public.imaging_order_items;
  SELECT count(*) INTO v_queue FROM public.dicom_worklist_queue;

  IF v_orders <> 0 OR v_items <> 0 OR v_queue <> 0 THEN
    RAISE EXCEPTION
      'WORKLIST_RLS_FAIL: tenant B saw tenant A data orders=% items=% queue=%',
      v_orders, v_items, v_queue;
  END IF;

  RAISE NOTICE
    'WORKLIST_RLS_PASS cross_insert=blocked item_scope=parent queue_scope=parent tenant_b_rows=0';
END
$$;

RESET ROLE;
ROLLBACK;
