-- Clinical record signing and atomic attendance finalization.
-- The DataSIGH source is intentionally not referenced by this migration.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.medical_records
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS signed_by UUID,
  ADD COLUMN IF NOT EXISTS content_hash TEXT;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.medical_records'::regclass
       AND conname = 'medical_records_status_check'
  ) THEN
    ALTER TABLE public.medical_records
      ADD CONSTRAINT medical_records_status_check
      CHECK (status IN ('draft', 'signed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.medical_records'::regclass
       AND conname = 'medical_records_signature_consistency_check'
  ) THEN
    ALTER TABLE public.medical_records
      ADD CONSTRAINT medical_records_signature_consistency_check
      CHECK (
        (status = 'draft' AND signed_at IS NULL AND signed_by IS NULL AND content_hash IS NULL)
        OR
        (status = 'signed' AND signed_at IS NOT NULL AND signed_by IS NOT NULL AND content_hash IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.medical_records'::regclass
       AND conname = 'medical_records_signed_by_fkey'
  ) THEN
    ALTER TABLE public.medical_records
      ADD CONSTRAINT medical_records_signed_by_fkey
      FOREIGN KEY (signed_by) REFERENCES auth.users(id);
  END IF;
END
$constraints$;

CREATE UNIQUE INDEX IF NOT EXISTS medical_records_company_appointment_uq
  ON public.medical_records(company_id, appointment_id)
  WHERE company_id IS NOT NULL AND appointment_id IS NOT NULL;

INSERT INTO public.role_permissions
  (role_id, module, can_view, can_create, can_edit, can_delete, can_export)
SELECT r.id, 'prontuario', TRUE,
       r.name IN ('admin', 'gestor', 'medico', 'enfermagem'),
       r.name IN ('admin', 'gestor', 'medico', 'enfermagem'),
       FALSE, FALSE
  FROM public.roles r
 WHERE r.name IN ('admin', 'gestor', 'medico', 'enfermagem')
ON CONFLICT (role_id, module) DO UPDATE
  SET can_view = EXCLUDED.can_view,
      can_create = EXCLUDED.can_create,
      can_edit = EXCLUDED.can_edit,
      can_delete = FALSE,
      updated_at = NOW();

CREATE OR REPLACE FUNCTION public.has_medical_record_permission(p_action TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.user_profiles up
      JOIN public.roles r
        ON r.name = CASE lower(COALESCE(up.role_name, ''))
                      WHEN 'administrador' THEN 'admin'
                      WHEN 'médico' THEN 'medico'
                      WHEN 'enfermeiro' THEN 'enfermagem'
                      WHEN 'enfermeira' THEN 'enfermagem'
                      ELSE lower(COALESCE(up.role_name, ''))
                    END
       AND r.lg_ativo = TRUE
      JOIN public.role_permissions rp
        ON rp.role_id = r.id
       AND rp.module = 'prontuario'
     WHERE up.id = auth.uid()
       AND up.lg_ativo = TRUE
       AND up.company_id IS NOT NULL
       AND CASE lower(COALESCE(p_action, ''))
             WHEN 'view' THEN rp.can_view
             WHEN 'create' THEN rp.can_create
             WHEN 'edit' THEN rp.can_edit
             ELSE FALSE
           END
  )
$function$;

DROP FUNCTION IF EXISTS public.assert_medical_record_permission();

CREATE OR REPLACE FUNCTION public.assert_medical_record_permission(p_action TEXT DEFAULT 'view')
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor RECORD;
BEGIN
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  IF v_actor.user_id IS NULL OR v_actor.company_id IS NULL THEN
    RAISE EXCEPTION 'Usuario autenticado sem empresa operacional ativa';
  END IF;
  IF NOT public.has_medical_record_permission(p_action) THEN
    RAISE EXCEPTION 'Perfil sem permissao % para prontuario', p_action;
  END IF;
END
$function$;

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
AS $function$
DECLARE
  v_actor RECORD;
  v_patient public.patients;
  v_professional public.professionals;
  v_appointment public.appointments;
  v_row public.medical_records;
BEGIN
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  PERFORM public.assert_medical_record_permission('create');

  SELECT * INTO v_patient FROM public.patients
   WHERE id = p_patient_id AND company_id = v_actor.company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Paciente fora da empresa do usuario ou inexistente';
  END IF;

  IF p_professional_id IS NOT NULL THEN
    SELECT * INTO v_professional FROM public.professionals
     WHERE id = p_professional_id AND company_id = v_actor.company_id AND lg_ativo = TRUE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Profissional fora da empresa do usuario ou inexistente';
    END IF;
  END IF;

  IF p_appointment_id IS NOT NULL THEN
    SELECT * INTO v_appointment FROM public.appointments
     WHERE id = p_appointment_id AND company_id = v_actor.company_id;
    IF NOT FOUND
       OR v_appointment.patient_id IS DISTINCT FROM p_patient_id
       OR (p_professional_id IS NOT NULL AND v_appointment.professional_id IS DISTINCT FROM p_professional_id) THEN
      RAISE EXCEPTION 'Agendamento nao corresponde ao paciente, profissional e empresa informados';
    END IF;
  END IF;

  INSERT INTO public.medical_records (
    company_id, patient_id, professional_id, appointment_id, record_date,
    anamnesis, evolution, chief_complaint, diagnosis, prescription,
    vital_signs, notes, created_by, updated_by, status
  ) VALUES (
    v_actor.company_id, p_patient_id, p_professional_id, p_appointment_id,
    COALESCE(p_record_date, CURRENT_DATE), p_anamnesis, p_evolution, NULL,
    p_diagnosis, p_prescription, p_vital_signs, p_notes,
    v_actor.user_id, v_actor.user_id, 'draft'
  )
  RETURNING * INTO v_row;
  RETURN v_row;
END
$function$;

CREATE OR REPLACE FUNCTION public.update_medical_record_secure(
  p_record_id BIGINT,
  p_patch JSONB
)
RETURNS public.medical_records
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor RECORD;
  v_old public.medical_records;
  v_row public.medical_records;
  v_key TEXT;
BEGIN
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  PERFORM public.assert_medical_record_permission('edit');
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::JSONB THEN
    RAISE EXCEPTION 'Nenhum campo clinico informado';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF v_key NOT IN ('record_date', 'anamnesis', 'evolution', 'diagnosis',
                     'prescription', 'vital_signs', 'notes') THEN
      RAISE EXCEPTION 'Campo clinico nao editavel por este RPC: %', v_key;
    END IF;
  END LOOP;

  SELECT * INTO v_old FROM public.medical_records
   WHERE id = p_record_id AND company_id = v_actor.company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Prontuario nao encontrado'; END IF;
  IF v_old.status = 'signed' THEN
    RAISE EXCEPTION 'Prontuario assinado e imutavel';
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
END
$function$;

CREATE OR REPLACE FUNCTION public.protect_signed_medical_record()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF OLD.status = 'signed' THEN
    RAISE EXCEPTION 'Prontuario assinado e imutavel';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_protect_signed_medical_record ON public.medical_records;
CREATE TRIGGER trg_protect_signed_medical_record
  BEFORE UPDATE OR DELETE ON public.medical_records
  FOR EACH ROW EXECUTE FUNCTION public.protect_signed_medical_record();

CREATE OR REPLACE FUNCTION public.sign_medical_record_secure(p_record_id BIGINT)
RETURNS public.medical_records
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor RECORD;
  v_professional public.professionals;
  v_row public.medical_records;
  v_hash TEXT;
BEGIN
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  PERFORM public.assert_medical_record_permission('edit');
  SELECT * INTO v_professional FROM public.professionals
   WHERE user_id = v_actor.user_id AND company_id = v_actor.company_id AND lg_ativo = TRUE
   ORDER BY id LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Usuario autenticado sem profissional clinico ativo'; END IF;

  SELECT * INTO v_row FROM public.medical_records
   WHERE id = p_record_id AND company_id = v_actor.company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Prontuario nao encontrado'; END IF;
  v_hash := encode(digest(jsonb_build_object(
    'record_date', v_row.record_date, 'anamnesis', v_row.anamnesis,
    'evolution', v_row.evolution, 'diagnosis', v_row.diagnosis,
    'prescription', v_row.prescription, 'vital_signs', v_row.vital_signs,
    'notes', v_row.notes
  )::TEXT, 'sha256'), 'hex');

  IF v_row.status = 'signed' THEN
    IF v_row.signed_by = v_actor.user_id AND v_row.content_hash = v_hash THEN RETURN v_row; END IF;
    RAISE EXCEPTION 'Prontuario ja assinado com conteudo ou signatario diferente';
  END IF;
  IF v_row.professional_id IS NOT NULL AND v_row.professional_id <> v_professional.id THEN
    RAISE EXCEPTION 'Prontuario pertence a outro profissional';
  END IF;

  UPDATE public.medical_records
     SET professional_id = v_professional.id, status = 'signed',
         signed_at = NOW(), signed_by = v_actor.user_id, content_hash = v_hash,
         updated_by = v_actor.user_id, updated_at = NOW()
   WHERE id = v_row.id RETURNING * INTO v_row;
  RETURN v_row;
END
$function$;

CREATE OR REPLACE FUNCTION public.finalize_medical_attendance_secure(
  p_appointment_id BIGINT,
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
AS $function$
DECLARE
  v_actor RECORD;
  v_professional public.professionals;
  v_appointment public.appointments;
  v_row public.medical_records;
  v_hash TEXT;
BEGIN
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  PERFORM public.assert_medical_record_permission('create');
  SELECT * INTO v_professional FROM public.professionals
   WHERE user_id = v_actor.user_id AND company_id = v_actor.company_id AND lg_ativo = TRUE
   ORDER BY id LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Usuario autenticado sem profissional clinico ativo'; END IF;

  SELECT * INTO v_appointment FROM public.appointments
   WHERE id = p_appointment_id AND company_id = v_actor.company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento fora da empresa do usuario ou inexistente'; END IF;
  IF v_appointment.professional_id IS DISTINCT FROM v_professional.id THEN
    RAISE EXCEPTION 'Agendamento pertence a outro profissional';
  END IF;
  IF v_appointment.patient_id IS NULL THEN RAISE EXCEPTION 'Agendamento sem paciente'; END IF;

  v_hash := encode(digest(jsonb_build_object(
    'record_date', COALESCE(p_record_date, v_appointment.appointment_date, CURRENT_DATE), 'anamnesis', p_anamnesis,
    'evolution', p_evolution, 'diagnosis', p_diagnosis,
    'prescription', p_prescription, 'vital_signs', p_vital_signs,
    'notes', p_notes
  )::TEXT, 'sha256'), 'hex');

  SELECT * INTO v_row FROM public.medical_records
   WHERE company_id = v_actor.company_id AND appointment_id = p_appointment_id FOR UPDATE;
  IF FOUND AND v_row.status = 'signed' THEN
    IF v_appointment.status = 'completed'
       AND v_row.signed_by = v_actor.user_id
       AND v_row.content_hash = v_hash THEN
      RETURN v_row;
    END IF;
    RAISE EXCEPTION 'Finalizacao repetida diverge do atendimento assinado';
  END IF;
  IF v_appointment.status <> 'in_progress' THEN
    RAISE EXCEPTION 'Atendimento deve estar em andamento para finalizar';
  END IF;

  IF FOUND THEN
    UPDATE public.medical_records
       SET patient_id = v_appointment.patient_id,
           professional_id = v_professional.id,
           record_date = COALESCE(p_record_date, v_appointment.appointment_date, CURRENT_DATE),
           anamnesis = p_anamnesis, evolution = p_evolution,
           diagnosis = p_diagnosis, prescription = p_prescription,
           vital_signs = p_vital_signs, notes = p_notes,
           status = 'signed', signed_at = NOW(), signed_by = v_actor.user_id,
           content_hash = v_hash, updated_by = v_actor.user_id, updated_at = NOW()
     WHERE id = v_row.id RETURNING * INTO v_row;
  ELSE
    INSERT INTO public.medical_records (
      company_id, patient_id, professional_id, appointment_id, record_date,
      anamnesis, evolution, diagnosis, prescription, vital_signs, notes,
      created_by, updated_by, status, signed_at, signed_by, content_hash
    ) VALUES (
      v_actor.company_id, v_appointment.patient_id, v_professional.id,
      v_appointment.id, COALESCE(p_record_date, v_appointment.appointment_date, CURRENT_DATE), p_anamnesis,
      p_evolution, p_diagnosis, p_prescription, p_vital_signs, p_notes,
      v_actor.user_id, v_actor.user_id, 'signed', NOW(), v_actor.user_id, v_hash
    ) RETURNING * INTO v_row;
  END IF;

  UPDATE public.appointments SET status = 'completed', updated_at = NOW()
   WHERE id = v_appointment.id;
  INSERT INTO public.scheduling_status_history (
    company_id, appointment_id, from_status, to_status, reason, actor_user_id
  ) VALUES (
    v_actor.company_id, v_appointment.id, v_appointment.status, 'completed',
    'Atendimento clinico finalizado e prontuario assinado', v_actor.user_id
  );
  RETURN v_row;
END
$function$;

-- Preserve base-table RLS when the statistics view is queried.
CREATE OR REPLACE VIEW public.audit_logs_stats
WITH (security_invoker = true)
AS
SELECT company_id, DATE_TRUNC('day', dt_evento) AS dia, acao, tabela,
       cd_usuario, cd_usuario_nome, COUNT(*) AS total
  FROM public.audit_logs
 GROUP BY company_id, DATE_TRUNC('day', dt_evento), acao, tabela,
          cd_usuario, cd_usuario_nome;

ALTER FUNCTION public.audit_trigger_func() SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.audit_trigger_func() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.has_medical_record_permission(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_medical_record_permission(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_medical_record_secure(BIGINT, BIGINT, BIGINT, DATE, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_medical_record_secure(BIGINT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sign_medical_record_secure(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_medical_attendance_secure(BIGINT, DATE, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON TABLE public.medical_records FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.medical_records FROM authenticated;
REVOKE ALL ON TABLE public.audit_logs_stats FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.audit_logs TO authenticated;
GRANT SELECT ON TABLE public.audit_logs_stats TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_medical_record_permission(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assert_medical_record_permission(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_medical_record_secure(BIGINT, BIGINT, BIGINT, DATE, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_medical_record_secure(BIGINT, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sign_medical_record_secure(BIGINT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_medical_attendance_secure(BIGINT, DATE, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) TO authenticated, service_role;

