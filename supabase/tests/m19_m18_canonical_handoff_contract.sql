-- Run only against a disposable full ProntoMedic replay database.
-- Never run against VPS production or DataSIGH.
BEGIN;

DO $classification_catalog$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT count(*)
    INTO v_count
    FROM public.mnct_classificacao_risco
   WHERE company_id IS NULL
     AND lg_ativo IS TRUE
     AND ds_classificacao IN ('VERMELHO', 'LARANJA', 'AMARELO', 'VERDE', 'AZUL');

  IF v_count <> 5 THEN
    RAISE EXCEPTION 'Canonical Manchester catalog is incomplete: %/5', v_count;
  END IF;
END
$classification_catalog$;

DO $contract$
DECLARE v_count INTEGER; v_source TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'triagem_fila'
       AND column_name = 'appointment_id' AND data_type = 'bigint'
  ) THEN RAISE EXCEPTION 'triagem_fila.appointment_id is missing'; END IF;

  SELECT count(*) INTO v_count FROM pg_constraint
   WHERE conrelid = 'public.triagem_fila'::regclass
     AND conname IN ('triagem_fila_appointment_id_fkey','triagem_fila_appointment_scope_fkey')
     AND convalidated;
  IF v_count <> 2 THEN RAISE EXCEPTION 'Validated triage appointment FKs are incomplete'; END IF;

  SELECT count(*) INTO v_count
    FROM pg_index index_row
    JOIN pg_class index_class ON index_class.oid = index_row.indexrelid
    JOIN pg_namespace namespace ON namespace.oid = index_class.relnamespace
   WHERE namespace.nspname = 'public'
     AND (
       (index_class.relname = 'idx_triagem_fila_appointment_scope'
         AND NOT index_row.indisunique AND index_row.indnkeyatts = 3
         AND ARRAY(SELECT pg_get_indexdef(index_row.indexrelid, n, TRUE) FROM generate_series(1,3) n)
           = ARRAY['company_id','unit_id','appointment_id']
         AND lower(regexp_replace(replace(replace(pg_get_expr(index_row.indpred,index_row.indrelid,TRUE),'::text',''),'::character varying',''),'[()\s]+','','g'))
           = 'appointment_idisnotnull')
       OR (index_class.relname = 'uq_appointments_clinical_scope'
         AND index_row.indisunique AND index_row.indnkeyatts = 3
         AND ARRAY(SELECT pg_get_indexdef(index_row.indexrelid, n, TRUE) FROM generate_series(1,3) n)
           = ARRAY['company_id','unit_id','id'] AND index_row.indpred IS NULL)
       OR (index_class.relname = 'uq_triagem_fila_appointment_scope'
         AND index_row.indisunique AND index_row.indnkeyatts = 3
         AND ARRAY(SELECT pg_get_indexdef(index_row.indexrelid, n, TRUE) FROM generate_series(1,3) n)
           = ARRAY['company_id','unit_id','appointment_id']
         AND lower(regexp_replace(replace(replace(pg_get_expr(index_row.indpred,index_row.indrelid,TRUE),'::text',''),'::character varying',''),'[()\s]+','','g'))
           = 'appointment_idisnotnullandtp_status<>''desistiu''')
       OR (index_class.relname = 'uq_triagens_appointment_scope'
         AND index_row.indisunique AND index_row.indnkeyatts = 3
         AND ARRAY(SELECT pg_get_indexdef(index_row.indexrelid, n, TRUE) FROM generate_series(1,3) n)
           = ARRAY['company_id','unit_id','cd_appointment']
         AND lower(regexp_replace(replace(replace(pg_get_expr(index_row.indpred,index_row.indrelid,TRUE),'::text',''),'::character varying',''),'[()\s]+','','g'))
           = 'cd_appointmentisnotnull')
       OR (index_class.relname = 'uq_encounters_appointment_scope'
         AND index_row.indisunique AND index_row.indnkeyatts = 3
         AND ARRAY(SELECT pg_get_indexdef(index_row.indexrelid, n, TRUE) FROM generate_series(1,3) n)
           = ARRAY['company_id','unit_id','appointment_id']
         AND lower(regexp_replace(replace(replace(pg_get_expr(index_row.indpred,index_row.indrelid,TRUE),'::text',''),'::character varying',''),'[()\s]+','','g'))
           = 'appointment_idisnotnull')
     );
  IF v_count <> 5 THEN RAISE EXCEPTION 'Canonical handoff index definitions drifted: %/5 valid', v_count; END IF;

  SELECT count(*) INTO v_count FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname IN ('triagem_fila','triagens','news2_avaliacoes','encounters','triagem_reclassificacoes')
     AND c.relrowsecurity AND c.relforcerowsecurity;
  IF v_count <> 5 THEN RAISE EXCEPTION 'FORCE RLS incomplete: %', v_count; END IF;

  SELECT count(*) INTO v_count FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('public','private')
     AND p.proname IN ('m19_prepare_triage_handoff_secure','m19_complete_triage_secure',
       'm19_reclassify_triage_secure','m18_open_attendance_secure',
       'm18_save_attendance_secure','m18_finalize_attendance_secure',
       'm18_complete_attendance_secure')
     AND p.prosecdef AND pg_get_userbyid(p.proowner) = 'prontomedic_clinical_handoff_owner';
  IF v_count <> 7 THEN RAISE EXCEPTION 'Security definer ownership incomplete: %', v_count; END IF;

  IF has_table_privilege('authenticated','public.triagem_fila','INSERT')
     OR has_table_privilege('authenticated','public.triagem_fila','UPDATE')
     OR has_table_privilege('authenticated','public.triagens','INSERT')
     OR has_table_privilege('authenticated','public.triagens','UPDATE')
     OR has_table_privilege('authenticated','public.news2_avaliacoes','INSERT')
     OR has_table_privilege('authenticated','public.encounters','INSERT')
     OR has_table_privilege('authenticated','public.encounters','UPDATE') THEN
    RAISE EXCEPTION 'Authenticated still has direct clinical DML';
  END IF;

  SELECT pg_get_functiondef('public.m19_complete_triage_secure(integer,bigint,bigint,bigint,integer,text,jsonb,jsonb)'::regprocedure)
    INTO v_source;
  IF position('public.active_company_id()' IN v_source) = 0
     OR position('public.active_unit_id()' IN v_source) = 0
     OR position('public.request_aal()' IN v_source) = 0
     OR position('public.can_access(''enfermagem'', ''create'')' IN v_source) = 0
     OR position('queue.appointment_id = v_appointment.id' IN v_source) = 0
     OR position('queue.tp_status IN (''AGUARDANDO'',''CHAMADO'',''EM_TRIAGEM'',''TRIADO'')' IN v_source) = 0
     OR position('''CHAMADO''' IN v_source) = 0
     OR position('''EM_TRIAGEM''' IN v_source) = 0
     OR (length(v_source) - length(replace(v_source, 'private.transition_triage_queue(', ''))) /
        length('private.transition_triage_queue(') < 3 THEN
    RAISE EXCEPTION 'M19 completion lacks active context, AAL2, nursing permission or queue correlation';
  END IF;

  SELECT pg_get_functiondef('public.m19_prepare_triage_handoff_secure(bigint,text)'::regprocedure)
    INTO v_source;
  IF position('public.can_access(''recepcao'', ''edit'')' IN v_source) = 0
     OR position('public.can_access(''enfermagem'', ''create'')' IN v_source) = 0 THEN
    RAISE EXCEPTION 'M19 preparation does not preserve Reception and Nursing ownership';
  END IF;

  SELECT pg_get_functiondef('public.m19_reclassify_triage_secure(bigint,integer,text)'::regprocedure)
    INTO v_source;
  IF position('public.can_access(''enfermagem'', ''edit'')' IN v_source) = 0 THEN
    RAISE EXCEPTION 'M19 reclassification lacks nursing edit permission';
  END IF;

  SELECT pg_get_functiondef('public.m18_open_attendance_secure(bigint,integer,bigint)'::regprocedure)
    INTO v_source;
  IF position('triage.cd_appointment = v_appointment.id' IN v_source) = 0
     OR position('triage.tp_status IN' IN v_source) = 0
     OR position('v_appointment.unit_id' IN v_source) = 0
     OR position('public.request_aal()' IN v_source) = 0
     OR position('public.can_access(''prontuario'', ''create'')' IN v_source) = 0
     OR position('public.can_access(''prontuario'', ''edit'')' IN v_source) = 0
     OR position('public.update_appointment_status_secure(' IN v_source) = 0
     OR position('''in_progress''' IN v_source) = 0
     OR position('public.m18_can_edit_attendance()' IN v_source) <> 0 THEN
    RAISE EXCEPTION 'M18 does not enforce completed correlated M19 triage';
  END IF;

  IF NOT has_function_privilege('authenticated','public.m19_prepare_triage_handoff_secure(bigint,text)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.m19_complete_triage_secure(integer,bigint,bigint,bigint,integer,text,jsonb,jsonb)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.m18_open_attendance_secure(bigint,integer,bigint)','EXECUTE')
     OR NOT has_function_privilege('prontomedic_clinical_handoff_owner','public.can_access(text,text)','EXECUTE')
     OR NOT has_function_privilege('prontomedic_clinical_handoff_owner','public.update_appointment_status_secure(bigint,text,text)','EXECUTE')
     OR NOT has_function_privilege('prontomedic_clinical_handoff_owner','public.current_company_id()','EXECUTE')
     OR NOT has_function_privilege('prontomedic_clinical_handoff_owner','public.audit_current_user_id()','EXECUTE')
     OR NOT has_function_privilege('prontomedic_clinical_handoff_owner','public.audit_has_role(text[])','EXECUTE')
     OR NOT has_function_privilege('prontomedic_clinical_handoff_owner','public.org_can_access_unit(uuid,integer)','EXECUTE')
     OR NOT has_function_privilege('prontomedic_clinical_handoff_owner','private.m19_complete_triage(integer,bigint,bigint,bigint,integer,text,jsonb,jsonb)','EXECUTE')
     OR NOT has_function_privilege('prontomedic_clinical_handoff_owner','private.transition_triage_queue(bigint,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Authenticated RPC grants incomplete';
  END IF;

  SELECT count(*) INTO v_count
    FROM pg_proc procedure
    JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'private'
     AND procedure.proname IN ('m19_complete_triage','m19_reclassify_triage')
     AND pg_get_userbyid(procedure.proowner) = 'prontomedic_rpc_owner';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'Private M19 owners diverge from the canonical RPC owner: %', v_count;
  END IF;
  IF pg_get_userbyid(
    (SELECT proowner FROM pg_proc WHERE oid = 'private.transition_triage_queue(bigint,text,text)'::regprocedure)
  ) <> 'prontomedic_clinical_handoff_owner' THEN
    RAISE EXCEPTION 'Queue transition does not use the scoped clinical handoff owner';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = 'prontomedic_clinical_handoff_owner'
       AND (rolcanlogin OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Clinical handoff owner must be NOLOGIN NOBYPASSRLS';
  END IF;

END
$contract$;

-- Database-enforced idempotency and tenant/unit correlation.
DO $constraints$
DECLARE v_def TEXT; v_count INTEGER;
BEGIN
  SELECT indexdef INTO v_def FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'uq_triagem_fila_appointment_scope';
  IF position('(company_id, unit_id, appointment_id)' IN v_def) = 0
     OR position('tp_status' IN v_def) = 0 THEN
    RAISE EXCEPTION 'Queue uniqueness is not tenant/unit/appointment scoped';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('triagem_fila','triagens','news2_avaliacoes','encounters','triagem_reclassificacoes')
       AND roles && ARRAY['authenticated']::name[]
       AND cmd IN ('INSERT','UPDATE','DELETE','ALL')
  ) THEN RAISE EXCEPTION 'Authenticated write policy remains on a clinical surface'; END IF;
  SELECT count(*) INTO v_count
    FROM pg_policies
   WHERE schemaname = 'public'
     AND roles && ARRAY['prontomedic_clinical_handoff_owner']::name[]
     AND (
       (tablename IN ('appointments','professionals','professional_schedules') AND cmd = 'SELECT')
       OR (tablename IN ('triagem_fila','triagens','news2_avaliacoes','encounters','triagem_reclassificacoes') AND cmd = 'ALL')
     )
     AND coalesce(qual, '') LIKE '%active_company_id%'
     AND coalesce(qual, '') LIKE '%active_unit_id%'
     AND coalesce(qual, '') LIKE '%request_aal%';
  IF v_count <> 8 THEN
    RAISE EXCEPTION 'Restricted RPC owner policies are incomplete: %/8', v_count;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('triagem_fila','triagens','news2_avaliacoes','encounters','triagem_reclassificacoes')
       AND roles && ARRAY['authenticated']::name[]
       AND (coalesce(qual,'') NOT LIKE '%active_company_id%'
         OR coalesce(qual,'') NOT LIKE '%active_unit_id%'
         OR coalesce(qual,'') NOT LIKE '%request_aal%')
  ) THEN RAISE EXCEPTION 'Authenticated read policy is not company/unit/AAL2 scoped'; END IF;
