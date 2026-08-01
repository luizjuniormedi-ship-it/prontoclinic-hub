-- Shared payer catalog used by Reception and Billing.
-- Keep writes behind the existing tenant-aware policy; only restore runtime reads.

ALTER TABLE public.payment_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_sources_authenticated_select
  ON public.payment_sources;
CREATE POLICY payment_sources_authenticated_select
  ON public.payment_sources
  FOR SELECT
  TO authenticated
  USING (
    company_id = public.active_company_id()
    AND (
      public.can_access('recepcao', 'view')
      OR public.can_access('faturamento', 'view')
    )
  );

REVOKE ALL ON TABLE public.payment_sources FROM anon;
GRANT SELECT ON TABLE public.payment_sources TO authenticated;
