-- Module 21: care protocols, immutable versions and auditable executions.
-- Additive migration. It does not access or change DataSIGH.
BEGIN;

DO $owner$
DECLARE
  v_executor_is_superuser BOOLEAN;
BEGIN
  SELECT rolsuper INTO v_executor_is_superuser
  FROM pg_roles WHERE rolname = CURRENT_USER;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prontomedic_rpc_owner') THEN
    IF NOT COALESCE(v_executor_is_superuser, FALSE) THEN
      RAISE EXCEPTION 'M21 requires a superuser to create prontomedic_rpc_owner';
    END IF;
    EXECUTE
      'CREATE ROLE prontomedic_rpc_owner NOLOGIN BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION';
  ELSIF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'prontomedic_rpc_owner'
      AND (rolcanlogin OR NOT rolbypassrls OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication)
  ) THEN
    IF NOT COALESCE(v_executor_is_superuser, FALSE) THEN
      RAISE EXCEPTION 'M21 cannot harden prontomedic_rpc_owner without a superuser';
    END IF;
    EXECUTE
      'ALTER ROLE prontomedic_rpc_owner NOLOGIN BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION';
  END IF;
END
$owner$;

DO $$
BEGIN
  IF to_regprocedure('private.current_company_id()') IS NULL THEN
    RAISE EXCEPTION 'M21 requires private.current_company_id()';
  END IF;
  IF to_regclass('public.unit_access') IS NULL THEN
    RAISE EXCEPTION 'M21 requires public.unit_access';
  END IF;
  IF to_regclass('public.permissions') IS NULL
     OR to_regclass('public.role_permissions') IS NULL
     OR to_regclass('public.roles') IS NULL
     OR to_regclass('public.user_permissions') IS NULL
     OR to_regprocedure(
       'private.prontomedic_module_action_allowed(text,text,integer,boolean)'
     ) IS NULL THEN
    RAISE EXCEPTION 'M21 requires the canonical permission catalog and M19 authorization helper';
  END IF;
END
$$;

INSERT INTO public.permissions (module, action, label, description)
VALUES
  ('protocolos_governanca', 'view', 'Visualizar governança de protocolos', 'Consultar definições e versões de protocolos'),
  ('protocolos_governanca', 'create', 'Criar protocolos', 'Criar definição e primeira versão de protocolo'),
  ('protocolos_governanca', 'edit', 'Editar governança de protocolos', 'Publicar versões e transicionar definições'),
  ('protocolos_execucao', 'view', 'Visualizar execução de protocolos', 'Consultar execuções, etapas, alertas e tarefas'),
  ('protocolos_execucao', 'create', 'Iniciar execução de protocolo', 'Iniciar protocolo assistencial para paciente autorizado'),
  ('protocolos_execucao', 'edit', 'Atualizar execução de protocolo', 'Transicionar etapas, alertas, tarefas e encerramento')
ON CONFLICT (module, action) DO NOTHING;

INSERT INTO public.role_permissions (
  role_id, company_id, module, can_view, can_create, can_edit, can_delete, can_export
)
SELECT r.id, c.id, matrix.module, TRUE, TRUE, TRUE, FALSE, FALSE
FROM public.roles r
CROSS JOIN public.companies c
JOIN (
  VALUES
    ('admin', 'protocolos_governanca'),
    ('gestor', 'protocolos_governanca'),
    ('medico', 'protocolos_governanca'),
    ('admin', 'protocolos_execucao'),
    ('gestor', 'protocolos_execucao'),
    ('medico', 'protocolos_execucao'),
    ('enfermagem', 'protocolos_execucao'),
    ('tecnico_enfermagem', 'protocolos_execucao')
) AS matrix(role_name, module)
  ON matrix.role_name = r.name
ON CONFLICT DO NOTHING;

UPDATE public.role_permissions rp
SET can_view = FALSE,
    can_create = FALSE,
    can_edit = FALSE,
    can_delete = FALSE,
    can_export = FALSE,
    updated_at = NOW()
FROM public.roles r
WHERE r.id = rp.role_id
  AND (
    (rp.module = 'protocolos_governanca'
      AND r.name NOT IN ('admin', 'gestor', 'medico'))
    OR
    (rp.module = 'protocolos_execucao'
      AND r.name NOT IN ('admin', 'gestor', 'medico', 'enfermagem', 'tecnico_enfermagem'))
  )
  AND (rp.can_view OR rp.can_create OR rp.can_edit OR rp.can_delete OR rp.can_export);

CREATE TABLE IF NOT EXISTS public.care_protocol_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  unit_id INTEGER REFERENCES public.units(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'CLINICAL',
  description TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'ACTIVE', 'INACTIVE', 'RETIRED')),
  active_version_id UUID,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retired_at TIMESTAMPTZ,
  CONSTRAINT care_protocol_definition_name_nonempty CHECK (BTRIM(name) <> ''),
  CONSTRAINT care_protocol_definition_code_nonempty CHECK (BTRIM(code) <> '')
);

ALTER TABLE public.care_protocol_definitions
  DROP CONSTRAINT IF EXISTS care_protocol_definition_code_uq;
CREATE UNIQUE INDEX IF NOT EXISTS care_protocol_definition_unit_code_uq
  ON public.care_protocol_definitions(company_id, unit_id, code)
  WHERE unit_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS care_protocol_definition_corporate_code_uq
  ON public.care_protocol_definitions(company_id, code)
  WHERE unit_id IS NULL;

CREATE TABLE IF NOT EXISTS public.care_protocol_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  protocol_definition_id UUID NOT NULL
    REFERENCES public.care_protocol_definitions(id) ON DELETE RESTRICT,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  content JSONB NOT NULL,
  change_summary TEXT NOT NULL,
  publication_status TEXT NOT NULL DEFAULT 'PUBLISHED'
    CHECK (publication_status = 'PUBLISHED'),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  published_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT care_protocol_version_number_uq
    UNIQUE (protocol_definition_id, version_number),
  CONSTRAINT care_protocol_version_content_object
    CHECK (jsonb_typeof(content) = 'object'),
  CONSTRAINT care_protocol_version_summary_nonempty
    CHECK (BTRIM(change_summary) <> '')
);

ALTER TABLE public.care_protocol_definitions
  DROP CONSTRAINT IF EXISTS care_protocol_definition_active_version_fk;
ALTER TABLE public.care_protocol_definitions
  ADD CONSTRAINT care_protocol_definition_active_version_fk
  FOREIGN KEY (active_version_id)
  REFERENCES public.care_protocol_versions(id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS public.care_protocol_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  unit_id INTEGER NOT NULL REFERENCES public.units(id) ON DELETE RESTRICT,
  patient_id BIGINT NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  encounter_id UUID REFERENCES public.encounters(id) ON DELETE RESTRICT,
  protocol_definition_id UUID NOT NULL
    REFERENCES public.care_protocol_definitions(id) ON DELETE RESTRICT,
  protocol_version_id UUID NOT NULL
    REFERENCES public.care_protocol_versions(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED')),
  source_signal_type TEXT,
  source_signal_id TEXT,
  source_signal_payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  started_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  started_at TIMESTAMPTZ,
  paused_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  status_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT care_protocol_signal_payload_object
    CHECK (jsonb_typeof(source_signal_payload) = 'object')
);

CREATE TABLE IF NOT EXISTS public.care_protocol_execution_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  unit_id INTEGER NOT NULL REFERENCES public.units(id) ON DELETE RESTRICT,
  execution_id UUID NOT NULL
    REFERENCES public.care_protocol_executions(id) ON DELETE RESTRICT,
  step_key TEXT NOT NULL,
  sequence_number INTEGER NOT NULL CHECK (sequence_number > 0),
  title TEXT NOT NULL,
  instructions TEXT,
  step_type TEXT NOT NULL DEFAULT 'TASK'
    CHECK (step_type IN ('TASK', 'OBSERVATION', 'CHECKLIST', 'ALERT_REVIEW', 'ESCALATION')),
  required BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED', 'BLOCKED')),
  assigned_role TEXT,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  due_at TIMESTAMPTZ,
  completed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  status_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT care_protocol_execution_step_uq UNIQUE (execution_id, step_key),
  CONSTRAINT care_protocol_execution_step_title_nonempty CHECK (BTRIM(title) <> '')
);

