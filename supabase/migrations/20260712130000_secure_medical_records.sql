-- Secure clinical record contract.
-- Additive fields required by the longitudinal clinical workflow.

ALTER TABLE public.medical_records
  ADD COLUMN IF NOT EXISTS record_date DATE NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS anamnesis TEXT,
  ADD COLUMN IF NOT EXISTS evolution TEXT,
  ADD COLUMN IF NOT EXISTS vital_signs JSONB;

CREATE OR REPLACE FUNCTION public.assert_medical_record_permission()
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor RECORD;
BEGIN
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  IF v_actor.user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario autenticado sem perfil operacional';
  END IF;
  IF COALESCE(v_actor.role_name, '') NOT IN (
    'admin', 'administrador', 'gestor', 'medico', 'médico',
    'enfermagem', 'enfermeiro', 'enfermeira'
  ) THEN
    RAISE EXCEPTION 'Perfil sem permissao para prontuario';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_medical_record_secure(
  p_patient_id BIGINT,
  p_professional_id BIGINT DEFAULT NULL,
  p_appointment_id BIGINT DEFAULT NULL,
  p_record_date DATE DEFAULT CURRENT_DATE,
  p_anamnesis TEXT DEFAULT NULL,
  p_evolution TEXT DEFAULT NULL,
  p_diagnosis TEXT DEFAULT NULL,
  p_prescription TEXT DEFAULT NULL,
  p_vital_signs JSONB DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS public.medical_records
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor RECORD;
  v_patient public.patients;
  v_row public.medical_records;
BEGIN
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  PERFORM public.assert_medical_record_permission();

  SELECT * INTO v_patient
    FROM public.patients
   WHERE id = p_patient_id
     AND (v_actor.company_id IS NULL OR company_id = v_actor.company_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Paciente fora da empresa do usuario ou inexistente';
  END IF;

  INSERT INTO public.medical_records (
    company_id, patient_id, professional_id, appointment_id, record_date,
    anamnesis, evolution, chief_complaint, diagnosis, prescription,
    vital_signs, notes, created_by, updated_by
  )
  VALUES (
    v_patient.company_id, p_patient_id, p_professional_id, p_appointment_id, COALESCE(p_record_date, CURRENT_DATE),
    p_anamnesis, p_evolution, NULL, p_diagnosis, p_prescription,
    p_vital_signs, p_notes, v_actor.user_id, v_actor.user_id
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_medical_record_secure(
  p_record_id BIGINT,
  p_patch JSONB
)
RETURNS public.medical_records
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor RECORD;
  v_old public.medical_records;
  v_row public.medical_records;
  v_key TEXT;
BEGIN
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  PERFORM public.assert_medical_record_permission();

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::JSONB THEN
    RAISE EXCEPTION 'Nenhum campo clinico informado';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF v_key NOT IN (
      'record_date', 'anamnesis', 'evolution', 'diagnosis',
      'prescription', 'vital_signs', 'notes'
    ) THEN
      RAISE EXCEPTION 'Campo clinico nao editavel por este RPC: %', v_key;
    END IF;
  END LOOP;

  SELECT * INTO v_old
    FROM public.medical_records
   WHERE id = p_record_id
     AND (v_actor.company_id IS NULL OR company_id = v_actor.company_id)
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Prontuario nao encontrado';
  END IF;

  UPDATE public.medical_records
     SET record_date = CASE WHEN p_patch ? 'record_date' THEN NULLIF(p_patch->>'record_date', '')::DATE ELSE record_date END,
         anamnesis = CASE WHEN p_patch ? 'anamnesis' THEN NULLIF(p_patch->>'anamnesis', '') ELSE anamnesis END,
         evolution = CASE WHEN p_patch ? 'evolution' THEN NULLIF(p_patch->>'evolution', '') ELSE evolution END,
         diagnosis = CASE WHEN p_patch ? 'diagnosis' THEN NULLIF(p_patch->>'diagnosis', '') ELSE diagnosis END,
         prescription = CASE WHEN p_patch ? 'prescription' THEN NULLIF(p_patch->>'prescription', '') ELSE prescription END,
         vital_signs = CASE WHEN p_patch ? 'vital_signs' THEN p_patch->'vital_signs' ELSE vital_signs END,
         notes = CASE WHEN p_patch ? 'notes' THEN NULLIF(p_patch->>'notes', '') ELSE notes END,
         updated_by = v_actor.user_id,
         updated_at = NOW()
   WHERE id = p_record_id
   RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_medical_record_permission() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_medical_record_secure(BIGINT, BIGINT, BIGINT, DATE, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_medical_record_secure(BIGINT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_medical_record_permission() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_medical_record_secure(BIGINT, BIGINT, BIGINT, DATE, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_medical_record_secure(BIGINT, JSONB) TO authenticated, service_role;
