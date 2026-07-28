-- Modulo 20: prescricao eletronica canonica, seguranca clinica e trilha imutavel.
-- Migration aditiva. M17/M18 sao apenas referencias opcionais; nenhum JSON legado
-- e copiado para as novas tabelas.

BEGIN;

DO $owner$
DECLARE
  v_executor_is_superuser BOOLEAN;
BEGIN
  SELECT rolsuper INTO v_executor_is_superuser
  FROM pg_roles WHERE rolname = CURRENT_USER;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prontomedic_rpc_owner') THEN
    IF NOT COALESCE(v_executor_is_superuser, FALSE) THEN
      RAISE EXCEPTION 'M20 requires a superuser to create prontomedic_rpc_owner';
    END IF;
    EXECUTE
      'CREATE ROLE prontomedic_rpc_owner NOLOGIN BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION';
  ELSIF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'prontomedic_rpc_owner'
      AND (rolcanlogin OR NOT rolbypassrls OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication)
  ) THEN
    IF NOT COALESCE(v_executor_is_superuser, FALSE) THEN
      RAISE EXCEPTION 'M20 cannot harden prontomedic_rpc_owner without a superuser';
    END IF;
    EXECUTE
      'ALTER ROLE prontomedic_rpc_owner NOLOGIN BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION';
  END IF;
END
$owner$;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS private;

DO $dependencies$
BEGIN
  IF to_regclass('public.permissions') IS NULL
     OR to_regclass('public.role_permissions') IS NULL
     OR to_regclass('public.roles') IS NULL
     OR to_regclass('public.user_permissions') IS NULL
     OR to_regprocedure(
       'private.prontomedic_module_action_allowed(text,text,integer,boolean)'
     ) IS NULL THEN
    RAISE EXCEPTION 'M20 requires the canonical permission catalog and M19 authorization helper';
  END IF;
END
$dependencies$;

INSERT INTO public.permissions (module, action, label, description)
VALUES
  ('prescricao_eletronica', 'view', 'Visualizar prescrições eletrônicas', 'Consultar prescrições no tenant autorizado'),
  ('prescricao_eletronica', 'create', 'Criar prescrições eletrônicas', 'Criar, validar e assinar prescrições autorizadas'),
  ('prescricao_eletronica', 'edit', 'Editar prescrições eletrônicas', 'Alterar itens e transicionar prescrições autorizadas'),
  ('revisao_farmaceutica', 'view', 'Visualizar revisão farmacêutica', 'Consultar validações e revisões farmacêuticas'),
  ('revisao_farmaceutica', 'create', 'Registrar revisão farmacêutica', 'Registrar decisão farmacêutica auditável'),
  ('revisao_farmaceutica', 'edit', 'Atualizar revisão farmacêutica', 'Resolver alertas e transicionar revisão autorizada')
ON CONFLICT (module, action) DO NOTHING;

INSERT INTO public.role_permissions (
  role_id, module, can_view, can_create, can_edit, can_delete, can_export
)
SELECT r.id, matrix.module, matrix.can_view, matrix.can_create, matrix.can_edit, FALSE, FALSE
FROM public.roles r
JOIN (
  VALUES
    ('admin', 'prescricao_eletronica', TRUE, TRUE, TRUE),
    ('medico', 'prescricao_eletronica', TRUE, TRUE, TRUE),
    ('farmacia', 'prescricao_eletronica', TRUE, FALSE, FALSE),
    ('enfermagem', 'prescricao_eletronica', TRUE, FALSE, FALSE),
    ('admin', 'revisao_farmaceutica', TRUE, TRUE, TRUE),
    ('farmacia', 'revisao_farmaceutica', TRUE, TRUE, TRUE)
) AS matrix(role_name, module, can_view, can_create, can_edit)
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
    (rp.module = 'prescricao_eletronica'
      AND r.name NOT IN ('admin', 'medico', 'farmacia', 'enfermagem'))
    OR
    (rp.module = 'revisao_farmaceutica'
      AND r.name NOT IN ('admin', 'farmacia'))
  )
  AND (rp.can_view OR rp.can_create OR rp.can_edit OR rp.can_delete OR rp.can_export);

CREATE TABLE IF NOT EXISTS public.electronic_prescriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  unit_id INTEGER NOT NULL REFERENCES public.units(id) ON DELETE RESTRICT,
  encounter_id UUID REFERENCES public.encounters(id) ON DELETE RESTRICT,
  patient_id BIGINT NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  prescriber_id BIGINT NOT NULL REFERENCES public.professionals(id) ON DELETE RESTRICT,
  medical_record_id BIGINT REFERENCES public.medical_records(id) ON DELETE SET NULL,
  root_prescription_id UUID,
  supersedes_id UUID,
  current_version INTEGER NOT NULL DEFAULT 0 CHECK (current_version >= 0),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','validated','signed','active','suspended','cancelled','completed','expired')),
  clinical_indication TEXT,
  notes TEXT,
  last_validation_run_id UUID,
  validated_at TIMESTAMPTZ,
  signed_at TIMESTAMPTZ,
  signed_by UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  signature_hash TEXT,
  activated_at TIMESTAMPTZ,
  suspended_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  expired_at TIMESTAMPTZ,
  terminal_reason TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    status NOT IN ('signed','active','suspended','completed','expired')
    OR (signed_at IS NOT NULL AND signed_by IS NOT NULL AND signature_hash IS NOT NULL)
  ),
  CHECK (signature_hash IS NULL OR signature_hash ~ '^[0-9a-f]{64}$')
);

ALTER TABLE public.electronic_prescriptions
  DROP CONSTRAINT IF EXISTS electronic_prescriptions_root_fk,
  DROP CONSTRAINT IF EXISTS electronic_prescriptions_supersedes_fk;

ALTER TABLE public.electronic_prescriptions
  ADD CONSTRAINT electronic_prescriptions_root_fk
    FOREIGN KEY (root_prescription_id)
    REFERENCES public.electronic_prescriptions(id) ON DELETE RESTRICT,
  ADD CONSTRAINT electronic_prescriptions_supersedes_fk
    FOREIGN KEY (supersedes_id)
    REFERENCES public.electronic_prescriptions(id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS public.electronic_prescription_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  prescription_id UUID NOT NULL REFERENCES public.electronic_prescriptions(id) ON DELETE RESTRICT,
  item_type TEXT NOT NULL DEFAULT 'medication'
    CHECK (item_type IN ('medication','diet','care','procedure')),
  medication_id BIGINT,
  medication_name TEXT NOT NULL,
  active_ingredient TEXT,
  concentration TEXT,
  pharmaceutical_form TEXT,
  dose NUMERIC(14,4),
  dose_unit TEXT,
  route TEXT,
  frequency_text TEXT,
  frequency_interval_minutes INTEGER CHECK (frequency_interval_minutes IS NULL OR frequency_interval_minutes > 0),
  schedule_times TIME[] NOT NULL DEFAULT '{}'::TIME[],
  duration_days INTEGER CHECK (duration_days IS NULL OR duration_days > 0),
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  is_prn BOOLEAN NOT NULL DEFAULT FALSE,
  max_daily_dose NUMERIC(14,4) CHECK (max_daily_dose IS NULL OR max_daily_dose > 0),
  indication TEXT,
  instructions TEXT,
  renal_adjustment_notes TEXT,
  hepatic_adjustment_notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (NULLIF(BTRIM(medication_name), '') IS NOT NULL),
  CHECK (
    item_type <> 'medication'
    OR (
      dose IS NOT NULL AND dose > 0
      AND NULLIF(BTRIM(dose_unit), '') IS NOT NULL
      AND NULLIF(BTRIM(route), '') IS NOT NULL
      AND NULLIF(BTRIM(frequency_text), '') IS NOT NULL
    )
  ),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at >= starts_at)
);