CREATE TABLE IF NOT EXISTS public.care_protocol_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  unit_id INTEGER NOT NULL REFERENCES public.units(id) ON DELETE RESTRICT,
  execution_id UUID NOT NULL
    REFERENCES public.care_protocol_executions(id) ON DELETE RESTRICT,
  step_id UUID REFERENCES public.care_protocol_execution_steps(id) ON DELETE RESTRICT,
  observation_type TEXT NOT NULL,
  value JSONB NOT NULL DEFAULT '{}'::JSONB,
  notes TEXT,
  recorded_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT care_protocol_observation_type_nonempty CHECK (BTRIM(observation_type) <> ''),
  CONSTRAINT care_protocol_observation_value_object CHECK (jsonb_typeof(value) = 'object')
);

CREATE TABLE IF NOT EXISTS public.care_protocol_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  unit_id INTEGER NOT NULL REFERENCES public.units(id) ON DELETE RESTRICT,
  execution_id UUID NOT NULL
    REFERENCES public.care_protocol_executions(id) ON DELETE RESTRICT,
  step_id UUID REFERENCES public.care_protocol_execution_steps(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
  raised_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  acknowledged_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  resolution_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT care_protocol_alert_code_nonempty CHECK (BTRIM(code) <> ''),
  CONSTRAINT care_protocol_alert_message_nonempty CHECK (BTRIM(message) <> '')
);

CREATE TABLE IF NOT EXISTS public.care_protocol_escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  unit_id INTEGER NOT NULL REFERENCES public.units(id) ON DELETE RESTRICT,
  execution_id UUID NOT NULL
    REFERENCES public.care_protocol_executions(id) ON DELETE RESTRICT,
  alert_id UUID REFERENCES public.care_protocol_alerts(id) ON DELETE RESTRICT,
  escalation_level INTEGER NOT NULL CHECK (escalation_level BETWEEN 1 AND 5),
  target_role TEXT,
  target_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'REQUESTED'
    CHECK (status IN ('REQUESTED', 'ACKNOWLEDGED', 'CLOSED')),
  escalated_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  acknowledged_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMPTZ,
  closed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT care_protocol_escalation_reason_nonempty CHECK (BTRIM(reason) <> ''),
  CONSTRAINT care_protocol_escalation_target_present
    CHECK (target_role IS NOT NULL OR target_user_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.care_protocol_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  unit_id INTEGER NOT NULL REFERENCES public.units(id) ON DELETE RESTRICT,
  execution_id UUID NOT NULL
    REFERENCES public.care_protocol_executions(id) ON DELETE RESTRICT,
  step_id UUID REFERENCES public.care_protocol_execution_steps(id) ON DELETE RESTRICT,
  override_type TEXT NOT NULL
    CHECK (override_type IN ('SKIP_REQUIRED_STEP', 'DEADLINE', 'RESPONSIBILITY', 'OTHER')),
  reason TEXT NOT NULL,
  previous_value JSONB,
  new_value JSONB,
  authorized_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT care_protocol_override_reason_nonempty CHECK (BTRIM(reason) <> '')
);

CREATE TABLE IF NOT EXISTS public.care_protocol_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  unit_id INTEGER NOT NULL REFERENCES public.units(id) ON DELETE RESTRICT,
  patient_id BIGINT NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  encounter_id UUID REFERENCES public.encounters(id) ON DELETE RESTRICT,
  execution_id UUID NOT NULL
    REFERENCES public.care_protocol_executions(id) ON DELETE RESTRICT,
  step_id UUID NOT NULL
    REFERENCES public.care_protocol_execution_steps(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'ROUTINE'
    CHECK (priority IN ('ROUTINE', 'URGENT', 'IMMEDIATE')),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  assigned_role TEXT,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  due_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  completed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT care_protocol_task_step_uq UNIQUE (step_id),
  CONSTRAINT care_protocol_task_title_nonempty CHECK (BTRIM(title) <> '')
);

