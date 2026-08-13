-- Canonical M19 -> M18 clinical handoff.
-- Additive only. DataSIGH is intentionally not referenced.
BEGIN;

CREATE TABLE IF NOT EXISTS private.m19_m18_handoff_rollback_state (
  object_type TEXT NOT NULL,
  object_name TEXT NOT NULL,
  ddl TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (object_type, object_name)
);
ALTER TABLE private.m19_m18_handoff_rollback_state
  ADD COLUMN IF NOT EXISTS migration_version TEXT NOT NULL DEFAULT '20260813040000';
REVOKE ALL ON private.m19_m18_handoff_rollback_state FROM PUBLIC, anon, authenticated, app_prontomedic;

DO $snapshot_lifecycle$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM private.m19_m18_handoff_rollback_state
     WHERE object_type = 'lifecycle' AND object_name = '20260813040000.active'
  ) THEN
    DELETE FROM private.m19_m18_handoff_rollback_state
     WHERE migration_version = '20260813040000';
    INSERT INTO private.m19_m18_handoff_rollback_state(
      object_type, object_name, metadata, migration_version
    ) VALUES (
      'lifecycle', '20260813040000.active',
      jsonb_build_object('captured_at', clock_timestamp()), '20260813040000'
    );
    PERFORM set_config('prontomedic.snapshot_new', 'true', TRUE);
  ELSE
    PERFORM set_config('prontomedic.snapshot_new', 'false', TRUE);
  END IF;
END
$snapshot_lifecycle$;

DO $clinical_owner$
DECLARE v_existed BOOLEAN := EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = 'prontomedic_clinical_handoff_owner'
);
BEGIN
  INSERT INTO private.m19_m18_handoff_rollback_state(object_type, object_name, metadata)
  VALUES ('role', 'prontomedic_clinical_handoff_owner', jsonb_build_object('existed', v_existed))
  ON CONFLICT (object_type, object_name) DO NOTHING;
  IF NOT v_existed THEN
    CREATE ROLE prontomedic_clinical_handoff_owner NOLOGIN NOBYPASSRLS;
  ELSIF EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = 'prontomedic_clinical_handoff_owner' AND rolbypassrls
  ) THEN
    RAISE EXCEPTION 'Clinical handoff owner must not bypass RLS';
  END IF;
END
$clinical_owner$;

GRANT USAGE ON SCHEMA public, private, auth TO prontomedic_clinical_handoff_owner;

INSERT INTO private.m19_m18_handoff_rollback_state(object_type, object_name, ddl, metadata)
SELECT 'function', p.oid::regprocedure::TEXT, pg_get_functiondef(p.oid),
       jsonb_build_object(
         'owner', pg_get_userbyid(p.proowner),
         'authenticated_execute', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
         'app_execute', has_function_privilege('app_prontomedic', p.oid, 'EXECUTE')
       )
  FROM pg_proc p
 WHERE p.oid IN (
   'public.m18_open_attendance_secure(bigint,integer,bigint)'::regprocedure,
   'public.m18_save_attendance_secure(uuid,jsonb)'::regprocedure,
   'public.m18_finalize_attendance_secure(uuid,text)'::regprocedure,
   'public.m18_complete_attendance_secure(uuid,jsonb,text)'::regprocedure,
   'private.m19_complete_triage(integer,bigint,bigint,bigint,integer,text,jsonb,jsonb)'::regprocedure,
   'private.m19_reclassify_triage(bigint,integer,text)'::regprocedure,
   'private.transition_triage_queue(bigint,text,text)'::regprocedure
 ) AND current_setting('prontomedic.snapshot_new') = 'true'
ON CONFLICT (object_type, object_name) DO NOTHING;

INSERT INTO private.m19_m18_handoff_rollback_state(object_type, object_name, metadata)
SELECT 'table_security', c.oid::regclass::TEXT, jsonb_build_object(
         'rls', c.relrowsecurity,
         'force_rls', c.relforcerowsecurity,
         'authenticated_select', has_table_privilege('authenticated', c.oid, 'SELECT'),
         'authenticated_insert', has_table_privilege('authenticated', c.oid, 'INSERT'),
         'authenticated_update', has_table_privilege('authenticated', c.oid, 'UPDATE'),
         'authenticated_delete', has_table_privilege('authenticated', c.oid, 'DELETE'),
         'app_select', has_table_privilege('app_prontomedic', c.oid, 'SELECT'),
         'app_insert', has_table_privilege('app_prontomedic', c.oid, 'INSERT'),
         'app_update', has_table_privilege('app_prontomedic', c.oid, 'UPDATE'),
         'app_delete', has_table_privilege('app_prontomedic', c.oid, 'DELETE')
       )
  FROM pg_class c
 WHERE c.oid IN (
   'public.triagem_fila'::regclass, 'public.triagens'::regclass,
   'public.news2_avaliacoes'::regclass, 'public.encounters'::regclass,
   'public.triagem_reclassificacoes'::regclass
 ) AND current_setting('prontomedic.snapshot_new') = 'true'
