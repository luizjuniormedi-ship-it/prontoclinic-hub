-- PostgreSQL 18 runtime gate for the six frontend nursing operations.
-- Ephemeral replay only. Never execute against DataSIGH or production.

BEGIN;

DO $gate$
BEGIN
  IF current_setting('server_version_num')::INTEGER < 180000 THEN
    RAISE EXCEPTION 'Nursing runtime gate requires PostgreSQL 18, found %', version();
  END IF;
END
$gate$;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID LANGUAGE sql STABLE
AS $gate$ SELECT NULLIF(current_setting('app.test_user_id', TRUE), '')::UUID $gate$;

INSERT INTO public.companies (id, name) VALUES
  ('4a000000-0000-4000-8000-000000000001', 'Nursing Tenant A'),
  ('4b000000-0000-4000-8000-000000000002', 'Nursing Tenant B');
INSERT INTO auth.users (id) VALUES
  ('5a000000-0000-4000-8000-000000000001'),
  ('5b000000-0000-4000-8000-000000000002'),
  ('5c000000-0000-4000-8000-000000000003'),
  ('5d000000-0000-4000-8000-000000000004'),
  ('5e000000-0000-4000-8000-000000000005'),
  ('5f000000-0000-4000-8000-000000000006'),
  ('5a000000-0000-4000-8000-000000000007');
INSERT INTO public.roles(name,description) VALUES
  ('nursing_create_only','Nursing gate create-only'),
  ('nursing_edit_only','Nursing gate edit-only'),
  ('nursing_view_only','Nursing gate view-only')
ON CONFLICT(name) DO NOTHING;
INSERT INTO public.role_permissions(role_id,module,can_view,can_create,can_edit)
SELECT role.id,'enfermagem',seed.can_view,seed.can_create,seed.can_edit
  FROM (VALUES
    ('nursing_create_only',FALSE,TRUE,FALSE),
    ('nursing_edit_only',FALSE,FALSE,TRUE),
    ('nursing_view_only',TRUE,FALSE,FALSE)
  ) AS seed(role_name,can_view,can_create,can_edit)
  JOIN public.roles AS role ON role.name=seed.role_name
ON CONFLICT(role_id,module) DO UPDATE
  SET can_view=EXCLUDED.can_view,can_create=EXCLUDED.can_create,can_edit=EXCLUDED.can_edit;
INSERT INTO public.user_profiles(id,full_name,email,role_name,role_id,company_id,lg_ativo)
SELECT seed.id,seed.full_name,seed.email,seed.role_name,role.id,seed.company_id,seed.lg_ativo
  FROM (VALUES
    ('5a000000-0000-4000-8000-000000000001'::UUID,'Nurse A','nurse-a@test.local','enfermagem','4a000000-0000-4000-8000-000000000001'::UUID,TRUE),
    ('5b000000-0000-4000-8000-000000000002'::UUID,'Nurse B','nurse-b@test.local','enfermagem','4b000000-0000-4000-8000-000000000002'::UUID,TRUE),
    ('5c000000-0000-4000-8000-000000000003'::UUID,'No Permission A','none-a@test.local','financeiro','4a000000-0000-4000-8000-000000000001'::UUID,TRUE),
    ('5d000000-0000-4000-8000-000000000004'::UUID,'Create Only A','create-a@test.local','nursing_create_only','4a000000-0000-4000-8000-000000000001'::UUID,TRUE),
    ('5e000000-0000-4000-8000-000000000005'::UUID,'Edit Only A','edit-a@test.local','nursing_edit_only','4a000000-0000-4000-8000-000000000001'::UUID,TRUE),
    ('5f000000-0000-4000-8000-000000000006'::UUID,'View Only A','view-a@test.local','nursing_view_only','4a000000-0000-4000-8000-000000000001'::UUID,TRUE),
    ('5a000000-0000-4000-8000-000000000007'::UUID,'Inactive Nurse A','inactive-a@test.local','enfermagem','4a000000-0000-4000-8000-000000000001'::UUID,FALSE)
  ) AS seed(id,full_name,email,role_name,company_id,lg_ativo)
  JOIN public.roles AS role ON role.name=seed.role_name;
INSERT INTO public.patients(id,company_id,full_name)
OVERRIDING SYSTEM VALUE VALUES
  (990011,'4a000000-0000-4000-8000-000000000001','Patient A'),
  (990012,'4b000000-0000-4000-8000-000000000002','Patient B');

