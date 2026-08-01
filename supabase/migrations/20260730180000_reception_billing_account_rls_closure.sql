BEGIN;

-- Remove permissive company-wide reads. Billing data is always scoped to the
-- active unit and requires an explicit reception or billing capability.
DROP POLICY IF EXISTS billing_accounts_authenticated_read
  ON public.billing_accounts;
DROP POLICY IF EXISTS billing_accounts_runtime_read
  ON public.billing_accounts;

CREATE POLICY billing_accounts_authenticated_read
  ON public.billing_accounts
  FOR SELECT TO authenticated
  USING (
    company_id = public.current_company_id()
    AND unit_id = public.active_unit_id()
    AND (
      public.can_access('recepcao', 'view')
      OR public.can_access('faturamento', 'view')
    )
  );

CREATE POLICY billing_accounts_runtime_read
  ON public.billing_accounts
  FOR SELECT TO app_prontomedic
  USING (
    company_id = public.current_company_id()
    AND unit_id = public.active_unit_id()
    AND (
      public.can_access('recepcao', 'view')
      OR public.can_access('faturamento', 'view')
    )
  );

DO $$
DECLARE
  v_policy_count INTEGER;
BEGIN
  SELECT count(*)
    INTO v_policy_count
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename = 'billing_accounts'
     AND policyname IN (
       'billing_accounts_authenticated_read',
       'billing_accounts_runtime_read'
     )
     AND qual ILIKE '%active_unit_id%'
     AND qual ILIKE '%can_access%';

  IF v_policy_count <> 2 THEN
    RAISE EXCEPTION
      'RECEPTION_RLS_CONTRACT: billing account read policies are not unit and capability scoped';
  END IF;
END
$$;

COMMIT;
