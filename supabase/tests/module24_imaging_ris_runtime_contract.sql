-- M24 authenticated two-tenant replay. Disposable database only.
DO $guard$
BEGIN
  IF current_database() !~ '^prontomedic_reception_[a-z0-9_]+$' THEN
    RAISE EXCEPTION 'M24 runtime contract is restricted to disposable reception databases';
  END IF;
END;
$guard$;

BEGIN;

INSERT INTO public.companies(id, name, cnpj, lg_ativo) VALUES
  ('00000000-0000-4000-8000-000000000241', 'M24 Tenant A', '00000000000241', TRUE),
  ('00000000-0000-4000-8000-000000000242', 'M24 Tenant B', '00000000000242', TRUE);
INSERT INTO public.units(id, company_id, cd_codigo, ds_nome, lg_principal, lg_ativo) VALUES
  (24001, '00000000-0000-4000-8000-000000000241', 'M24A', 'M24 Unit A', TRUE, TRUE),
  (24002, '00000000-0000-4000-8000-000000000242', 'M24B', 'M24 Unit B', TRUE, TRUE);

INSERT INTO auth.users(id, email, encrypted_password, email_confirmed_at) VALUES
  ('00000000-0000-4000-8000-000000002401', 'm24-admin-a@example.invalid', 'synthetic', NOW()),
  ('00000000-0000-4000-8000-000000002402', 'm24-admin-b@example.invalid', 'synthetic', NOW());
INSERT INTO public.user_profiles(
  id, user_id, full_name, email, role_name, company_id, primary_unit_id, lg_ativo
) VALUES
  ('00000000-0000-4000-8000-000000002401', '00000000-0000-4000-8000-000000002401', 'M24 Admin A', 'm24-admin-a@example.invalid', 'admin', '00000000-0000-4000-8000-000000000241', 24001, TRUE),
  ('00000000-0000-4000-8000-000000002402', '00000000-0000-4000-8000-000000002402', 'M24 Admin B', 'm24-admin-b@example.invalid', 'admin', '00000000-0000-4000-8000-000000000242', 24002, TRUE);
INSERT INTO public.memberships(id, user_id, company_id, status) VALUES
  ('00000000-0000-4000-8000-000000002451', '00000000-0000-4000-8000-000000002401', '00000000-0000-4000-8000-000000000241', 'active'),
  ('00000000-0000-4000-8000-000000002452', '00000000-0000-4000-8000-000000002402', '00000000-0000-4000-8000-000000000242', 'active');
INSERT INTO public.membership_roles(membership_id, role_id)
SELECT fixture.membership_id, role_record.id
FROM (VALUES
  ('00000000-0000-4000-8000-000000002451'::UUID),
  ('00000000-0000-4000-8000-000000002452'::UUID)
) AS fixture(membership_id)
CROSS JOIN (SELECT id FROM public.roles WHERE name = 'admin') AS role_record;
INSERT INTO public.membership_units(membership_id, unit_id) VALUES
  ('00000000-0000-4000-8000-000000002451', 24001),
  ('00000000-0000-4000-8000-000000002452', 24002);
INSERT INTO public.application_devices(
  id, user_id, company_id, unit_id, client_device_id, display_name
) VALUES
  ('00000000-0000-4000-8000-000000002461', '00000000-0000-4000-8000-000000002401', '00000000-0000-4000-8000-000000000241', 24001, '00000000-0000-4000-8000-000000002471', 'M24 A device'),
  ('00000000-0000-4000-8000-000000002462', '00000000-0000-4000-8000-000000002402', '00000000-0000-4000-8000-000000000242', 24002, '00000000-0000-4000-8000-000000002472', 'M24 B device');
INSERT INTO public.application_sessions(
  id, user_id, company_id, unit_id, device_id, gotrue_session_id,
  idle_expires_at, absolute_expires_at
) VALUES
  ('00000000-0000-4000-8000-000000002471', '00000000-0000-4000-8000-000000002401', '00000000-0000-4000-8000-000000000241', 24001, '00000000-0000-4000-8000-000000002461', '00000000-0000-4000-8000-000000002471', NOW() + INTERVAL '30 minutes', NOW() + INTERVAL '12 hours'),
  ('00000000-0000-4000-8000-000000002472', '00000000-0000-4000-8000-000000002402', '00000000-0000-4000-8000-000000000242', 24002, '00000000-0000-4000-8000-000000002462', '00000000-0000-4000-8000-000000002472', NOW() + INTERVAL '30 minutes', NOW() + INTERVAL '12 hours');