END
$constraints$;

-- Behavioral proof with two synthetic tenants. Context resolvers are replaced
-- only inside this transaction and are restored by the final ROLLBACK.
CREATE OR REPLACE FUNCTION public.active_company_id() RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$ SELECT NULLIF(current_setting('test.active_company', TRUE), '')::UUID $$;
CREATE OR REPLACE FUNCTION public.active_unit_id() RETURNS INTEGER
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$ SELECT NULLIF(current_setting('test.active_unit', TRUE), '')::INTEGER $$;
CREATE OR REPLACE FUNCTION public.request_aal() RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$ SELECT COALESCE(NULLIF(current_setting('test.aal', TRUE), ''), 'aal1') $$;
CREATE OR REPLACE FUNCTION public.audit_current_user_id() RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$ SELECT NULL::UUID $$;
CREATE OR REPLACE FUNCTION public.can_access(p_module TEXT, p_action TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$
  SELECT current_setting('test.can_edit', TRUE) = 'true'
     AND (
       (p_module = 'prontuario' AND p_action IN ('create', 'edit'))
       OR (p_module = 'agenda' AND p_action = 'edit')
     )
$$;

GRANT EXECUTE ON FUNCTION public.active_company_id(), public.active_unit_id(),
  public.request_aal(), public.audit_current_user_id(), public.can_access(TEXT, TEXT)
  TO authenticated, prontomedic_clinical_handoff_owner;

INSERT INTO public.companies(id, name) VALUES
  ('c1800000-0000-4000-8000-000000000001','M18 Tenant A'),
  ('c1800000-0000-4000-8000-000000000002','M18 Tenant B')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.units(id, company_id, cd_codigo, ds_nome) VALUES
  (91801,'c1800000-0000-4000-8000-000000000001','M18-A','M18 Unit A'),
  (91802,'c1800000-0000-4000-8000-000000000002','M18-B','M18 Unit B')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.patients(id, company_id, full_name) VALUES
  (91801,'c1800000-0000-4000-8000-000000000001','M18 Patient A'),
  (91802,'c1800000-0000-4000-8000-000000000002','M18 Patient B')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.professionals(id, company_id, full_name, lg_ativo) VALUES
  (91801,'c1800000-0000-4000-8000-000000000001','M18 Professional A',TRUE),
  (91802,'c1800000-0000-4000-8000-000000000002','M18 Professional B',TRUE)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.professional_schedules(company_id, professional_id, unit_id, day_of_week, lg_habilitado)
VALUES
  ('c1800000-0000-4000-8000-000000000001',91801,91801,'MONDAY',TRUE),
  ('c1800000-0000-4000-8000-000000000002',91802,91802,'MONDAY',TRUE);
-- The behavioral proof starts after reception check-in. The real E2E exercises
-- that workflow; this transaction only seeds its canonical waiting outcome.
SET LOCAL session_replication_role = replica;
INSERT INTO public.appointments(id, company_id, unit_id, patient_id, professional_id,
  appointment_date, start_time, end_time, status)
VALUES
  (91801,'c1800000-0000-4000-8000-000000000001',91801,91801,91801,CURRENT_DATE,'08:00','08:30','waiting'),
  (91802,'c1800000-0000-4000-8000-000000000002',91802,91802,91802,CURRENT_DATE,'09:00','09:30','waiting'),
  (91803,'c1800000-0000-4000-8000-000000000001',91801,91801,91801,CURRENT_DATE,'10:00','10:30','waiting');
SET LOCAL session_replication_role = origin;
INSERT INTO public.triagens(company_id, unit_id, cd_paciente, cd_appointment, tp_status)
VALUES
  ('c1800000-0000-4000-8000-000000000001',91801,91801,91801,'TRIADO'),
  ('c1800000-0000-4000-8000-000000000002',91802,91802,91802,'TRIADO'),
  ('c1800000-0000-4000-8000-000000000001',91801,91801,91803,'TRIADO');

SELECT set_config('test.active_company','c1800000-0000-4000-8000-000000000001',TRUE);
SELECT set_config('test.active_unit','91801',TRUE);
SELECT set_config('test.can_edit','true',TRUE);
SELECT set_config('test.aal','aal1',TRUE);
SET LOCAL ROLE authenticated;
DO $aal1_denied$
BEGIN
  BEGIN
    PERFORM public.m18_open_attendance_secure(91801,91801,91801);
    RAISE EXCEPTION 'AAL1 unexpectedly opened M18';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$aal1_denied$;

SELECT set_config('test.aal','aal2',TRUE);
DO $scope_behaviors$
DECLARE v_first UUID; v_retry UUID; v_atomic UUID;
BEGIN
  BEGIN
    PERFORM public.m18_open_attendance_secure(91801,91801,91802);
    RAISE EXCEPTION 'Cross-tenant professional unexpectedly accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.m18_open_attendance_secure(91801,91802,91801);
    RAISE EXCEPTION 'Divergent unit unexpectedly accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'Unidade informada diverge%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.m18_open_attendance_secure(91802,91801,91801);
    RAISE EXCEPTION 'Second tenant appointment unexpectedly visible';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;

  SELECT id INTO v_first FROM public.m18_open_attendance_secure(91801,91801,91801);
  SELECT id INTO v_retry FROM public.m18_open_attendance_secure(91801,91801,91801);
  IF v_first IS DISTINCT FROM v_retry THEN RAISE EXCEPTION 'M18 open is not idempotent'; END IF;
  PERFORM public.m18_save_attendance_secure(v_first, '{"chief_complaint":"synthetic contract proof"}'::JSONB);

  PERFORM set_config('test.aal','aal1',TRUE);
  BEGIN
    PERFORM public.m18_save_attendance_secure(v_first, '{"anamnesis":"must fail"}'::JSONB);
    RAISE EXCEPTION 'AAL1 unexpectedly saved M18';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.m18_finalize_attendance_secure(v_first,'FINALIZED');
    RAISE EXCEPTION 'AAL1 unexpectedly finalized M18';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  PERFORM set_config('test.aal','aal2',TRUE);
  PERFORM public.m18_finalize_attendance_secure(v_first,'FINALIZED');

  SELECT id INTO v_atomic FROM public.m18_open_attendance_secure(91803,91801,91801);
  PERFORM set_config('test.aal','aal1',TRUE);
  BEGIN
    PERFORM public.m18_complete_attendance_secure(
      v_atomic, '{"chief_complaint":"must fail under aal1"}'::JSONB, 'FINALIZED'
    );
    RAISE EXCEPTION 'AAL1 unexpectedly completed M18 atomically';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('test.aal','aal2',TRUE);
  PERFORM public.m18_complete_attendance_secure(
    v_atomic, '{"chief_complaint":"synthetic atomic completion"}'::JSONB, 'FINALIZED'
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.encounters WHERE id = v_atomic AND status = 'finalizado'
  ) THEN RAISE EXCEPTION 'AAL2 atomic completion did not finalize M18'; END IF;
END
$scope_behaviors$;
RESET ROLE;

DO $rollback_state$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM private.m19_m18_handoff_rollback_state
     WHERE object_type = 'function' AND object_name = 'm18_save_attendance_secure(uuid,jsonb)'
       AND ddl IS NOT NULL AND metadata ? 'owner'
  ) OR NOT EXISTS (
    SELECT 1 FROM private.m19_m18_handoff_rollback_state WHERE object_type = 'table_security'
  ) THEN RAISE EXCEPTION 'Operational rollback snapshot is not restorable'; END IF;
END
$rollback_state$;

SELECT 'M19_M18_CANONICAL_HANDOFF_CONTRACT_PASS' AS result;
ROLLBACK;