CREATE OR REPLACE FUNCTION public.nursing_gate_force_rollback()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog
AS $gate$
BEGIN
  IF NEW.description = 'FORCE_ROLLBACK' THEN
    RAISE EXCEPTION 'forced nursing gate rollback';
  END IF;
  RETURN NEW;
END
$gate$;
CREATE TRIGGER nursing_gate_force_rollback
  AFTER INSERT ON public.nursing_incidents
  FOR EACH ROW EXECUTE FUNCTION public.nursing_gate_force_rollback();

DO $gate$
DECLARE
  v_relation RECORD;
  v_function REGPROCEDURE;
  v_owner RECORD;
  v_expected TEXT[] := ARRAY[
    'create_nursing_medication_secure(bigint, text, text, text, timestamp with time zone, uuid)',
    'administer_nursing_medication_secure(bigint, bigint, uuid)',
    'refuse_nursing_medication_secure(bigint, text, uuid)',
    'report_nursing_incident_secure(bigint, text, text, text, uuid)',
    'record_nursing_procedure_secure(bigint, text, text, boolean, uuid)',
    'create_nursing_shift_handoff_secure(date, text, text, jsonb, jsonb, text, uuid)'
  ];
BEGIN
  IF (
    SELECT array_agg(procedure.proname || '(' || oidvectortypes(procedure.proargtypes) || ')' ORDER BY procedure.proname)
      FROM pg_proc AS procedure
      JOIN pg_namespace AS namespace ON namespace.oid=procedure.pronamespace
     WHERE namespace.nspname='public'
       AND procedure.proname IN (
         'create_nursing_medication_secure','administer_nursing_medication_secure',
         'refuse_nursing_medication_secure','report_nursing_incident_secure',
         'record_nursing_procedure_secure','create_nursing_shift_handoff_secure'
       )
  ) IS DISTINCT FROM (SELECT array_agg(value ORDER BY value) FROM unnest(v_expected) AS value) THEN
    RAISE EXCEPTION 'The six frontend nursing RPC signatures diverge from the contract';
  END IF;
  IF to_regprocedure('public.bedside_check(bigint,bigint)') IS NULL
     OR EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::REGNAMESPACE AND proname='record_nursing_shift_handoff_secure') THEN
    RAISE EXCEPTION 'Bedside compatibility or handoff function name is incorrect';
  END IF;
  IF to_regprocedure('public.nursing_actor_context_secure(text)') IS NULL
     OR to_regprocedure('public.nursing_actor_context_secure()') IS NOT NULL
     OR has_function_privilege('authenticated','public.nursing_actor_context_secure(text)','EXECUTE') THEN
    RAISE EXCEPTION 'Internal nursing action context signature/ACL is unsafe';
  END IF;
  FOREACH v_function IN ARRAY ARRAY[
    'public.nursing_actor_context_secure(text)'::REGPROCEDURE,
    'public.nursing_has_permission_secure(text)'::REGPROCEDURE
  ] LOOP
    SELECT role.rolname,role.rolsuper,role.rolbypassrls,role.rolcanlogin INTO v_owner
      FROM pg_proc AS procedure JOIN pg_roles AS role ON role.oid=procedure.proowner
     WHERE procedure.oid=v_function;
    IF v_owner.rolname<>'nursing_rpc_owner' OR v_owner.rolsuper OR v_owner.rolbypassrls OR v_owner.rolcanlogin
       OR has_function_privilege('anon',v_function,'EXECUTE')
       OR has_function_privilege('service_role',v_function,'EXECUTE')
       OR EXISTS (
         SELECT 1 FROM pg_proc AS procedure
         CROSS JOIN LATERAL aclexplode(COALESCE(procedure.proacl,acldefault('f',procedure.proowner))) AS privilege
          WHERE procedure.oid=v_function AND privilege.grantee=0 AND privilege.privilege_type='EXECUTE'
       ) THEN
      RAISE EXCEPTION 'Unsafe internal nursing function owner/ACL for %',v_function;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('authenticated','public.nursing_has_permission_secure(text)','EXECUTE') THEN
    RAISE EXCEPTION 'Authenticated cannot evaluate nursing read policies';
  END IF;
  IF (SELECT provolatile FROM pg_proc WHERE oid='public.bedside_check(bigint,bigint)'::REGPROCEDURE) <> 's' THEN
    RAISE EXCEPTION 'bedside_check must be a read-only STABLE preview';
  END IF;

  FOR v_relation IN
    SELECT class.relname,class.relrowsecurity,class.relforcerowsecurity,
           owner.rolname,owner.rolsuper,owner.rolbypassrls,owner.rolcanlogin
      FROM pg_class AS class
      JOIN pg_namespace AS namespace ON namespace.oid=class.relnamespace
      JOIN pg_roles AS owner ON owner.oid=class.relowner
     WHERE namespace.nspname='public'
       AND class.relname IN ('nursing_medication_administrations','nursing_incidents','nursing_procedures','nursing_shift_handoffs')
  LOOP
    IF NOT v_relation.relrowsecurity OR NOT v_relation.relforcerowsecurity THEN
      RAISE EXCEPTION 'RLS/FORCE RLS missing on %',v_relation.relname;
    END IF;
    IF v_relation.rolname<>'nursing_data_owner' OR v_relation.rolsuper OR v_relation.rolbypassrls OR v_relation.rolcanlogin THEN
      RAISE EXCEPTION 'Unsafe nursing table owner: %',row_to_json(v_relation);
    END IF;
    IF has_table_privilege('anon',format('public.%I',v_relation.relname),'SELECT')
       OR has_table_privilege('authenticated',format('public.%I',v_relation.relname),'INSERT')
       OR has_table_privilege('authenticated',format('public.%I',v_relation.relname),'UPDATE')
       OR has_table_privilege('authenticated',format('public.%I',v_relation.relname),'DELETE')
       OR has_table_privilege('service_role',format('public.%I',v_relation.relname),'INSERT')
       OR NOT has_table_privilege('authenticated',format('public.%I',v_relation.relname),'SELECT') THEN
      RAISE EXCEPTION 'Nursing table grants are not exact on %',v_relation.relname;
    END IF;
  END LOOP;

  FOREACH v_function IN ARRAY ARRAY[
    'public.create_nursing_medication_secure(bigint,text,text,text,timestamptz,uuid)'::REGPROCEDURE,
    'public.administer_nursing_medication_secure(bigint,bigint,uuid)'::REGPROCEDURE,
    'public.refuse_nursing_medication_secure(bigint,text,uuid)'::REGPROCEDURE,
    'public.report_nursing_incident_secure(bigint,text,text,text,uuid)'::REGPROCEDURE,
    'public.record_nursing_procedure_secure(bigint,text,text,boolean,uuid)'::REGPROCEDURE,
    'public.create_nursing_shift_handoff_secure(date,text,text,jsonb,jsonb,text,uuid)'::REGPROCEDURE
  ] LOOP
    SELECT role.rolname,role.rolsuper,role.rolbypassrls,role.rolcanlogin INTO v_owner
      FROM pg_proc AS procedure JOIN pg_roles AS role ON role.oid=procedure.proowner
     WHERE procedure.oid=v_function;
    IF v_owner.rolname<>'nursing_rpc_owner' OR v_owner.rolsuper OR v_owner.rolbypassrls OR v_owner.rolcanlogin THEN
      RAISE EXCEPTION 'Unsafe nursing RPC owner for %: %',v_function,row_to_json(v_owner);
    END IF;
    IF has_function_privilege('anon',v_function,'EXECUTE')
       OR has_function_privilege('service_role',v_function,'EXECUTE')
       OR NOT has_function_privilege('authenticated',v_function,'EXECUTE')
       OR EXISTS (
         SELECT 1 FROM pg_proc AS procedure
         CROSS JOIN LATERAL aclexplode(COALESCE(procedure.proacl,acldefault('f',procedure.proowner))) AS privilege
          WHERE procedure.oid=v_function AND privilege.grantee=0 AND privilege.privilege_type='EXECUTE'
       ) THEN RAISE EXCEPTION 'Nursing RPC grants are not exact for %',v_function; END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('nursing_rpc_owner','nursing_data_owner') AND (rolsuper OR rolbypassrls OR rolcanlogin)) THEN
    RAISE EXCEPTION 'A nursing owner can login, is superuser, or has BYPASSRLS';
  END IF;
  IF NOT has_table_privilege('nursing_rpc_owner','public.roles','SELECT')
     OR NOT has_table_privilege('nursing_rpc_owner','public.role_permissions','SELECT')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='roles' AND policyname='nursing_rpc_roles_lookup')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='role_permissions' AND policyname='nursing_rpc_permissions_lookup') THEN
    RAISE EXCEPTION 'Nursing RPC owner RBAC lookup grants/policies are incomplete';
  END IF;
  IF (SELECT count(*) FROM pg_constraint
       WHERE conrelid IN ('public.nursing_medication_administrations'::REGCLASS,'public.nursing_incidents'::REGCLASS,'public.nursing_procedures'::REGCLASS,'public.nursing_shift_handoffs'::REGCLASS)
         AND contype='f' AND array_length(conkey,1)=2) < 11 THEN
    RAISE EXCEPTION 'Tenant-composite nursing foreign keys are incomplete';
  END IF;
  IF (SELECT count(*) FROM public.role_permissions AS permission
       JOIN public.roles AS role ON role.id=permission.role_id
      WHERE permission.module='enfermagem' AND role.name IN ('admin','enfermagem')
        AND permission.can_view AND permission.can_create AND permission.can_edit)<>2
     OR EXISTS (
       SELECT 1 FROM public.role_permissions AS permission
       JOIN public.roles AS role ON role.id=permission.role_id
        WHERE permission.module='enfermagem' AND role.name IN ('financeiro','recepcao')
          AND (permission.can_create OR permission.can_edit)
     ) THEN
    RAISE EXCEPTION 'Nursing RBAC defaults are unsafe or incomplete';
  END IF;
