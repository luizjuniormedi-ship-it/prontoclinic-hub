-- Recreate both entrypoints so PostgreSQL cannot retain an older public body.

DROP FUNCTION IF EXISTS private.transition_reception_appointment_to_waiting(
  BIGINT
);
DROP FUNCTION public.update_appointment_status_secure(
  BIGINT, TEXT, TEXT
);

CREATE FUNCTION public.update_appointment_status_secure(
  p_appointment_id BIGINT,
  p_new_status TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS public.appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, auth
SET row_security = off
AS $function$
BEGIN
  IF p_new_status = 'waiting' THEN
    RAISE EXCEPTION
      'Entrada em espera exige o workflow transacional da recepcao'
      USING ERRCODE = '42501';
  END IF;

  RETURN private.transition_appointment_status_core(
    p_appointment_id,
    p_new_status,
    p_reason,
    FALSE
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.update_appointment_status_secure(
  BIGINT, TEXT, TEXT
) FROM PUBLIC, anon, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.update_appointment_status_secure(
  BIGINT, TEXT, TEXT
) TO authenticated, prontomedic_reception_rpc_owner;

CREATE FUNCTION private.transition_reception_appointment_to_waiting(
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

DO $assert$
DECLARE
  v_definition TEXT;
BEGIN
  SELECT pg_get_functiondef(
    'public.update_appointment_status_secure(bigint,text,text)'::regprocedure
  )
  INTO v_definition;

  IF position(
    'IF p_new_status = ''waiting''' IN v_definition
  ) = 0 OR position(
    'ERRCODE = ''42501''' IN v_definition
  ) = 0 THEN
    RAISE EXCEPTION
      'Public schedule transition did not retain the waiting veto';
  END IF;
END;
$assert$;

INSERT INTO public.prontomedic_deployment_migrations(filename)
VALUES ('20260728194500_reception_recreate_schedule_entrypoints.sql')
ON CONFLICT (filename) DO NOTHING;