INSERT INTO public.user_access_context(user_id, session_id, membership_id, role_id, unit_id)
SELECT fixture.user_id, fixture.session_id, fixture.membership_id, role_record.id, fixture.unit_id
FROM (VALUES
  ('00000000-0000-4000-8000-000000002401'::UUID, '00000000-0000-4000-8000-000000002471'::UUID, '00000000-0000-4000-8000-000000002451'::UUID, 24001),
  ('00000000-0000-4000-8000-000000002402'::UUID, '00000000-0000-4000-8000-000000002472'::UUID, '00000000-0000-4000-8000-000000002452'::UUID, 24002)
) AS fixture(user_id, session_id, membership_id, unit_id)
CROSS JOIN (SELECT id FROM public.roles WHERE name = 'admin') AS role_record;
INSERT INTO public.role_permissions(
  company_id, role_id, module, can_view, can_create, can_edit, can_delete, can_export
)
SELECT company_id, role_record.id, module, TRUE, TRUE, TRUE, FALSE, TRUE
FROM (VALUES
  ('00000000-0000-4000-8000-000000000241'::UUID, 'dicom'),
  ('00000000-0000-4000-8000-000000000241'::UUID, 'worklist'),
  ('00000000-0000-4000-8000-000000000242'::UUID, 'dicom'),
  ('00000000-0000-4000-8000-000000000242'::UUID, 'worklist')
) AS fixture(company_id, module)
CROSS JOIN (SELECT id FROM public.roles WHERE name = 'admin') AS role_record
ON CONFLICT (company_id, role_id, module) DO UPDATE
SET can_view = TRUE,
    can_create = TRUE,
    can_edit = TRUE,
    can_export = TRUE;

INSERT INTO public.patients(id, company_id, full_name, cpf, lg_ativo) VALUES
  (24001, '00000000-0000-4000-8000-000000000241', 'M24 Patient A', '00000000241', TRUE),
  (24002, '00000000-0000-4000-8000-000000000242', 'M24 Patient B', '00000000242', TRUE);
INSERT INTO public.professionals(id, company_id, full_name, specialty, lg_ativo) VALUES
  (24001, '00000000-0000-4000-8000-000000000241', 'M24 Doctor A', 'Radiologia', TRUE),
  (24002, '00000000-0000-4000-8000-000000000242', 'M24 Doctor B', 'Radiologia', TRUE);
INSERT INTO public.appointments(
  id, company_id, unit_id, patient_id, professional_id,
  appointment_date, start_time, end_time, status, notes
) VALUES
  (24001, '00000000-0000-4000-8000-000000000241', 24001, 24001, 24001, CURRENT_DATE, '08:00', '08:30', 'scheduled', 'M24 A'),
  (24002, '00000000-0000-4000-8000-000000000242', 24002, 24002, 24002, CURRENT_DATE, '09:00', '09:30', 'scheduled', 'M24 B');
UPDATE public.appointments
SET scheduled_at = (appointment_date + start_time)::TIMESTAMP AT TIME ZONE
  CASE id WHEN 24001 THEN 'America/Sao_Paulo' ELSE 'America/Manaus' END
WHERE id IN (24001, 24002);
INSERT INTO public.imaging_orders(
  id, company_id, unit_id, patient_id, appointment_id,
  requesting_physician_id, clinical_indication, priority,
  accession_number, status, created_by
) VALUES
  ('00000000-0000-4000-8000-000000002411', '00000000-0000-4000-8000-000000000241', 24001, 24001, 24001, 24001, 'M24 A', 'normal', 'M24ACC-A', 'liberado_worklist', '00000000-0000-4000-8000-000000002401'),
  ('00000000-0000-4000-8000-000000002412', '00000000-0000-4000-8000-000000000242', 24002, 24002, 24002, 24002, 'M24 B', 'normal', 'M24ACC-B', 'liberado_worklist', '00000000-0000-4000-8000-000000002402');
