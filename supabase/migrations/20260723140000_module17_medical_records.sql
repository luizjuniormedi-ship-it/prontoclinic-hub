-- Módulo 17: prontuário longitudinal, assinatura, retificação e acesso emergencial.
-- Migration aditiva/idempotente. Não toca DataSIGH.

BEGIN;

-- Some operational baselines do not carry the legacy stub table. Create only
-- the canonical base required by this module; existing tables/data are kept.
CREATE TABLE IF NOT EXISTS public.medical_records (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  patient_id BIGINT REFERENCES public.patients(id) ON DELETE CASCADE,
  professional_id BIGINT REFERENCES public.professionals(id),
  appointment_id BIGINT REFERENCES public.appointments(id),
  chief_complaint TEXT,
  history_present_illness TEXT,
  physical_examination TEXT,
  diagnosis TEXT,
  treatment_plan TEXT,
  prescriptions TEXT,
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE IF EXISTS public.medical_records
  ADD COLUMN IF NOT EXISTS chief_complaint TEXT,
  ADD COLUMN IF NOT EXISTS history_present_illness TEXT,
  ADD COLUMN IF NOT EXISTS physical_examination TEXT,
  ADD COLUMN IF NOT EXISTS diagnosis TEXT,
  ADD COLUMN IF NOT EXISTS treatment_plan TEXT,
  ADD COLUMN IF NOT EXISTS prescriptions TEXT,
  ADD COLUMN IF NOT EXISTS unit_id INTEGER REFERENCES public.units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS record_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS record_type TEXT NOT NULL DEFAULT 'PROGRESS_NOTE',
  ADD COLUMN IF NOT EXISTS anamnesis JSONB,
  ADD COLUMN IF NOT EXISTS evolution TEXT,
  ADD COLUMN IF NOT EXISTS vital_signs JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS soap_subjective TEXT,
  ADD COLUMN IF NOT EXISTS soap_objective TEXT,
  ADD COLUMN IF NOT EXISTS soap_assessment TEXT,
  ADD COLUMN IF NOT EXISTS soap_plan TEXT,
  ADD COLUMN IF NOT EXISTS diagnoses JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS prescriptions_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS exams JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS documents JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS signed_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS root_record_id BIGINT,
  ADD COLUMN IF NOT EXISTS supersedes_id BIGINT,
  ADD COLUMN IF NOT EXISTS retification_reason TEXT,
  ADD COLUMN IF NOT EXISTS emergency_access BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
DECLARE
  assignments TEXT[] := ARRAY[]::TEXT[];
  has_created_at BOOLEAN;
  has_history BOOLEAN;
  has_treatment BOOLEAN;
  has_complaint BOOLEAN;
  anamnesis_is_jsonb BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='medical_records' AND column_name='created_at') INTO has_created_at;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='medical_records' AND column_name='history_present_illness') INTO has_history;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='medical_records' AND column_name='treatment_plan') INTO has_treatment;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='medical_records' AND column_name='chief_complaint') INTO has_complaint;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='medical_records' AND column_name='anamnesis' AND data_type='jsonb') INTO anamnesis_is_jsonb;
  assignments := array_append(assignments, CASE WHEN has_created_at THEN 'record_date = COALESCE(record_date, created_at, NOW())' ELSE 'record_date = COALESCE(record_date, NOW())' END);
  IF has_history THEN assignments := array_append(assignments, CASE WHEN anamnesis_is_jsonb THEN 'anamnesis = COALESCE(anamnesis, to_jsonb(history_present_illness))' ELSE 'anamnesis = COALESCE(anamnesis, history_present_illness)' END); END IF;
  IF has_treatment THEN assignments := array_append(assignments, 'evolution = COALESCE(evolution, treatment_plan)'); END IF;
  IF has_complaint THEN assignments := array_append(assignments, 'notes = COALESCE(notes, chief_complaint)'); END IF;
  EXECUTE 'UPDATE public.medical_records SET ' || array_to_string(assignments, ', ');
  -- Existing records predate M17 and are not silently treated as editable drafts.
  UPDATE public.medical_records
     SET status = 'LEGACY'
   WHERE status = 'DRAFT'
     AND record_type IN ('consulta', 'evolucao', 'laudo');
END $$;

