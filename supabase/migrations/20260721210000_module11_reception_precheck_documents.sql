-- Module 11: reception pre-check for invalid documents and revoked consent.
-- Additive only: an absent document/consent record is not treated as an error.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.patient_documents') IS NULL
     OR to_regclass('public.paciente_consentimentos') IS NULL THEN
    RAISE EXCEPTION 'Module 11 document/consent foundation is missing';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.get_reception_precheckin_context(
  p_appointment_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_appointment public.appointments;
  v_document_issues JSONB := '[]'::JSONB;
  v_consent_issues JSONB := '[]'::JSONB;
  v_issues JSONB := '[]'::JSONB;
  v_document_pending BOOLEAN := FALSE;
  v_consent_pending BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_appointment
    FROM public.appointments
   WHERE id = p_appointment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento nao encontrado';
  END IF;
  IF v_appointment.company_id <> public.current_company_id() THEN
    RAISE EXCEPTION 'Agendamento fora do tenant';
  END IF;
  IF v_appointment.unit_id IS NOT NULL
     AND NOT public.org_can_access_unit(v_appointment.company_id, v_appointment.unit_id) THEN
    RAISE EXCEPTION 'Agendamento fora da unidade autorizada';
  END IF;

  IF v_appointment.patient_id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'type', 'document',
      'severity', 'blocking',
      'description', CASE
        WHEN COALESCE(NULLIF(lower(d.status), ''), 'active') <> 'active'
          THEN 'Documento do paciente inativo ou inválido'
        ELSE 'Documento do paciente expirado'
      END,
      'document_type', d.document_type,
      'document_id', d.id
    ) ORDER BY d.expires_at NULLS LAST, d.created_at DESC), '[]'::JSONB)
    INTO v_document_issues
    FROM public.patient_documents d
    WHERE d.company_id = v_appointment.company_id
      AND d.patient_id = v_appointment.patient_id
      AND (
        COALESCE(NULLIF(lower(d.status), ''), 'active') <> 'active'
        OR (d.expires_at IS NOT NULL AND d.expires_at < CURRENT_DATE)
      );

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'type', 'consent',
      'severity', 'blocking',
      'description', CASE
        WHEN c.dt_revocacao IS NOT NULL THEN 'Consentimento do paciente revogado'
        ELSE 'Consentimento do paciente está sem aceite ativo'
      END,
      'consent_id', c.id,
      'channel', c.cd_canal
    ) ORDER BY c.dt_optin DESC), '[]'::JSONB)
    INTO v_consent_issues
    FROM public.paciente_consentimentos c
    WHERE c.company_id = v_appointment.company_id
      AND c.cd_paciente = v_appointment.patient_id
      AND (c.lg_optin IS DISTINCT FROM TRUE OR c.dt_revocacao IS NOT NULL);
  END IF;

  v_document_pending := jsonb_array_length(v_document_issues) > 0;
  v_consent_pending := jsonb_array_length(v_consent_issues) > 0;
  v_issues := v_document_issues || v_consent_issues;

  RETURN jsonb_build_object(
    'appointment_id', v_appointment.id,
    'patient_id', v_appointment.patient_id,
    'unit_id', v_appointment.unit_id,
    'ready', NOT (v_document_pending OR v_consent_pending),
    'has_document_pending', v_document_pending,
    'has_consent_pending', v_consent_pending,
    'document_issues', v_document_issues,
    'consent_issues', v_consent_issues,
    'issues', v_issues
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_reception_precheckin_context(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_reception_precheckin_context(BIGINT)
  TO authenticated, app_prontomedic;

CREATE OR REPLACE FUNCTION public.perform_reception_checkin_secure(
  p_appointment_id BIGINT,
  p_priority TEXT DEFAULT 'normal',
  p_exception_reason TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_appointment public.appointments;
  v_readiness JSONB;
  v_precheck JSONB;
  v_issues JSONB := '[]'::JSONB;
  v_ready BOOLEAN;
  v_checkin public.reception_checkins;
  v_ticket public.reception_queue_tickets;
  v_number INTEGER;
  v_actor RECORD;
BEGIN
  PERFORM public.assert_scheduling_permission();
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  IF v_actor.user_id IS NULL OR v_actor.company_id IS NULL THEN
    RAISE EXCEPTION 'Usuario autenticado sem perfil operacional';
  END IF;

  SELECT * INTO v_appointment
    FROM public.appointments
   WHERE id = p_appointment_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento nao encontrado'; END IF;
  IF v_appointment.company_id <> v_actor.company_id THEN
    RAISE EXCEPTION 'Agendamento fora do escopo do usuario';
  END IF;
  IF v_appointment.unit_id IS NOT NULL
     AND NOT public.org_can_access_unit(v_appointment.company_id, v_appointment.unit_id) THEN
    RAISE EXCEPTION 'Agendamento fora da unidade autorizada';
  END IF;
  IF p_priority NOT IN ('normal','legal','urgent') THEN
    RAISE EXCEPTION 'Prioridade invalida';
  END IF;

  -- Idempotency is evaluated before readiness so retries preserve the ticket.
  SELECT * INTO v_checkin
    FROM public.reception_checkins
   WHERE appointment_id = v_appointment.id
   FOR UPDATE;
  IF FOUND THEN
    SELECT * INTO v_ticket
      FROM public.reception_queue_tickets
     WHERE checkin_id = v_checkin.id
     LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'checkin_id', v_checkin.id,
        'ticket_id', v_ticket.id,
        'ticket', v_ticket.prefix || lpad(v_ticket.number::TEXT, 3, '0'),
        'released_by_exception', v_checkin.released_by_exception,
        'issues', '[]'::JSONB,
        'idempotent', TRUE
      );
    END IF;
  END IF;

  v_readiness := public.get_reception_checkin_readiness(p_appointment_id);
  v_precheck := public.get_reception_precheckin_context(p_appointment_id);
  v_issues := COALESCE(v_readiness->'issues', '[]'::JSONB)
    || COALESCE(v_precheck->'issues', '[]'::JSONB);
  v_ready := (v_readiness->>'ready')::BOOLEAN AND (v_precheck->>'ready')::BOOLEAN;
  IF NOT v_ready AND NULLIF(trim(COALESCE(p_exception_reason,'')), '') IS NULL THEN
    RAISE EXCEPTION 'Check-in bloqueado por pendencias';
  END IF;

  IF v_checkin.id IS NULL THEN
    INSERT INTO public.reception_checkins(
      company_id, unit_id, patient_id, appointment_id, status, priority,
      released_by_exception, created_by
    )
    VALUES (
      v_appointment.company_id, v_appointment.unit_id, v_appointment.patient_id,
      v_appointment.id, 'checked_in', p_priority,
      NOT v_ready, v_actor.user_id
    )
    RETURNING * INTO v_checkin;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(CURRENT_DATE::TEXT), hashtext('reception-C'));
  SELECT COALESCE(max(number), 0) + 1 INTO v_number
    FROM public.reception_queue_tickets
   WHERE ticket_date = CURRENT_DATE AND prefix = 'C';

  INSERT INTO public.reception_queue_tickets(
    company_id, unit_id, checkin_id, patient_id, appointment_id, number, priority
  )
  VALUES (
    v_appointment.company_id, v_appointment.unit_id, v_checkin.id,
    v_appointment.patient_id, v_appointment.id, v_number, p_priority
  )
  RETURNING * INTO v_ticket;

  INSERT INTO public.reception_admin_history(
    company_id, unit_id, entity_type, entity_id, appointment_id,
    from_status, to_status, reason, details, actor_user_id
  )
  VALUES (
    v_appointment.company_id, v_appointment.unit_id, 'checkin',
    v_checkin.id::TEXT, v_appointment.id, NULL, 'checked_in',
    COALESCE(NULLIF(trim(p_exception_reason), ''), 'Check-in realizado'),
    jsonb_build_object('ticket', v_ticket.prefix || lpad(v_ticket.number::TEXT, 3, '0'), 'issues', v_issues),
    v_actor.user_id
  );

  IF to_regprocedure('public.update_appointment_status_secure(bigint,text,text)') IS NOT NULL THEN
    PERFORM public.update_appointment_status_secure(v_appointment.id, 'waiting', 'Check-in realizado');
  END IF;

  RETURN jsonb_build_object(
    'checkin_id', v_checkin.id,
    'ticket_id', v_ticket.id,
    'ticket', v_ticket.prefix || lpad(v_ticket.number::TEXT, 3, '0'),
    'released_by_exception', NOT v_ready,
    'issues', v_issues,
    'idempotent', FALSE
  );
END;
$$;

REVOKE ALL ON FUNCTION public.perform_reception_checkin_secure(BIGINT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.perform_reception_checkin_secure(BIGINT, TEXT, TEXT)
  TO authenticated, app_prontomedic;

DO $$
BEGIN
  IF to_regclass('public.prontomedic_deployment_migrations') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.prontomedic_deployment_migrations
        WHERE filename = '20260721210000_module11_reception_precheck_documents.sql'
     ) THEN
    INSERT INTO public.prontomedic_deployment_migrations(filename, applied_at)
    VALUES ('20260721210000_module11_reception_precheck_documents.sql', NOW());
  END IF;
END
$$;

COMMIT;
