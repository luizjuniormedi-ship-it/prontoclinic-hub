-- Operational rollback for the canonical M19 -> M18 handoff.
-- Restores the captured pre-migration functions, owners, policies, RLS flags,
-- table privileges and index definitions. The additive appointment_id column is
-- removed only when empty, preventing clinical data loss.
BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('private.m19_m18_handoff_rollback_state') IS NULL THEN
    RAISE EXCEPTION 'Rollback state for 20260813040000 is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM private.m19_m18_handoff_rollback_state
     WHERE object_type = 'function'
       AND object_name = 'm18_save_attendance_secure(uuid,jsonb)'
  ) THEN
    RAISE EXCEPTION 'Captured M18 function state is incomplete';
  END IF;
END
$preflight$;

DROP FUNCTION IF EXISTS public.m19_prepare_triage_handoff_secure(BIGINT, TEXT);
DROP FUNCTION IF EXISTS public.m19_complete_triage_secure(INTEGER, BIGINT, BIGINT, BIGINT, INTEGER, TEXT, JSONB, JSONB);
DROP FUNCTION IF EXISTS public.m19_reclassify_triage_secure(BIGINT, INTEGER, TEXT);

DO $restore_functions$
DECLARE v_state RECORD;
BEGIN
  FOR v_state IN
    SELECT object_name, ddl, metadata
      FROM private.m19_m18_handoff_rollback_state
     WHERE object_type = 'function'
     ORDER BY object_name
  LOOP
    EXECUTE v_state.ddl;
    EXECUTE format('ALTER FUNCTION %s OWNER TO %I', v_state.object_name, v_state.metadata->>'owner');
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated, app_prontomedic', v_state.object_name);
    IF (v_state.metadata->>'authenticated_execute')::BOOLEAN THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_state.object_name);
    END IF;
    IF (v_state.metadata->>'app_execute')::BOOLEAN THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO app_prontomedic', v_state.object_name);
    END IF;
  END LOOP;
END
$restore_functions$;

DO $restore_function_grants$
DECLARE v_execute BOOLEAN;
BEGIN
  SELECT COALESCE((metadata->>'execute')::BOOLEAN, FALSE)
    INTO v_execute
    FROM private.m19_m18_handoff_rollback_state
   WHERE object_type = 'function_grant'
     AND object_name = 'prontomedic_clinical_handoff_owner.sync_completed_appointment_billing_secure(bigint,text)';
  IF NOT COALESCE(v_execute, FALSE) THEN
    REVOKE EXECUTE ON FUNCTION public.sync_completed_appointment_billing_secure(BIGINT, TEXT)
      FROM prontomedic_clinical_handoff_owner;
  END IF;
END
$restore_function_grants$;

DO $restore_policies$
DECLARE v_table TEXT; v_policy RECORD;
BEGIN
  DROP POLICY IF EXISTS clinical_appointments_rpc_read ON public.appointments;
  DROP POLICY IF EXISTS clinical_professionals_rpc_read ON public.professionals;
  DROP POLICY IF EXISTS clinical_professional_schedules_rpc_read ON public.professional_schedules;
  FOREACH v_table IN ARRAY ARRAY['appointments','professionals','professional_schedules','triagem_fila','triagens','news2_avaliacoes','encounters','triagem_reclassificacoes']
  LOOP
    FOR v_policy IN
      SELECT policyname FROM pg_policies
       WHERE schemaname = 'public' AND tablename = v_table
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_policy.policyname, v_table);
    END LOOP;
  END LOOP;
  FOR v_policy IN
    SELECT ddl FROM private.m19_m18_handoff_rollback_state
     WHERE object_type = 'policy' ORDER BY object_name
  LOOP
    EXECUTE v_policy.ddl;
  END LOOP;
END
$restore_policies$;

DO $cleanup_clinical_owner$
DECLARE v_existed BOOLEAN; v_sequence RECORD;
BEGIN
  SELECT (metadata->>'existed')::BOOLEAN INTO v_existed
    FROM private.m19_m18_handoff_rollback_state
   WHERE object_type = 'role' AND object_name = 'prontomedic_clinical_handoff_owner';
  IF v_existed IS FALSE THEN
    REVOKE ALL PRIVILEGES ON public.appointments, public.professionals,
      public.professional_schedules, public.triagem_fila, public.triagens,
      public.news2_avaliacoes, public.encounters, public.triagem_reclassificacoes
      FROM prontomedic_clinical_handoff_owner;
    REVOKE EXECUTE ON FUNCTION public.active_company_id(), public.active_unit_id(),
      public.request_aal(), public.can_access(TEXT, TEXT),
      public.update_appointment_status_secure(BIGINT, TEXT, TEXT),
      public.sync_completed_appointment_billing_secure(BIGINT, TEXT)
      FROM prontomedic_clinical_handoff_owner;
    REVOKE USAGE ON SCHEMA public, private, auth FROM prontomedic_clinical_handoff_owner;
    FOR v_sequence IN
      SELECT quote_ident(sequence_schema) || '.' || quote_ident(sequence_name) AS qualified_name
        FROM information_schema.sequences
       WHERE sequence_schema = 'public'
         AND sequence_name IN (
           SELECT split_part(pg_get_serial_sequence('public.' || table_name, column_name), '.', 2)
             FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name IN ('triagem_fila','triagens','news2_avaliacoes','encounters','triagem_reclassificacoes')
              AND pg_get_serial_sequence('public.' || table_name, column_name) IS NOT NULL
         )
    LOOP
      EXECUTE format('REVOKE USAGE, SELECT ON SEQUENCE %s FROM prontomedic_clinical_handoff_owner', v_sequence.qualified_name);
    END LOOP;
  END IF;