ON CONFLICT (object_type, object_name) DO NOTHING;

INSERT INTO private.m19_m18_handoff_rollback_state(object_type, object_name, ddl)
SELECT 'policy', format('%I.%I.%I', schemaname, tablename, policyname),
       format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s',
         policyname, schemaname, tablename,
         CASE WHEN permissive = 'PERMISSIVE' THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
         cmd,
         array_to_string(ARRAY(SELECT quote_ident(role_name) FROM unnest(roles) role_name), ', '),
         CASE WHEN qual IS NULL THEN '' ELSE format(' USING (%s)', qual) END,
         CASE WHEN with_check IS NULL THEN '' ELSE format(' WITH CHECK (%s)', with_check) END)
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('appointments','professionals','professional_schedules','triagem_fila','triagens','news2_avaliacoes','encounters','triagem_reclassificacoes')
   AND current_setting('prontomedic.snapshot_new') = 'true'
ON CONFLICT (object_type, object_name) DO NOTHING;

INSERT INTO private.m19_m18_handoff_rollback_state(object_type, object_name, ddl)
SELECT 'index', indexname, indexdef
  FROM pg_indexes
 WHERE schemaname = 'public'
   AND indexname IN ('idx_triagem_fila_appointment_scope','uq_appointments_clinical_scope',
     'uq_triagem_fila_appointment_scope','uq_triagens_appointment_scope','uq_encounters_appointment_scope')
   AND current_setting('prontomedic.snapshot_new') = 'true'
ON CONFLICT (object_type, object_name) DO NOTHING;

DO $preflight$
BEGIN
  IF to_regclass('public.triagem_fila') IS NULL
     OR to_regclass('public.triagens') IS NULL
     OR to_regclass('public.encounters') IS NULL
     OR to_regclass('public.appointments') IS NULL
     OR to_regprocedure('public.active_company_id()') IS NULL
     OR to_regprocedure('public.active_unit_id()') IS NULL
     OR to_regprocedure('public.request_aal()') IS NULL THEN
    RAISE EXCEPTION 'M19/M18 canonical handoff prerequisites are missing';
  END IF;
END
$preflight$;

ALTER TABLE public.triagem_fila
  ADD COLUMN IF NOT EXISTS appointment_id BIGINT;

