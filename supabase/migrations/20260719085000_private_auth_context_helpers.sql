-- Private, non-privileged context helpers used by Module 2 policies.
-- They expose no data and delegate company resolution to the existing
-- tenant helper; authorization remains enforced by the calling policy.

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated, app_prontomedic;

CREATE OR REPLACE FUNCTION private.current_user_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  SELECT auth.uid();
$$;

CREATE OR REPLACE FUNCTION private.current_company_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  SELECT public.current_company_id();
$$;

REVOKE ALL ON FUNCTION private.current_user_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.current_company_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.current_user_id() TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION private.current_company_id() TO authenticated, app_prontomedic;

COMMIT;
