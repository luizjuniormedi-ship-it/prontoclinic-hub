-- Restrict the reception status transition to one appointment per transaction.

CREATE OR REPLACE FUNCTION private.reception_mark_appointment_waiting(
  p_appointment_id BIGINT,
  p_reason TEXT
)
RETURNS public.appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
DECLARE
  v_company_id UUID := public.active_company_id();
  v_unit_id INTEGER := public.active_unit_id();
  v_actor_id UUID := public.audit_current_user_id();
  v_old public.appointments;
  v_row public.appointments;
BEGIN
  IF v_company_id IS NULL OR v_unit_id IS NULL OR v_actor_id IS NULL THEN
    RAISE EXCEPTION
      'Reception appointment transition requires active authenticated context';
  END IF;

  PERFORM set_config(
    'app.reception.appointment_id',
    p_appointment_id::TEXT,
    TRUE
  );
  PERFORM set_config(
    'app.reception.company_id',
    v_company_id::TEXT,
    TRUE
  );
  PERFORM set_config(
    'app.reception.unit_id',
    v_unit_id::TEXT,
    TRUE
  );

  SELECT *
    INTO v_old
    FROM public.appointments appointment
   WHERE appointment.id = p_appointment_id
     AND appointment.company_id = v_company_id
     AND appointment.unit_id = v_unit_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Reception appointment not found in active context [role=%, appointment_cap=%, company_cap=%, unit_cap=%]',
      current_user,
      current_setting('app.reception.appointment_id', TRUE),
      current_setting('app.reception.company_id', TRUE),
      current_setting('app.reception.unit_id', TRUE);
  END IF;

  IF NOT public.can_transition_appointment_status(v_old.status, 'waiting') THEN
    RAISE EXCEPTION
      'Reception invalid status transition: % -> waiting',
      v_old.status;
  END IF;

  UPDATE public.appointments
     SET status = 'waiting',
         notes = COALESCE(
           NULLIF(trim(COALESCE(p_reason, '')), ''),
           notes
         ),
         updated_at = now()
   WHERE id = v_old.id
     AND company_id = v_company_id
     AND unit_id = v_unit_id
  RETURNING * INTO v_row;

  INSERT INTO public.scheduling_status_history(
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
    NULLIF(trim(COALESCE(p_reason, '')), ''),
    v_actor_id
  );

  RETURN v_row;
END;
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
CREATE POLICY appointments_reception_rpc_select
  ON public.appointments
  FOR SELECT TO prontomedic_reception_rpc_owner
  USING (
    id = NULLIF(
      current_setting('app.reception.appointment_id', TRUE),
      ''
    )::BIGINT
    AND company_id = NULLIF(
      current_setting('app.reception.company_id', TRUE),
      ''
    )::UUID
    AND unit_id = NULLIF(
      current_setting('app.reception.unit_id', TRUE),
      ''
    )::INTEGER
  );

DROP POLICY IF EXISTS appointments_reception_rpc_update
  ON public.appointments;
CREATE POLICY appointments_reception_rpc_update
  ON public.appointments
  FOR UPDATE TO prontomedic_reception_rpc_owner
  USING (
    id = NULLIF(
      current_setting('app.reception.appointment_id', TRUE),
      ''
    )::BIGINT
    AND company_id = NULLIF(
      current_setting('app.reception.company_id', TRUE),
      ''
    )::UUID
    AND unit_id = NULLIF(
      current_setting('app.reception.unit_id', TRUE),
      ''
    )::INTEGER
  )
  WITH CHECK (
    id = NULLIF(
      current_setting('app.reception.appointment_id', TRUE),
      ''
    )::BIGINT
    AND company_id = NULLIF(
      current_setting('app.reception.company_id', TRUE),
      ''
    )::UUID
    AND unit_id = NULLIF(
      current_setting('app.reception.unit_id', TRUE),
      ''
    )::INTEGER
  );

INSERT INTO public.prontomedic_deployment_migrations(filename)
VALUES ('20260728173000_reception_appointment_transaction_capability.sql')
ON CONFLICT (filename) DO NOTHING;