DO $fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.triagem_fila'::regclass
       AND conname = 'triagem_fila_appointment_id_fkey'
  ) THEN
    ALTER TABLE public.triagem_fila
      ADD CONSTRAINT triagem_fila_appointment_id_fkey
      FOREIGN KEY (appointment_id) REFERENCES public.appointments(id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
END
$fk$;

DO $orphans$
DECLARE v_count BIGINT;
BEGIN
  SELECT count(*) INTO v_count
    FROM public.triagem_fila queue
    LEFT JOIN public.appointments appointment ON appointment.id = queue.appointment_id
   WHERE queue.appointment_id IS NOT NULL
     AND (
       appointment.id IS NULL
       OR appointment.company_id IS DISTINCT FROM queue.company_id
       OR appointment.unit_id IS DISTINCT FROM queue.unit_id
       OR appointment.patient_id IS DISTINCT FROM queue.cd_paciente
     );
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Cannot validate triage/appointment correlation: % inconsistent rows', v_count;
  END IF;
  ALTER TABLE public.triagem_fila VALIDATE CONSTRAINT triagem_fila_appointment_id_fkey;
END
$orphans$;

DO $indexes$
DECLARE
  v_name TEXT;
  v_unique BOOLEAN;
  v_columns TEXT[];
  v_predicate TEXT;
  v_create TEXT;
  v_index RECORD;
  v_actual_columns TEXT[];
BEGIN
  FOR v_name, v_unique, v_columns, v_predicate, v_create IN VALUES
    ('idx_triagem_fila_appointment_scope', FALSE, ARRAY['company_id','unit_id','appointment_id'], '(appointment_id IS NOT NULL)',
      'CREATE INDEX idx_triagem_fila_appointment_scope ON public.triagem_fila(company_id, unit_id, appointment_id) WHERE appointment_id IS NOT NULL'),
    ('uq_appointments_clinical_scope', TRUE, ARRAY['company_id','unit_id','id'], NULL,
      'CREATE UNIQUE INDEX uq_appointments_clinical_scope ON public.appointments(company_id, unit_id, id)'),
    ('uq_triagem_fila_appointment_scope', TRUE, ARRAY['company_id','unit_id','appointment_id'], '((appointment_id IS NOT NULL) AND (tp_status <> ''DESISTIU''::text))',
      'CREATE UNIQUE INDEX uq_triagem_fila_appointment_scope ON public.triagem_fila(company_id, unit_id, appointment_id) WHERE appointment_id IS NOT NULL AND tp_status <> ''DESISTIU'''),
    ('uq_triagens_appointment_scope', TRUE, ARRAY['company_id','unit_id','cd_appointment'], '(cd_appointment IS NOT NULL)',
      'CREATE UNIQUE INDEX uq_triagens_appointment_scope ON public.triagens(company_id, unit_id, cd_appointment) WHERE cd_appointment IS NOT NULL'),
    ('uq_encounters_appointment_scope', TRUE, ARRAY['company_id','unit_id','appointment_id'], '(appointment_id IS NOT NULL)',
      'CREATE UNIQUE INDEX uq_encounters_appointment_scope ON public.encounters(company_id, unit_id, appointment_id) WHERE appointment_id IS NOT NULL')
  LOOP
    SELECT i.indexrelid, i.indisunique, i.indnkeyatts,
           pg_get_expr(i.indpred, i.indrelid, TRUE) AS predicate
      INTO v_index
      FROM pg_index i
      JOIN pg_class index_class ON index_class.oid = i.indexrelid
      JOIN pg_namespace namespace ON namespace.oid = index_class.relnamespace
     WHERE namespace.nspname = 'public' AND index_class.relname = v_name;
    IF NOT FOUND THEN
      EXECUTE v_create;
    ELSE
      SELECT array_agg(pg_get_indexdef(v_index.indexrelid, position, TRUE) ORDER BY position)
        INTO v_actual_columns
        FROM generate_series(1, v_index.indnkeyatts) position;
      IF v_index.indisunique IS DISTINCT FROM v_unique
         OR v_actual_columns IS DISTINCT FROM v_columns
         OR lower(regexp_replace(replace(replace(COALESCE(v_index.predicate, ''), '::text', ''), '::character varying', ''), '[()\s]+', '', 'g'))
              IS DISTINCT FROM lower(regexp_replace(replace(replace(COALESCE(v_predicate, ''), '::text', ''), '::character varying', ''), '[()\s]+', '', 'g')) THEN
        RAISE EXCEPTION 'Index drift detected for %: unique=%, columns=%, predicate=%',
          v_name, v_index.indisunique, v_actual_columns, v_index.predicate;
      END IF;
    END IF;
  END LOOP;
END
$indexes$;

DO $scope_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.triagem_fila'::regclass
       AND conname = 'triagem_fila_appointment_scope_fkey'
  ) THEN
    ALTER TABLE public.triagem_fila
      ADD CONSTRAINT triagem_fila_appointment_scope_fkey
      FOREIGN KEY (company_id, unit_id, appointment_id)
      REFERENCES public.appointments(company_id, unit_id, id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
  ALTER TABLE public.triagem_fila
    VALIDATE CONSTRAINT triagem_fila_appointment_scope_fkey;
END
$scope_fk$;

ALTER TABLE public.triagem_fila ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.triagem_fila FORCE ROW LEVEL SECURITY;
ALTER TABLE public.triagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.triagens FORCE ROW LEVEL SECURITY;
ALTER TABLE public.news2_avaliacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.news2_avaliacoes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.encounters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.encounters FORCE ROW LEVEL SECURITY;
ALTER TABLE public.triagem_reclassificacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.triagem_reclassificacoes FORCE ROW LEVEL SECURITY;

DO $policies$
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
END
$policies$;

CREATE POLICY clinical_queue_read ON public.triagem_fila
  FOR SELECT TO authenticated, app_prontomedic
  USING (
    public.request_aal() = 'aal2'
    AND company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
  );
CREATE POLICY clinical_triages_read ON public.triagens
  FOR SELECT TO authenticated, app_prontomedic
  USING (
    public.request_aal() = 'aal2'
    AND company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
  );
CREATE POLICY clinical_news2_read ON public.news2_avaliacoes
  FOR SELECT TO authenticated, app_prontomedic
  USING (
    public.request_aal() = 'aal2'
    AND company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
  );
CREATE POLICY clinical_encounters_read ON public.encounters
  FOR SELECT TO authenticated, app_prontomedic
  USING (
    public.request_aal() = 'aal2'
    AND company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
  );

CREATE POLICY clinical_reclassifications_read ON public.triagem_reclassificacoes
  FOR SELECT TO authenticated, app_prontomedic
  USING (
    public.request_aal() = 'aal2'
    AND company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
  );

DROP POLICY IF EXISTS clinical_appointments_rpc_read ON public.appointments;
CREATE POLICY clinical_appointments_rpc_read ON public.appointments
  FOR SELECT TO prontomedic_clinical_handoff_owner
  USING (
    public.request_aal() = 'aal2'
    AND company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
  );

DROP POLICY IF EXISTS clinical_professionals_rpc_read ON public.professionals;
CREATE POLICY clinical_professionals_rpc_read ON public.professionals
  FOR SELECT TO prontomedic_clinical_handoff_owner
  USING (
    public.request_aal() = 'aal2'
    AND company_id = public.active_company_id()
    AND public.active_unit_id() IS NOT NULL
    AND lg_ativo = TRUE
  );
DROP POLICY IF EXISTS clinical_professional_schedules_rpc_read ON public.professional_schedules;
CREATE POLICY clinical_professional_schedules_rpc_read ON public.professional_schedules
  FOR SELECT TO prontomedic_clinical_handoff_owner
  USING (
    public.request_aal() = 'aal2'
    AND company_id = public.active_company_id()
    AND public.active_unit_id() IN (unit_id, slot1_unit_id, slot2_unit_id, slot3_unit_id)
    AND lg_habilitado = TRUE
  );

CREATE POLICY clinical_queue_rpc_write ON public.triagem_fila
  FOR ALL TO prontomedic_clinical_handoff_owner
  USING (public.request_aal() = 'aal2' AND company_id = public.active_company_id() AND unit_id = public.active_unit_id())
  WITH CHECK (public.request_aal() = 'aal2' AND company_id = public.active_company_id() AND unit_id = public.active_unit_id());
CREATE POLICY clinical_triages_rpc_write ON public.triagens
  FOR ALL TO prontomedic_clinical_handoff_owner
  USING (public.request_aal() = 'aal2' AND company_id = public.active_company_id() AND unit_id = public.active_unit_id())
  WITH CHECK (public.request_aal() = 'aal2' AND company_id = public.active_company_id() AND unit_id = public.active_unit_id());
CREATE POLICY clinical_news2_rpc_write ON public.news2_avaliacoes
  FOR ALL TO prontomedic_clinical_handoff_owner
  USING (public.request_aal() = 'aal2' AND company_id = public.active_company_id() AND unit_id = public.active_unit_id())
  WITH CHECK (public.request_aal() = 'aal2' AND company_id = public.active_company_id() AND unit_id = public.active_unit_id());
CREATE POLICY clinical_encounters_rpc_write ON public.encounters
  FOR ALL TO prontomedic_clinical_handoff_owner
  USING (public.request_aal() = 'aal2' AND company_id = public.active_company_id() AND unit_id = public.active_unit_id())
  WITH CHECK (public.request_aal() = 'aal2' AND company_id = public.active_company_id() AND unit_id = public.active_unit_id());
CREATE POLICY clinical_reclassifications_rpc_write ON public.triagem_reclassificacoes
  FOR ALL TO prontomedic_clinical_handoff_owner
  USING (public.request_aal() = 'aal2' AND company_id = public.active_company_id() AND unit_id = public.active_unit_id())
  WITH CHECK (public.request_aal() = 'aal2' AND company_id = public.active_company_id() AND unit_id = public.active_unit_id());

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON
  public.triagem_fila, public.triagens, public.news2_avaliacoes, public.encounters,
  public.triagem_reclassificacoes
  FROM authenticated, app_prontomedic;
GRANT SELECT ON public.triagem_fila, public.triagens, public.news2_avaliacoes,
  public.encounters, public.triagem_reclassificacoes
  TO authenticated, app_prontomedic;
GRANT SELECT ON public.appointments, public.professionals, public.professional_schedules
  TO prontomedic_clinical_handoff_owner;
GRANT SELECT, INSERT, UPDATE ON public.triagem_fila, public.triagens, public.encounters
  TO prontomedic_clinical_handoff_owner;
GRANT SELECT, INSERT ON public.news2_avaliacoes, public.triagem_reclassificacoes
  TO prontomedic_clinical_handoff_owner;
DO $clinical_sequences$
DECLARE v_table TEXT; v_sequence TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['triagem_fila','triagens','news2_avaliacoes','encounters','triagem_reclassificacoes']
  LOOP
    SELECT pg_get_serial_sequence('public.' || v_table, 'id') INTO v_sequence;
    IF v_sequence IS NOT NULL THEN
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO prontomedic_clinical_handoff_owner', v_sequence);
    END IF;
  END LOOP;
END
$clinical_sequences$;
GRANT EXECUTE ON FUNCTION public.active_company_id(), public.active_unit_id(),
  public.request_aal(), public.can_access(TEXT, TEXT)
  TO prontomedic_clinical_handoff_owner;

CREATE OR REPLACE FUNCTION public.m19_prepare_triage_handoff_secure(
  p_appointment_id BIGINT,
  p_complaint TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, auth
AS $function$
DECLARE
  v_company UUID := public.active_company_id();
  v_unit INTEGER := public.active_unit_id();
  v_appointment public.appointments;
  v_queue public.triagem_fila;
  v_number INTEGER;
BEGIN
  IF public.request_aal() <> 'aal2' OR v_company IS NULL OR v_unit IS NULL
     OR NOT (
       public.can_access('recepcao', 'edit')
       OR public.can_access('enfermagem', 'create')
     ) THEN
    RAISE EXCEPTION 'Contexto AAL2, unidade e permissão de encaminhamento são obrigatórios' USING ERRCODE = '42501';
  END IF;
  IF p_appointment_id IS NULL THEN RAISE EXCEPTION 'Agendamento é obrigatório'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_company::TEXT || ':' || v_unit::TEXT || ':' || p_appointment_id::TEXT, 0));
  SELECT * INTO v_appointment FROM public.appointments appointment
   WHERE appointment.id = p_appointment_id
     AND appointment.company_id = v_company
     AND appointment.unit_id = v_unit
     AND appointment.patient_id IS NOT NULL
     AND appointment.status IN ('waiting','checked_in','confirmed');
  IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento indisponível no contexto clínico ativo' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO v_queue FROM public.triagem_fila queue
   WHERE queue.company_id = v_company AND queue.unit_id = v_unit
     AND queue.appointment_id = v_appointment.id AND queue.tp_status <> 'DESISTIU'
   FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object('queue', to_jsonb(v_queue), 'idempotent', TRUE);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('triage-ticket:' || v_company::TEXT || ':' || v_unit::TEXT || ':' || CURRENT_DATE::TEXT, 0));
  SELECT count(*) + 1 INTO v_number FROM public.triagem_fila queue
   WHERE queue.company_id = v_company AND queue.unit_id = v_unit
     AND (queue.dt_chegada AT TIME ZONE 'America/Sao_Paulo')::DATE = CURRENT_DATE;
  INSERT INTO public.triagem_fila(company_id, unit_id, appointment_id, cd_paciente, cd_senha, tp_status, ds_queixa_inicial)
  VALUES (v_company, v_unit, v_appointment.id, v_appointment.patient_id,
          'T' || lpad(v_number::TEXT, 3, '0'), 'AGUARDANDO', NULLIF(btrim(p_complaint), ''))
  RETURNING * INTO v_queue;
  RETURN jsonb_build_object('queue', to_jsonb(v_queue), 'idempotent', FALSE);
