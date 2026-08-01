-- Módulo 18: atendimento médico ambulatorial.
-- Migration aditiva/idempotente. Não toca DataSIGH.
BEGIN;

CREATE TABLE IF NOT EXISTS public.encounters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  unit_id INTEGER REFERENCES public.units(id) ON DELETE SET NULL,
  patient_id BIGINT NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  professional_id BIGINT REFERENCES public.professionals(id) ON DELETE SET NULL,
  appointment_id BIGINT REFERENCES public.appointments(id) ON DELETE SET NULL,
  encounter_type TEXT NOT NULL DEFAULT 'AMBULATORIAL',
  status TEXT NOT NULL DEFAULT 'OPEN',
  chief_complaint TEXT,
  anamnesis TEXT,
  physical_exam TEXT,
  vital_signs JSONB NOT NULL DEFAULT '{}'::JSONB,
  diagnoses JSONB NOT NULL DEFAULT '[]'::JSONB,
  conduct TEXT,
  procedures JSONB NOT NULL DEFAULT '[]'::JSONB,
  prescriptions JSONB NOT NULL DEFAULT '[]'::JSONB,
  exams JSONB NOT NULL DEFAULT '[]'::JSONB,
  certificate JSONB,
  referral JSONB,
  return_plan TEXT,
  discharge_summary TEXT,
  admission_plan TEXT,
  created_by UUID REFERENCES auth.users(id),
  signed_by UUID REFERENCES auth.users(id),
  signed_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.encounters
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS unit_id INTEGER REFERENCES public.units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS patient_id BIGINT REFERENCES public.patients(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS professional_id BIGINT REFERENCES public.professionals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS appointment_id BIGINT REFERENCES public.appointments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS encounter_type TEXT NOT NULL DEFAULT 'AMBULATORIAL',
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'OPEN',
  ADD COLUMN IF NOT EXISTS chief_complaint TEXT,
  ADD COLUMN IF NOT EXISTS anamnesis TEXT,
  ADD COLUMN IF NOT EXISTS physical_exam TEXT,
  ADD COLUMN IF NOT EXISTS vital_signs JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS diagnoses JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS conduct TEXT,
  ADD COLUMN IF NOT EXISTS procedures JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS prescriptions JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS exams JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS certificate JSONB,
  ADD COLUMN IF NOT EXISTS referral JSONB,
  ADD COLUMN IF NOT EXISTS return_plan TEXT,
  ADD COLUMN IF NOT EXISTS discharge_summary TEXT,
  ADD COLUMN IF NOT EXISTS admission_plan TEXT,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS signed_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.medical_records
  ADD COLUMN IF NOT EXISTS encounter_id UUID REFERENCES public.encounters(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS encounters_company_appointment_idx
  ON public.encounters(company_id, appointment_id, created_at DESC) WHERE appointment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS encounters_company_patient_idx
  ON public.encounters(company_id, patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS encounters_company_status_idx
  ON public.encounters(company_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS medical_records_encounter_idx
  ON public.medical_records(company_id, encounter_id);

CREATE OR REPLACE FUNCTION public.m18_can_edit_attendance()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT public.m17_can_edit_records()
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE (id = auth.uid() OR user_id = auth.uid())
        AND lower(coalesce(role_name, '')) IN ('admin','administrador','medico','médico','doctor','enfermeiro','enfermagem')
        AND lg_ativo = TRUE
    )
$$;

CREATE OR REPLACE FUNCTION public.m18_open_attendance_secure(
  p_appointment_id BIGINT,
  p_unit_id INTEGER DEFAULT NULL,
  p_professional_id BIGINT DEFAULT NULL
)
RETURNS public.encounters LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company UUID := public.m17_company_id();
  v_appointment public.appointments;
  v_row public.encounters;
BEGIN
  IF v_company IS NULL OR NOT public.m18_can_edit_attendance() THEN
    RAISE EXCEPTION 'Usuário sem permissão para abrir atendimento';
  END IF;
  SELECT * INTO v_appointment FROM public.appointments
   WHERE id = p_appointment_id AND company_id = v_company FOR UPDATE;
  IF NOT FOUND OR v_appointment.patient_id IS NULL THEN
    RAISE EXCEPTION 'Agendamento não encontrado ou sem paciente';
  END IF;
  IF p_unit_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.units WHERE id = p_unit_id AND company_id = v_company
  ) THEN RAISE EXCEPTION 'Unidade não pertence à empresa'; END IF;
  IF p_professional_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.professionals WHERE id = p_professional_id AND company_id = v_company
  ) THEN RAISE EXCEPTION 'Profissional não pertence à empresa'; END IF;

  SELECT * INTO v_row FROM public.encounters
   WHERE company_id = v_company AND appointment_id = p_appointment_id
   ORDER BY id DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    IF v_row.status IN ('finalizado','alta_ambulatorial','encaminhado','internado','cancelado') THEN
      RAISE EXCEPTION 'Atendimento já finalizado';
    END IF;
    UPDATE public.encounters SET status = 'em_atendimento', updated_at = NOW()
      WHERE id = v_row.id RETURNING * INTO v_row;
    RETURN v_row;
  END IF;

  INSERT INTO public.encounters(company_id, unit_id, patient_id, professional_id, appointment_id, created_by, status)
  VALUES (v_company, p_unit_id, v_appointment.patient_id, coalesce(p_professional_id, v_appointment.professional_id), p_appointment_id, auth.uid(), 'em_atendimento')
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.m18_save_attendance_secure(p_encounter_id UUID, p_payload JSONB)
RETURNS public.encounters LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_row public.encounters; v_company UUID := public.m17_company_id();
BEGIN
  IF v_company IS NULL OR NOT public.m18_can_edit_attendance() THEN RAISE EXCEPTION 'Usuário sem permissão para salvar atendimento'; END IF;
  IF jsonb_typeof(coalesce(p_payload, '{}'::JSONB)) <> 'object' THEN RAISE EXCEPTION 'Dados do atendimento inválidos'; END IF;
  UPDATE public.encounters SET
    chief_complaint = NULLIF(BTRIM(p_payload->>'chief_complaint'), ''),
    anamnesis = NULLIF(BTRIM(p_payload->>'anamnesis'), ''),
    physical_exam = NULLIF(BTRIM(p_payload->>'physical_exam'), ''),
    vital_signs = CASE WHEN jsonb_typeof(coalesce(p_payload->'vital_signs','{}'::JSONB)) = 'object' THEN coalesce(p_payload->'vital_signs','{}'::JSONB) ELSE '{}'::JSONB END,
    diagnoses = CASE WHEN jsonb_typeof(coalesce(p_payload->'diagnoses','[]'::JSONB)) = 'array' THEN coalesce(p_payload->'diagnoses','[]'::JSONB) ELSE '[]'::JSONB END,
    conduct = NULLIF(BTRIM(p_payload->>'conduct'), ''),
    procedures = CASE WHEN jsonb_typeof(coalesce(p_payload->'procedures','[]'::JSONB)) = 'array' THEN coalesce(p_payload->'procedures','[]'::JSONB) ELSE '[]'::JSONB END,
    prescriptions = CASE WHEN jsonb_typeof(coalesce(p_payload->'prescriptions','[]'::JSONB)) = 'array' THEN coalesce(p_payload->'prescriptions','[]'::JSONB) ELSE '[]'::JSONB END,
    exams = CASE WHEN jsonb_typeof(coalesce(p_payload->'exams','[]'::JSONB)) = 'array' THEN coalesce(p_payload->'exams','[]'::JSONB) ELSE '[]'::JSONB END,
    certificate = p_payload->'certificate', referral = p_payload->'referral',
    return_plan = NULLIF(BTRIM(p_payload->>'return_plan'), ''),
    discharge_summary = NULLIF(BTRIM(p_payload->>'discharge_summary'), ''),
    admission_plan = NULLIF(BTRIM(p_payload->>'admission_plan'), ''),
    status = 'em_atendimento', updated_at = NOW()
  WHERE id = p_encounter_id AND company_id = v_company AND status IN ('em_atendimento','aguardando_assinatura','reaberto')
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Atendimento não encontrado ou não editável'; END IF;
  IF NULLIF(BTRIM(v_row.chief_complaint), '') IS NULL AND NULLIF(BTRIM(v_row.anamnesis), '') IS NULL AND NULLIF(BTRIM(v_row.physical_exam), '') IS NULL THEN
    RAISE EXCEPTION 'Informe queixa, anamnese ou exame físico';
  END IF;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.m18_finalize_attendance_secure(p_encounter_id UUID, p_disposition TEXT DEFAULT 'FINALIZED')
RETURNS public.encounters LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_row public.encounters; v_company UUID := public.m17_company_id(); v_status TEXT := CASE upper(coalesce(p_disposition, 'FINALIZED'))
  WHEN 'FINALIZED' THEN 'finalizado'
  WHEN 'DISCHARGED' THEN 'alta_ambulatorial'
  WHEN 'REFERRED' THEN 'encaminhado'
  WHEN 'ADMITTED' THEN 'internado'
  ELSE '' END;
BEGIN
  IF v_company IS NULL OR NOT public.m18_can_edit_attendance() THEN RAISE EXCEPTION 'Usuário sem permissão para finalizar atendimento'; END IF;
  IF v_status = '' THEN RAISE EXCEPTION 'Destino clínico inválido'; END IF;
  UPDATE public.encounters SET status = v_status, signed_by = auth.uid(), signed_at = NOW(), finalized_at = NOW(), updated_at = NOW()
   WHERE id = p_encounter_id AND company_id = v_company AND status IN ('em_atendimento','aguardando_assinatura','reaberto')
   AND (NULLIF(BTRIM(chief_complaint), '') IS NOT NULL OR NULLIF(BTRIM(anamnesis), '') IS NOT NULL OR NULLIF(BTRIM(physical_exam), '') IS NOT NULL)
   RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Atendimento sem conteúdo ou já finalizado'; END IF;
  RETURN v_row;
END;
$$;

ALTER TABLE public.encounters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.encounters FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.encounters FROM PUBLIC, anon, authenticated, app_prontomedic;
GRANT SELECT ON TABLE public.encounters TO authenticated, app_prontomedic;
DROP POLICY IF EXISTS m18_encounters_select ON public.encounters;
CREATE POLICY m18_encounters_select ON public.encounters FOR SELECT TO authenticated, app_prontomedic
  USING (company_id = public.m17_company_id());
DROP POLICY IF EXISTS m18_encounters_write ON public.encounters;
REVOKE ALL ON FUNCTION public.m18_can_edit_attendance() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.m18_open_attendance_secure(BIGINT, INTEGER, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.m18_save_attendance_secure(UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.m18_finalize_attendance_secure(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.m18_can_edit_attendance() TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m18_open_attendance_secure(BIGINT, INTEGER, BIGINT) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m18_save_attendance_secure(UUID, JSONB) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m18_finalize_attendance_secure(UUID, TEXT) TO authenticated, app_prontomedic;

COMMIT;