ALTER TABLE IF EXISTS public.medical_records
  DROP CONSTRAINT IF EXISTS medical_records_status_check,
  DROP CONSTRAINT IF EXISTS medical_records_record_type_check;

ALTER TABLE IF EXISTS public.medical_records
  ADD CONSTRAINT medical_records_status_check
    CHECK (status IN ('DRAFT', 'SIGNED', 'RETIRED', 'LEGACY')),
  ADD CONSTRAINT medical_records_record_type_check
    CHECK (record_type IN ('PROGRESS_NOTE', 'SOAP', 'ANAMNESIS', 'PHYSICAL_EXAM', 'DISCHARGE_SUMMARY', 'ADDENDUM', 'consulta', 'evolucao', 'laudo'));

CREATE INDEX IF NOT EXISTS idx_medical_records_patient_timeline
  ON public.medical_records(company_id, patient_id, record_date DESC);
CREATE INDEX IF NOT EXISTS idx_medical_records_unit_timeline
  ON public.medical_records(company_id, unit_id, record_date DESC);
CREATE INDEX IF NOT EXISTS idx_medical_records_root_version
  ON public.medical_records(company_id, root_record_id, version);

ALTER TABLE IF EXISTS public.medical_records
  DROP CONSTRAINT IF EXISTS medical_records_root_record_fk,
  DROP CONSTRAINT IF EXISTS medical_records_supersedes_fk;