END;
$function$;

CREATE OR REPLACE FUNCTION public.m19_complete_triage_secure(
  p_unit_id INTEGER,
  p_patient_id BIGINT,
  p_appointment_id BIGINT DEFAULT NULL,
  p_queue_id BIGINT DEFAULT NULL,
  p_classification_id INTEGER DEFAULT NULL,
  p_classification_reason TEXT DEFAULT NULL,
  p_payload JSONB DEFAULT '{}'::JSONB,
  p_news2 JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, auth
AS $function$
DECLARE
  v_company UUID := public.active_company_id();
  v_unit INTEGER := public.active_unit_id();
  v_queue public.triagem_fila;
  v_appointment public.appointments;
  v_result JSONB;
BEGIN
  IF public.request_aal() <> 'aal2' OR v_company IS NULL OR v_unit IS NULL
     OR NOT public.can_access('enfermagem', 'create') THEN
    RAISE EXCEPTION 'Contexto AAL2, unidade e permissão de triagem são obrigatórios' USING ERRCODE = '42501';
  END IF;
  IF p_unit_id IS DISTINCT FROM v_unit OR p_patient_id IS NULL
     OR p_appointment_id IS NULL OR p_queue_id IS NULL THEN
    RAISE EXCEPTION 'Fila, agendamento, paciente e unidade ativos são obrigatórios';
  END IF;
  SELECT * INTO v_appointment FROM public.appointments appointment
   WHERE appointment.id = p_appointment_id AND appointment.company_id = v_company
     AND appointment.unit_id = v_unit AND appointment.patient_id = p_patient_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento fora do contexto clínico ativo' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_queue FROM public.triagem_fila queue
   WHERE queue.id = p_queue_id AND queue.company_id = v_company AND queue.unit_id = v_unit
     AND queue.appointment_id = v_appointment.id AND queue.cd_paciente = v_appointment.patient_id
     AND queue.tp_status IN ('CHAMADO','EM_TRIAGEM','TRIADO')
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fila não corresponde ao agendamento, paciente e unidade'; END IF;

  v_result := private.m19_complete_triage(p_unit_id, p_patient_id, p_appointment_id,
    p_queue_id, p_classification_id, p_classification_reason, p_payload, p_news2);
  IF NOT EXISTS (
    SELECT 1 FROM public.triagens triage
     WHERE triage.company_id = v_company AND triage.unit_id = v_unit
       AND triage.cd_appointment = p_appointment_id AND triage.triagem_fila_id = p_queue_id
       AND triage.cd_paciente = p_patient_id AND triage.tp_status IN ('TRIADO','ENCAMINHADO','FINALIZADO')
  ) THEN RAISE EXCEPTION 'Conclusão M19 não produziu handoff clínico correlacionado'; END IF;
  RETURN v_result || jsonb_build_object('appointment_id', p_appointment_id, 'queue_id', p_queue_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.m18_open_attendance_secure(
  p_appointment_id BIGINT,
  p_unit_id INTEGER DEFAULT NULL,
  p_professional_id BIGINT DEFAULT NULL
)
RETURNS public.encounters
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, auth
AS $function$
DECLARE
  v_company UUID := public.active_company_id();
  v_unit INTEGER := public.active_unit_id();
  v_appointment public.appointments;
  v_triage public.triagens;
  v_row public.encounters;
  v_professional_id BIGINT;
BEGIN
  IF public.request_aal() <> 'aal2' OR v_company IS NULL OR v_unit IS NULL
     OR NOT public.m18_can_edit_attendance() THEN
    RAISE EXCEPTION 'Contexto AAL2 ou permissão clínica inválidos' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'm18-open:' || v_company::TEXT || ':' || p_appointment_id::TEXT, 0));
  SELECT * INTO v_appointment FROM public.appointments appointment
   WHERE appointment.id = p_appointment_id AND appointment.company_id = v_company
     AND appointment.unit_id = v_unit AND appointment.patient_id IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento não encontrado no contexto ativo' USING ERRCODE = 'P0002'; END IF;
  IF p_unit_id IS NOT NULL AND p_unit_id IS DISTINCT FROM v_appointment.unit_id THEN
    RAISE EXCEPTION 'Unidade informada diverge da unidade canônica do agendamento';
  END IF;
  SELECT * INTO v_triage FROM public.triagens triage
   WHERE triage.company_id = v_company AND triage.unit_id = v_appointment.unit_id
     AND triage.cd_appointment = v_appointment.id AND triage.cd_paciente = v_appointment.patient_id
     AND triage.tp_status IN ('TRIADO','ENCAMINHADO','FINALIZADO')
   ORDER BY triage.dt_triagem DESC, triage.id DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Atendimento médico exige triagem M19 concluída e correlacionada'; END IF;

  v_professional_id := COALESCE(p_professional_id, v_appointment.professional_id);
  IF v_professional_id IS NULL OR NOT EXISTS (
    SELECT 1
      FROM public.professionals professional
     WHERE professional.id = v_professional_id
       AND professional.company_id = v_company
       AND professional.lg_ativo = TRUE
       AND EXISTS (
         SELECT 1
           FROM public.professional_schedules schedule
          WHERE schedule.professional_id = professional.id
            AND schedule.company_id = v_company
            AND schedule.lg_habilitado = TRUE
            AND v_unit IN (schedule.unit_id, schedule.slot1_unit_id, schedule.slot2_unit_id, schedule.slot3_unit_id)
       )
  ) THEN
    RAISE EXCEPTION 'Profissional não pertence à empresa/unidade clínica ativa' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.encounters encounter
   WHERE encounter.company_id = v_company AND encounter.unit_id = v_appointment.unit_id
     AND encounter.appointment_id = v_appointment.id AND encounter.status <> 'cancelado'
   ORDER BY encounter.created_at DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    IF v_row.status IN ('finalizado','alta_ambulatorial','encaminhado','internado') THEN
      RAISE EXCEPTION 'Atendimento já finalizado';
    END IF;
    UPDATE public.encounters SET status = 'em_atendimento', updated_at = NOW()
     WHERE id = v_row.id RETURNING * INTO v_row;
    RETURN v_row;
  END IF;
  INSERT INTO public.encounters(company_id, unit_id, patient_id, professional_id,
    appointment_id, created_by, status)
  VALUES (v_company, v_appointment.unit_id, v_appointment.patient_id,
    v_professional_id, v_appointment.id,
    public.audit_current_user_id(), 'em_atendimento')
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.m18_save_attendance_secure(
  p_encounter_id UUID,
  p_payload JSONB
)
RETURNS public.encounters
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, auth
AS $function$
DECLARE
  v_company UUID := public.active_company_id();
  v_unit INTEGER := public.active_unit_id();
  v_row public.encounters;
