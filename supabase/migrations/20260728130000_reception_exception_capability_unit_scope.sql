-- Keep reception exception capability on the reception-owned unit boundary.
-- Additive only. DataSIGH and external integrations are not accessed.

BEGIN;

CREATE OR REPLACE FUNCTION private.reception_actor_has_selected_unit(
  p_company_id UUID,
  p_unit_id INTEGER
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
SET row_security = off
AS $function$
  SELECT p_company_id IS NOT NULL
    AND p_unit_id IS NOT NULL
    AND public.current_application_session_is_active()
    AND EXISTS (
      SELECT 1
      FROM public.user_access_context access_context
      JOIN public.memberships membership
        ON membership.id = access_context.membership_id
       AND membership.user_id = access_context.user_id
       AND membership.status = 'active'
      WHERE access_context.user_id = auth.uid()
        AND access_context.session_id =
          NULLIF(auth.jwt()->>'session_id', '')::UUID
        AND membership.company_id = p_company_id
        AND access_context.unit_id = p_unit_id
    );
$function$;

ALTER FUNCTION private.reception_actor_has_selected_unit(UUID, INTEGER)
  OWNER TO prontomedic_reception_rpc_owner;

REVOKE ALL ON FUNCTION private.reception_actor_has_selected_unit(UUID, INTEGER)
  FROM PUBLIC, anon, authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION private.reception_actor_has_selected_unit(UUID, INTEGER)
  TO prontomedic_reception_rpc_owner;

DROP POLICY IF EXISTS appointments_reception_rpc_select
  ON public.appointments;
CREATE POLICY appointments_reception_rpc_select
  ON public.appointments
  FOR SELECT TO prontomedic_reception_rpc_owner
  USING (
    private.reception_actor_can_access_unit(company_id, unit_id)
  );

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
    AND private.reception_actor_has_selected_unit(
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