END
$gate$;

SET LOCAL ROLE authenticated;
SET LOCAL app.test_user_id='5a000000-0000-4000-8000-000000000001';

DO $gate$
DECLARE
  v_created JSONB; v_created_retry JSONB; v_admin JSONB; v_admin_retry JSONB;
  v_refuse_created JSONB; v_refused JSONB; v_refused_retry JSONB;
  v_incident JSONB; v_incident_retry JSONB; v_procedure JSONB; v_procedure_retry JSONB;
  v_handoff JSONB; v_handoff_retry JSONB; v_admin_id BIGINT; v_refuse_id BIGINT;
  v_checks_ok BOOLEAN; v_before JSONB;
BEGIN
  BEGIN
    INSERT INTO public.nursing_procedures(company_id,patient_id,procedure_type,faturavel,performed_at,performed_by,idempotency_key,request_hash)
    VALUES('4a000000-0000-4000-8000-000000000001',990011,'direct',FALSE,now(),'5a000000-0000-4000-8000-000000000001',gen_random_uuid(),repeat('0',64));
    RAISE EXCEPTION 'Direct nursing DML was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  v_created:=public.create_nursing_medication_secure(990011,'Dipirona','500 mg','VO','2026-07-13 10:00:00+00','6a000000-0000-4000-8000-000000000001');
  v_created_retry:=public.create_nursing_medication_secure(990011,'Dipirona','500 mg','VO','2026-07-13 10:00:00+00','6a000000-0000-4000-8000-000000000001');
  v_admin_id:=(v_created->>'id')::BIGINT;
  IF v_created_retry IS DISTINCT FROM v_created OR v_created->>'status'<>'pendente'
     OR v_created->>'company_id'<>'4a000000-0000-4000-8000-000000000001'
     OR v_created->>'prepared_by'<>'5a000000-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'Create medication contract/idempotency/authorship failed: %',v_created;
  END IF;

  SELECT to_jsonb(m) INTO v_before FROM public.nursing_medication_administrations AS m WHERE id=v_admin_id;
  BEGIN
    PERFORM public.administer_nursing_medication_secure(v_admin_id,990012,'6a000000-0000-4000-8000-000000000002');
    RAISE EXCEPTION 'Administration with divergent patient was accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%paciente confirmado nao confere%' THEN RAISE; END IF; END;
  IF (SELECT to_jsonb(m) FROM public.nursing_medication_administrations AS m WHERE id=v_admin_id) IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'Divergent bedside patient left partial medication state';
  END IF;
  SELECT bool_and(ok) INTO v_checks_ok FROM public.bedside_check(v_admin_id,990011);
  IF NOT v_checks_ok THEN RAISE EXCEPTION 'Valid bedside check failed'; END IF;
  IF (SELECT to_jsonb(m) FROM public.nursing_medication_administrations AS m WHERE id=v_admin_id) IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'Read-only bedside preview persisted state';
  END IF;
  v_admin:=public.administer_nursing_medication_secure(v_admin_id,990011,'6a000000-0000-4000-8000-000000000002');
  v_admin_retry:=public.administer_nursing_medication_secure(v_admin_id,990011,'6a000000-0000-4000-8000-000000000002');
  IF v_admin_retry IS DISTINCT FROM v_admin OR v_admin->>'status'<>'administrado'
     OR v_admin->>'administered_by'<>'5a000000-0000-4000-8000-000000000001'
     OR (v_admin->>'bedside_check_ok')::BOOLEAN IS NOT TRUE
     OR v_admin->>'bedside_checked_at' IS NULL
     OR v_admin->>'bedside_checked_by'<>'5a000000-0000-4000-8000-000000000001'
     OR v_admin->>'bedside_confirmed_patient_id'<>'990011' THEN
    RAISE EXCEPTION 'Atomic bedside administration/idempotency failed: %',v_admin;
  END IF;

  v_refuse_created:=public.create_nursing_medication_secure(990011,'Omeprazol','20 mg','VO',NULL,'6a000000-0000-4000-8000-000000000003');
  v_refuse_id:=(v_refuse_created->>'id')::BIGINT;
  PERFORM set_config('app.gate_admin_id',v_admin_id::TEXT,TRUE);
  PERFORM set_config('app.gate_refuse_id',v_refuse_id::TEXT,TRUE);
  v_refused:=public.refuse_nursing_medication_secure(v_refuse_id,'Paciente recusou','6a000000-0000-4000-8000-000000000004');
  v_refused_retry:=public.refuse_nursing_medication_secure(v_refuse_id,'Paciente recusou','6a000000-0000-4000-8000-000000000004');
  IF v_refused_retry IS DISTINCT FROM v_refused OR v_refused->>'status'<>'recusado'
     OR v_refused->>'refusal_reason'<>'Paciente recusou'
     OR v_refused->>'refused_by'<>'5a000000-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'Medication refusal/idempotency/authorship failed: %',v_refused;
  END IF;

  v_incident:=public.report_nursing_incident_secure(990011,'queda','grave','Queda sem trauma','6a000000-0000-4000-8000-000000000005');
  v_incident_retry:=public.report_nursing_incident_secure(990011,'queda','grave','Queda sem trauma','6a000000-0000-4000-8000-000000000005');
  IF v_incident_retry IS DISTINCT FROM v_incident OR (v_incident->>'medico_notificado')::BOOLEAN IS NOT TRUE
     OR v_incident->>'reported_by'<>'5a000000-0000-4000-8000-000000000001' THEN RAISE EXCEPTION 'Incident operation failed: %',v_incident; END IF;

  v_procedure:=public.record_nursing_procedure_secure(990011,'curativo','Curativo simples',TRUE,'6a000000-0000-4000-8000-000000000006');
  v_procedure_retry:=public.record_nursing_procedure_secure(990011,'curativo','Curativo simples',TRUE,'6a000000-0000-4000-8000-000000000006');
  IF v_procedure_retry IS DISTINCT FROM v_procedure OR (v_procedure->>'faturavel')::BOOLEAN IS NOT TRUE
     OR v_procedure->>'performed_by'<>'5a000000-0000-4000-8000-000000000001' THEN RAISE EXCEPTION 'Procedure operation failed: %',v_procedure; END IF;

  v_handoff:=public.create_nursing_shift_handoff_secure('2026-07-13','noturno','Plantao estavel','["Reavaliar dor"]','[990011]',NULL,'6a000000-0000-4000-8000-000000000007');
  v_handoff_retry:=public.create_nursing_shift_handoff_secure('2026-07-13','noturno','Plantao estavel','["Reavaliar dor"]','[990011]',NULL,'6a000000-0000-4000-8000-000000000007');
  IF v_handoff_retry IS DISTINCT FROM v_handoff OR v_handoff->>'created_by'<>'5a000000-0000-4000-8000-000000000001'
     OR v_handoff->>'shift_type'<>'noturno' THEN RAISE EXCEPTION 'Handoff operation failed: %',v_handoff; END IF;

  BEGIN
    PERFORM public.report_nursing_incident_secure(990011,'queda','leve','FORCE_ROLLBACK','6a000000-0000-4000-8000-000000000008');
    RAISE EXCEPTION 'Forced rollback did not fail';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%forced nursing gate rollback%' THEN RAISE; END IF; END;
  IF EXISTS (SELECT 1 FROM public.nursing_incidents WHERE idempotency_key='6a000000-0000-4000-8000-000000000008') THEN
    RAISE EXCEPTION 'Failed nursing RPC left partial incident state';
  END IF;

  BEGIN
    PERFORM public.create_nursing_medication_secure(990012,'Tenant B drug','1','VO',NULL,'6a000000-0000-4000-8000-000000000009');
    RAISE EXCEPTION 'Tenant A created Tenant B medication';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%fora do tenant%' THEN RAISE; END IF; END;