BEGIN
  IF public.request_aal() <> 'aal2' OR v_company IS NULL OR v_unit IS NULL
     OR NOT public.m18_can_edit_attendance() THEN
    RAISE EXCEPTION 'Contexto AAL2, empresa, unidade e permissão clínica são obrigatórios' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(COALESCE(p_payload, '{}'::JSONB)) <> 'object' THEN
    RAISE EXCEPTION 'Dados do atendimento inválidos';
  END IF;

  UPDATE public.encounters SET
    chief_complaint = CASE WHEN p_payload ? 'chief_complaint' THEN NULLIF(BTRIM(p_payload->>'chief_complaint'), '') ELSE chief_complaint END,
    anamnesis = CASE WHEN p_payload ? 'anamnesis' THEN NULLIF(BTRIM(p_payload->>'anamnesis'), '') ELSE anamnesis END,
    physical_exam = CASE WHEN p_payload ? 'physical_exam' THEN NULLIF(BTRIM(p_payload->>'physical_exam'), '') ELSE physical_exam END,
    vital_signs = CASE WHEN p_payload ? 'vital_signs' AND jsonb_typeof(p_payload->'vital_signs') = 'object' THEN p_payload->'vital_signs' ELSE vital_signs END,
    diagnoses = CASE WHEN p_payload ? 'diagnoses' AND jsonb_typeof(p_payload->'diagnoses') = 'array' THEN p_payload->'diagnoses' ELSE diagnoses END,
    conduct = CASE WHEN p_payload ? 'conduct' THEN NULLIF(BTRIM(p_payload->>'conduct'), '') ELSE conduct END,
    procedures = CASE WHEN p_payload ? 'procedures' AND jsonb_typeof(p_payload->'procedures') = 'array' THEN p_payload->'procedures' ELSE procedures END,
    prescriptions = CASE WHEN p_payload ? 'prescriptions' AND jsonb_typeof(p_payload->'prescriptions') = 'array' THEN p_payload->'prescriptions' ELSE prescriptions END,
    exams = CASE WHEN p_payload ? 'exams' AND jsonb_typeof(p_payload->'exams') = 'array' THEN p_payload->'exams' ELSE exams END,
    certificate = CASE WHEN p_payload ? 'certificate' THEN p_payload->'certificate' ELSE certificate END,
    referral = CASE WHEN p_payload ? 'referral' THEN p_payload->'referral' ELSE referral END,
    return_plan = CASE WHEN p_payload ? 'return_plan' THEN NULLIF(BTRIM(p_payload->>'return_plan'), '') ELSE return_plan END,
    discharge_summary = CASE WHEN p_payload ? 'discharge_summary' THEN NULLIF(BTRIM(p_payload->>'discharge_summary'), '') ELSE discharge_summary END,
    admission_plan = CASE WHEN p_payload ? 'admission_plan' THEN NULLIF(BTRIM(p_payload->>'admission_plan'), '') ELSE admission_plan END,
    status = 'em_atendimento', updated_at = NOW()
  WHERE id = p_encounter_id
    AND company_id = v_company
    AND unit_id = v_unit
    AND status IN ('em_atendimento','aguardando_assinatura','reaberto')
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Atendimento não encontrado ou não editável no contexto ativo' USING ERRCODE = 'P0002'; END IF;
  IF NULLIF(BTRIM(v_row.chief_complaint), '') IS NULL
     AND NULLIF(BTRIM(v_row.anamnesis), '') IS NULL
     AND NULLIF(BTRIM(v_row.physical_exam), '') IS NULL THEN
    RAISE EXCEPTION 'Informe queixa, anamnese ou exame físico';
  END IF;
  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.m18_finalize_attendance_secure(
  p_encounter_id UUID,
  p_disposition TEXT DEFAULT 'FINALIZED'
)
RETURNS public.encounters
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, auth
AS $function$
DECLARE
  v_company UUID := public.active_company_id();
  v_unit INTEGER := public.active_unit_id();
  v_row public.encounters;
  v_status TEXT := CASE upper(COALESCE(p_disposition, 'FINALIZED'))
    WHEN 'FINALIZED' THEN 'finalizado'
    WHEN 'DISCHARGED' THEN 'alta_ambulatorial'
    WHEN 'REFERRED' THEN 'encaminhado'
    WHEN 'ADMITTED' THEN 'internado'
    ELSE '' END;