INSERT INTO public.imaging_order_items(
  id, company_id, unit_id, imaging_order_id, exam_name, modality_type,
  requested_procedure_id, scheduled_procedure_step_id, station_aetitle,
  scheduled_datetime, status
) VALUES
  ('00000000-0000-4000-8000-000000002421', '00000000-0000-4000-8000-000000000241', 24001, '00000000-0000-4000-8000-000000002411', 'M24 CT A', 'CT', 'M24-RP-A', 'M24-SPS-A', 'M24AE', NOW(), 'liberado_worklist'),
  ('00000000-0000-4000-8000-000000002422', '00000000-0000-4000-8000-000000000242', 24002, '00000000-0000-4000-8000-000000002412', 'M24 CT B', 'CT', 'M24-RP-B', 'M24-SPS-B', 'M24BE', NOW(), 'liberado_worklist');
INSERT INTO public.dicom_worklist_queue(
  id, company_id, unit_id, imaging_order_item_id, patient_id, patient_name,
  patient_identifier, accession_number, requested_procedure_description,
  requested_procedure_id, scheduled_procedure_step_id, modality_type,
  scheduled_station_aetitle, scheduled_datetime, status, appointment_id,
  idempotency_key
) VALUES
  ('00000000-0000-4000-8000-000000002431', '00000000-0000-4000-8000-000000000241', 24001, '00000000-0000-4000-8000-000000002421', 24001, 'M24 Patient A', 'M24-P-A', 'M24ACC-A', 'M24 CT A', 'M24-RP-A', 'M24-SPS-A', 'CT', 'M24AE', NOW(), 'exported', 24001, 'm24-wl-a'),
  ('00000000-0000-4000-8000-000000002432', '00000000-0000-4000-8000-000000000242', 24002, '00000000-0000-4000-8000-000000002422', 24002, 'M24 Patient B', 'M24-P-B', 'M24ACC-B', 'M24 CT B', 'M24-RP-B', 'M24-SPS-B', 'CT', 'M24BE', NOW(), 'exported', 24002, 'm24-wl-b');
INSERT INTO public.imaging_order_items(
  id, company_id, unit_id, imaging_order_id, exam_name, modality_type,
  requested_procedure_id, scheduled_procedure_step_id, station_aetitle,
  scheduled_datetime, status
) VALUES (
  '00000000-0000-4000-8000-000000002423', '00000000-0000-4000-8000-000000000241', 24001,
  '00000000-0000-4000-8000-000000002411', 'M24 CT A second', 'CT',
  'M24-RP-A2', 'M24-SPS-A2', 'M24AE', NOW(), 'liberado_worklist'
);
INSERT INTO public.dicom_worklist_queue(
  id, company_id, unit_id, imaging_order_item_id, patient_id, patient_name,
  patient_identifier, accession_number, requested_procedure_description,
  requested_procedure_id, scheduled_procedure_step_id, modality_type,
  scheduled_station_aetitle, scheduled_datetime, status, appointment_id,
  idempotency_key
) VALUES (
  '00000000-0000-4000-8000-000000002433', '00000000-0000-4000-8000-000000000241', 24001,
  '00000000-0000-4000-8000-000000002423', 24001, 'M24 Patient A', 'M24-P-A',
  'M24ACC-A', 'M24 CT A second', 'M24-RP-A2', 'M24-SPS-A2', 'CT', 'M24AE',
  NOW(), 'exported', 24001, 'm24-wl-a2'
);
INSERT INTO public.dicom_nodes(
  id, company_id, unit_id, name, node_kind, aetitle, dicom_host, dicom_port,
  is_default, is_active
) VALUES (
  '00000000-0000-4000-8000-000000002441', '00000000-0000-4000-8000-000000000241',
  24001, 'M24 PACS A', 'pacs', 'M24PACS', '127.0.0.1', 4242, TRUE, TRUE
);
INSERT INTO public.dicom_exams(
  id, company_id, unit_id, cd_dicom_exame, cd_appointment, cd_patient,
  ds_patient_name, ds_modality, ds_status
) VALUES
  (24001, '00000000-0000-4000-8000-000000000241', 24001, '1.2.826.0.1.3680043.24.1', 24001, 24001, 'M24 Patient A', 'CT', 'LAUDADO'),
  (24002, '00000000-0000-4000-8000-000000000242', 24002, '1.2.826.0.1.3680043.24.2', 24002, 24002, 'M24 Patient B', 'CT', 'LAUDADO');