CREATE TABLE IF NOT EXISTS public.care_protocol_events (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  unit_id INTEGER REFERENCES public.units(id) ON DELETE RESTRICT,
  protocol_definition_id UUID REFERENCES public.care_protocol_definitions(id) ON DELETE RESTRICT,
  execution_id UUID REFERENCES public.care_protocol_executions(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  reason TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  actor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT care_protocol_event_owner_present
    CHECK (protocol_definition_id IS NOT NULL OR execution_id IS NOT NULL),
  CONSTRAINT care_protocol_event_type_nonempty CHECK (BTRIM(event_type) <> ''),
  CONSTRAINT care_protocol_event_payload_object CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX IF NOT EXISTS care_protocol_definitions_scope_idx
  ON public.care_protocol_definitions(company_id, unit_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS care_protocol_versions_definition_idx
  ON public.care_protocol_versions(protocol_definition_id, version_number DESC);
CREATE INDEX IF NOT EXISTS care_protocol_executions_patient_idx
  ON public.care_protocol_executions(company_id, unit_id, patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS care_protocol_executions_encounter_idx
  ON public.care_protocol_executions(company_id, encounter_id, created_at DESC)
  WHERE encounter_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS care_protocol_executions_signal_idx
  ON public.care_protocol_executions(company_id, source_signal_type, source_signal_id)
  WHERE source_signal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS care_protocol_steps_execution_idx
  ON public.care_protocol_execution_steps(execution_id, sequence_number);
CREATE INDEX IF NOT EXISTS care_protocol_alerts_open_idx
  ON public.care_protocol_alerts(company_id, unit_id, severity, created_at DESC)
  WHERE status <> 'RESOLVED';
CREATE INDEX IF NOT EXISTS care_protocol_tasks_open_idx
  ON public.care_protocol_tasks(company_id, unit_id, status, due_at)
  WHERE status IN ('PENDING', 'IN_PROGRESS');
CREATE INDEX IF NOT EXISTS care_protocol_events_execution_idx
  ON public.care_protocol_events(execution_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.m21_actor_company_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public, private
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.company_id', TRUE), '')::UUID,
    private.current_company_id()
  )
$$;

CREATE OR REPLACE FUNCTION private.protocol_unit_accessible_runtime(
  p_company_id UUID,
  p_unit_id INTEGER
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
  SELECT
    p_company_id IS NOT NULL
    AND p_unit_id IS NOT NULL
    AND p_company_id = COALESCE(
      NULLIF(current_setting('request.jwt.claim.company_id', TRUE), '')::UUID,
      private.current_company_id()
    )
    AND EXISTS (
      SELECT 1
        FROM public.units u
       WHERE u.id = p_unit_id
         AND u.company_id = p_company_id
         AND u.lg_ativo = TRUE
    )
    AND EXISTS (
      SELECT 1
        FROM public.user_profiles up
       WHERE (
         up.id = private.current_user_id()
         OR up.user_id = private.current_user_id()
       )
         AND up.company_id = p_company_id
         AND up.lg_ativo = TRUE
         AND (
           lower(coalesce(up.role_name, '')) IN (
             'admin', 'administrador', 'gestor', 'gerente', 'master', 'admin_master'
           )
           OR up.primary_unit_id = p_unit_id
           OR EXISTS (
             SELECT 1
               FROM public.unit_access ua
              WHERE ua.user_id = coalesce(up.user_id, up.id)
                AND ua.company_id = p_company_id
                AND ua.unit_id = p_unit_id
                AND ua.valid_from <= NOW()
                AND (ua.valid_until IS NULL OR ua.valid_until >= NOW())
           )
         )
    )
$$;

ALTER FUNCTION private.protocol_unit_accessible_runtime(UUID, INTEGER)
  OWNER TO prontomedic_rpc_owner;
REVOKE ALL ON FUNCTION private.protocol_unit_accessible_runtime(UUID, INTEGER)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.protocol_unit_accessible_runtime(UUID, INTEGER)
  TO authenticated, app_prontomedic, prontomedic_rpc_owner;

CREATE OR REPLACE FUNCTION public.m21_unit_accessible(p_company_id UUID, p_unit_id INTEGER)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, private
AS $$
  SELECT private.protocol_unit_accessible_runtime(p_company_id, p_unit_id)
$$;

REVOKE ALL ON FUNCTION public.m21_unit_accessible(UUID, INTEGER)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m21_unit_accessible(UUID, INTEGER)
  TO authenticated, app_prontomedic, prontomedic_rpc_owner;

CREATE OR REPLACE FUNCTION public.m21_can_manage_definitions()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
  SELECT private.prontomedic_module_action_allowed(
    'protocolos_governanca', 'view', NULL, FALSE
  )
$$;

CREATE OR REPLACE FUNCTION public.m21_can_execute_protocols()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
  SELECT private.prontomedic_module_action_allowed(
    'protocolos_execucao', 'view', NULL, FALSE
  )
$$;

DROP FUNCTION IF EXISTS private.m21_require_actor(UUID, INTEGER, BOOLEAN);

CREATE OR REPLACE FUNCTION private.m21_require_actor(
  p_company_id UUID,
  p_unit_id INTEGER,
  p_manage_definitions BOOLEAN DEFAULT FALSE,
  p_action TEXT DEFAULT 'edit'
)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_actor UUID := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'M21 requires an authenticated actor';
  END IF;
  IF p_company_id IS NULL OR p_company_id <> public.m21_actor_company_id() THEN
    RAISE EXCEPTION 'M21 tenant mismatch';
  END IF;
  IF p_unit_id IS NOT NULL AND NOT public.m21_unit_accessible(p_company_id, p_unit_id) THEN
    RAISE EXCEPTION 'M21 unit access denied';
  END IF;
  IF p_manage_definitions AND NOT private.prontomedic_module_action_allowed(
    'protocolos_governanca', p_action, p_unit_id, FALSE
  ) THEN
    RAISE EXCEPTION 'M21 protocol governance permission denied';
  END IF;
  IF NOT p_manage_definitions AND NOT private.prontomedic_module_action_allowed(
    'protocolos_execucao', p_action, p_unit_id, FALSE
  ) THEN
    RAISE EXCEPTION 'M21 protocol execution permission denied';
  END IF;
  RETURN v_actor;
END
$$;

CREATE OR REPLACE FUNCTION private.m21_guard_immutable_rows()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'M21 immutable records cannot be updated or deleted';
END
$$;

CREATE OR REPLACE FUNCTION private.m21_validate_protocol_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  v_step JSONB;
  v_key TEXT;
  v_type TEXT;
BEGIN
  IF jsonb_typeof(COALESCE(NEW.content->'steps', '[]'::JSONB)) <> 'array' THEN
    RAISE EXCEPTION 'Protocol content.steps must be an array';
  END IF;
  IF jsonb_array_length(COALESCE(NEW.content->'steps', '[]'::JSONB)) = 0 THEN
    RAISE EXCEPTION 'Protocol must contain at least one step';
  END IF;
  FOR v_step IN SELECT value FROM jsonb_array_elements(NEW.content->'steps')
  LOOP
    IF jsonb_typeof(v_step) <> 'object' THEN
      RAISE EXCEPTION 'Protocol steps must be objects';
    END IF;
    v_key := BTRIM(COALESCE(v_step->>'key', ''));
    v_type := UPPER(BTRIM(COALESCE(v_step->>'type', 'TASK')));
    IF v_key = '' OR BTRIM(COALESCE(v_step->>'title', '')) = '' THEN
      RAISE EXCEPTION 'Protocol step key and title are required';
    END IF;
    IF v_type IN (
      'PRESCRIPTION', 'PRESCRICAO', 'PRESCRIÇÃO', 'MEDICATION',
      'MEDICATION_ORDER', 'DRUG_ORDER', 'AUTO_PRESCRIBE'
    ) THEN
      RAISE EXCEPTION 'M21 cannot prescribe or create medication orders automatically';
    END IF;
    IF v_type NOT IN ('TASK', 'OBSERVATION', 'CHECKLIST', 'ALERT_REVIEW', 'ESCALATION') THEN
      RAISE EXCEPTION 'Unsupported protocol step type: %', v_type;
    END IF;
  END LOOP;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION private.m21_guard_immutable_rows()
  FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION private.m21_validate_protocol_version()
  FROM PUBLIC, anon, authenticated, app_prontomedic;

DROP TRIGGER IF EXISTS trg_m21_immutable_versions ON public.care_protocol_versions;
CREATE TRIGGER trg_m21_immutable_versions
  BEFORE UPDATE OR DELETE ON public.care_protocol_versions
  FOR EACH ROW EXECUTE FUNCTION private.m21_guard_immutable_rows();

DROP TRIGGER IF EXISTS trg_m21_validate_protocol_version ON public.care_protocol_versions;
CREATE TRIGGER trg_m21_validate_protocol_version
  BEFORE INSERT ON public.care_protocol_versions
  FOR EACH ROW EXECUTE FUNCTION private.m21_validate_protocol_version();

DROP TRIGGER IF EXISTS trg_m21_immutable_observations ON public.care_protocol_observations;
CREATE TRIGGER trg_m21_immutable_observations
  BEFORE UPDATE OR DELETE ON public.care_protocol_observations
  FOR EACH ROW EXECUTE FUNCTION private.m21_guard_immutable_rows();

DROP TRIGGER IF EXISTS trg_m21_immutable_overrides ON public.care_protocol_overrides;
CREATE TRIGGER trg_m21_immutable_overrides
  BEFORE UPDATE OR DELETE ON public.care_protocol_overrides
  FOR EACH ROW EXECUTE FUNCTION private.m21_guard_immutable_rows();

DROP TRIGGER IF EXISTS trg_m21_immutable_events ON public.care_protocol_events;
CREATE TRIGGER trg_m21_immutable_events
  BEFORE UPDATE OR DELETE ON public.care_protocol_events
  FOR EACH ROW EXECUTE FUNCTION private.m21_guard_immutable_rows();

CREATE OR REPLACE FUNCTION private.m21_create_definition(
  p_unit_id INTEGER,
  p_code TEXT,
  p_name TEXT,
  p_category TEXT,
  p_description TEXT
)
RETURNS public.care_protocol_definitions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_company UUID := public.m21_actor_company_id();
  v_actor UUID;
  v_row public.care_protocol_definitions;
BEGIN
  v_actor := private.m21_require_actor(v_company, p_unit_id, TRUE, 'create');
  IF BTRIM(COALESCE(p_code, '')) = '' OR BTRIM(COALESCE(p_name, '')) = '' THEN
    RAISE EXCEPTION 'Protocol code and name are required';
  END IF;
  INSERT INTO public.care_protocol_definitions(
    company_id, unit_id, code, name, category, description, created_by, updated_by
  ) VALUES (
    v_company, p_unit_id, UPPER(BTRIM(p_code)), BTRIM(p_name),
    UPPER(BTRIM(COALESCE(p_category, 'CLINICAL'))), NULLIF(BTRIM(p_description), ''),
    v_actor, v_actor
  )
  RETURNING * INTO v_row;
  INSERT INTO public.care_protocol_events(
    company_id, unit_id, protocol_definition_id, event_type, to_status, actor_id
  ) VALUES (v_company, p_unit_id, v_row.id, 'DEFINITION_CREATED', 'DRAFT', v_actor);
  RETURN v_row;
END
$$;

CREATE OR REPLACE FUNCTION private.m21_publish_version(
  p_protocol_definition_id UUID,
  p_content JSONB,
  p_change_summary TEXT
)
RETURNS public.care_protocol_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_definition public.care_protocol_definitions;
  v_version public.care_protocol_versions;
  v_actor UUID;
  v_number INTEGER;
BEGIN
  SELECT * INTO v_definition
  FROM public.care_protocol_definitions
  WHERE id = p_protocol_definition_id
    AND company_id = public.m21_actor_company_id()
  FOR UPDATE;
  IF NOT FOUND OR v_definition.status = 'RETIRED' THEN
    RAISE EXCEPTION 'Protocol definition not found or retired';
  END IF;
  v_actor := private.m21_require_actor(v_definition.company_id, v_definition.unit_id, TRUE, 'edit');
  IF jsonb_typeof(COALESCE(p_content, '{}'::JSONB)) <> 'object'
     OR BTRIM(COALESCE(p_change_summary, '')) = '' THEN
    RAISE EXCEPTION 'Protocol content and change summary are required';
  END IF;
  SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_number
  FROM public.care_protocol_versions
  WHERE protocol_definition_id = v_definition.id;
  INSERT INTO public.care_protocol_versions(
    company_id, protocol_definition_id, version_number, content, change_summary,
    created_by, published_by
  ) VALUES (
    v_definition.company_id, v_definition.id, v_number, p_content,
    BTRIM(p_change_summary), v_actor, v_actor
  )
  RETURNING * INTO v_version;
  UPDATE public.care_protocol_definitions
  SET active_version_id = v_version.id,
      status = 'ACTIVE',
      updated_by = v_actor,
      updated_at = NOW()
  WHERE id = v_definition.id;
  INSERT INTO public.care_protocol_events(
    company_id, unit_id, protocol_definition_id, event_type, from_status,
    to_status, payload, actor_id
  ) VALUES (
    v_definition.company_id, v_definition.unit_id, v_definition.id,
    'VERSION_PUBLISHED', v_definition.status, 'ACTIVE',
    jsonb_build_object('version_id', v_version.id, 'version_number', v_number),
    v_actor
  );
  RETURN v_version;
END
$$;

CREATE OR REPLACE FUNCTION private.m21_transition_definition(
  p_protocol_definition_id UUID,
  p_expected_status TEXT,
  p_new_status TEXT,
  p_reason TEXT
)
RETURNS public.care_protocol_definitions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_row public.care_protocol_definitions;
  v_actor UUID;
  v_new TEXT := UPPER(BTRIM(COALESCE(p_new_status, '')));
  v_expected TEXT := UPPER(BTRIM(COALESCE(p_expected_status, '')));
BEGIN
  SELECT * INTO v_row FROM public.care_protocol_definitions
  WHERE id = p_protocol_definition_id
    AND company_id = public.m21_actor_company_id()
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Protocol definition not found'; END IF;
  v_actor := private.m21_require_actor(v_row.company_id, v_row.unit_id, TRUE, 'edit');
  IF v_row.status <> v_expected THEN RAISE EXCEPTION 'Protocol status changed concurrently'; END IF;
  IF NOT (
    (v_expected = 'ACTIVE' AND v_new IN ('INACTIVE', 'RETIRED'))
    OR (v_expected = 'INACTIVE' AND v_new IN ('ACTIVE', 'RETIRED'))
  ) THEN RAISE EXCEPTION 'Invalid protocol definition transition'; END IF;
  IF v_new = 'ACTIVE' AND v_row.active_version_id IS NULL THEN
    RAISE EXCEPTION 'Protocol without a published version cannot be activated';
  END IF;
  IF BTRIM(COALESCE(p_reason, '')) = '' THEN RAISE EXCEPTION 'Transition reason is required'; END IF;
  UPDATE public.care_protocol_definitions
  SET status = v_new,
      retired_at = CASE WHEN v_new = 'RETIRED' THEN NOW() ELSE retired_at END,
      updated_by = v_actor,
      updated_at = NOW()
  WHERE id = v_row.id
  RETURNING * INTO v_row;
  INSERT INTO public.care_protocol_events(
    company_id, unit_id, protocol_definition_id, event_type, from_status,
    to_status, reason, actor_id
  ) VALUES (
    v_row.company_id, v_row.unit_id, v_row.id, 'DEFINITION_TRANSITION',
    v_expected, v_new, BTRIM(p_reason), v_actor
  );
  RETURN v_row;
END
$$;

CREATE OR REPLACE FUNCTION private.m21_start_execution(
  p_protocol_version_id UUID,
  p_unit_id INTEGER,
  p_patient_id BIGINT,
  p_encounter_id UUID,
  p_source_signal_type TEXT,
  p_source_signal_id TEXT,
  p_source_signal_payload JSONB,
  p_assigned_to UUID
)
RETURNS public.care_protocol_executions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_company UUID := public.m21_actor_company_id();
  v_actor UUID;
  v_version public.care_protocol_versions;
  v_definition public.care_protocol_definitions;
  v_execution public.care_protocol_executions;
BEGIN
  v_actor := private.m21_require_actor(v_company, p_unit_id, FALSE, 'create');
  SELECT * INTO v_version
  FROM public.care_protocol_versions
  WHERE id = p_protocol_version_id
    AND company_id = v_company;
  IF NOT FOUND THEN RAISE EXCEPTION 'Protocol version not found for tenant'; END IF;

  SELECT * INTO v_definition
  FROM public.care_protocol_definitions
  WHERE id = v_version.protocol_definition_id
    AND company_id = v_company
    AND active_version_id = v_version.id
    AND status = 'ACTIVE'
    AND (unit_id IS NULL OR unit_id = p_unit_id)
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active protocol version not found for unit'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.patients p
    WHERE p.id = p_patient_id AND p.company_id = v_company AND p.lg_ativo = TRUE
  ) THEN RAISE EXCEPTION 'Patient does not belong to tenant'; END IF;
  IF p_encounter_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.encounters e
    WHERE e.id = p_encounter_id
      AND e.company_id = v_company
      AND e.patient_id = p_patient_id
      AND (e.unit_id IS NULL OR e.unit_id = p_unit_id)
  ) THEN RAISE EXCEPTION 'Encounter does not match tenant, unit and patient'; END IF;
  INSERT INTO public.care_protocol_executions(
    company_id, unit_id, patient_id, encounter_id, protocol_definition_id,
    protocol_version_id, status, source_signal_type, source_signal_id,
    source_signal_payload, assigned_to, started_by, started_at
  ) VALUES (
    v_company, p_unit_id, p_patient_id, p_encounter_id, v_definition.id,
    v_version.id, 'ACTIVE', NULLIF(BTRIM(p_source_signal_type), ''),
    NULLIF(BTRIM(p_source_signal_id), ''),
    CASE WHEN jsonb_typeof(COALESCE(p_source_signal_payload, '{}'::JSONB)) = 'object'
      THEN COALESCE(p_source_signal_payload, '{}'::JSONB) ELSE '{}'::JSONB END,
    p_assigned_to, v_actor, NOW()
  )
  RETURNING * INTO v_execution;

  INSERT INTO public.care_protocol_execution_steps(
    company_id, unit_id, execution_id, step_key, sequence_number, title,
    instructions, step_type, required, assigned_role, assigned_to, due_at
  )
  SELECT
    v_company,
    p_unit_id,
    v_execution.id,
    BTRIM(step->>'key'),
    COALESCE(NULLIF(step->>'sequence', '')::INTEGER, ordinal::INTEGER),
    BTRIM(step->>'title'),
    NULLIF(BTRIM(step->>'instructions'), ''),
    UPPER(BTRIM(COALESCE(step->>'type', 'TASK'))),
    COALESCE((step->>'required')::BOOLEAN, TRUE),
    NULLIF(BTRIM(step->>'assigned_role'), ''),
    p_assigned_to,
    CASE
      WHEN COALESCE(NULLIF(step->>'due_minutes', '')::INTEGER, 0) > 0
      THEN NOW() + make_interval(mins => (step->>'due_minutes')::INTEGER)
      ELSE NULL
    END
  FROM jsonb_array_elements(v_version.content->'steps') WITH ORDINALITY AS s(step, ordinal);

  INSERT INTO public.care_protocol_tasks(
    company_id, unit_id, patient_id, encounter_id, execution_id, step_id,
    title, description, priority, assigned_role, assigned_to, due_at, created_by
  )
  SELECT
    v_company, p_unit_id, p_patient_id, p_encounter_id, v_execution.id, s.id,
    s.title, s.instructions,
    CASE UPPER(COALESCE(v_version.content->>'priority', 'ROUTINE'))
      WHEN 'IMMEDIATE' THEN 'IMMEDIATE'
      WHEN 'URGENT' THEN 'URGENT'
      ELSE 'ROUTINE'
    END,
    s.assigned_role, s.assigned_to, s.due_at, v_actor
  FROM public.care_protocol_execution_steps s
  WHERE s.execution_id = v_execution.id AND s.step_type = 'TASK';

  INSERT INTO public.care_protocol_events(
    company_id, unit_id, protocol_definition_id, execution_id, event_type,
    to_status, payload, actor_id
  ) VALUES (
    v_company, p_unit_id, v_definition.id, v_execution.id, 'EXECUTION_STARTED',
    'ACTIVE', jsonb_build_object(
      'source_signal_type', p_source_signal_type,
      'source_signal_id', p_source_signal_id
    ), v_actor
  );
  RETURN v_execution;
END
$$;

CREATE OR REPLACE FUNCTION private.m21_transition_execution(
  p_execution_id UUID,
  p_expected_status TEXT,
  p_new_status TEXT,
  p_reason TEXT
)
RETURNS public.care_protocol_executions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_row public.care_protocol_executions;
  v_actor UUID;
  v_expected TEXT := UPPER(BTRIM(COALESCE(p_expected_status, '')));
  v_new TEXT := UPPER(BTRIM(COALESCE(p_new_status, '')));
BEGIN
  SELECT * INTO v_row FROM public.care_protocol_executions
  WHERE id = p_execution_id AND company_id = public.m21_actor_company_id()
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Protocol execution not found'; END IF;
  v_actor := private.m21_require_actor(v_row.company_id, v_row.unit_id, FALSE, 'edit');
  IF v_row.status <> v_expected THEN RAISE EXCEPTION 'Execution status changed concurrently'; END IF;
  IF NOT (
    (v_expected = 'PENDING' AND v_new IN ('ACTIVE', 'CANCELLED'))
    OR (v_expected = 'ACTIVE' AND v_new IN ('PAUSED', 'COMPLETED', 'CANCELLED'))
    OR (v_expected = 'PAUSED' AND v_new IN ('ACTIVE', 'CANCELLED'))
  ) THEN RAISE EXCEPTION 'Invalid execution transition'; END IF;
  IF v_new IN ('PAUSED', 'CANCELLED') AND BTRIM(COALESCE(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'Reason is required for pause or cancellation';
  END IF;
  IF v_new = 'COMPLETED' AND EXISTS (
    SELECT 1 FROM public.care_protocol_execution_steps s
    WHERE s.execution_id = v_row.id
      AND s.required = TRUE
      AND s.status <> 'COMPLETED'
  ) THEN RAISE EXCEPTION 'Required protocol steps are incomplete'; END IF;
  UPDATE public.care_protocol_executions
  SET status = v_new,
      status_reason = NULLIF(BTRIM(p_reason), ''),
      started_at = CASE WHEN v_new = 'ACTIVE' THEN COALESCE(started_at, NOW()) ELSE started_at END,
      paused_at = CASE WHEN v_new = 'PAUSED' THEN NOW() ELSE paused_at END,
      completed_at = CASE WHEN v_new = 'COMPLETED' THEN NOW() ELSE completed_at END,
      cancelled_at = CASE WHEN v_new = 'CANCELLED' THEN NOW() ELSE cancelled_at END,
      updated_at = NOW()
  WHERE id = v_row.id
  RETURNING * INTO v_row;
  IF v_new = 'CANCELLED' THEN
    UPDATE public.care_protocol_tasks
    SET status = 'CANCELLED', updated_at = NOW()
    WHERE execution_id = v_row.id AND status IN ('PENDING', 'IN_PROGRESS');
  END IF;
  INSERT INTO public.care_protocol_events(
    company_id, unit_id, protocol_definition_id, execution_id, event_type,
    from_status, to_status, reason, actor_id
  ) VALUES (
    v_row.company_id, v_row.unit_id, v_row.protocol_definition_id, v_row.id,
    'EXECUTION_TRANSITION', v_expected, v_new, NULLIF(BTRIM(p_reason), ''), v_actor
  );
  RETURN v_row;
END
$$;

CREATE OR REPLACE FUNCTION private.m21_transition_step(
  p_step_id UUID,
  p_expected_status TEXT,
  p_new_status TEXT,
  p_reason TEXT
)
RETURNS public.care_protocol_execution_steps
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_step public.care_protocol_execution_steps;
  v_execution public.care_protocol_executions;
  v_actor UUID;
  v_expected TEXT := UPPER(BTRIM(COALESCE(p_expected_status, '')));
  v_new TEXT := UPPER(BTRIM(COALESCE(p_new_status, '')));
BEGIN
  SELECT * INTO v_step FROM public.care_protocol_execution_steps
  WHERE id = p_step_id AND company_id = public.m21_actor_company_id()
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Protocol step not found'; END IF;
  SELECT * INTO v_execution FROM public.care_protocol_executions
  WHERE id = v_step.execution_id FOR UPDATE;
  v_actor := private.m21_require_actor(v_step.company_id, v_step.unit_id, FALSE, 'edit');
  IF v_execution.status <> 'ACTIVE' THEN RAISE EXCEPTION 'Execution is not active'; END IF;
  IF v_step.status <> v_expected THEN RAISE EXCEPTION 'Step status changed concurrently'; END IF;
  IF NOT (
    (v_expected = 'PENDING' AND v_new IN ('IN_PROGRESS', 'COMPLETED', 'SKIPPED', 'BLOCKED'))
    OR (v_expected = 'IN_PROGRESS' AND v_new IN ('COMPLETED', 'SKIPPED', 'BLOCKED'))
    OR (v_expected = 'BLOCKED' AND v_new IN ('IN_PROGRESS', 'SKIPPED'))
  ) THEN RAISE EXCEPTION 'Invalid protocol step transition'; END IF;
  IF v_new IN ('SKIPPED', 'BLOCKED') AND BTRIM(COALESCE(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'Reason is required for skipped or blocked steps';
  END IF;
  IF v_step.required AND v_new = 'SKIPPED' AND NOT EXISTS (
    SELECT 1 FROM public.care_protocol_overrides o
    WHERE o.step_id = v_step.id AND o.override_type = 'SKIP_REQUIRED_STEP'
  ) THEN RAISE EXCEPTION 'Required step needs an authorized override before skip'; END IF;
  UPDATE public.care_protocol_execution_steps
  SET status = v_new,
      status_reason = NULLIF(BTRIM(p_reason), ''),
      completed_by = CASE WHEN v_new IN ('COMPLETED', 'SKIPPED') THEN v_actor ELSE NULL END,
      completed_at = CASE WHEN v_new IN ('COMPLETED', 'SKIPPED') THEN NOW() ELSE NULL END,
      updated_at = NOW()
  WHERE id = v_step.id
  RETURNING * INTO v_step;
  UPDATE public.care_protocol_tasks
  SET status = CASE v_new
      WHEN 'IN_PROGRESS' THEN 'IN_PROGRESS'
      WHEN 'COMPLETED' THEN 'COMPLETED'
      WHEN 'SKIPPED' THEN 'CANCELLED'
      ELSE status
    END,
    completed_by = CASE WHEN v_new = 'COMPLETED' THEN v_actor ELSE completed_by END,
    completed_at = CASE WHEN v_new = 'COMPLETED' THEN NOW() ELSE completed_at END,
    updated_at = NOW()
  WHERE step_id = v_step.id;
  INSERT INTO public.care_protocol_events(
    company_id, unit_id, protocol_definition_id, execution_id, event_type,
    from_status, to_status, reason, payload, actor_id
  ) VALUES (
    v_step.company_id, v_step.unit_id, v_execution.protocol_definition_id,
    v_execution.id, 'STEP_TRANSITION', v_expected, v_new,
    NULLIF(BTRIM(p_reason), ''), jsonb_build_object('step_id', v_step.id), v_actor
  );
  RETURN v_step;
END
$$;

CREATE OR REPLACE FUNCTION private.m21_add_observation(
  p_execution_id UUID,
  p_step_id UUID,
  p_observation_type TEXT,
  p_value JSONB,
  p_notes TEXT
)
RETURNS public.care_protocol_observations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_execution public.care_protocol_executions;
  v_actor UUID;
  v_row public.care_protocol_observations;
BEGIN
  SELECT * INTO v_execution FROM public.care_protocol_executions
  WHERE id = p_execution_id AND company_id = public.m21_actor_company_id();
  IF NOT FOUND OR v_execution.status NOT IN ('ACTIVE', 'PAUSED') THEN
    RAISE EXCEPTION 'Protocol execution not found or closed';
  END IF;
  v_actor := private.m21_require_actor(v_execution.company_id, v_execution.unit_id, FALSE, 'edit');
  IF p_step_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.care_protocol_execution_steps
    WHERE id = p_step_id AND execution_id = v_execution.id
  ) THEN RAISE EXCEPTION 'Step does not belong to execution'; END IF;
  IF BTRIM(COALESCE(p_observation_type, '')) = ''
     OR jsonb_typeof(COALESCE(p_value, '{}'::JSONB)) <> 'object' THEN
    RAISE EXCEPTION 'Observation type and object value are required';
  END IF;
  INSERT INTO public.care_protocol_observations(
    company_id, unit_id, execution_id, step_id, observation_type,
    value, notes, recorded_by
  ) VALUES (
    v_execution.company_id, v_execution.unit_id, v_execution.id, p_step_id,
    UPPER(BTRIM(p_observation_type)), p_value, NULLIF(BTRIM(p_notes), ''), v_actor
  ) RETURNING * INTO v_row;
  INSERT INTO public.care_protocol_events(
    company_id, unit_id, protocol_definition_id, execution_id, event_type,
    payload, actor_id
  ) VALUES (
    v_execution.company_id, v_execution.unit_id, v_execution.protocol_definition_id,
    v_execution.id, 'OBSERVATION_RECORDED',
    jsonb_build_object('observation_id', v_row.id, 'step_id', p_step_id), v_actor
  );
  RETURN v_row;
END
$$;

CREATE OR REPLACE FUNCTION private.m21_raise_alert(
  p_execution_id UUID,
  p_step_id UUID,
  p_code TEXT,
  p_severity TEXT,
  p_message TEXT
)
RETURNS public.care_protocol_alerts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_execution public.care_protocol_executions;
  v_actor UUID;
  v_row public.care_protocol_alerts;
  v_severity TEXT := UPPER(BTRIM(COALESCE(p_severity, '')));
BEGIN
  SELECT * INTO v_execution FROM public.care_protocol_executions
  WHERE id = p_execution_id AND company_id = public.m21_actor_company_id();
  IF NOT FOUND OR v_execution.status NOT IN ('ACTIVE', 'PAUSED') THEN
    RAISE EXCEPTION 'Protocol execution not found or closed';
  END IF;
  v_actor := private.m21_require_actor(v_execution.company_id, v_execution.unit_id, FALSE, 'edit');
  IF p_step_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.care_protocol_execution_steps
    WHERE id = p_step_id AND execution_id = v_execution.id
  ) THEN RAISE EXCEPTION 'Step does not belong to execution'; END IF;
  IF v_severity NOT IN ('INFO', 'WARNING', 'CRITICAL')
     OR BTRIM(COALESCE(p_code, '')) = ''
     OR BTRIM(COALESCE(p_message, '')) = '' THEN
    RAISE EXCEPTION 'Alert code, severity and message are required';
  END IF;
  INSERT INTO public.care_protocol_alerts(
    company_id, unit_id, execution_id, step_id, code, severity, message, raised_by
  ) VALUES (
    v_execution.company_id, v_execution.unit_id, v_execution.id, p_step_id,
    UPPER(BTRIM(p_code)), v_severity, BTRIM(p_message), v_actor
  ) RETURNING * INTO v_row;
  INSERT INTO public.care_protocol_events(
    company_id, unit_id, protocol_definition_id, execution_id, event_type,
    payload, actor_id
  ) VALUES (
    v_execution.company_id, v_execution.unit_id, v_execution.protocol_definition_id,
    v_execution.id, 'ALERT_RAISED',
    jsonb_build_object('alert_id', v_row.id, 'severity', v_severity), v_actor
  );
  RETURN v_row;
END
$$;

CREATE OR REPLACE FUNCTION private.m21_transition_alert(
  p_alert_id UUID,
  p_expected_status TEXT,
  p_new_status TEXT,
  p_reason TEXT
)
RETURNS public.care_protocol_alerts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_row public.care_protocol_alerts;
  v_execution public.care_protocol_executions;
  v_actor UUID;
  v_expected TEXT := UPPER(BTRIM(COALESCE(p_expected_status, '')));
  v_new TEXT := UPPER(BTRIM(COALESCE(p_new_status, '')));
BEGIN
  SELECT * INTO v_row FROM public.care_protocol_alerts
  WHERE id = p_alert_id AND company_id = public.m21_actor_company_id()
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Protocol alert not found'; END IF;
  SELECT * INTO v_execution FROM public.care_protocol_executions WHERE id = v_row.execution_id;
  v_actor := private.m21_require_actor(v_row.company_id, v_row.unit_id, FALSE, 'edit');
  IF v_row.status <> v_expected THEN RAISE EXCEPTION 'Alert status changed concurrently'; END IF;
  IF NOT (
    (v_expected = 'OPEN' AND v_new IN ('ACKNOWLEDGED', 'RESOLVED'))
    OR (v_expected = 'ACKNOWLEDGED' AND v_new = 'RESOLVED')
  ) THEN RAISE EXCEPTION 'Invalid alert transition'; END IF;
  IF v_new = 'RESOLVED' AND BTRIM(COALESCE(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'Resolution reason is required';
  END IF;
  UPDATE public.care_protocol_alerts
  SET status = v_new,
      acknowledged_by = CASE WHEN v_new = 'ACKNOWLEDGED' THEN v_actor ELSE acknowledged_by END,
      acknowledged_at = CASE WHEN v_new = 'ACKNOWLEDGED' THEN NOW() ELSE acknowledged_at END,
      resolved_by = CASE WHEN v_new = 'RESOLVED' THEN v_actor ELSE resolved_by END,
      resolved_at = CASE WHEN v_new = 'RESOLVED' THEN NOW() ELSE resolved_at END,
      resolution_reason = CASE WHEN v_new = 'RESOLVED' THEN BTRIM(p_reason) ELSE resolution_reason END,
      updated_at = NOW()
  WHERE id = v_row.id RETURNING * INTO v_row;
  INSERT INTO public.care_protocol_events(
    company_id, unit_id, protocol_definition_id, execution_id, event_type,
    from_status, to_status, reason, payload, actor_id
  ) VALUES (
    v_row.company_id, v_row.unit_id, v_execution.protocol_definition_id,
    v_execution.id, 'ALERT_TRANSITION', v_expected, v_new,
    NULLIF(BTRIM(p_reason), ''), jsonb_build_object('alert_id', v_row.id), v_actor
  );
  RETURN v_row;
END
$$;

CREATE OR REPLACE FUNCTION private.m21_escalate(
  p_execution_id UUID,
  p_alert_id UUID,
  p_level INTEGER,
  p_target_role TEXT,
  p_target_user_id UUID,
  p_reason TEXT
)
RETURNS public.care_protocol_escalations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_execution public.care_protocol_executions;
  v_actor UUID;
  v_row public.care_protocol_escalations;
BEGIN
  SELECT * INTO v_execution FROM public.care_protocol_executions
  WHERE id = p_execution_id AND company_id = public.m21_actor_company_id();
  IF NOT FOUND OR v_execution.status NOT IN ('ACTIVE', 'PAUSED') THEN
    RAISE EXCEPTION 'Protocol execution not found or closed';
  END IF;
  v_actor := private.m21_require_actor(v_execution.company_id, v_execution.unit_id, FALSE, 'edit');
  IF p_alert_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.care_protocol_alerts
    WHERE id = p_alert_id AND execution_id = v_execution.id
  ) THEN RAISE EXCEPTION 'Alert does not belong to execution'; END IF;
  IF p_level NOT BETWEEN 1 AND 5
     OR (NULLIF(BTRIM(p_target_role), '') IS NULL AND p_target_user_id IS NULL)
     OR BTRIM(COALESCE(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'Escalation level, target and reason are required';
  END IF;
  INSERT INTO public.care_protocol_escalations(
    company_id, unit_id, execution_id, alert_id, escalation_level,
    target_role, target_user_id, reason, escalated_by
  ) VALUES (
    v_execution.company_id, v_execution.unit_id, v_execution.id, p_alert_id,
    p_level, NULLIF(BTRIM(p_target_role), ''), p_target_user_id,
    BTRIM(p_reason), v_actor
  ) RETURNING * INTO v_row;
  INSERT INTO public.care_protocol_events(
    company_id, unit_id, protocol_definition_id, execution_id, event_type,
    payload, reason, actor_id
  ) VALUES (
    v_execution.company_id, v_execution.unit_id, v_execution.protocol_definition_id,
    v_execution.id, 'ESCALATION_REQUESTED',
    jsonb_build_object('escalation_id', v_row.id, 'level', p_level),
    BTRIM(p_reason), v_actor
  );
  RETURN v_row;
END
$$;

CREATE OR REPLACE FUNCTION private.m21_add_override(
  p_execution_id UUID,
  p_step_id UUID,
  p_override_type TEXT,
  p_reason TEXT,
  p_previous_value JSONB,
  p_new_value JSONB
)
RETURNS public.care_protocol_overrides
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_execution public.care_protocol_executions;
  v_actor UUID;
  v_row public.care_protocol_overrides;
  v_type TEXT := UPPER(BTRIM(COALESCE(p_override_type, '')));
BEGIN
  SELECT * INTO v_execution FROM public.care_protocol_executions
  WHERE id = p_execution_id AND company_id = public.m21_actor_company_id();
  IF NOT FOUND OR v_execution.status NOT IN ('ACTIVE', 'PAUSED') THEN
    RAISE EXCEPTION 'Protocol execution not found or closed';
  END IF;
  v_actor := private.m21_require_actor(v_execution.company_id, v_execution.unit_id, FALSE, 'edit');
  IF p_step_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.care_protocol_execution_steps
    WHERE id = p_step_id AND execution_id = v_execution.id
  ) THEN RAISE EXCEPTION 'Step does not belong to execution'; END IF;
  IF v_type NOT IN ('SKIP_REQUIRED_STEP', 'DEADLINE', 'RESPONSIBILITY', 'OTHER')
     OR BTRIM(COALESCE(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'Override type and reason are required';
  END IF;
  INSERT INTO public.care_protocol_overrides(
    company_id, unit_id, execution_id, step_id, override_type, reason,
    previous_value, new_value, authorized_by
  ) VALUES (
    v_execution.company_id, v_execution.unit_id, v_execution.id, p_step_id,
    v_type, BTRIM(p_reason), p_previous_value, p_new_value, v_actor
  ) RETURNING * INTO v_row;
  INSERT INTO public.care_protocol_events(
    company_id, unit_id, protocol_definition_id, execution_id, event_type,
    reason, payload, actor_id
  ) VALUES (
    v_execution.company_id, v_execution.unit_id, v_execution.protocol_definition_id,
    v_execution.id, 'OVERRIDE_RECORDED', BTRIM(p_reason),
    jsonb_build_object('override_id', v_row.id, 'step_id', p_step_id, 'type', v_type),
    v_actor
  );
  RETURN v_row;
END
$$;

-- Public RPC wrappers remain invoker functions. The privileged implementation is
-- private, not exposed by the Data API, and validates actor, tenant and unit.
CREATE OR REPLACE FUNCTION public.m21_create_protocol_definition_secure(
  p_unit_id INTEGER, p_code TEXT, p_name TEXT, p_category TEXT DEFAULT 'CLINICAL',
  p_description TEXT DEFAULT NULL
) RETURNS public.care_protocol_definitions
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, private
AS $$ SELECT private.m21_create_definition(p_unit_id, p_code, p_name, p_category, p_description) $$;

CREATE OR REPLACE FUNCTION public.m21_publish_protocol_version_secure(
  p_protocol_definition_id UUID, p_content JSONB, p_change_summary TEXT
) RETURNS public.care_protocol_versions
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, private
AS $$ SELECT private.m21_publish_version(p_protocol_definition_id, p_content, p_change_summary) $$;

CREATE OR REPLACE FUNCTION public.m21_transition_protocol_definition_secure(
  p_protocol_definition_id UUID, p_expected_status TEXT, p_new_status TEXT, p_reason TEXT
) RETURNS public.care_protocol_definitions
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, private
AS $$ SELECT private.m21_transition_definition(p_protocol_definition_id, p_expected_status, p_new_status, p_reason) $$;

CREATE OR REPLACE FUNCTION public.m21_start_protocol_execution_secure(
  p_protocol_version_id UUID, p_unit_id INTEGER, p_patient_id BIGINT,
  p_encounter_id UUID DEFAULT NULL, p_source_signal_type TEXT DEFAULT NULL,
  p_source_signal_id TEXT DEFAULT NULL, p_source_signal_payload JSONB DEFAULT '{}'::JSONB,
  p_assigned_to UUID DEFAULT NULL
) RETURNS public.care_protocol_executions
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, private
AS $$ SELECT private.m21_start_execution(
  p_protocol_version_id, p_unit_id, p_patient_id, p_encounter_id,
  p_source_signal_type, p_source_signal_id, p_source_signal_payload, p_assigned_to
) $$;

CREATE OR REPLACE FUNCTION public.m21_transition_protocol_execution_secure(
  p_execution_id UUID, p_expected_status TEXT, p_new_status TEXT, p_reason TEXT DEFAULT NULL
) RETURNS public.care_protocol_executions
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, private
AS $$ SELECT private.m21_transition_execution(p_execution_id, p_expected_status, p_new_status, p_reason) $$;

CREATE OR REPLACE FUNCTION public.m21_transition_protocol_step_secure(
  p_step_id UUID, p_expected_status TEXT, p_new_status TEXT, p_reason TEXT DEFAULT NULL
) RETURNS public.care_protocol_execution_steps
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, private
AS $$ SELECT private.m21_transition_step(p_step_id, p_expected_status, p_new_status, p_reason) $$;

CREATE OR REPLACE FUNCTION public.m21_add_protocol_observation_secure(
  p_execution_id UUID, p_step_id UUID, p_observation_type TEXT,
  p_value JSONB DEFAULT '{}'::JSONB, p_notes TEXT DEFAULT NULL
) RETURNS public.care_protocol_observations
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, private
AS $$ SELECT private.m21_add_observation(p_execution_id, p_step_id, p_observation_type, p_value, p_notes) $$;

CREATE OR REPLACE FUNCTION public.m21_raise_protocol_alert_secure(
  p_execution_id UUID, p_step_id UUID, p_code TEXT, p_severity TEXT, p_message TEXT
) RETURNS public.care_protocol_alerts
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, private
AS $$ SELECT private.m21_raise_alert(p_execution_id, p_step_id, p_code, p_severity, p_message) $$;

CREATE OR REPLACE FUNCTION public.m21_transition_protocol_alert_secure(
  p_alert_id UUID, p_expected_status TEXT, p_new_status TEXT, p_reason TEXT DEFAULT NULL
) RETURNS public.care_protocol_alerts
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, private
AS $$ SELECT private.m21_transition_alert(p_alert_id, p_expected_status, p_new_status, p_reason) $$;

CREATE OR REPLACE FUNCTION public.m21_escalate_protocol_secure(
  p_execution_id UUID, p_alert_id UUID, p_level INTEGER, p_target_role TEXT,
  p_target_user_id UUID, p_reason TEXT
) RETURNS public.care_protocol_escalations
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, private
AS $$ SELECT private.m21_escalate(
  p_execution_id, p_alert_id, p_level, p_target_role, p_target_user_id, p_reason
) $$;

CREATE OR REPLACE FUNCTION public.m21_add_protocol_override_secure(
  p_execution_id UUID, p_step_id UUID, p_override_type TEXT, p_reason TEXT,
  p_previous_value JSONB DEFAULT NULL, p_new_value JSONB DEFAULT NULL
) RETURNS public.care_protocol_overrides
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, private
AS $$ SELECT private.m21_add_override(
  p_execution_id, p_step_id, p_override_type, p_reason, p_previous_value, p_new_value
) $$;

DO $$
DECLARE
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'care_protocol_definitions', 'care_protocol_versions',
    'care_protocol_executions', 'care_protocol_execution_steps',
    'care_protocol_observations', 'care_protocol_alerts',
    'care_protocol_escalations', 'care_protocol_overrides',
    'care_protocol_tasks', 'care_protocol_events'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', v_table);
    EXECUTE format(
      'REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated, app_prontomedic',
      v_table
    );
    EXECUTE format(
      'GRANT SELECT ON TABLE public.%I TO authenticated, app_prontomedic',
      v_table
    );
  END LOOP;
END
$$;

REVOKE ALL ON SEQUENCE public.care_protocol_events_id_seq
  FROM PUBLIC, anon, authenticated, app_prontomedic;

DROP POLICY IF EXISTS m21_definition_select ON public.care_protocol_definitions;
CREATE POLICY m21_definition_select
  ON public.care_protocol_definitions FOR SELECT TO authenticated, app_prontomedic
  USING (
    company_id = public.m21_actor_company_id()
    AND (unit_id IS NULL OR public.m21_unit_accessible(company_id, unit_id))
  );
DROP POLICY IF EXISTS m21_version_select ON public.care_protocol_versions;
CREATE POLICY m21_version_select
  ON public.care_protocol_versions FOR SELECT TO authenticated, app_prontomedic
  USING (
    company_id = public.m21_actor_company_id()
    AND EXISTS (
      SELECT 1 FROM public.care_protocol_definitions d
      WHERE d.id = protocol_definition_id
        AND d.company_id = care_protocol_versions.company_id
        AND (d.unit_id IS NULL OR public.m21_unit_accessible(d.company_id, d.unit_id))
    )
  );

DROP POLICY IF EXISTS m21_execution_select ON public.care_protocol_executions;
CREATE POLICY m21_execution_select
  ON public.care_protocol_executions FOR SELECT TO authenticated, app_prontomedic
  USING (
    company_id = public.m21_actor_company_id()
    AND public.m21_unit_accessible(company_id, unit_id)
  );
DROP POLICY IF EXISTS m21_step_select ON public.care_protocol_execution_steps;
CREATE POLICY m21_step_select
  ON public.care_protocol_execution_steps FOR SELECT TO authenticated, app_prontomedic
  USING (
    company_id = public.m21_actor_company_id()
    AND public.m21_unit_accessible(company_id, unit_id)
  );
DROP POLICY IF EXISTS m21_observation_select ON public.care_protocol_observations;
CREATE POLICY m21_observation_select
  ON public.care_protocol_observations FOR SELECT TO authenticated, app_prontomedic
  USING (
    company_id = public.m21_actor_company_id()
    AND public.m21_unit_accessible(company_id, unit_id)
  );
DROP POLICY IF EXISTS m21_alert_select ON public.care_protocol_alerts;
CREATE POLICY m21_alert_select
  ON public.care_protocol_alerts FOR SELECT TO authenticated, app_prontomedic
  USING (
    company_id = public.m21_actor_company_id()
    AND public.m21_unit_accessible(company_id, unit_id)
  );
DROP POLICY IF EXISTS m21_escalation_select ON public.care_protocol_escalations;
CREATE POLICY m21_escalation_select
  ON public.care_protocol_escalations FOR SELECT TO authenticated, app_prontomedic
  USING (
    company_id = public.m21_actor_company_id()
    AND public.m21_unit_accessible(company_id, unit_id)
  );
DROP POLICY IF EXISTS m21_override_select ON public.care_protocol_overrides;
CREATE POLICY m21_override_select
  ON public.care_protocol_overrides FOR SELECT TO authenticated, app_prontomedic
  USING (
    company_id = public.m21_actor_company_id()
    AND public.m21_unit_accessible(company_id, unit_id)
  );
DROP POLICY IF EXISTS m21_task_select ON public.care_protocol_tasks;
CREATE POLICY m21_task_select
  ON public.care_protocol_tasks FOR SELECT TO authenticated, app_prontomedic
  USING (
    company_id = public.m21_actor_company_id()
    AND public.m21_unit_accessible(company_id, unit_id)
  );
DROP POLICY IF EXISTS m21_event_select ON public.care_protocol_events;
CREATE POLICY m21_event_select
  ON public.care_protocol_events FOR SELECT TO authenticated, app_prontomedic
  USING (
    company_id = public.m21_actor_company_id()
    AND (unit_id IS NULL OR public.m21_unit_accessible(company_id, unit_id))
  );

REVOKE ALL ON FUNCTION public.m21_actor_company_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.m21_unit_accessible(UUID, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.m21_can_manage_definitions() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.m21_can_execute_protocols() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m21_actor_company_id() TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m21_unit_accessible(UUID, INTEGER) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m21_can_manage_definitions() TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m21_can_execute_protocols() TO authenticated, app_prontomedic;

DO $$
DECLARE
  v_signature TEXT;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'private.m21_require_actor(uuid,integer,boolean,text)',
    'private.m21_create_definition(integer,text,text,text,text)',
    'private.m21_publish_version(uuid,jsonb,text)',
    'private.m21_transition_definition(uuid,text,text,text)',
    'private.m21_start_execution(uuid,integer,bigint,uuid,text,text,jsonb,uuid)',
    'private.m21_transition_execution(uuid,text,text,text)',
    'private.m21_transition_step(uuid,text,text,text)',
    'private.m21_add_observation(uuid,uuid,text,jsonb,text)',
    'private.m21_raise_alert(uuid,uuid,text,text,text)',
    'private.m21_transition_alert(uuid,text,text,text)',
    'private.m21_escalate(uuid,uuid,integer,text,uuid,text)',
    'private.m21_add_override(uuid,uuid,text,text,jsonb,jsonb)'
  ]
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, app_prontomedic',
      v_signature
    );
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %s TO prontomedic_rpc_owner',
      v_signature
    );
  END LOOP;
END
$$;

DO $$
DECLARE
  v_signature TEXT;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.m21_create_protocol_definition_secure(integer,text,text,text,text)',
    'public.m21_publish_protocol_version_secure(uuid,jsonb,text)',
    'public.m21_transition_protocol_definition_secure(uuid,text,text,text)',
    'public.m21_start_protocol_execution_secure(uuid,integer,bigint,uuid,text,text,jsonb,uuid)',
    'public.m21_transition_protocol_execution_secure(uuid,text,text,text)',
    'public.m21_transition_protocol_step_secure(uuid,text,text,text)',
    'public.m21_add_protocol_observation_secure(uuid,uuid,text,jsonb,text)',
    'public.m21_raise_protocol_alert_secure(uuid,uuid,text,text,text)',
    'public.m21_transition_protocol_alert_secure(uuid,text,text,text)',
    'public.m21_escalate_protocol_secure(uuid,uuid,integer,text,uuid,text)',
    'public.m21_add_protocol_override_secure(uuid,uuid,text,text,jsonb,jsonb)'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', v_signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, app_prontomedic', v_signature);
  END LOOP;
END
$$;

GRANT USAGE ON SCHEMA public, private, auth TO prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION public.m21_actor_company_id()
  TO prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION public.m21_unit_accessible(UUID, INTEGER)
  TO prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION private.current_company_id()
  TO prontomedic_rpc_owner;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.care_protocol_definitions,
  public.care_protocol_versions,
  public.care_protocol_executions,
  public.care_protocol_execution_steps,
  public.care_protocol_observations,
  public.care_protocol_alerts,
  public.care_protocol_escalations,
  public.care_protocol_overrides,
  public.care_protocol_tasks,
  public.care_protocol_events
TO prontomedic_rpc_owner;
GRANT SELECT ON TABLE
  public.companies,
  public.units,
  public.user_profiles,
  public.unit_access,
  public.patients,
  public.encounters,
  public.triagens,
  public.permissions,
  public.user_permissions,
  public.roles,
  public.role_permissions
TO prontomedic_rpc_owner;
GRANT USAGE, SELECT ON SEQUENCE public.care_protocol_events_id_seq
  TO prontomedic_rpc_owner;

DO $ownership$
DECLARE
  v_function REGPROCEDURE;
BEGIN
  FOR v_function IN
    SELECT p.oid::REGPROCEDURE
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'private')
      AND p.proname LIKE 'm21_%'
      AND p.prosecdef
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO prontomedic_rpc_owner', v_function);
  END LOOP;
END
$ownership$;

DO $ledger$
BEGIN
  IF to_regclass('public.prontomedic_deployment_migrations') IS NOT NULL THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE
      ON public.prontomedic_deployment_migrations
      FROM authenticated, app_prontomedic;
    INSERT INTO public.prontomedic_deployment_migrations(filename, applied_at)
    VALUES ('20260724014218_module21_care_protocols.sql', NOW())
    ON CONFLICT (filename) DO NOTHING;
  END IF;
END
$ledger$;

COMMENT ON TABLE public.care_protocol_definitions IS
  'M21 protocol catalog scoped by company and optional unit.';
COMMENT ON TABLE public.care_protocol_versions IS
  'M21 immutable published protocol versions. Automatic prescription step types are rejected.';
COMMENT ON TABLE public.care_protocol_executions IS
  'M21 patient/encounter-aware protocol executions, optionally started from an M19 signal.';
COMMENT ON TABLE public.care_protocol_tasks IS
  'Operational tasks generated by M21 TASK steps; never medication or prescription orders.';

COMMIT;
