-- Keep reception exception capability on the reception-owned unit boundary.
-- Additive only. DataSIGH and external integrations are not accessed.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_reception_exception_capability(
  p_appointment_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
DECLARE
  v_actor RECORD;
  v_unit_id INTEGER;
  v_allowed BOOLEAN;
BEGIN
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  IF v_actor.user_id IS NULL OR v_actor.company_id IS NULL THEN
    RAISE EXCEPTION 'Usuario autenticado sem perfil operacional';
  END IF;

  SELECT appointment.unit_id
  INTO v_unit_id
  FROM public.appointments appointment
  WHERE appointment.id = p_appointment_id
    AND appointment.company_id = v_actor.company_id
    AND appointment.unit_id IS NOT NULL
    AND private.reception_actor_can_access_unit(
      appointment.company_id,
      appointment.unit_id
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento fora do escopo da recepcao';
  END IF;

  v_allowed := private.reception_can_release_exception(
    v_actor.user_id,
    v_actor.company_id,
    v_unit_id,
    v_actor.role_name
  );

  RETURN jsonb_build_object(
    'appointment_id', p_appointment_id,
    'unit_id', v_unit_id,
    'allowed', COALESCE(v_allowed, FALSE)
  );
END;
$function$;

ALTER FUNCTION public.get_reception_exception_capability(BIGINT)
  OWNER TO prontomedic_reception_rpc_owner;

REVOKE ALL ON FUNCTION public.get_reception_exception_capability(BIGINT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_reception_exception_capability(BIGINT)
  TO authenticated, app_prontomedic;

COMMIT;