ALTER TABLE IF EXISTS public.medical_records
  ADD CONSTRAINT medical_records_root_record_fk
    FOREIGN KEY (root_record_id) REFERENCES public.medical_records(id) ON DELETE RESTRICT,
  ADD CONSTRAINT medical_records_supersedes_fk
    FOREIGN KEY (supersedes_id) REFERENCES public.medical_records(id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS public.patient_clinical_problems (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  unit_id INTEGER REFERENCES public.units(id) ON DELETE SET NULL,
  patient_id BIGINT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  icd10_code TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RESOLVED', 'INACTIVE')),
  onset_date DATE,
  resolved_date DATE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.patient_allergies (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  unit_id INTEGER REFERENCES public.units(id) ON DELETE SET NULL,
  patient_id BIGINT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  allergen TEXT NOT NULL,
  reaction TEXT,
  severity TEXT CHECK (severity IN ('LOW', 'MODERATE', 'HIGH', 'UNKNOWN')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RESOLVED', 'INACTIVE')),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.medical_record_revisions (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  medical_record_id BIGINT NOT NULL REFERENCES public.medical_records(id) ON DELETE RESTRICT,
  revision_type TEXT NOT NULL CHECK (revision_type IN ('SIGNATURE', 'RETIFICATION', 'ADDENDUM')),
  reason TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.medical_record_access_events (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  unit_id INTEGER REFERENCES public.units(id) ON DELETE SET NULL,
  patient_id BIGINT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  medical_record_id BIGINT REFERENCES public.medical_records(id) ON DELETE SET NULL,
  access_type TEXT NOT NULL CHECK (access_type IN ('NORMAL', 'EMERGENCY')),
  reason TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (access_type <> 'EMERGENCY' OR NULLIF(BTRIM(reason), '') IS NOT NULL)
);

-- A legacy installation may already have patient_allergies with a narrower
-- shape. Extend it in place and recover tenant ownership from patients; do not
-- replace or delete any allergy rows.
ALTER TABLE IF EXISTS public.patient_allergies
  ADD COLUMN IF NOT EXISTS company_id UUID,
  ADD COLUMN IF NOT EXISTS unit_id INTEGER,
  ADD COLUMN IF NOT EXISTS created_by UUID,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
UPDATE public.patient_allergies a
   SET company_id = p.company_id,
       updated_at = COALESCE(a.updated_at, a.created_at, NOW())
  FROM public.patients p
 WHERE a.patient_id = p.id
   AND a.company_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_patient_clinical_problems_tenant_patient
  ON public.patient_clinical_problems(company_id, patient_id, status);
CREATE INDEX IF NOT EXISTS idx_patient_allergies_tenant_patient
  ON public.patient_allergies(company_id, patient_id, status);
CREATE INDEX IF NOT EXISTS idx_medical_record_revisions_record
  ON public.medical_record_revisions(company_id, medical_record_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_medical_record_access_events_patient
  ON public.medical_record_access_events(company_id, patient_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.m17_company_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.company_id', true), '')::UUID, public.current_company_id());
$fn$;

CREATE OR REPLACE FUNCTION public.m17_can_edit_records()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
  SELECT current_user = 'app_prontomedic' OR EXISTS (
    SELECT 1 FROM public.user_profiles
     WHERE (id = auth.uid() OR user_id = auth.uid())
       AND lower(COALESCE(role_name, '')) IN ('admin', 'administrador', 'medico', 'médico', 'doctor', 'enfermeiro', 'enfermagem')
       AND lg_ativo = TRUE
  );
$fn$;

CREATE OR REPLACE FUNCTION public.m17_guard_signed_medical_record()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status IN ('SIGNED', 'RETIRED') THEN
    RAISE EXCEPTION 'Prontuário assinado não pode ser excluído';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('SIGNED', 'RETIRED')
     AND current_setting('m17.allow_retire', true) IS DISTINCT FROM 'on'
     AND (to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
    RAISE EXCEPTION 'Prontuário assinado não pode ser alterado diretamente; use retificação ou adendo';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$fn$;

DROP TRIGGER IF EXISTS trg_m17_guard_signed_medical_record ON public.medical_records;
CREATE TRIGGER trg_m17_guard_signed_medical_record
  BEFORE UPDATE OR DELETE ON public.medical_records
  FOR EACH ROW EXECUTE FUNCTION public.m17_guard_signed_medical_record();

CREATE OR REPLACE FUNCTION public.m17_create_medical_record_secure(
  p_patient_id BIGINT,
  p_unit_id INTEGER DEFAULT NULL,
  p_professional_id BIGINT DEFAULT NULL,
  p_appointment_id BIGINT DEFAULT NULL,
  p_record_type TEXT DEFAULT 'PROGRESS_NOTE',
  p_anamnesis TEXT DEFAULT NULL,
  p_evolution TEXT DEFAULT NULL,
  p_vital_signs JSONB DEFAULT '{}'::JSONB,
  p_soap JSONB DEFAULT '{}'::JSONB,
  p_diagnoses JSONB DEFAULT '[]'::JSONB,
  p_plan TEXT DEFAULT NULL,
  p_prescriptions JSONB DEFAULT '[]'::JSONB,
  p_exams JSONB DEFAULT '[]'::JSONB,
  p_documents JSONB DEFAULT '[]'::JSONB
)
RETURNS public.medical_records LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE v_row public.medical_records; v_company UUID := public.m17_company_id();
BEGIN
  IF v_company IS NULL OR NOT public.m17_can_edit_records() THEN RAISE EXCEPTION 'Usuário sem permissão para criar prontuário'; END IF;
  IF p_record_type NOT IN ('PROGRESS_NOTE','SOAP','ANAMNESIS','PHYSICAL_EXAM','DISCHARGE_SUMMARY','ADDENDUM') THEN RAISE EXCEPTION 'Tipo de registro inválido'; END IF;
  IF jsonb_typeof(p_diagnoses) <> 'array' OR jsonb_typeof(p_prescriptions) <> 'array' OR jsonb_typeof(p_exams) <> 'array' OR jsonb_typeof(p_documents) <> 'array' THEN RAISE EXCEPTION 'Coleções clínicas devem ser arrays JSON'; END IF;
  INSERT INTO public.medical_records(company_id, unit_id, patient_id, professional_id, appointment_id, record_date, record_type, anamnesis, evolution, vital_signs, soap_subjective, soap_objective, soap_assessment, soap_plan, diagnoses, treatment_plan, prescriptions_json, exams, documents, status, root_record_id)
  VALUES (v_company, p_unit_id, p_patient_id, p_professional_id, p_appointment_id, NOW(), p_record_type, to_jsonb(p_anamnesis), p_evolution, p_vital_signs, p_soap->>'subjective', p_soap->>'objective', p_soap->>'assessment', COALESCE(p_plan, p_soap->>'plan'), p_diagnoses, p_plan, p_prescriptions, p_exams, p_documents, 'DRAFT', NULL)
  RETURNING * INTO v_row;
  UPDATE public.medical_records SET root_record_id = id WHERE id = v_row.id RETURNING * INTO v_row;
  RETURN v_row;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.m17_sign_medical_record_secure(p_record_id BIGINT)
RETURNS public.medical_records LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE v_row public.medical_records; v_company UUID := public.m17_company_id();
BEGIN
  IF v_company IS NULL OR NOT public.m17_can_edit_records() THEN RAISE EXCEPTION 'Usuário sem permissão para assinar prontuário'; END IF;
  UPDATE public.medical_records SET status='SIGNED', signed_at=NOW(), signed_by=auth.uid(), updated_at=NOW()
   WHERE id=p_record_id AND company_id=v_company AND status='DRAFT' RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registro não encontrado ou já assinado'; END IF;
  PERFORM private.m17_append_revision(v_company, v_row.id, 'SIGNATURE', 'Assinatura clínica', to_jsonb(v_row), auth.uid());
  RETURN v_row;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.m17_rectify_medical_record_secure(p_record_id BIGINT, p_reason TEXT, p_patch JSONB DEFAULT '{}'::JSONB)
RETURNS public.medical_records LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE v_old public.medical_records; v_new public.medical_records; v_company UUID := public.m17_company_id();
BEGIN
  IF v_company IS NULL OR NOT public.m17_can_edit_records() THEN RAISE EXCEPTION 'Usuário sem permissão para retificar prontuário'; END IF;
  IF NULLIF(BTRIM(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Motivo da retificação é obrigatório'; END IF;
  SELECT * INTO v_old FROM public.medical_records WHERE id=p_record_id AND company_id=v_company AND status IN ('SIGNED','RETIRED') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Somente registro assinado pode ser retificado'; END IF;
  INSERT INTO public.medical_records(company_id, unit_id, patient_id, professional_id, appointment_id, record_date, record_type, anamnesis, evolution, vital_signs, notes, soap_subjective, soap_objective, soap_assessment, soap_plan, diagnoses, treatment_plan, prescriptions_json, exams, documents, status, version, root_record_id, supersedes_id, retification_reason, created_at)
  VALUES (v_old.company_id, v_old.unit_id, v_old.patient_id, v_old.professional_id, v_old.appointment_id, NOW(), 'ADDENDUM', COALESCE(to_jsonb(p_patch->>'anamnesis'), v_old.anamnesis), COALESCE(p_patch->>'evolution', v_old.evolution), COALESCE(p_patch->'vital_signs', v_old.vital_signs), COALESCE(p_patch->>'notes', v_old.notes), COALESCE(p_patch->>'soap_subjective', v_old.soap_subjective), COALESCE(p_patch->>'soap_objective', v_old.soap_objective), COALESCE(p_patch->>'soap_assessment', v_old.soap_assessment), COALESCE(p_patch->>'soap_plan', v_old.soap_plan), COALESCE(p_patch->'diagnoses', v_old.diagnoses), v_old.treatment_plan, COALESCE(p_patch->'prescriptions_json', v_old.prescriptions_json), COALESCE(p_patch->'exams', v_old.exams), COALESCE(p_patch->'documents', v_old.documents), 'DRAFT', v_old.version + 1, COALESCE(v_old.root_record_id, v_old.id), v_old.id, BTRIM(p_reason), NOW())
  RETURNING * INTO v_new;
  PERFORM set_config('m17.allow_retire', 'on', true);
  UPDATE public.medical_records SET status='RETIRED', updated_at=NOW() WHERE id=v_old.id;
  PERFORM private.m17_append_revision(v_company, v_new.id, 'RETIFICATION', BTRIM(p_reason), to_jsonb(v_old), auth.uid());
  RETURN v_new;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.m17_register_emergency_access_secure(p_patient_id BIGINT, p_reason TEXT, p_unit_id INTEGER DEFAULT NULL, p_record_id BIGINT DEFAULT NULL)
RETURNS public.medical_record_access_events LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE v_row public.medical_record_access_events; v_company UUID := public.m17_company_id();
BEGIN
  IF v_company IS NULL OR NULLIF(BTRIM(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Motivo e empresa do acesso emergencial são obrigatórios'; END IF;
  SELECT * INTO v_row FROM private.m17_append_emergency_access(v_company, p_unit_id, p_patient_id, p_record_id, BTRIM(p_reason), auth.uid());
  RETURN v_row;
END;
$fn$;

-- RLS evaluates policies under the request role. Keep the privileged lookup
-- private and narrowly scoped; public clinical RPCs remain SECURITY INVOKER.
CREATE SCHEMA IF NOT EXISTS private;
CREATE OR REPLACE FUNCTION private.m17_append_revision(
  p_company_id UUID,
  p_medical_record_id BIGINT,
  p_revision_type TEXT,
  p_reason TEXT,
  p_snapshot JSONB,
  p_created_by UUID
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF p_company_id IS NULL OR p_company_id IS DISTINCT FROM public.m17_company_id()
     OR p_created_by IS DISTINCT FROM auth.uid()
     OR NOT public.m17_can_edit_records()
     OR NULLIF(BTRIM(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Revisão clínica não autorizada';
  END IF;
  INSERT INTO public.medical_record_revisions(company_id, medical_record_id, revision_type, reason, snapshot, created_by)
  VALUES (p_company_id, p_medical_record_id, p_revision_type, BTRIM(p_reason), p_snapshot, p_created_by);
END;
$fn$;
REVOKE ALL ON FUNCTION private.m17_append_revision(UUID, BIGINT, TEXT, TEXT, JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.m17_append_revision(UUID, BIGINT, TEXT, TEXT, JSONB, UUID) TO authenticated, app_prontomedic;

CREATE OR REPLACE FUNCTION private.m17_append_emergency_access(
  p_company_id UUID,
  p_unit_id INTEGER,
  p_patient_id BIGINT,
  p_medical_record_id BIGINT,
  p_reason TEXT,
  p_created_by UUID
)
RETURNS public.medical_record_access_events LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE v_row public.medical_record_access_events;
BEGIN
  IF p_company_id IS NULL OR p_company_id IS DISTINCT FROM public.m17_company_id()
     OR p_created_by IS DISTINCT FROM auth.uid()
     OR NULLIF(BTRIM(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Acesso emergencial não autorizado';
  END IF;
  INSERT INTO public.medical_record_access_events(company_id, unit_id, patient_id, medical_record_id, access_type, reason, created_by)
  VALUES (p_company_id, p_unit_id, p_patient_id, p_medical_record_id, 'EMERGENCY', BTRIM(p_reason), p_created_by)
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$fn$;
REVOKE ALL ON FUNCTION private.m17_append_emergency_access(UUID, INTEGER, BIGINT, BIGINT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.m17_append_emergency_access(UUID, INTEGER, BIGINT, BIGINT, TEXT, UUID) TO authenticated, app_prontomedic;

CREATE OR REPLACE FUNCTION private.m17_can_edit_records_rls()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
     WHERE (id = auth.uid() OR user_id = auth.uid())
       AND lower(COALESCE(role_name, '')) IN ('admin', 'administrador', 'medico', 'médico', 'doctor', 'enfermeiro', 'enfermagem')
       AND lg_ativo = TRUE
  );
$fn$;
REVOKE ALL ON FUNCTION private.m17_can_edit_records_rls() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.m17_can_edit_records_rls() TO authenticated, app_prontomedic;

DO $$
DECLARE r RECORD;
BEGIN
  IF to_regclass('public.medical_records') IS NOT NULL THEN ALTER TABLE public.medical_records ENABLE ROW LEVEL SECURITY; ALTER TABLE public.medical_records FORCE ROW LEVEL SECURITY; END IF;
  FOR r IN SELECT unnest(ARRAY['patient_clinical_problems','patient_allergies','medical_record_revisions','medical_record_access_events']) AS table_name LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', r.table_name);
  END LOOP;
END $$;

DROP POLICY IF EXISTS m17_medical_records_select ON public.medical_records;
CREATE POLICY m17_medical_records_select ON public.medical_records FOR SELECT TO authenticated
USING (
  company_id = public.active_company_id()
  AND unit_id = public.active_unit_id()
  AND (
    public.can_access('medical_records', 'view')
    OR public.can_access('prontuario', 'view')
  )
);
DROP POLICY IF EXISTS m17_medical_records_insert ON public.medical_records;
CREATE POLICY m17_medical_records_insert ON public.medical_records FOR INSERT TO authenticated
WITH CHECK (
  company_id = public.active_company_id()
  AND unit_id = public.active_unit_id()
  AND public.m17_can_edit_records()
  AND (
    public.can_access('medical_records', 'create')
    OR public.can_access('prontuario', 'create')
  )
);
DROP POLICY IF EXISTS m17_medical_records_update ON public.medical_records;
CREATE POLICY m17_medical_records_update ON public.medical_records FOR UPDATE TO authenticated
USING (
  company_id = public.active_company_id()
  AND unit_id = public.active_unit_id()
  AND status = 'DRAFT'
  AND public.m17_can_edit_records()
  AND (
    public.can_access('medical_records', 'edit')
    OR public.can_access('prontuario', 'edit')
  )
)
WITH CHECK (
  company_id = public.active_company_id()
  AND unit_id = public.active_unit_id()
);
DROP POLICY IF EXISTS m17_medical_records_delete ON public.medical_records;
CREATE POLICY m17_medical_records_delete ON public.medical_records FOR DELETE TO authenticated
USING (
  company_id = public.active_company_id()
  AND unit_id = public.active_unit_id()
  AND status = 'DRAFT'
  AND public.m17_can_edit_records()
  AND (
    public.can_access('medical_records', 'delete')
    OR public.can_access('prontuario', 'delete')
  )
);

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT unnest(ARRAY['patient_clinical_problems','patient_allergies']) AS table_name LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'm17_' || r.table_name || '_select', r.table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (
        company_id = public.active_company_id()
        AND unit_id = public.active_unit_id()
        AND (
          public.can_access(''medical_records'', ''view'')
          OR public.can_access(''prontuario'', ''view'')
        )
      )',
      'm17_' || r.table_name || '_select',
      r.table_name
    );
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'm17_' || r.table_name || '_write', r.table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (
        company_id = public.active_company_id()
        AND unit_id = public.active_unit_id()
        AND public.m17_can_edit_records()
      ) WITH CHECK (
        company_id = public.active_company_id()
        AND unit_id = public.active_unit_id()
        AND public.m17_can_edit_records()
      )',
      'm17_' || r.table_name || '_write',
      r.table_name
    );
  END LOOP;
END $$;

DROP POLICY IF EXISTS m17_medical_record_revisions_select ON public.medical_record_revisions;
CREATE POLICY m17_medical_record_revisions_select ON public.medical_record_revisions FOR SELECT TO authenticated
USING (
  company_id = public.active_company_id()
  AND unit_id = public.active_unit_id()
  AND (
    public.can_access('medical_records', 'view')
    OR public.can_access('prontuario', 'view')
  )
);
DROP POLICY IF EXISTS m17_medical_record_revisions_insert ON public.medical_record_revisions;
REVOKE INSERT ON public.medical_record_revisions FROM authenticated;
DROP POLICY IF EXISTS m17_medical_record_access_events_select ON public.medical_record_access_events;
CREATE POLICY m17_medical_record_access_events_select ON public.medical_record_access_events FOR SELECT TO authenticated
USING (
  company_id = public.active_company_id()
  AND unit_id = public.active_unit_id()
  AND (
    public.can_access('medical_records', 'view')
    OR public.can_access('prontuario', 'view')
  )
);
DROP POLICY IF EXISTS m17_medical_record_access_events_insert ON public.medical_record_access_events;
REVOKE INSERT ON public.medical_record_access_events FROM authenticated;

GRANT EXECUTE ON FUNCTION public.m17_company_id() TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m17_can_edit_records() TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m17_create_medical_record_secure(BIGINT,INTEGER,BIGINT,BIGINT,TEXT,TEXT,TEXT,JSONB,JSONB,JSONB,TEXT,JSONB,JSONB,JSONB) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m17_sign_medical_record_secure(BIGINT) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m17_rectify_medical_record_secure(BIGINT,TEXT,JSONB) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m17_register_emergency_access_secure(BIGINT,TEXT,INTEGER,BIGINT) TO authenticated, app_prontomedic;

DO $fn$
BEGIN
  IF to_regclass('public.prontomedic_deployment_migrations') IS NOT NULL THEN
    INSERT INTO public.prontomedic_deployment_migrations(filename, applied_at)
    VALUES ('20260723140000_module17_medical_records.sql', NOW()) ON CONFLICT (filename) DO NOTHING;
  END IF;
END $fn$;

COMMIT;
