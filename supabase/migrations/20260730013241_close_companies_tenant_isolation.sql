-- Close the company catalogue to the persisted AAL2 application context.
-- Company creation and maintenance remain backend-only administrative actions.

BEGIN;

DO $requirements$
BEGIN
  IF to_regclass('public.companies') IS NULL
     OR to_regprocedure('public.active_company_id()') IS NULL THEN
    RAISE EXCEPTION
      'Companies tenant isolation requires companies and active_company_id()';
  END IF;
END
$requirements$;

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies FORCE ROW LEVEL SECURITY;

DO $drop_company_policies$
DECLARE
  v_policy RECORD;
BEGIN
  FOR v_policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'companies'
  LOOP
    EXECUTE format(
      'DROP POLICY %I ON public.companies',
      v_policy.policyname
    );
  END LOOP;
END
$drop_company_policies$;

REVOKE ALL ON TABLE public.companies FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.companies TO authenticated;

CREATE POLICY companies_active_context_select
  ON public.companies
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND id = public.active_company_id()
  );

DO $runtime_policy$
DECLARE
  v_role NAME;
BEGIN
  FOREACH v_role IN ARRAY ARRAY[
    'app_prontomedic',
    'prontomedic_rpc_owner',
    'prontomedic_reception_rpc_owner',
    'prontomedic_tiss_rpc_owner'
  ]::NAME[]
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
      EXECUTE format(
        'CREATE POLICY companies_%s_context_select
           ON public.companies
           FOR SELECT
           TO %I
           USING (id = public.active_company_id())',
        v_role,
        v_role
      );
    END IF;
  END LOOP;
END
$runtime_policy$;

COMMENT ON POLICY companies_active_context_select ON public.companies IS
  'Authenticated users can read only the company selected in their persisted AAL2 application context.';

COMMIT;