END
$gate$;

-- create-only: create-class operations succeed; view and edit are denied.
SET LOCAL app.test_user_id='5d000000-0000-4000-8000-000000000004';
DO $gate$
DECLARE v_admin_id BIGINT:=current_setting('app.gate_admin_id')::BIGINT;
BEGIN
  IF EXISTS(SELECT 1 FROM public.nursing_incidents) THEN RAISE EXCEPTION 'create-only role received can_view'; END IF;
  PERFORM public.report_nursing_incident_secure(990011,'queda','leve','Create only allowed','6d000000-0000-4000-8000-000000000001');
  PERFORM public.record_nursing_procedure_secure(990011,'Create only allowed',NULL,FALSE,'6d000000-0000-4000-8000-000000000002');
  PERFORM public.create_nursing_shift_handoff_secure('2026-07-13','noturno','Create only allowed',NULL,NULL,NULL,'6d000000-0000-4000-8000-000000000003');
  BEGIN PERFORM public.create_nursing_medication_secure(990011,'Denied edit','1','VO',NULL,'6d000000-0000-4000-8000-000000000004'); RAISE EXCEPTION 'create-only executed edit';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%enfermagem.edit%' THEN RAISE; END IF; END;
  BEGIN PERFORM public.administer_nursing_medication_secure(v_admin_id,990011,'6d000000-0000-4000-8000-000000000005'); RAISE EXCEPTION 'create-only administered';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%enfermagem.edit%' THEN RAISE; END IF; END;
  BEGIN PERFORM public.refuse_nursing_medication_secure(v_admin_id,'Denied edit','6d000000-0000-4000-8000-000000000006'); RAISE EXCEPTION 'create-only refused';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%enfermagem.edit%' THEN RAISE; END IF; END;
  BEGIN PERFORM * FROM public.bedside_check(v_admin_id,990011); RAISE EXCEPTION 'create-only previewed bedside';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%enfermagem.view%' THEN RAISE; END IF; END;