SET LOCAL ROLE app_prontomedic;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000002401';
SET LOCAL request.jwt.claim.role = 'authenticated';
SET LOCAL request.jwt.claim.company_id = '00000000-0000-4000-8000-000000000241';
SET LOCAL request.jwt.claim.unit_id = '24001';
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000002401","company_id":"00000000-0000-4000-8000-000000000241","unit_id":24001,"session_id":"00000000-0000-4000-8000-000000002471","role":"authenticated","aal":"aal2"}';

DO $tenant_a$
DECLARE
  v_result JSONB;
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM public.get_dicom_exam_by_appointment(24001);
  IF v_count <> 1 THEN RAISE EXCEPTION 'M24 own DICOM exam was not readable'; END IF;
  SELECT COUNT(*) INTO v_count FROM public.get_dicom_exam_by_appointment(24002);
  IF v_count <> 0 THEN RAISE EXCEPTION 'M24 cross-tenant DICOM exam leaked'; END IF;

  BEGIN
    PERFORM public.m24_receive_pacs_study_secure(
      'M24ACC-A', '1.2.826.0.1.3680043.24.99', CURRENT_DATE, NULL,
      'CT', 'M24AE', NULL, NULL
    );
    RAISE EXCEPTION 'M24 ambiguous accession was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'M24 ambiguous accession was accepted' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%ScheduledProcedureStepID is required%' THEN RAISE; END IF;
  END;

  v_result := public.m24_receive_pacs_study_secure(
    'M24ACC-A',
    '1.2.826.0.1.3680043.24.1', CURRENT_DATE, '081500', 'CT', 'M24AE',
    'M24-SPS-A', '00000000-0000-4000-8000-000000002441'
  );
  IF (v_result->>'company_id')::UUID <> '00000000-0000-4000-8000-000000000241'
     OR (v_result->>'unit_id')::INTEGER <> 24001
     OR (v_result->>'idempotent')::BOOLEAN THEN
    RAISE EXCEPTION 'M24 first ingest did not derive scope/non-idempotent result: %', v_result;
  END IF;

  v_result := public.m24_receive_pacs_study_secure(
    'M24ACC-A',
    '1.2.826.0.1.3680043.24.1', CURRENT_DATE, '081500', 'CT', 'M24AE',
    'M24-SPS-A', '00000000-0000-4000-8000-000000002441'
  );
  IF NOT (v_result->>'idempotent')::BOOLEAN THEN
    RAISE EXCEPTION 'M24 repeated ingest was not idempotent: %', v_result;
  END IF;

  BEGIN
    PERFORM public.m24_receive_pacs_study_secure(
      'M24ACC-A',
      '1.2.826.0.1.3680043.24.1', CURRENT_DATE, '081501', 'MR', 'M24OTHER',
      'M24-SPS-A', '00000000-0000-4000-8000-000000002441'
    );
    RAISE EXCEPTION 'M24 divergent PACS replay was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'M24 divergent PACS replay was accepted' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%replay payload differs from canonical study%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.m24_receive_pacs_study_secure(
      'M24ACC-B',
      '1.2.826.0.1.3680043.24.2', CURRENT_DATE, NULL, 'CT', 'M24BE', 'M24-SPS-B', NULL
    );
    RAISE EXCEPTION 'M24 cross-tenant worklist ingest was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'M24 cross-tenant worklist ingest was accepted' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%Worklist item not found in active scope%' THEN RAISE; END IF;
  END;
END;
$tenant_a$;

RESET ROLE;
DO $ingest_effects$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM public.pacs_studies
  WHERE study_instance_uid = '1.2.826.0.1.3680043.24.1';
  IF v_count <> 1 THEN RAISE EXCEPTION 'M24 PACS ingest duplicated study'; END IF;
  SELECT COUNT(*) INTO v_count FROM public.reports
  WHERE study_instance_uid = '1.2.826.0.1.3680043.24.1';
  IF v_count <> 1 THEN RAISE EXCEPTION 'M24 PACS ingest did not create one canonical report'; END IF;
