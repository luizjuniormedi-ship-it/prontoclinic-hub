BEGIN;

DROP FUNCTION IF EXISTS public.resolve_reception_document_issue_secure(
  BIGINT, UUID, TEXT, DATE
);

CREATE OR REPLACE FUNCTION public.resolve_reception_document_issue_secure(
  p_appointment_id BIGINT,
  p_document_id UUID,
  p_document_number TEXT,
  p_expires_at DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_appointment public.appointments;
  v_document public.patient_documents;
  v_actor UUID := NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
  v_document_number TEXT := btrim(COALESCE(p_document_number, ''));
BEGIN
  PERFORM public.assert_scheduling_permission();
  IF NOT public.audit_has_role(ARRAY['admin','gestor','recepcao']::TEXT[]) THEN
    RAISE EXCEPTION 'Perfil sem permissao para regularizar documento';
  END IF;
  IF length(v_document_number) < 3 THEN
    RAISE EXCEPTION 'Numero do documento invalido';
  END IF;
  IF p_expires_at IS NOT NULL AND p_expires_at < CURRENT_DATE THEN
    RAISE EXCEPTION 'A nova validade nao pode estar vencida';
  END IF;

  SELECT *
    INTO v_appointment
    FROM public.appointments
   WHERE id = p_appointment_id
   FOR UPDATE;
  IF NOT FOUND OR v_appointment.company_id <> public.current_company_id() THEN
    RAISE EXCEPTION 'Agendamento fora do tenant';
  END IF;
  IF NOT public.org_can_access_unit(v_appointment.company_id, v_appointment.unit_id) THEN
    RAISE EXCEPTION 'Agendamento fora da unidade autorizada';
  END IF;

  SELECT *
    INTO v_document
    FROM public.patient_documents
   WHERE id = p_document_id
     AND company_id = v_appointment.company_id
     AND patient_id = v_appointment.patient_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Documento nao pertence ao paciente do agendamento';
  END IF;

  IF v_document.status = 'active'
     AND btrim(COALESCE(v_document.document_number, '')) = v_document_number
     AND v_document.expires_at IS NOT DISTINCT FROM p_expires_at THEN
    RETURN jsonb_build_object(
      'appointment_id', v_appointment.id,
      'document_id', v_document.id,
      'status', v_document.status,
      'idempotent', TRUE
    );
  END IF;

  UPDATE public.patient_documents
     SET document_number = v_document_number,
         expires_at = p_expires_at,
         status = 'active',
         updated_at = NOW()
   WHERE id = v_document.id;

  INSERT INTO public.reception_admin_history(
    company_id, unit_id, entity_type, entity_id, appointment_id,
    from_status, to_status, reason, details, actor_user_id
  )
  VALUES(
    v_appointment.company_id, v_appointment.unit_id, 'patient_document',
    v_document.id::TEXT, v_appointment.id, v_document.status, 'active',
    'Documento regularizado durante o check-in',
    jsonb_build_object(
      'expires_at', p_expires_at,
      'document_number_hash',
      encode(digest(v_document_number, 'sha256'), 'hex')
    ),
    v_actor
  );

  RETURN jsonb_build_object(
    'appointment_id', v_appointment.id,
    'document_id', v_document.id,
    'status', 'active',
    'idempotent', FALSE
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
