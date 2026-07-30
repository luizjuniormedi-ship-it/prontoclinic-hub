-- Reception closure: complete walk-in payload and audited document resolution.
-- Additive only. DataSIGH is not accessed.

BEGIN;

CREATE OR REPLACE FUNCTION public.create_reception_walkin_secure(
  p_patient_id BIGINT,
  p_unit_id INTEGER,
  p_appointment_type_id BIGINT,
  p_professional_id BIGINT,
  p_service_id BIGINT,
  p_notes TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company UUID := public.current_company_id();
  v_id BIGINT;
  v_actor UUID := NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
  v_duration INTEGER;
BEGIN
  PERFORM public.assert_scheduling_permission();
  IF NOT public.audit_has_role(ARRAY['admin','gestor','recepcao']::TEXT[]) THEN
    RAISE EXCEPTION 'Perfil sem permissao para atendimento espontaneo';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.patients
    WHERE id = p_patient_id AND company_id = v_company
  ) THEN
    RAISE EXCEPTION 'Paciente fora do tenant';
  END IF;
  IF p_unit_id IS NULL OR NOT public.org_can_access_unit(v_company, p_unit_id) THEN
    RAISE EXCEPTION 'Unidade fora do escopo';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.appointment_types
    WHERE id = p_appointment_type_id
      AND COALESCE(lower(status), 'active') IN ('active', 'ativo')
  ) THEN
    RAISE EXCEPTION 'Tipo de atendimento invalido';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.professionals
    WHERE id = p_professional_id
      AND company_id = v_company
      AND COALESCE(lg_ativo, TRUE)
  ) THEN
    RAISE EXCEPTION 'Profissional fora do tenant ou inativo';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.services_catalog
    WHERE id = p_service_id AND COALESCE(lg_ativo, TRUE)
  ) THEN
    RAISE EXCEPTION 'Servico invalido ou inativo';
  END IF;

  SELECT GREATEST(COALESCE(default_duration_minutes, 30), 5)
    INTO v_duration
    FROM public.appointment_types
   WHERE id = p_appointment_type_id;

  INSERT INTO public.appointments(
    company_id, patient_id, unit_id, appointment_type_id, professional_id,
    service_id, appointment_date, start_time, end_time, status, notes, is_walkin
  )
  VALUES(
    v_company, p_patient_id, p_unit_id, p_appointment_type_id, p_professional_id,
    p_service_id, CURRENT_DATE, LOCALTIME(0)::TIME,
    LOCALTIME(0)::TIME + make_interval(mins => v_duration),
    'scheduled', NULLIF(btrim(p_notes), ''), TRUE
  )
  RETURNING id INTO v_id;

  INSERT INTO public.reception_admin_history(
    company_id, unit_id, entity_type, entity_id, appointment_id,
    from_status, to_status, reason, details, actor_user_id
  )
  VALUES(
    v_company, p_unit_id, 'walkin', v_id::TEXT, v_id, NULL, 'scheduled',
    'Atendimento espontaneo criado',
    jsonb_build_object(
      'patient_id', p_patient_id,
      'appointment_type_id', p_appointment_type_id,
      'professional_id', p_professional_id,
      'service_id', p_service_id
    ),
    v_actor
  );
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_reception_walkin_secure(
  BIGINT, INTEGER, BIGINT, BIGINT, BIGINT, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_reception_walkin_secure(
  BIGINT, INTEGER, BIGINT, BIGINT, BIGINT, TEXT
) TO authenticated, app_prontomedic;

CREATE OR REPLACE FUNCTION public.resolve_reception_document_issue_secure(
  p_appointment_id BIGINT,
  p_document_id UUID,
  p_document_number TEXT,
  p_expires_at DATE DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_appointment public.appointments;
  v_actor UUID := NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
BEGIN
  PERFORM public.assert_scheduling_permission();
  IF NOT public.audit_has_role(ARRAY['admin','gestor','recepcao']::TEXT[]) THEN
    RAISE EXCEPTION 'Perfil sem permissao para regularizar documento';
  END IF;
  IF length(btrim(COALESCE(p_document_number, ''))) < 3 THEN
    RAISE EXCEPTION 'Numero do documento invalido';
  END IF;
  IF p_expires_at IS NOT NULL AND p_expires_at < CURRENT_DATE THEN
    RAISE EXCEPTION 'A nova validade nao pode estar vencida';
  END IF;

  SELECT * INTO v_appointment
    FROM public.appointments
   WHERE id = p_appointment_id
   FOR UPDATE;
  IF NOT FOUND OR v_appointment.company_id <> public.current_company_id() THEN
    RAISE EXCEPTION 'Agendamento fora do tenant';
  END IF;
  IF NOT public.org_can_access_unit(v_appointment.company_id, v_appointment.unit_id) THEN
    RAISE EXCEPTION 'Agendamento fora da unidade autorizada';
  END IF;

  UPDATE public.patient_documents
     SET document_number = btrim(p_document_number),
         expires_at = p_expires_at,
         status = 'active',
         updated_at = NOW()
   WHERE id = p_document_id
     AND company_id = v_appointment.company_id
     AND patient_id = v_appointment.patient_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Documento nao pertence ao paciente do agendamento';
  END IF;

  INSERT INTO public.reception_admin_history(
    company_id, unit_id, entity_type, entity_id, appointment_id,
    from_status, to_status, reason, details, actor_user_id
  )
  VALUES(
    v_appointment.company_id, v_appointment.unit_id, 'patient_document',
    p_document_id::TEXT, v_appointment.id, 'pending', 'active',
    'Documento regularizado durante o check-in',
    jsonb_build_object('expires_at', p_expires_at), v_actor
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_reception_document_issue_secure(
  BIGINT, UUID, TEXT, DATE
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_reception_document_issue_secure(
  BIGINT, UUID, TEXT, DATE
) TO authenticated, app_prontomedic;

COMMIT;
