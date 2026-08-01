-- Route reception check-in through the canonical scheduling status transition.

CREATE OR REPLACE FUNCTION public.update_appointment_status_secure(
  p_appointment_id BIGINT,
  p_new_status TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS public.appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_company_id UUID := public.active_company_id();
  v_unit_id INTEGER := public.active_unit_id();
  v_old public.appointments%ROWTYPE;
  v_row public.appointments%ROWTYPE;
  v_reason TEXT := NULLIF(trim(COALESCE(p_reason, '')), '');
  v_reception_waiting BOOLEAN :=
    p_new_status = 'waiting'
    AND public.can_access('recepcao', 'edit');
BEGIN
  IF v_company_id IS NULL
     OR v_unit_id IS NULL
     OR NOT (
       public.can_access('agenda', 'edit')
       OR v_reception_waiting
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

REVOKE ALL ON FUNCTION public.update_appointment_status_secure(
  BIGINT, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_appointment_status_secure(
  BIGINT, TEXT, TEXT
) TO authenticated, prontomedic_reception_rpc_owner;

CREATE OR REPLACE FUNCTION private.reception_mark_appointment_waiting(
  p_appointment_id BIGINT,
  p_reason TEXT
)
RETURNS public.appointments
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT public.update_appointment_status_secure(
    p_appointment_id,
    'waiting',
    p_reason
  );
$function$;

ALTER FUNCTION private.reception_mark_appointment_waiting(
  BIGINT, TEXT
) OWNER TO prontomedic_reception_rpc_owner;

REVOKE ALL ON FUNCTION private.reception_mark_appointment_waiting(
  BIGINT, TEXT
) FROM PUBLIC, anon, authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION private.reception_mark_appointment_waiting(
  BIGINT, TEXT
) TO prontomedic_reception_rpc_owner;

DROP POLICY IF EXISTS appointments_reception_rpc_select
  ON public.appointments;
DROP POLICY IF EXISTS appointments_reception_rpc_update
  ON public.appointments;
DROP POLICY IF EXISTS appointments_reception_rpc_lock
  ON public.appointments;

REVOKE UPDATE (status, notes, updated_at) ON public.appointments
  FROM prontomedic_reception_rpc_owner;

INSERT INTO public.prontomedic_deployment_migrations(filename)
VALUES ('20260728183000_reception_use_canonical_schedule_transition.sql')
ON CONFLICT (filename) DO NOTHING;
