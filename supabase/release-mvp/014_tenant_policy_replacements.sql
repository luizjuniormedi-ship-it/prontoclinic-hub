-- MVP release baseline: tenant-aware policies after RLS is enabled.
-- MVP data tables use tenant-scoped predicates.
ALTER TABLE public.insurance_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_eligibility_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billings ENABLE ROW LEVEL SECURITY;

CREATE POLICY mvp_insurance_authorizations_tenant
  ON public.insurance_authorizations FOR ALL TO authenticated
  USING (company_id = public.get_my_company_id())
  WITH CHECK (company_id = public.get_my_company_id());
CREATE POLICY mvp_insurance_eligibility_tenant
  ON public.insurance_eligibility_checks FOR ALL TO authenticated
  USING (company_id = public.get_my_company_id())
  WITH CHECK (company_id = public.get_my_company_id());
CREATE POLICY mvp_billings_tenant
  ON public.billings FOR ALL TO authenticated
  USING (company_id = public.get_my_company_id())
  WITH CHECK (company_id = public.get_my_company_id());