END
$gate$;

-- edit-only: medication state operations succeed; view and create are denied.
SET LOCAL app.test_user_id='5e000000-0000-4000-8000-000000000005';
DO $gate$
DECLARE v_first JSONB; v_second JSONB; v_first_id BIGINT; v_second_id BIGINT;
BEGIN
  IF EXISTS(SELECT 1 FROM public.nursing_medication_administrations) THEN RAISE EXCEPTION 'edit-only role received can_view'; END IF;
  v_first:=public.create_nursing_medication_secure(990011,'Edit only administer','1 mg','VO',NULL,'6e000000-0000-4000-8000-000000000001');
  v_first_id:=(v_first->>'id')::BIGINT;
  PERFORM public.administer_nursing_medication_secure(v_first_id,990011,'6e000000-0000-4000-8000-000000000002');
  v_second:=public.create_nursing_medication_secure(990011,'Edit only refuse','1 mg','VO',NULL,'6e000000-0000-4000-8000-000000000003');
  v_second_id:=(v_second->>'id')::BIGINT;
  PERFORM public.refuse_nursing_medication_secure(v_second_id,'Edit only refusal','6e000000-0000-4000-8000-000000000004');
  BEGIN PERFORM public.report_nursing_incident_secure(990011,'queda','leve','Denied create','6e000000-0000-4000-8000-000000000005'); RAISE EXCEPTION 'edit-only reported incident';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%enfermagem.create%' THEN RAISE; END IF; END;
  BEGIN PERFORM public.record_nursing_procedure_secure(990011,'Denied create',NULL,FALSE,'6e000000-0000-4000-8000-000000000006'); RAISE EXCEPTION 'edit-only recorded procedure';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%enfermagem.create%' THEN RAISE; END IF; END;
  BEGIN PERFORM public.create_nursing_shift_handoff_secure('2026-07-13','noturno','Denied create',NULL,NULL,NULL,'6e000000-0000-4000-8000-000000000007'); RAISE EXCEPTION 'edit-only created handoff';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%enfermagem.create%' THEN RAISE; END IF; END;
  BEGIN PERFORM * FROM public.bedside_check(v_first_id,990011); RAISE EXCEPTION 'edit-only previewed bedside';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%enfermagem.view%' THEN RAISE; END IF; END;
