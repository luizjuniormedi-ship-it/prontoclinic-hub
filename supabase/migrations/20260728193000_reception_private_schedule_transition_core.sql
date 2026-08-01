-- Keep one schedule transition core while making reception capability private.

CREATE OR REPLACE FUNCTION private.transition_appointment_status_core(
  p_appointment_id BIGINT,
  p_new_status TEXT,
  p_reason TEXT,
  p_reception_workflow BOOLEAN
)
RETURNS public.appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, auth
SET row_security = off
AS $function$
DECLARE
  v_company_id UUID := public.active_company_id();
  v_unit_id INTEGER := public.active_unit_id();
  v_old public.appointments%ROWTYPE;
  v_row public.appointments%ROWTYPE;
  v_reason TEXT := NULLIF(trim(COALESCE(p_reason, '')), '');
BEGIN
  IF p_new_status = 'waiting' AND (
    NOT p_reception_workflow
    OR NOT private.reception_waiting_transition_authorized(p_appointment_id)
  ) THEN
    RAISE EXCEPTION
      'Entrada em espera exige check-in transacional completo'
      USING ERRCODE = '42501';
  END IF;

  IF v_company_id IS NULL
     OR v_unit_id IS NULL
     OR (
       p_new_status <> 'waiting'
       AND NOT public.can_access('agenda', 'edit')
     ) THEN
    RAISE EXCEPTION
      'Contexto AAL2, sessão, unidade ou permissão operacional inválidos'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_old
  FROM public.appointments appointment
  WHERE appointment.id = p_appointment_id
    AND appointment.company_id = v_company_id
    AND appointment.unit_id = v_unit_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Agendamento não encontrado no contexto ativo'
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.can_transition_appointment_status(
    v_old.status,
    p_new_status
  ) THEN
    RAISE EXCEPTION
      'Transição inválida: % para %',
      v_old.status,
      p_new_status;
  END IF;

  IF p_new_status IN ('cancelled', 'no_show')
     AND v_reason IS NULL THEN
    RAISE EXCEPTION
      'Motivo é obrigatório para cancelar ou registrar falta';
  END IF;

  UPDATE public.appointments appointment
  SET status = p_new_status,
      notes = COALESCE(v_reason, appointment.notes),
      updated_at = now()
  WHERE appointment.id = p_appointment_id
    AND appointment.company_id = v_company_id
    AND appointment.unit_id = v_unit_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Agendamento não encontrado no contexto ativo'
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.scheduling_status_history (
    company_id,
    appointment_id,
    from_status,
    to_status,
    reason,
    actor_user_id
  )
  VALUES (
    v_company_id,
    v_row.id,
    v_old.status,
    v_row.status,
    v_reason,
    auth.uid()
  );

  IF p_new_status = 'cancelled' THEN
    INSERT INTO public.scheduling_cancellations (
      company_id,
      appointment_id,
      reason,
      cancelled_by
    )
    VALUES (
      v_company_id,
      v_row.id,
      v_reason,
      auth.uid()
    );
  END IF;

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION private.transition_appointment_status_core(
  BIGINT, TEXT, TEXT, BOOLEAN
) FROM PUBLIC, anon, authenticated, app_prontomedic,
  prontomedic_reception_rpc_owner;

CREATE OR REPLACE FUNCTION public.update_appointment_status_secure(
  p_appointment_id BIGINT,
  p_new_status TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS public.appointments
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, auth
SET row_security = off
AS $function$
  SELECT private.transition_appointment_status_core(
    p_appointment_id,
    p_new_status,
    p_reason,
    FALSE
  );
$function$;

CREATE OR REPLACE FUNCTION private.transition_reception_appointment_to_waiting(
  p_appointment_id BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, auth
SET row_security = off
AS $function$
BEGIN
  PERFORM private.transition_appointment_status_core(
    p_appointment_id,
    'waiting',
    NULL,
    TRUE
  );
END;
$function$;

REVOKE ALL ON FUNCTION private.transition_reception_appointment_to_waiting(
  BIGINT
) FROM PUBLIC, anon, authenticated, app_prontomedic,
  prontomedic_reception_rpc_owner;

INSERT INTO public.prontomedic_deployment_migrations(filename)
VALUES ('20260728193000_reception_private_schedule_transition_core.sql')
ON CONFLICT (filename) DO NOTHING;