BEGIN
  IF public.request_aal() <> 'aal2' OR v_company IS NULL OR v_unit IS NULL
     OR NOT public.m18_can_edit_attendance() THEN
    RAISE EXCEPTION 'Contexto AAL2, empresa, unidade e permissão clínica são obrigatórios' USING ERRCODE = '42501';
  END IF;
  IF v_status = '' THEN RAISE EXCEPTION 'Destino clínico inválido'; END IF;

  UPDATE public.encounters SET
    status = v_status,
    signed_by = public.audit_current_user_id(),
    signed_at = NOW(), finalized_at = NOW(), updated_at = NOW()
  WHERE id = p_encounter_id
    AND company_id = v_company
    AND unit_id = v_unit
    AND status IN ('em_atendimento','aguardando_assinatura','reaberto')
    AND (NULLIF(BTRIM(chief_complaint), '') IS NOT NULL
      OR NULLIF(BTRIM(anamnesis), '') IS NOT NULL
      OR NULLIF(BTRIM(physical_exam), '') IS NOT NULL)
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Atendimento sem conteúdo, fora do contexto ativo ou já finalizado'; END IF;
  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.m18_complete_attendance_secure(
  p_encounter_id UUID,
  p_payload JSONB,
  p_disposition TEXT DEFAULT 'FINALIZED'
)
RETURNS public.encounters
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, auth
AS $function$
DECLARE
  v_company UUID := public.active_company_id();
  v_unit INTEGER := public.active_unit_id();
  v_row public.encounters;