END
$gate$;

-- view-only: tenant rows and bedside preview are visible; every mutation is denied.
SET LOCAL app.test_user_id='5f000000-0000-4000-8000-000000000006';
DO $gate$
DECLARE v_admin_id BIGINT:=current_setting('app.gate_admin_id')::BIGINT; v_attempt INTEGER:=0; v_preview_count INTEGER;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.nursing_medication_administrations) THEN RAISE EXCEPTION 'view-only role cannot read nursing rows'; END IF;
  SELECT count(*) INTO v_preview_count FROM public.bedside_check(v_admin_id,990011);
  IF v_preview_count<>2 THEN RAISE EXCEPTION 'view-only bedside preview failed'; END IF;
  BEGIN PERFORM public.create_nursing_medication_secure(990011,'View denied','1','VO',NULL,'6f000000-0000-4000-8000-000000000001'); RAISE EXCEPTION 'view-only created medication';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%enfermagem.edit%' THEN RAISE; END IF; v_attempt:=v_attempt+1; END;
  BEGIN PERFORM public.administer_nursing_medication_secure(v_admin_id,990011,'6f000000-0000-4000-8000-000000000002'); RAISE EXCEPTION 'view-only administered';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%enfermagem.edit%' THEN RAISE; END IF; v_attempt:=v_attempt+1; END;
  BEGIN PERFORM public.refuse_nursing_medication_secure(v_admin_id,'View denied','6f000000-0000-4000-8000-000000000003'); RAISE EXCEPTION 'view-only refused';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%enfermagem.edit%' THEN RAISE; END IF; v_attempt:=v_attempt+1; END;
  BEGIN PERFORM public.report_nursing_incident_secure(990011,'queda','leve','View denied','6f000000-0000-4000-8000-000000000004'); RAISE EXCEPTION 'view-only reported';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%enfermagem.create%' THEN RAISE; END IF; v_attempt:=v_attempt+1; END;
  BEGIN PERFORM public.record_nursing_procedure_secure(990011,'View denied',NULL,FALSE,'6f000000-0000-4000-8000-000000000005'); RAISE EXCEPTION 'view-only procedure';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%enfermagem.create%' THEN RAISE; END IF; v_attempt:=v_attempt+1; END;
  BEGIN PERFORM public.create_nursing_shift_handoff_secure('2026-07-13','noturno','View denied',NULL,NULL,NULL,'6f000000-0000-4000-8000-000000000006'); RAISE EXCEPTION 'view-only handoff';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%enfermagem.create%' THEN RAISE; END IF; v_attempt:=v_attempt+1; END;
  IF v_attempt<>6 THEN RAISE EXCEPTION 'view-only mutation matrix incomplete'; END IF;
