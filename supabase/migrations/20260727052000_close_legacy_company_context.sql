BEGIN;

DO $requirements$
BEGIN
  IF to_regprocedure('public.active_company_id()') IS NULL
     OR to_regprocedure('public.current_application_session_is_active()') IS NULL THEN
    RAISE EXCEPTION
      'Legacy company context closure requires the application session foundation';
  END IF;
END;
$requirements$;

CREATE OR REPLACE FUNCTION public.current_company_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
  SELECT CASE
    WHEN public.current_application_session_is_active()
      THEN public.active_company_id()
    ELSE NULL
  END;
$function$;

COMMENT ON FUNCTION public.current_company_id() IS
  'Returns the company from the active application session; fails closed for missing, expired, revoked or ambiguous contexts.';

REVOKE ALL ON FUNCTION public.current_company_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_company_id()
  TO authenticated, app_prontomedic, prontomedic_reception_rpc_owner;

COMMIT;