BEGIN
  IF public.request_aal() <> 'aal2' OR v_company IS NULL OR v_unit IS NULL
     OR NOT public.m18_can_edit_attendance() THEN
    RAISE EXCEPTION 'Contexto AAL2, empresa, unidade e permissão clínica são obrigatórios' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.encounters encounter
     WHERE encounter.id = p_encounter_id
       AND encounter.company_id = v_company
       AND encounter.unit_id = v_unit
       AND encounter.status IN ('em_atendimento','aguardando_assinatura','reaberto')
  ) THEN
    RAISE EXCEPTION 'Atendimento não encontrado ou não editável no contexto ativo' USING ERRCODE = 'P0002';
  END IF;
  v_row := public.m18_save_attendance_secure(p_encounter_id, p_payload);
  RETURN public.m18_finalize_attendance_secure(v_row.id, p_disposition);
END;
$function$;

CREATE OR REPLACE FUNCTION public.m19_reclassify_triage_secure(
  p_triage_id BIGINT,
  p_classification_id INTEGER,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, auth
AS $function$
DECLARE
  v_company UUID := public.active_company_id();
  v_unit INTEGER := public.active_unit_id();
BEGIN
  IF public.request_aal() <> 'aal2' OR v_company IS NULL OR v_unit IS NULL
     OR NOT public.can_access('enfermagem', 'edit') THEN
    RAISE EXCEPTION 'Contexto AAL2, unidade e permissão de reclassificação são obrigatórios' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.triagens triage
     WHERE triage.id = p_triage_id AND triage.company_id = v_company AND triage.unit_id = v_unit
  ) THEN RAISE EXCEPTION 'Triagem não encontrada no contexto ativo' USING ERRCODE = 'P0002'; END IF;
  RETURN private.m19_reclassify_triage(p_triage_id, p_classification_id, p_reason);