END
$gate$;

-- No-permission active profile: view, create and edit all fail.
SET LOCAL app.test_user_id='5c000000-0000-4000-8000-000000000003';
DO $gate$
DECLARE v_admin_id BIGINT:=current_setting('app.gate_admin_id')::BIGINT; v_attempt INTEGER:=0;
BEGIN
  IF EXISTS(SELECT 1 FROM public.nursing_medication_administrations) THEN RAISE EXCEPTION 'no-permission role can read nursing rows'; END IF;
  BEGIN PERFORM * FROM public.bedside_check(v_admin_id,990011); RAISE EXCEPTION 'no-permission previewed';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%enfermagem.view%' THEN RAISE; END IF; END;
  BEGIN PERFORM public.create_nursing_medication_secure(990011,'Unauthorized','1','VO',NULL,'6c000000-0000-4000-8000-000000000001'); RAISE EXCEPTION 'no-permission edited';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%enfermagem.edit%' THEN RAISE; END IF; v_attempt:=v_attempt+1; END;
  BEGIN PERFORM public.administer_nursing_medication_secure(v_admin_id,990011,'6c000000-0000-4000-8000-000000000002'); RAISE EXCEPTION 'no-permission administered';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%enfermagem.edit%' THEN RAISE; END IF; v_attempt:=v_attempt+1; END;
  BEGIN PERFORM public.refuse_nursing_medication_secure(v_admin_id,'Unauthorized','6c000000-0000-4000-8000-000000000003'); RAISE EXCEPTION 'no-permission refused';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%enfermagem.edit%' THEN RAISE; END IF; v_attempt:=v_attempt+1; END;
  BEGIN PERFORM public.report_nursing_incident_secure(990011,'queda','leve','Unauthorized','6c000000-0000-4000-8000-000000000004'); RAISE EXCEPTION 'no-permission reported';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%enfermagem.create%' THEN RAISE; END IF; v_attempt:=v_attempt+1; END;
  BEGIN PERFORM public.record_nursing_procedure_secure(990011,'Unauthorized',NULL,FALSE,'6c000000-0000-4000-8000-000000000005'); RAISE EXCEPTION 'no-permission procedure';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%enfermagem.create%' THEN RAISE; END IF; v_attempt:=v_attempt+1; END;
  BEGIN PERFORM public.create_nursing_shift_handoff_secure('2026-07-13','noturno','Unauthorized',NULL,NULL,NULL,'6c000000-0000-4000-8000-000000000006'); RAISE EXCEPTION 'no-permission handoff';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%enfermagem.create%' THEN RAISE; END IF; v_attempt:=v_attempt+1; END;
  IF v_attempt<>6 THEN RAISE EXCEPTION 'no-permission mutation matrix incomplete'; END IF;