END;
$ingest_effects$;
SELECT set_config('app.report_signing_rpc', '1', TRUE);
UPDATE public.reports
SET status = 'liberado', signed_at = NOW(), released_at = NOW(),
    signed_by_user_id = '00000000-0000-4000-8000-000000002401',
    signed_by_name = 'M24 Admin A', signed_by_crm = 'CRM-M24'
WHERE company_id = '00000000-0000-4000-8000-000000000241'
  AND study_instance_uid = '1.2.826.0.1.3680043.24.1';
SELECT set_config('app.report_signing_rpc', '', TRUE);
SET LOCAL ROLE app_prontomedic;

DO $publish$
DECLARE
  v_result JSONB;
BEGIN
  v_result := public.publish_dicom_report(24001, TRUE);
  IF v_result->>'status' <> 'entregue' THEN
    RAISE EXCEPTION 'M24 canonical report was not delivered: %', v_result;
  END IF;
  PERFORM public.publish_dicom_report(24001, TRUE);
END;
$publish$;

RESET ROLE;
DO $publish_effects$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM public.report_delivery_logs AS delivery
  JOIN public.reports AS report ON report.id = delivery.report_id
  WHERE report.study_instance_uid = '1.2.826.0.1.3680043.24.1';
  IF v_count <> 1 THEN RAISE EXCEPTION 'M24 publication was not idempotent'; END IF;
END;
$publish_effects$;

SET LOCAL ROLE app_prontomedic;

SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000002402';
SET LOCAL request.jwt.claim.company_id = '00000000-0000-4000-8000-000000000242';
SET LOCAL request.jwt.claim.unit_id = '24002';
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000002402","company_id":"00000000-0000-4000-8000-000000000242","unit_id":24002,"session_id":"00000000-0000-4000-8000-000000002472","role":"authenticated","aal":"aal2"}';

DO $tenant_b$
BEGIN
  BEGIN
    PERFORM public.publish_dicom_report(24001, TRUE);
    RAISE EXCEPTION 'M24 cross-tenant report publish was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'M24 cross-tenant report publish was accepted' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%DICOM exam not found in active scope%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.m24_receive_pacs_study_secure(
      'M24ACC-B',
      '1.2.826.0.1.3680043.24.1', CURRENT_DATE, NULL, 'CT', 'M24BE', 'M24-SPS-B', NULL
    );
    RAISE EXCEPTION 'M24 duplicate StudyInstanceUID crossed tenants';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'M24 duplicate StudyInstanceUID crossed tenants' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%already belongs to another scope or worklist item%' THEN RAISE; END IF;
  END;
END;
$tenant_b$;

SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000002402","company_id":"00000000-0000-4000-8000-000000000242","unit_id":24002,"session_id":"00000000-0000-4000-8000-000000002472","role":"authenticated","aal":"aal1"}';
DO $aal1$
BEGIN
  BEGIN
    PERFORM public.get_dicom_exam_by_appointment(24002);
    RAISE EXCEPTION 'M24 AAL1 DICOM read was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'M24 AAL1 DICOM read was accepted' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%AAL2 required%' THEN RAISE; END IF;
  END;
END;
$aal1$;

RESET ROLE;
SELECT set_config('request.jwt.claims','',TRUE);
SELECT set_config('request.jwt.claim.sub','',TRUE);
SELECT set_config('request.jwt.claim.company_id','',TRUE);
SELECT set_config('request.jwt.claim.unit_id','',TRUE);
INSERT INTO public.appointments(id,company_id,unit_id,patient_id,professional_id,appointment_date,start_time,end_time,status,notes) VALUES
 (24003,'00000000-0000-4000-8000-000000000241',24001,24001,24001,CURRENT_DATE,'10:00','10:30','scheduled','M24 create/cancel A'),
 (24004,'00000000-0000-4000-8000-000000000242',24002,24002,24002,CURRENT_DATE,'11:00','11:30','scheduled','M24 cross tenant B');