END;
$function$;

REVOKE ALL ON FUNCTION public.m19_prepare_triage_handoff_secure(BIGINT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.m19_complete_triage_secure(INTEGER, BIGINT, BIGINT, BIGINT, INTEGER, TEXT, JSONB, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.m18_open_attendance_secure(BIGINT, INTEGER, BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.m18_save_attendance_secure(UUID, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.m18_finalize_attendance_secure(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.m18_complete_attendance_secure(UUID, JSONB, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.m19_reclassify_triage_secure(BIGINT, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m19_prepare_triage_handoff_secure(BIGINT, TEXT),
  public.m19_complete_triage_secure(INTEGER, BIGINT, BIGINT, BIGINT, INTEGER, TEXT, JSONB, JSONB),
  public.m18_open_attendance_secure(BIGINT, INTEGER, BIGINT),
  public.m18_save_attendance_secure(UUID, JSONB),
  public.m18_finalize_attendance_secure(UUID, TEXT),
  public.m18_complete_attendance_secure(UUID, JSONB, TEXT),
  public.m19_reclassify_triage_secure(BIGINT, INTEGER, TEXT)
  TO authenticated, app_prontomedic;

ALTER FUNCTION public.m19_prepare_triage_handoff_secure(BIGINT, TEXT) OWNER TO prontomedic_clinical_handoff_owner;
ALTER FUNCTION public.m19_complete_triage_secure(INTEGER, BIGINT, BIGINT, BIGINT, INTEGER, TEXT, JSONB, JSONB)
  OWNER TO prontomedic_clinical_handoff_owner;
ALTER FUNCTION public.m18_open_attendance_secure(BIGINT, INTEGER, BIGINT)
  OWNER TO prontomedic_clinical_handoff_owner;
ALTER FUNCTION public.m19_reclassify_triage_secure(BIGINT, INTEGER, TEXT)
  OWNER TO prontomedic_clinical_handoff_owner;
ALTER FUNCTION private.m19_complete_triage(INTEGER, BIGINT, BIGINT, BIGINT, INTEGER, TEXT, JSONB, JSONB)
  OWNER TO prontomedic_clinical_handoff_owner;
ALTER FUNCTION private.m19_reclassify_triage(BIGINT, INTEGER, TEXT)
  OWNER TO prontomedic_clinical_handoff_owner;
ALTER FUNCTION private.transition_triage_queue(BIGINT, TEXT, TEXT)
  OWNER TO prontomedic_clinical_handoff_owner;
ALTER FUNCTION public.m18_save_attendance_secure(UUID, JSONB)
  OWNER TO prontomedic_clinical_handoff_owner;
ALTER FUNCTION public.m18_finalize_attendance_secure(UUID, TEXT)
  OWNER TO prontomedic_clinical_handoff_owner;
ALTER FUNCTION public.m18_complete_attendance_secure(UUID, JSONB, TEXT)
  OWNER TO prontomedic_clinical_handoff_owner;

COMMENT ON COLUMN public.triagem_fila.appointment_id IS
  'Canonical appointment correlation for the Reception -> M19 -> M18 handoff, protected by a tenant/unit composite FK.';
COMMENT ON FUNCTION public.m19_prepare_triage_handoff_secure(BIGINT, TEXT) IS
  'Idempotently creates the unit-scoped M19 queue entry for one appointment.';

COMMIT;