END
$gate$;

-- Inactive profile is denied independently of its full nursing role.
SET LOCAL app.test_user_id='5a000000-0000-4000-8000-000000000007';
DO $gate$
DECLARE v_admin_id BIGINT:=current_setting('app.gate_admin_id')::BIGINT;
BEGIN
  IF EXISTS(SELECT 1 FROM public.nursing_medication_administrations) THEN RAISE EXCEPTION 'inactive profile can read nursing rows'; END IF;
  BEGIN PERFORM * FROM public.bedside_check(v_admin_id,990011); RAISE EXCEPTION 'inactive profile previewed';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%enfermagem.view%' THEN RAISE; END IF; END;
  BEGIN PERFORM public.create_nursing_medication_secure(990011,'Inactive','1','VO',NULL,'6a000000-0000-4000-8000-000000000071'); RAISE EXCEPTION 'inactive profile edited';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%enfermagem.edit%' THEN RAISE; END IF; END;
  BEGIN PERFORM public.report_nursing_incident_secure(990011,'queda','leve','Inactive','6a000000-0000-4000-8000-000000000072'); RAISE EXCEPTION 'inactive profile created';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%enfermagem.create%' THEN RAISE; END IF; END;
END
$gate$;

SET LOCAL app.test_user_id='5b000000-0000-4000-8000-000000000002';
DO $gate$
DECLARE v_row JSONB;
BEGIN
  IF EXISTS(SELECT 1 FROM public.nursing_medication_administrations)
     OR EXISTS(SELECT 1 FROM public.nursing_incidents)
     OR EXISTS(SELECT 1 FROM public.nursing_procedures)
     OR EXISTS(SELECT 1 FROM public.nursing_shift_handoffs) THEN
    RAISE EXCEPTION 'Tenant B can read Tenant A nursing data';
  END IF;
  v_row:=public.create_nursing_medication_secure(990012,'Paracetamol','750 mg','VO',NULL,'6b000000-0000-4000-8000-000000000001');
  IF v_row->>'company_id'<>'4b000000-0000-4000-8000-000000000002'
     OR (SELECT count(*) FROM public.nursing_medication_administrations)<>1 THEN RAISE EXCEPTION 'Tenant B create failed'; END IF;
END
$gate$;

SET LOCAL app.test_user_id='5a000000-0000-4000-8000-000000000001';
DO $gate$
BEGIN
  IF (SELECT count(*) FROM public.nursing_medication_administrations)<>4
     OR EXISTS(SELECT 1 FROM public.nursing_medication_administrations WHERE company_id<>'4a000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'Tenant A read isolation failed after Tenant B write';
  END IF;
END
$gate$;

RESET ROLE;
ROLLBACK;
SELECT 'F1_RUNTIME_NURSING_SECURE_GATE=PASS' AS result;