UPDATE public.appointments
SET scheduled_at = (appointment_date + start_time)::TIMESTAMP AT TIME ZONE
  CASE id WHEN 24003 THEN 'America/Sao_Paulo' ELSE 'America/Manaus' END
WHERE id IN (24003, 24004);
SET LOCAL ROLE app_prontomedic;
SET LOCAL request.jwt.claim.sub='00000000-0000-4000-8000-000000002401';
SET LOCAL request.jwt.claim.company_id='00000000-0000-4000-8000-000000000241';
SET LOCAL request.jwt.claim.unit_id='24001';
SET LOCAL request.jwt.claims='{"sub":"00000000-0000-4000-8000-000000002401","company_id":"00000000-0000-4000-8000-000000000241","unit_id":24001,"session_id":"00000000-0000-4000-8000-000000002471","role":"authenticated","aal":"aal2"}';
DO $orders$
DECLARE r JSONB; oid UUID;
BEGIN
 r:=public.m24_create_imaging_order_secure(24003,'Synthetic CT','normal','[{"exam_name":"CT synthetic","modality_type":"CT","station_aetitle":"M24AE","requested_procedure_id":"M24-CT","scheduled_procedure_step_id":"M24-SPS"}]','m24-order-a');
 IF (r->>'idempotent')::BOOLEAN THEN RAISE EXCEPTION 'M24 first order create reported idempotent'; END IF; oid:=(r->>'order_id')::UUID;
 r:=public.m24_create_imaging_order_secure(24003,'Synthetic CT','normal','[{"exam_name":"CT synthetic","modality_type":"CT","station_aetitle":"M24AE","requested_procedure_id":"M24-CT","scheduled_procedure_step_id":"M24-SPS"}]','m24-order-a');
 IF NOT (r->>'idempotent')::BOOLEAN OR (r->>'order_id')::UUID<>oid THEN RAISE EXCEPTION 'M24 order create is not idempotent'; END IF;
 IF (SELECT scheduled_datetime FROM public.imaging_order_items WHERE imaging_order_id=oid LIMIT 1) IS DISTINCT FROM (SELECT scheduled_at FROM public.appointments WHERE id=24003) THEN RAISE EXCEPTION 'M24 imaging item did not preserve canonical scheduled_at'; END IF;
 BEGIN PERFORM public.m24_create_imaging_order_secure(24003,'Divergent payload','urgent','[{"exam_name":"Other","modality_type":"MR","station_aetitle":"M24AE"}]','m24-order-a'); RAISE EXCEPTION 'M24 divergent idempotent payload accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='M24 divergent idempotent payload accepted' THEN RAISE; END IF; IF SQLERRM NOT LIKE '%different imaging order%' THEN RAISE; END IF; END;
 BEGIN PERFORM public.m24_create_imaging_order_secure(24004,'Cross','normal','[{"exam_name":"Cross","modality_type":"CT","station_aetitle":"M24BE"}]','m24-cross'); RAISE EXCEPTION 'M24 cross tenant appointment accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='M24 cross tenant appointment accepted' THEN RAISE; END IF; IF SQLERRM NOT LIKE '%Appointment not found in active scope%' THEN RAISE; END IF; END;
 r:=public.m24_cancel_imaging_order_secure(oid,'Synthetic cancellation');
 IF r->>'status'<>'cancelado' OR (r->>'idempotent')::BOOLEAN THEN RAISE EXCEPTION 'M24 reversible cancellation failed'; END IF;
 r:=public.m24_cancel_imaging_order_secure(oid,'Synthetic cancellation');
 IF NOT (r->>'idempotent')::BOOLEAN THEN RAISE EXCEPTION 'M24 cancellation is not idempotent'; END IF;
 BEGIN PERFORM public.m24_cancel_imaging_order_secure('00000000-0000-4000-8000-000000002411','Too late'); RAISE EXCEPTION 'M24 acquired order cancellation accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='M24 acquired order cancellation accepted' THEN RAISE; END IF; IF SQLERRM NOT LIKE '%after acquisition/PACS%' THEN RAISE; END IF; END;
END $orders$;

ROLLBACK;