CREATE TABLE IF NOT EXISTS public.prescription_safety_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  prescription_id UUID NOT NULL REFERENCES public.electronic_prescriptions(id) ON DELETE RESTRICT,
  prescription_item_id UUID REFERENCES public.electronic_prescription_items(id) ON DELETE RESTRICT,
  validation_run_id UUID NOT NULL,
  related_event_id UUID REFERENCES public.prescription_safety_events(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('detected','acknowledged','overridden','resolved')),
  rule_code TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  title TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(details) = 'object'),
  reason TEXT,
  actor_id UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    event_type = 'detected'
    OR (related_event_id IS NOT NULL AND NULLIF(BTRIM(reason), '') IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.pharmaceutical_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  prescription_id UUID NOT NULL REFERENCES public.electronic_prescriptions(id) ON DELETE RESTRICT,
  review_status TEXT NOT NULL CHECK (review_status IN ('approved','changes_requested','rejected')),
  notes TEXT,
  reviewer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reviewer_professional_id BIGINT REFERENCES public.professionals(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (review_status = 'approved' OR NULLIF(BTRIM(notes), '') IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.electronic_prescription_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  prescription_id UUID NOT NULL REFERENCES public.electronic_prescriptions(id) ON DELETE RESTRICT,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  action TEXT NOT NULL,
  reason TEXT,
  header_snapshot JSONB NOT NULL CHECK (jsonb_typeof(header_snapshot) = 'object'),
  items_snapshot JSONB NOT NULL CHECK (jsonb_typeof(items_snapshot) = 'array'),
  snapshot_hash TEXT NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
  actor_id UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (prescription_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_m20_prescriptions_patient
  ON public.electronic_prescriptions(company_id, patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_m20_prescriptions_encounter
  ON public.electronic_prescriptions(company_id, encounter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_m20_prescriptions_unit_status
  ON public.electronic_prescriptions(company_id, unit_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_m20_items_prescription
  ON public.electronic_prescription_items(company_id, prescription_id, sort_order, created_at);
CREATE INDEX IF NOT EXISTS idx_m20_safety_validation
  ON public.prescription_safety_events(company_id, prescription_id, validation_run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_m20_reviews_prescription
  ON public.pharmaceutical_reviews(company_id, prescription_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_m20_versions_prescription
  ON public.electronic_prescription_versions(company_id, prescription_id, version_number DESC);

CREATE OR REPLACE FUNCTION private.m18_unit_accessible_runtime(
  p_company_id UUID,
  p_unit_id INTEGER
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $fn$
  SELECT p_unit_id IS NULL OR EXISTS (
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
           'admin', 'administrador', 'gestor', 'gerente'
         )
         OR up.primary_unit_id = p_unit_id
         OR EXISTS (
           SELECT 1
             FROM public.user_roles ur
            WHERE ur.user_id = coalesce(up.user_id, up.id)
              AND ur.company_id = p_company_id
              AND (ur.unit_id IS NULL OR ur.unit_id = p_unit_id)
              AND ur.valid_from <= NOW()
              AND (ur.valid_until IS NULL OR ur.valid_until >= NOW())
         )
       )
  )
$fn$;

ALTER FUNCTION private.m18_unit_accessible_runtime(UUID, INTEGER)
  OWNER TO prontomedic_rpc_owner;
REVOKE ALL ON FUNCTION private.m18_unit_accessible_runtime(UUID, INTEGER)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.m18_unit_accessible_runtime(UUID, INTEGER)
  TO authenticated, app_prontomedic, prontomedic_rpc_owner;

CREATE OR REPLACE FUNCTION public.m18_unit_accessible(
  p_company_id UUID,
  p_unit_id INTEGER
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, private
AS $fn$
  SELECT private.m18_unit_accessible_runtime(p_company_id, p_unit_id)
$fn$;

REVOKE ALL ON FUNCTION public.m18_unit_accessible(UUID, INTEGER)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m18_unit_accessible(UUID, INTEGER)
  TO authenticated, app_prontomedic, prontomedic_rpc_owner;

CREATE OR REPLACE FUNCTION public.m20_company_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
  SELECT public.m17_company_id();
$fn$;

CREATE OR REPLACE FUNCTION public.m20_can_read_prescriptions()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $fn$
  SELECT private.prontomedic_module_action_allowed(
      'prescricao_eletronica', 'view', NULL, FALSE
    )
    OR private.prontomedic_module_action_allowed(
      'revisao_farmaceutica', 'view', NULL, FALSE
    );
$fn$;

CREATE OR REPLACE FUNCTION public.m20_can_prescribe(p_prescriber_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $fn$
  SELECT private.prontomedic_module_action_allowed(
      'prescricao_eletronica', 'create', NULL, FALSE
    )
    AND EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE (up.id = auth.uid() OR up.user_id = auth.uid())
        AND up.company_id = public.m20_company_id()
        AND up.lg_ativo = TRUE
        AND (
          lower(COALESCE(up.role_name, '')) IN ('admin','administrador')
          OR EXISTS (
            SELECT 1
            FROM public.professionals p
            WHERE p.id = p_prescriber_id
              AND p.company_id = up.company_id
              AND p.user_id = auth.uid()
              AND p.lg_ativo = TRUE
          )
        )
    );
$fn$;

CREATE OR REPLACE FUNCTION public.m20_can_review_prescriptions()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $fn$
  SELECT private.prontomedic_module_action_allowed(
    'revisao_farmaceutica', 'create', NULL, FALSE
  );
$fn$;

CREATE OR REPLACE FUNCTION private.m20_guard_internal_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF current_setting('m20.internal_write', TRUE) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Alteração direta do M20 não permitida; use os RPCs seguros';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Registros clínicos do M20 não podem ser excluídos';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION private.m20_guard_item_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_prescription_id UUID;
  v_status TEXT;
BEGIN
  IF current_setting('m20.internal_write', TRUE) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Alteração direta de item não permitida; use os RPCs seguros';
  END IF;
  v_prescription_id := CASE
    WHEN TG_OP = 'DELETE' THEN OLD.prescription_id
    ELSE NEW.prescription_id
  END;
  SELECT status INTO v_status
  FROM public.electronic_prescriptions
  WHERE id = v_prescription_id;
  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Itens só podem ser alterados em prescrição rascunho';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION private.m20_reject_append_only_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Histórico clínico imutável';
  END IF;
  IF current_setting('m20.internal_write', TRUE) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Inserção direta no histórico não permitida';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_m20_guard_prescription ON public.electronic_prescriptions;
CREATE TRIGGER trg_m20_guard_prescription
  BEFORE UPDATE OR DELETE ON public.electronic_prescriptions
  FOR EACH ROW EXECUTE FUNCTION private.m20_guard_internal_write();

DROP TRIGGER IF EXISTS trg_m20_guard_item ON public.electronic_prescription_items;
CREATE TRIGGER trg_m20_guard_item
  BEFORE INSERT OR UPDATE OR DELETE ON public.electronic_prescription_items
  FOR EACH ROW EXECUTE FUNCTION private.m20_guard_item_write();

DROP TRIGGER IF EXISTS trg_m20_safety_append_only ON public.prescription_safety_events;
CREATE TRIGGER trg_m20_safety_append_only
  BEFORE INSERT OR UPDATE OR DELETE ON public.prescription_safety_events
  FOR EACH ROW EXECUTE FUNCTION private.m20_reject_append_only_mutation();

DROP TRIGGER IF EXISTS trg_m20_review_append_only ON public.pharmaceutical_reviews;
CREATE TRIGGER trg_m20_review_append_only
  BEFORE INSERT OR UPDATE OR DELETE ON public.pharmaceutical_reviews
  FOR EACH ROW EXECUTE FUNCTION private.m20_reject_append_only_mutation();

DROP TRIGGER IF EXISTS trg_m20_version_append_only ON public.electronic_prescription_versions;
CREATE TRIGGER trg_m20_version_append_only
  BEFORE INSERT OR UPDATE OR DELETE ON public.electronic_prescription_versions
  FOR EACH ROW EXECUTE FUNCTION private.m20_reject_append_only_mutation();

CREATE OR REPLACE FUNCTION private.m20_append_version(
  p_prescription_id UUID,
  p_action TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_row public.electronic_prescriptions;
  v_items JSONB;
  v_header JSONB;
  v_next INTEGER;
  v_hash TEXT;
BEGIN
  IF current_setting('m20.internal_write', TRUE) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Operação interna M20 ausente';
  END IF;

  SELECT * INTO v_row
  FROM public.electronic_prescriptions
  WHERE id = p_prescription_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Prescrição não encontrada'; END IF;

  SELECT COALESCE(MAX(version_number), 0) + 1
    INTO v_next
  FROM public.electronic_prescription_versions
  WHERE prescription_id = p_prescription_id;

  UPDATE public.electronic_prescriptions
     SET current_version = v_next,
         updated_at = NOW(),
         updated_by = auth.uid()
   WHERE id = p_prescription_id
   RETURNING * INTO v_row;

  SELECT COALESCE(JSONB_AGG(to_jsonb(i) ORDER BY i.sort_order, i.created_at, i.id), '[]'::JSONB)
    INTO v_items
  FROM public.electronic_prescription_items i
  WHERE i.prescription_id = p_prescription_id;

  v_header := to_jsonb(v_row);
  v_hash := encode(digest((v_header || JSONB_BUILD_OBJECT('items', v_items))::TEXT, 'sha256'), 'hex');

  INSERT INTO public.electronic_prescription_versions(
    company_id, prescription_id, version_number, action, reason,
    header_snapshot, items_snapshot, snapshot_hash, actor_id
  )
  VALUES (
    v_row.company_id, p_prescription_id, v_next, upper(BTRIM(p_action)),
    NULLIF(BTRIM(p_reason), ''), v_header, v_items, v_hash, auth.uid()
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION private.m20_create_prescription_impl(
  p_unit_id INTEGER,
  p_encounter_id UUID,
  p_patient_id BIGINT,
  p_prescriber_id BIGINT,
  p_medical_record_id BIGINT DEFAULT NULL,
  p_clinical_indication TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS public.electronic_prescriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_company UUID := public.m20_company_id();
  v_row public.electronic_prescriptions;
BEGIN
  IF v_company IS NULL OR NOT public.m20_can_prescribe(p_prescriber_id) THEN
    RAISE EXCEPTION 'Usuário sem permissão para prescrever';
  END IF;
  IF p_unit_id IS NULL OR NOT public.m18_unit_accessible(v_company, p_unit_id) THEN
    RAISE EXCEPTION 'Unidade não autorizada';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.units u
    WHERE u.id = p_unit_id AND u.company_id = v_company AND u.lg_ativo = TRUE
  ) THEN RAISE EXCEPTION 'Unidade não pertence à empresa'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.patients p
    WHERE p.id = p_patient_id AND p.company_id = v_company AND p.lg_ativo = TRUE
  ) THEN RAISE EXCEPTION 'Paciente não pertence à empresa'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.professionals p
    WHERE p.id = p_prescriber_id AND p.company_id = v_company AND p.lg_ativo = TRUE
  ) THEN RAISE EXCEPTION 'Prescritor não pertence à empresa'; END IF;
  IF p_encounter_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.encounters e
    WHERE e.id = p_encounter_id
      AND e.company_id = v_company
      AND e.patient_id = p_patient_id
      AND (e.unit_id IS NULL OR e.unit_id = p_unit_id)
  ) THEN RAISE EXCEPTION 'Atendimento incompatível com paciente ou unidade'; END IF;
  IF p_medical_record_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.medical_records mr
    WHERE mr.id = p_medical_record_id
      AND mr.company_id = v_company
      AND mr.patient_id = p_patient_id
      AND (mr.encounter_id IS NULL OR p_encounter_id IS NULL OR mr.encounter_id = p_encounter_id)
  ) THEN RAISE EXCEPTION 'Prontuário incompatível com paciente ou atendimento'; END IF;

  PERFORM set_config('m20.internal_write', 'on', TRUE);
  INSERT INTO public.electronic_prescriptions(
    company_id, unit_id, encounter_id, patient_id, prescriber_id, medical_record_id,
    status, clinical_indication, notes, created_by, updated_by
  )
  VALUES (
    v_company, p_unit_id, p_encounter_id, p_patient_id, p_prescriber_id, p_medical_record_id,
    'draft', NULLIF(BTRIM(p_clinical_indication), ''), NULLIF(BTRIM(p_notes), ''),
    auth.uid(), auth.uid()
  )
  RETURNING * INTO v_row;

  UPDATE public.electronic_prescriptions
     SET root_prescription_id = id
   WHERE id = v_row.id;
  PERFORM private.m20_append_version(v_row.id, 'created', NULL);
  SELECT * INTO v_row FROM public.electronic_prescriptions WHERE id = v_row.id;
  RETURN v_row;
END;
$fn$;

CREATE OR REPLACE FUNCTION private.m20_upsert_item_impl(
  p_prescription_id UUID,
  p_item JSONB,
  p_item_id UUID DEFAULT NULL
)
RETURNS public.electronic_prescription_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_company UUID := public.m20_company_id();
  v_prescription public.electronic_prescriptions;
  v_row public.electronic_prescription_items;
  v_item_type TEXT := lower(COALESCE(NULLIF(BTRIM(p_item->>'item_type'), ''), 'medication'));
  v_dose NUMERIC;
  v_medication_id BIGINT;
  v_schedule TIME[];
BEGIN
  IF jsonb_typeof(COALESCE(p_item, '{}'::JSONB)) <> 'object' THEN
    RAISE EXCEPTION 'Item inválido';
  END IF;
  SELECT * INTO v_prescription
  FROM public.electronic_prescriptions
  WHERE id = p_prescription_id AND company_id = v_company
  FOR UPDATE;
  IF NOT FOUND OR NOT public.m20_can_prescribe(v_prescription.prescriber_id) THEN
    RAISE EXCEPTION 'Prescrição não encontrada ou não autorizada';
  END IF;
  IF v_prescription.status NOT IN ('draft','validated') THEN
    RAISE EXCEPTION 'Prescrição não pode mais receber alterações';
  END IF;
  IF v_item_type NOT IN ('medication','diet','care','procedure') THEN
    RAISE EXCEPTION 'Tipo de item inválido';
  END IF;
  IF NULLIF(BTRIM(p_item->>'medication_name'), '') IS NULL THEN
    RAISE EXCEPTION 'Descrição do item é obrigatória';
  END IF;
  IF NULLIF(p_item->>'dose', '') IS NOT NULL THEN
    IF (p_item->>'dose') !~ '^[0-9]+([.][0-9]{1,4})?$' THEN RAISE EXCEPTION 'Dose inválida'; END IF;
    v_dose := (p_item->>'dose')::NUMERIC;
  END IF;
  IF NULLIF(p_item->>'medication_id', '') IS NOT NULL THEN
    IF (p_item->>'medication_id') !~ '^[0-9]+$' THEN RAISE EXCEPTION 'Medicamento inválido'; END IF;
    v_medication_id := (p_item->>'medication_id')::BIGINT;
  END IF;
  IF v_item_type = 'medication' AND (
    v_dose IS NULL OR v_dose <= 0
    OR NULLIF(BTRIM(p_item->>'dose_unit'), '') IS NULL
    OR NULLIF(BTRIM(p_item->>'route'), '') IS NULL
    OR NULLIF(BTRIM(p_item->>'frequency_text'), '') IS NULL
  ) THEN RAISE EXCEPTION 'Medicamento exige dose, unidade, via e frequência'; END IF;
  IF jsonb_typeof(COALESCE(p_item->'schedule_times', '[]'::JSONB)) <> 'array' THEN
    RAISE EXCEPTION 'Horários devem ser um array';
  END IF;
  SELECT COALESCE(ARRAY_AGG(value::TIME ORDER BY ordinal), '{}'::TIME[])
    INTO v_schedule
  FROM jsonb_array_elements_text(COALESCE(p_item->'schedule_times', '[]'::JSONB))
       WITH ORDINALITY AS schedule(value, ordinal);

  PERFORM set_config('m20.internal_write', 'on', TRUE);
  IF v_prescription.status = 'validated' THEN
    UPDATE public.electronic_prescriptions
       SET status = 'draft', validated_at = NULL, last_validation_run_id = NULL
     WHERE id = p_prescription_id;
  END IF;

  IF p_item_id IS NULL THEN
    INSERT INTO public.electronic_prescription_items(
      company_id, prescription_id, item_type, medication_id, medication_name,
      active_ingredient, concentration, pharmaceutical_form, dose, dose_unit,
      route, frequency_text, frequency_interval_minutes, schedule_times,
      duration_days, starts_at, ends_at, is_prn, max_daily_dose, indication,
      instructions, renal_adjustment_notes, hepatic_adjustment_notes, sort_order,
      created_by, updated_by
    )
    VALUES (
      v_company, p_prescription_id, v_item_type, v_medication_id,
      BTRIM(p_item->>'medication_name'), NULLIF(BTRIM(p_item->>'active_ingredient'), ''),
      NULLIF(BTRIM(p_item->>'concentration'), ''), NULLIF(BTRIM(p_item->>'pharmaceutical_form'), ''),
      v_dose, NULLIF(BTRIM(p_item->>'dose_unit'), ''), NULLIF(BTRIM(p_item->>'route'), ''),
      NULLIF(BTRIM(p_item->>'frequency_text'), ''),
      NULLIF(p_item->>'frequency_interval_minutes', '')::INTEGER, v_schedule,
      NULLIF(p_item->>'duration_days', '')::INTEGER, NULLIF(p_item->>'starts_at', '')::TIMESTAMPTZ,
      NULLIF(p_item->>'ends_at', '')::TIMESTAMPTZ, COALESCE((p_item->>'is_prn')::BOOLEAN, FALSE),
      NULLIF(p_item->>'max_daily_dose', '')::NUMERIC, NULLIF(BTRIM(p_item->>'indication'), ''),
      NULLIF(BTRIM(p_item->>'instructions'), ''), NULLIF(BTRIM(p_item->>'renal_adjustment_notes'), ''),
      NULLIF(BTRIM(p_item->>'hepatic_adjustment_notes'), ''),
      COALESCE(NULLIF(p_item->>'sort_order', '')::INTEGER, 0), auth.uid(), auth.uid()
    )
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.electronic_prescription_items
       SET item_type = v_item_type,
           medication_id = v_medication_id,
           medication_name = BTRIM(p_item->>'medication_name'),
           active_ingredient = NULLIF(BTRIM(p_item->>'active_ingredient'), ''),
           concentration = NULLIF(BTRIM(p_item->>'concentration'), ''),
           pharmaceutical_form = NULLIF(BTRIM(p_item->>'pharmaceutical_form'), ''),
           dose = v_dose,
           dose_unit = NULLIF(BTRIM(p_item->>'dose_unit'), ''),
           route = NULLIF(BTRIM(p_item->>'route'), ''),
           frequency_text = NULLIF(BTRIM(p_item->>'frequency_text'), ''),
           frequency_interval_minutes = NULLIF(p_item->>'frequency_interval_minutes', '')::INTEGER,
           schedule_times = v_schedule,
           duration_days = NULLIF(p_item->>'duration_days', '')::INTEGER,
           starts_at = NULLIF(p_item->>'starts_at', '')::TIMESTAMPTZ,
           ends_at = NULLIF(p_item->>'ends_at', '')::TIMESTAMPTZ,
           is_prn = COALESCE((p_item->>'is_prn')::BOOLEAN, FALSE),
           max_daily_dose = NULLIF(p_item->>'max_daily_dose', '')::NUMERIC,
           indication = NULLIF(BTRIM(p_item->>'indication'), ''),
           instructions = NULLIF(BTRIM(p_item->>'instructions'), ''),
           renal_adjustment_notes = NULLIF(BTRIM(p_item->>'renal_adjustment_notes'), ''),
           hepatic_adjustment_notes = NULLIF(BTRIM(p_item->>'hepatic_adjustment_notes'), ''),
           sort_order = COALESCE(NULLIF(p_item->>'sort_order', '')::INTEGER, sort_order),
           updated_by = auth.uid(),
           updated_at = NOW()
     WHERE id = p_item_id
       AND prescription_id = p_prescription_id
       AND company_id = v_company
     RETURNING * INTO v_row;
    IF NOT FOUND THEN RAISE EXCEPTION 'Item não encontrado'; END IF;
  END IF;

  PERFORM private.m20_append_version(p_prescription_id, 'item_saved', NULL);
  RETURN v_row;
END;
$fn$;

CREATE OR REPLACE FUNCTION private.m20_remove_item_impl(
  p_prescription_id UUID,
  p_item_id UUID
)
RETURNS public.electronic_prescriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_company UUID := public.m20_company_id();
  v_prescription public.electronic_prescriptions;
BEGIN
  SELECT * INTO v_prescription
  FROM public.electronic_prescriptions
  WHERE id = p_prescription_id AND company_id = v_company
  FOR UPDATE;
  IF NOT FOUND OR NOT public.m20_can_prescribe(v_prescription.prescriber_id) THEN
    RAISE EXCEPTION 'Prescrição não encontrada ou não autorizada';
  END IF;
  IF v_prescription.status NOT IN ('draft','validated') THEN
    RAISE EXCEPTION 'Prescrição não pode mais receber alterações';
  END IF;
  PERFORM set_config('m20.internal_write', 'on', TRUE);
  IF v_prescription.status = 'validated' THEN
    UPDATE public.electronic_prescriptions
       SET status = 'draft', validated_at = NULL, last_validation_run_id = NULL
     WHERE id = p_prescription_id;
  END IF;
  DELETE FROM public.electronic_prescription_items
  WHERE id = p_item_id AND prescription_id = p_prescription_id AND company_id = v_company;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item não encontrado'; END IF;
  PERFORM private.m20_append_version(p_prescription_id, 'item_removed', NULL);
  SELECT * INTO v_prescription FROM public.electronic_prescriptions WHERE id = p_prescription_id;
  RETURN v_prescription;
END;
$fn$;

CREATE OR REPLACE FUNCTION private.m20_validate_prescription_impl(p_prescription_id UUID)
RETURNS public.electronic_prescriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_company UUID := public.m20_company_id();
  v_prescription public.electronic_prescriptions;
  v_run UUID := gen_random_uuid();
  v_critical INTEGER;
BEGIN
  SELECT * INTO v_prescription
  FROM public.electronic_prescriptions
  WHERE id = p_prescription_id AND company_id = v_company
  FOR UPDATE;
  IF NOT FOUND OR NOT public.m20_can_prescribe(v_prescription.prescriber_id) THEN
    RAISE EXCEPTION 'Prescrição não encontrada ou não autorizada';
  END IF;
  IF v_prescription.status NOT IN ('draft','validated') THEN
    RAISE EXCEPTION 'Somente rascunho pode ser validado';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.electronic_prescription_items
    WHERE prescription_id = p_prescription_id
  ) THEN RAISE EXCEPTION 'Inclua ao menos um item antes de validar'; END IF;

  PERFORM set_config('m20.internal_write', 'on', TRUE);

  INSERT INTO public.prescription_safety_events(
    company_id, prescription_id, validation_run_id, event_type, rule_code,
    rule_version, severity, title, details, actor_id
  )
  SELECT v_company, p_prescription_id, v_run, 'detected', 'DUPLICATE_ACTIVE_INGREDIENT',
         'm20.1', 'warning', 'Possível duplicidade terapêutica',
         JSONB_BUILD_OBJECT('key', normalized_name, 'count', item_count), auth.uid()
  FROM (
    SELECT lower(BTRIM(COALESCE(NULLIF(active_ingredient, ''), medication_name))) normalized_name,
           COUNT(*) item_count
    FROM public.electronic_prescription_items
    WHERE prescription_id = p_prescription_id AND item_type = 'medication'
    GROUP BY lower(BTRIM(COALESCE(NULLIF(active_ingredient, ''), medication_name)))
    HAVING COUNT(*) > 1
  ) duplicates;

  INSERT INTO public.prescription_safety_events(
    company_id, prescription_id, prescription_item_id, validation_run_id,
    event_type, rule_code, rule_version, severity, title, details, actor_id
  )
  SELECT v_company, p_prescription_id, i.id, v_run,
         'detected', 'ACTIVE_ALLERGY_EXACT_MATCH', 'm20.1', 'critical',
         'Alergia ativa compatível com o item prescrito',
         JSONB_BUILD_OBJECT(
           'allergy_id', a.id,
           'allergen', a.allergen,
           'reaction', a.reaction,
           'allergy_severity', a.severity,
           'medication', i.medication_name
         ),
         auth.uid()
  FROM public.electronic_prescription_items i
  JOIN public.patient_allergies a
    ON a.company_id = v_company
   AND a.patient_id = v_prescription.patient_id
   AND a.status = 'ACTIVE'
   AND lower(BTRIM(a.allergen)) =
       lower(BTRIM(COALESCE(NULLIF(i.active_ingredient, ''), i.medication_name)))
  WHERE i.prescription_id = p_prescription_id
    AND i.item_type = 'medication';

  SELECT COUNT(*) INTO v_critical
  FROM public.prescription_safety_events
  WHERE prescription_id = p_prescription_id
    AND validation_run_id = v_run
    AND event_type = 'detected'
    AND severity = 'critical';

  UPDATE public.electronic_prescriptions
     SET status = CASE WHEN v_critical = 0 THEN 'validated' ELSE 'draft' END,
         validated_at = CASE WHEN v_critical = 0 THEN NOW() ELSE NULL END,
         last_validation_run_id = v_run,
         updated_by = auth.uid()
   WHERE id = p_prescription_id
   RETURNING * INTO v_prescription;

  PERFORM private.m20_append_version(
    p_prescription_id,
    CASE WHEN v_critical = 0 THEN 'validated' ELSE 'validation_blocked' END,
    CASE WHEN v_critical = 0 THEN NULL ELSE 'Evento crítico de segurança pendente' END
  );
  SELECT * INTO v_prescription FROM public.electronic_prescriptions WHERE id = p_prescription_id;
  RETURN v_prescription;
END;
$fn$;

CREATE OR REPLACE FUNCTION private.m20_resolve_safety_event_impl(
  p_event_id UUID,
  p_action TEXT,
  p_reason TEXT
)
RETURNS public.electronic_prescriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_company UUID := public.m20_company_id();
  v_event public.prescription_safety_events;
  v_prescription public.electronic_prescriptions;
  v_action TEXT := lower(BTRIM(COALESCE(p_action, '')));
BEGIN
  IF v_action NOT IN ('acknowledged','overridden','resolved') THEN
    RAISE EXCEPTION 'Ação de segurança inválida';
  END IF;
  IF NULLIF(BTRIM(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Justificativa obrigatória'; END IF;
  SELECT * INTO v_event
  FROM public.prescription_safety_events
  WHERE id = p_event_id AND company_id = v_company AND event_type = 'detected'
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Evento de segurança não encontrado'; END IF;
  SELECT * INTO v_prescription
  FROM public.electronic_prescriptions
  WHERE id = v_event.prescription_id AND company_id = v_company
  FOR UPDATE;
  IF NOT public.m20_can_prescribe(v_prescription.prescriber_id) THEN
    RAISE EXCEPTION 'Usuário sem permissão para resolver alerta';
  END IF;
  IF v_prescription.status NOT IN ('draft','validated') THEN
    RAISE EXCEPTION 'Prescrição não permite resolução de alerta';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.prescription_safety_events
    WHERE related_event_id = p_event_id
      AND event_type IN ('overridden','resolved')
  ) THEN RAISE EXCEPTION 'Evento já resolvido'; END IF;

  PERFORM set_config('m20.internal_write', 'on', TRUE);
  INSERT INTO public.prescription_safety_events(
    company_id, prescription_id, prescription_item_id, validation_run_id,
    related_event_id, event_type, rule_code, rule_version, severity,
    title, details, reason, actor_id
  )
  VALUES (
    v_company, v_event.prescription_id, v_event.prescription_item_id,
    v_event.validation_run_id, v_event.id, v_action, v_event.rule_code,
    v_event.rule_version, v_event.severity, 'Tratamento de alerta clínico',
    v_event.details, BTRIM(p_reason), auth.uid()
  );

  IF NOT EXISTS (
    SELECT 1
    FROM public.prescription_safety_events detected
    WHERE detected.prescription_id = v_prescription.id
      AND detected.validation_run_id = v_prescription.last_validation_run_id
      AND detected.event_type = 'detected'
      AND detected.severity = 'critical'
      AND NOT EXISTS (
        SELECT 1 FROM public.prescription_safety_events resolution
        WHERE resolution.related_event_id = detected.id
          AND resolution.event_type IN ('overridden','resolved')
      )
  ) THEN
    UPDATE public.electronic_prescriptions
       SET status = 'validated', validated_at = NOW(), updated_by = auth.uid()
     WHERE id = v_prescription.id;
  END IF;

  PERFORM private.m20_append_version(v_prescription.id, 'safety_' || v_action, BTRIM(p_reason));
  SELECT * INTO v_prescription FROM public.electronic_prescriptions WHERE id = v_prescription.id;
  RETURN v_prescription;
END;
$fn$;

CREATE OR REPLACE FUNCTION private.m20_record_review_impl(
  p_prescription_id UUID,
  p_review_status TEXT,
  p_notes TEXT DEFAULT NULL,
  p_reviewer_professional_id BIGINT DEFAULT NULL
)
RETURNS public.pharmaceutical_reviews
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_company UUID := public.m20_company_id();
  v_status TEXT := lower(BTRIM(COALESCE(p_review_status, '')));
  v_prescription public.electronic_prescriptions;
  v_row public.pharmaceutical_reviews;
BEGIN
  IF auth.uid() IS NULL OR NOT public.m20_can_review_prescriptions() THEN
    RAISE EXCEPTION 'Usuário sem permissão para revisão farmacêutica';
  END IF;
  IF v_status NOT IN ('approved','changes_requested','rejected') THEN
    RAISE EXCEPTION 'Resultado de revisão inválido';
  END IF;
  IF v_status <> 'approved' AND NULLIF(BTRIM(p_notes), '') IS NULL THEN
    RAISE EXCEPTION 'Parecer é obrigatório';
  END IF;
  SELECT * INTO v_prescription
  FROM public.electronic_prescriptions
  WHERE id = p_prescription_id AND company_id = v_company
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Prescrição não encontrada'; END IF;
  IF p_reviewer_professional_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.professionals
    WHERE id = p_reviewer_professional_id
      AND company_id = v_company
      AND user_id = auth.uid()
      AND lg_ativo = TRUE
  ) THEN RAISE EXCEPTION 'Profissional revisor inválido'; END IF;

  PERFORM set_config('m20.internal_write', 'on', TRUE);
  INSERT INTO public.pharmaceutical_reviews(
    company_id, prescription_id, review_status, notes, reviewer_id,
    reviewer_professional_id
  )
  VALUES (
    v_company, p_prescription_id, v_status, NULLIF(BTRIM(p_notes), ''),
    auth.uid(), p_reviewer_professional_id
  )
  RETURNING * INTO v_row;
  PERFORM private.m20_append_version(p_prescription_id, 'pharmaceutical_' || v_status, p_notes);
  RETURN v_row;
END;
$fn$;

CREATE OR REPLACE FUNCTION private.m20_transition_prescription_impl(
  p_prescription_id UUID,
  p_target_status TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS public.electronic_prescriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_company UUID := public.m20_company_id();
  v_target TEXT := lower(BTRIM(COALESCE(p_target_status, '')));
  v_row public.electronic_prescriptions;
  v_items JSONB;
  v_signed_at TIMESTAMPTZ;
  v_signature TEXT;
BEGIN
  SELECT * INTO v_row
  FROM public.electronic_prescriptions
  WHERE id = p_prescription_id AND company_id = v_company
  FOR UPDATE;
  IF NOT FOUND OR NOT public.m20_can_prescribe(v_row.prescriber_id) THEN
    RAISE EXCEPTION 'Prescrição não encontrada ou não autorizada';
  END IF;
  IF v_target NOT IN ('signed','active','suspended','cancelled','completed','expired') THEN
    RAISE EXCEPTION 'Transição de estado inválida';
  END IF;
  IF v_target IN ('suspended','cancelled') AND NULLIF(BTRIM(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Motivo é obrigatório para suspensão ou cancelamento';
  END IF;

  PERFORM set_config('m20.internal_write', 'on', TRUE);

  IF v_target = 'signed' THEN
    IF v_row.status <> 'validated' THEN RAISE EXCEPTION 'Prescrição deve estar validada para assinatura'; END IF;
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Assinatura exige identidade autenticada'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.electronic_prescription_items
      WHERE prescription_id = p_prescription_id
    ) THEN RAISE EXCEPTION 'Prescrição sem itens'; END IF;
    IF EXISTS (
      SELECT 1
      FROM public.prescription_safety_events detected
      WHERE detected.prescription_id = p_prescription_id
        AND detected.validation_run_id = v_row.last_validation_run_id
        AND detected.event_type = 'detected'
        AND detected.severity = 'critical'
        AND NOT EXISTS (
          SELECT 1 FROM public.prescription_safety_events resolution
          WHERE resolution.related_event_id = detected.id
            AND resolution.event_type IN ('overridden','resolved')
        )
    ) THEN RAISE EXCEPTION 'Há evento crítico de segurança pendente'; END IF;

    SELECT COALESCE(JSONB_AGG(to_jsonb(i) ORDER BY i.sort_order, i.id), '[]'::JSONB)
      INTO v_items
    FROM public.electronic_prescription_items i
    WHERE i.prescription_id = p_prescription_id;
    v_signed_at := clock_timestamp();
    v_signature := encode(
      digest(
        (
          JSONB_BUILD_OBJECT(
            'prescription_id', v_row.id,
            'company_id', v_row.company_id,
            'unit_id', v_row.unit_id,
            'encounter_id', v_row.encounter_id,
            'patient_id', v_row.patient_id,
            'prescriber_id', v_row.prescriber_id,
            'items', v_items
          )::TEXT
          || '|' || auth.uid()::TEXT
          || '|' || v_signed_at::TEXT
          || '|' || txid_current()::TEXT
        ),
        'sha256'
      ),
      'hex'
    );
    UPDATE public.electronic_prescriptions
       SET status = 'signed', signed_at = v_signed_at, signed_by = auth.uid(),
           signature_hash = v_signature, updated_by = auth.uid()
     WHERE id = p_prescription_id
     RETURNING * INTO v_row;
  ELSIF v_target = 'active' THEN
    IF v_row.status NOT IN ('signed','suspended') THEN RAISE EXCEPTION 'Somente prescrição assinada ou suspensa pode ser ativada'; END IF;
    UPDATE public.electronic_prescriptions
       SET status = 'active', activated_at = COALESCE(activated_at, NOW()),
           suspended_at = NULL, terminal_reason = NULL, updated_by = auth.uid()
     WHERE id = p_prescription_id RETURNING * INTO v_row;
  ELSIF v_target = 'suspended' THEN
    IF v_row.status <> 'active' THEN RAISE EXCEPTION 'Somente prescrição ativa pode ser suspensa'; END IF;
    UPDATE public.electronic_prescriptions
       SET status = 'suspended', suspended_at = NOW(),
           terminal_reason = BTRIM(p_reason), updated_by = auth.uid()
     WHERE id = p_prescription_id RETURNING * INTO v_row;
  ELSIF v_target = 'cancelled' THEN
    IF v_row.status IN ('cancelled','completed','expired') THEN RAISE EXCEPTION 'Prescrição já está em estado terminal'; END IF;
    UPDATE public.electronic_prescriptions
       SET status = 'cancelled', cancelled_at = NOW(),
           terminal_reason = BTRIM(p_reason), updated_by = auth.uid()
     WHERE id = p_prescription_id RETURNING * INTO v_row;
  ELSIF v_target = 'completed' THEN
    IF v_row.status NOT IN ('active','suspended') THEN RAISE EXCEPTION 'Somente prescrição ativa ou suspensa pode ser concluída'; END IF;
    UPDATE public.electronic_prescriptions
       SET status = 'completed', completed_at = NOW(),
           terminal_reason = NULLIF(BTRIM(p_reason), ''), updated_by = auth.uid()
     WHERE id = p_prescription_id RETURNING * INTO v_row;
  ELSIF v_target = 'expired' THEN
    IF v_row.status NOT IN ('signed','active','suspended') THEN RAISE EXCEPTION 'Estado incompatível com expiração'; END IF;
    UPDATE public.electronic_prescriptions
       SET status = 'expired', expired_at = NOW(),
           terminal_reason = NULLIF(BTRIM(p_reason), ''), updated_by = auth.uid()
     WHERE id = p_prescription_id RETURNING * INTO v_row;
  END IF;

  PERFORM private.m20_append_version(p_prescription_id, v_target, p_reason);
  SELECT * INTO v_row FROM public.electronic_prescriptions WHERE id = p_prescription_id;
  RETURN v_row;
END;
$fn$;

-- Public RPCs execute as the dedicated technical owner. They do not accept
-- company, actor, signed_at or signature_hash from the client, and private
-- helpers repeat authorization checks from authenticated claims.
CREATE OR REPLACE FUNCTION public.m20_create_prescription_secure(
  p_unit_id INTEGER,
  p_encounter_id UUID,
  p_patient_id BIGINT,
  p_prescriber_id BIGINT,
  p_medical_record_id BIGINT DEFAULT NULL,
  p_clinical_indication TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS public.electronic_prescriptions
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT private.m20_create_prescription_impl(
    p_unit_id, p_encounter_id, p_patient_id, p_prescriber_id,
    p_medical_record_id, p_clinical_indication, p_notes
  );
$fn$;

CREATE OR REPLACE FUNCTION public.m20_upsert_prescription_item_secure(
  p_prescription_id UUID,
  p_item JSONB,
  p_item_id UUID DEFAULT NULL
)
RETURNS public.electronic_prescription_items
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT private.m20_upsert_item_impl(p_prescription_id, p_item, p_item_id);
$fn$;

CREATE OR REPLACE FUNCTION public.m20_remove_prescription_item_secure(
  p_prescription_id UUID,
  p_item_id UUID
)
RETURNS public.electronic_prescriptions
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT private.m20_remove_item_impl(p_prescription_id, p_item_id);
$fn$;

CREATE OR REPLACE FUNCTION public.m20_validate_prescription_secure(p_prescription_id UUID)
RETURNS public.electronic_prescriptions
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT private.m20_validate_prescription_impl(p_prescription_id);
$fn$;

CREATE OR REPLACE FUNCTION public.m20_resolve_safety_event_secure(
  p_event_id UUID,
  p_action TEXT,
  p_reason TEXT
)
RETURNS public.electronic_prescriptions
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT private.m20_resolve_safety_event_impl(p_event_id, p_action, p_reason);
$fn$;

CREATE OR REPLACE FUNCTION public.m20_record_pharmaceutical_review_secure(
  p_prescription_id UUID,
  p_review_status TEXT,
  p_notes TEXT DEFAULT NULL,
  p_reviewer_professional_id BIGINT DEFAULT NULL
)
RETURNS public.pharmaceutical_reviews
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT private.m20_record_review_impl(
    p_prescription_id, p_review_status, p_notes, p_reviewer_professional_id
  );
$fn$;

CREATE OR REPLACE FUNCTION public.m20_transition_prescription_secure(
  p_prescription_id UUID,
  p_target_status TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS public.electronic_prescriptions
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT private.m20_transition_prescription_impl(p_prescription_id, p_target_status, p_reason);
$fn$;

ALTER TABLE public.electronic_prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.electronic_prescriptions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.electronic_prescription_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.electronic_prescription_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.prescription_safety_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prescription_safety_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pharmaceutical_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmaceutical_reviews FORCE ROW LEVEL SECURITY;
ALTER TABLE public.electronic_prescription_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.electronic_prescription_versions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS m20_prescriptions_select ON public.electronic_prescriptions;
CREATE POLICY m20_prescriptions_select
  ON public.electronic_prescriptions FOR SELECT
  TO authenticated, app_prontomedic
  USING (
    company_id = public.m20_company_id()
    AND public.m20_can_read_prescriptions()
    AND public.m18_unit_accessible(company_id, unit_id)
  );

DROP POLICY IF EXISTS m20_items_select ON public.electronic_prescription_items;
CREATE POLICY m20_items_select
  ON public.electronic_prescription_items FOR SELECT
  TO authenticated, app_prontomedic
  USING (
    company_id = public.m20_company_id()
    AND EXISTS (
      SELECT 1 FROM public.electronic_prescriptions p
      WHERE p.id = public.electronic_prescription_items.prescription_id
        AND p.company_id = public.electronic_prescription_items.company_id
        AND public.m18_unit_accessible(p.company_id, p.unit_id)
    )
    AND public.m20_can_read_prescriptions()
  );

DROP POLICY IF EXISTS m20_safety_select ON public.prescription_safety_events;
CREATE POLICY m20_safety_select
  ON public.prescription_safety_events FOR SELECT
  TO authenticated, app_prontomedic
  USING (
    company_id = public.m20_company_id()
    AND EXISTS (
      SELECT 1 FROM public.electronic_prescriptions p
      WHERE p.id = public.prescription_safety_events.prescription_id
        AND p.company_id = public.prescription_safety_events.company_id
        AND public.m18_unit_accessible(p.company_id, p.unit_id)
    )
    AND public.m20_can_read_prescriptions()
  );

DROP POLICY IF EXISTS m20_reviews_select ON public.pharmaceutical_reviews;
CREATE POLICY m20_reviews_select
  ON public.pharmaceutical_reviews FOR SELECT
  TO authenticated, app_prontomedic
  USING (
    company_id = public.m20_company_id()
    AND EXISTS (
      SELECT 1 FROM public.electronic_prescriptions p
      WHERE p.id = public.pharmaceutical_reviews.prescription_id
        AND p.company_id = public.pharmaceutical_reviews.company_id
        AND public.m18_unit_accessible(p.company_id, p.unit_id)
    )
    AND public.m20_can_read_prescriptions()
  );

DROP POLICY IF EXISTS m20_versions_select ON public.electronic_prescription_versions;
CREATE POLICY m20_versions_select
  ON public.electronic_prescription_versions FOR SELECT
  TO authenticated, app_prontomedic
  USING (
    company_id = public.m20_company_id()
    AND EXISTS (
      SELECT 1 FROM public.electronic_prescriptions p
      WHERE p.id = public.electronic_prescription_versions.prescription_id
        AND p.company_id = public.electronic_prescription_versions.company_id
        AND public.m18_unit_accessible(p.company_id, p.unit_id)
    )
    AND public.m20_can_read_prescriptions()
  );

REVOKE ALL ON TABLE
  public.electronic_prescriptions,
  public.electronic_prescription_items,
  public.prescription_safety_events,
  public.pharmaceutical_reviews,
  public.electronic_prescription_versions
FROM PUBLIC, anon, authenticated, app_prontomedic;

GRANT SELECT ON TABLE
  public.electronic_prescriptions,
  public.electronic_prescription_items,
  public.prescription_safety_events,
  public.pharmaceutical_reviews,
  public.electronic_prescription_versions
TO authenticated, app_prontomedic;

GRANT USAGE ON SCHEMA private TO authenticated, app_prontomedic;

REVOKE ALL ON FUNCTION public.m20_company_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.m20_can_read_prescriptions() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.m20_can_prescribe(BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.m20_can_review_prescriptions() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.m20_create_prescription_secure(INTEGER, UUID, BIGINT, BIGINT, BIGINT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.m20_upsert_prescription_item_secure(UUID, JSONB, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.m20_remove_prescription_item_secure(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.m20_validate_prescription_secure(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.m20_resolve_safety_event_secure(UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.m20_record_pharmaceutical_review_secure(UUID, TEXT, TEXT, BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.m20_transition_prescription_secure(UUID, TEXT, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.m20_company_id() TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m20_can_read_prescriptions() TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m20_can_prescribe(BIGINT) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m20_can_review_prescriptions() TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m20_create_prescription_secure(INTEGER, UUID, BIGINT, BIGINT, BIGINT, TEXT, TEXT) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m20_upsert_prescription_item_secure(UUID, JSONB, UUID) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m20_remove_prescription_item_secure(UUID, UUID) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m20_validate_prescription_secure(UUID) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m20_resolve_safety_event_secure(UUID, TEXT, TEXT) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m20_record_pharmaceutical_review_secure(UUID, TEXT, TEXT, BIGINT) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m20_transition_prescription_secure(UUID, TEXT, TEXT) TO authenticated, app_prontomedic;

REVOKE ALL ON FUNCTION private.m20_append_version(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION private.m20_guard_internal_write() FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION private.m20_guard_item_write() FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION private.m20_reject_append_only_mutation() FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION private.m20_create_prescription_impl(INTEGER, UUID, BIGINT, BIGINT, BIGINT, TEXT, TEXT) FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION private.m20_upsert_item_impl(UUID, JSONB, UUID) FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION private.m20_remove_item_impl(UUID, UUID) FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION private.m20_validate_prescription_impl(UUID) FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION private.m20_resolve_safety_event_impl(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION private.m20_record_review_impl(UUID, TEXT, TEXT, BIGINT) FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION private.m20_transition_prescription_impl(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated, app_prontomedic;

GRANT EXECUTE ON FUNCTION private.m20_append_version(UUID, TEXT, TEXT) TO prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION private.m20_create_prescription_impl(INTEGER, UUID, BIGINT, BIGINT, BIGINT, TEXT, TEXT) TO prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION private.m20_upsert_item_impl(UUID, JSONB, UUID) TO prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION private.m20_remove_item_impl(UUID, UUID) TO prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION private.m20_validate_prescription_impl(UUID) TO prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION private.m20_resolve_safety_event_impl(UUID, TEXT, TEXT) TO prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION private.m20_record_review_impl(UUID, TEXT, TEXT, BIGINT) TO prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION private.m20_transition_prescription_impl(UUID, TEXT, TEXT) TO prontomedic_rpc_owner;

GRANT USAGE ON SCHEMA public, private, auth TO prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION public.m20_company_id()
  TO prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION public.m17_company_id()
  TO prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION public.m18_unit_accessible(UUID, INTEGER)
  TO prontomedic_rpc_owner;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.electronic_prescriptions,
  public.electronic_prescription_items,
  public.prescription_safety_events,
  public.pharmaceutical_reviews,
  public.electronic_prescription_versions
TO prontomedic_rpc_owner;
GRANT SELECT ON TABLE
  public.companies,
  public.units,
  public.user_profiles,
  public.professionals,
  public.patients,
  public.patient_allergies,
  public.encounters,
  public.medical_records,
  public.user_roles,
  public.permissions,
  public.user_permissions,
  public.roles,
  public.role_permissions
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
      AND p.proname LIKE 'm20_%'
      AND p.prosecdef
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO prontomedic_rpc_owner', v_function);
  END LOOP;
END
$ownership$;

COMMENT ON TABLE public.electronic_prescriptions IS
  'M20: cabecalho canonico de prescricao; encounter_id e medical_record_id apenas referenciam M18/M17.';
COMMENT ON COLUMN public.electronic_prescriptions.signature_hash IS
  'Atestacao SHA-256 gerada exclusivamente no servidor sobre snapshot, ator, horario e transacao. Nao substitui certificado ICP-Brasil.';
COMMENT ON TABLE public.electronic_prescription_versions IS
  'Historico append-only com snapshot do cabecalho e itens em cada mutacao atomica.';

DO $ledger$
BEGIN
  IF to_regclass('public.prontomedic_deployment_migrations') IS NOT NULL THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE
      ON public.prontomedic_deployment_migrations
      FROM authenticated, app_prontomedic;
    INSERT INTO public.prontomedic_deployment_migrations(filename, applied_at)
    VALUES ('20260724014213_module20_electronic_prescriptions.sql', NOW())
    ON CONFLICT (filename) DO NOTHING;
  END IF;
END
$ledger$;

COMMIT;