END
$cleanup_clinical_owner$;


DO $restore_table_security$
DECLARE v_state RECORD; v_role TEXT; v_privilege TEXT; v_allowed BOOLEAN;
BEGIN
  FOR v_state IN
    SELECT object_name, metadata
      FROM private.m19_m18_handoff_rollback_state
     WHERE object_type = 'table_security'
     ORDER BY object_name
  LOOP
    EXECUTE format('REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE %s FROM authenticated, app_prontomedic', v_state.object_name);
    FOREACH v_role IN ARRAY ARRAY['authenticated','app'] LOOP
      FOREACH v_privilege IN ARRAY ARRAY['select','insert','update','delete'] LOOP
        v_allowed := COALESCE((v_state.metadata->>(v_role || '_' || v_privilege))::BOOLEAN, FALSE);
        IF v_allowed THEN
          EXECUTE format('GRANT %s ON TABLE %s TO %I', upper(v_privilege), v_state.object_name,
            CASE WHEN v_role = 'app' THEN 'app_prontomedic' ELSE 'authenticated' END);
        END IF;
      END LOOP;
    END LOOP;
    EXECUTE format('ALTER TABLE %s %s ROW LEVEL SECURITY', v_state.object_name,
      CASE WHEN (v_state.metadata->>'rls')::BOOLEAN THEN 'ENABLE' ELSE 'DISABLE' END);
    EXECUTE format('ALTER TABLE %s %s ROW LEVEL SECURITY', v_state.object_name,
      CASE WHEN (v_state.metadata->>'force_rls')::BOOLEAN THEN 'FORCE' ELSE 'NO FORCE' END);
  END LOOP;
END
$restore_table_security$;

ALTER TABLE public.triagem_fila DROP CONSTRAINT IF EXISTS triagem_fila_appointment_scope_fkey;
ALTER TABLE public.triagem_fila DROP CONSTRAINT IF EXISTS triagem_fila_appointment_id_fkey;

DO $restore_indexes$
DECLARE v_name TEXT; v_state RECORD;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'idx_triagem_fila_appointment_scope','uq_appointments_clinical_scope',
    'uq_triagem_fila_appointment_scope','uq_triagens_appointment_scope',
    'uq_encounters_appointment_scope'
  ] LOOP
    EXECUTE format('DROP INDEX IF EXISTS public.%I', v_name);
  END LOOP;
  FOR v_state IN
    SELECT ddl FROM private.m19_m18_handoff_rollback_state
     WHERE object_type = 'index' ORDER BY object_name
  LOOP
    EXECUTE v_state.ddl;
  END LOOP;
END
$restore_indexes$;

DO $optional_column$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'triagem_fila' AND column_name = 'appointment_id'
  ) AND NOT EXISTS (SELECT 1 FROM public.triagem_fila WHERE appointment_id IS NOT NULL) THEN
    ALTER TABLE public.triagem_fila DROP COLUMN appointment_id;
  END IF;
END
$optional_column$;

DELETE FROM public.mnct_classificacao_risco classification
 USING private.m19_m18_handoff_rollback_state state
 WHERE state.object_type = 'catalog_seed'
   AND state.migration_version = '20260813040000'
   AND classification.ds_classificacao = state.metadata->>'ds_classificacao';

DO $drop_new_clinical_owner$
DECLARE v_existed BOOLEAN;
BEGIN
  SELECT (metadata->>'existed')::BOOLEAN INTO v_existed
    FROM private.m19_m18_handoff_rollback_state
   WHERE object_type = 'role' AND object_name = 'prontomedic_clinical_handoff_owner';
  IF v_existed IS FALSE
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prontomedic_clinical_handoff_owner')
     AND NOT EXISTS (
       SELECT 1 FROM pg_shdepend dependency
        JOIN pg_roles role ON role.oid = dependency.refobjid
       WHERE role.rolname = 'prontomedic_clinical_handoff_owner'
         AND dependency.deptype IN ('a','o')
     ) THEN
    DROP ROLE prontomedic_clinical_handoff_owner;
  END IF;
END
$drop_new_clinical_owner$;

DELETE FROM private.m19_m18_handoff_rollback_state
 WHERE migration_version = '20260813040000';

COMMIT;
