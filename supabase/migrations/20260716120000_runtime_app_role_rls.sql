-- Runtime tenant isolation for the direct PostgreSQL application role.
-- The VPS proxy connects as app_prontomedic, not PostgREST's authenticated role.
-- The backend must set request.jwt.claim.company_id inside each transaction.
BEGIN;

CREATE OR REPLACE FUNCTION public.request_company_id()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.company_id', true), '')::UUID
$$;

REVOKE ALL ON FUNCTION public.request_company_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_company_id() TO app_prontomedic;

ALTER TABLE public.billings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tiss_xml ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tiss_xml FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  policy RECORD;
BEGIN
  FOR policy IN
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('billings', 'tiss_xml')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy.policyname, policy.tablename);
  END LOOP;
END
$$;

CREATE POLICY runtime_billings_tenant
  ON public.billings
  FOR ALL TO app_prontomedic
  USING (company_id = public.request_company_id())
  WITH CHECK (company_id = public.request_company_id());

CREATE POLICY runtime_tiss_xml_tenant
  ON public.tiss_xml
  FOR ALL TO app_prontomedic
  USING (company_id = public.request_company_id())
  WITH CHECK (company_id = public.request_company_id());

COMMIT;
