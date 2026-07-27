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

CREATE OR REPLACE FUNCTION public.is_admin(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
  SELECT COALESCE(
    p_user_id = auth.uid()
    AND public.current_application_session_is_active()
    AND public.current_context_is_company_admin(public.active_company_id()),
    FALSE
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_staff(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
  SELECT COALESCE(
    p_user_id = auth.uid()
    AND public.current_application_session_is_active()
    AND public.active_company_id() IS NOT NULL,
    FALSE
  );
$function$;

COMMENT ON FUNCTION public.is_admin(UUID) IS
  'Validates the administrative role selected in the active AAL2 application context.';
COMMENT ON FUNCTION public.is_staff(UUID) IS
  'Validates identity and an active application context before granting staff compatibility.';

-- The local gateway executes client queries with SET LOCAL ROLE authenticated.
-- NOINHERIT keeps the application connection privileged only after that
-- explicit role switch.
GRANT authenticated TO app_prontomedic;

-- Retire the unused request.jwt.claim.company_id GUC as a tenant authority.
-- The signed session id and persisted access context are the single source of
-- truth for both direct backend policies and authenticated RPCs.
CREATE OR REPLACE FUNCTION public.request_company_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
  SELECT public.current_company_id();
$function$;

ALTER FUNCTION public.request_company_id() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.current_company_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_company_id()
  TO authenticated, app_prontomedic, prontomedic_reception_rpc_owner;

REVOKE ALL ON FUNCTION public.is_admin(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_staff(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin(UUID)
  TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.is_staff(UUID)
  TO authenticated, app_prontomedic;

REVOKE ALL ON FUNCTION public.request_company_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_company_id()
  TO authenticated,
     app_prontomedic,
     prontomedic_lis_rpc_owner,
     prontomedic_tiss_rpc_owner;

-- Policies installed for the direct backend role call these helpers. Keep the
-- grants explicit because earlier closures revoke PUBLIC and portal access.
GRANT EXECUTE ON FUNCTION public.active_company_id()
  TO app_prontomedic;
GRANT EXECUTE ON FUNCTION public.active_unit_id()
  TO app_prontomedic;
GRANT EXECUTE ON FUNCTION public.can_access(TEXT, TEXT)
  TO app_prontomedic;

DO $runtime_policy_acl$
BEGIN
  IF NOT EXISTS (
       SELECT 1
         FROM pg_auth_members membership
         JOIN pg_roles granted_role
           ON granted_role.oid = membership.roleid
         JOIN pg_roles member_role
           ON member_role.oid = membership.member
        WHERE granted_role.rolname = 'authenticated'
          AND member_role.rolname = 'app_prontomedic'
     )
     OR NOT has_function_privilege(
       'app_prontomedic',
       'public.active_company_id()',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'app_prontomedic',
       'public.active_unit_id()',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'app_prontomedic',
       'public.can_access(text,text)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'app_prontomedic',
       'public.request_company_id()',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       'public.request_company_id()',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'Direct backend role membership or policy helper ACL is incomplete';
  END IF;
END
$runtime_policy_acl$;

COMMIT;
