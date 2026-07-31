-- Reception document resolution is serialized by the document row update.
-- Reading the appointment with FOR UPDATE would require direct UPDATE rights
-- on appointments for receptionists, bypassing the canonical RPC boundary.

BEGIN;

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
   WHERE id = p_appointment_id;
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
