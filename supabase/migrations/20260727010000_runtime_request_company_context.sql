-- Shared tenant context used by the direct PostgreSQL application role.
-- The proxy sets request.jwt.claim.company_id inside each transaction.

BEGIN;

DO $$
BEGIN
  IF to_regrole('app_prontomedic') IS NULL THEN
    RAISE EXCEPTION
      'Required runtime role app_prontomedic is missing. Provision it before applying migrations.';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.request_company_id()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.company_id', true), '')::UUID
$$;

REVOKE ALL ON FUNCTION public.request_company_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_company_id() TO app_prontomedic;

COMMIT;
