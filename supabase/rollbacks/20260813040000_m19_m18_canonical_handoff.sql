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

DO $restore_policies$
DECLARE v_table TEXT; v_policy RECORD;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['triagem_fila','triagens','news2_avaliacoes','encounters','triagem_reclassificacoes']
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

DELETE FROM private.m19_m18_handoff_rollback_state
 WHERE migration_version = '20260813040000';

COMMIT;
