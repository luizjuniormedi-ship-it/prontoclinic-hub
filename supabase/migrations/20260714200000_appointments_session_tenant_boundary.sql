-- Enforce that appointment writes use the authenticated session tenant.
-- The client may submit p_company_id for legacy compatibility, but it can never
-- select a tenant different from auth.uid() -> user_profiles.company_id.

CREATE OR REPLACE FUNCTION public.enforce_appointment_session_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $f1$
DECLARE
  v_company_id UUID;
  v_jwt_role TEXT := current_setting('request.jwt.claim.role', TRUE);
BEGIN
  IF v_jwt_role = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'usuario nao autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT up.company_id
    INTO STRICT v_company_id
  FROM public.user_profiles up
  WHERE up.id = auth.uid()
    AND up.lg_ativo = TRUE;

  IF NEW.company_id IS DISTINCT FROM v_company_id THEN
    RAISE EXCEPTION 'tenant do agendamento difere do tenant da sessao'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    RAISE EXCEPTION 'usuario sem empresa associada' USING ERRCODE = '42501';
  WHEN TOO_MANY_ROWS THEN
    RAISE EXCEPTION 'identidade do usuario ambigua' USING ERRCODE = '42501';
END
$f1$;

DROP TRIGGER IF EXISTS trg_appointments_session_tenant ON public.appointments;
CREATE TRIGGER trg_appointments_session_tenant
  BEFORE INSERT OR UPDATE OF company_id ON public.appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_appointment_session_tenant();

REVOKE ALL ON FUNCTION public.enforce_appointment_session_tenant() FROM PUBLIC, anon, authenticated;
