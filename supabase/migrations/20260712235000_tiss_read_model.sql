-- Tenant-safe, read-only projection for canonical TISS billing references.
-- No TISS payload is generated, changed, or transmitted by this migration.

CREATE OR REPLACE FUNCTION public.list_tiss_read_model_secure(
  p_year INTEGER DEFAULT NULL,
  p_month INTEGER DEFAULT NULL,
  p_insurance_company_id INTEGER DEFAULT NULL
)
RETURNS TABLE(
  tiss_xml_id BIGINT,
  billing_id BIGINT,
  appointment_id BIGINT,
  patient_id BIGINT,
  insurance_plan_id INTEGER,
  insurance_company_id INTEGER,
  insurance_company_name VARCHAR(100),
  insurance_plan_name VARCHAR(100),
  billing_amount NUMERIC,
  tiss_created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_company_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticacao obrigatoria para consultar TISS'
      USING ERRCODE = '42501';
  END IF;

  v_company_id := public.get_my_company_id();
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Perfil autenticado sem empresa para consultar TISS'
      USING ERRCODE = '42501';
  END IF;

  IF p_month IS NOT NULL AND (p_month < 1 OR p_month > 12) THEN
    RAISE EXCEPTION 'Mes TISS invalido: %', p_month
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    tiss.id,
    tiss.billing_id,
    tiss.appointment_id,
    tiss.patient_id,
    tiss.insurance_plan_id,
    plan.insurance_company_id,
    operator.name,
    plan.name,
    billing.amount,
    tiss.created_at
  FROM public.tiss_xml AS tiss
  LEFT JOIN public.billings AS billing
    ON billing.id = tiss.billing_id
   AND billing.company_id = tiss.company_id
  LEFT JOIN public.insurance_plans AS plan
    ON plan.id = tiss.insurance_plan_id
   AND plan.company_id = tiss.company_id
  LEFT JOIN public.insurance_companies AS operator
    ON operator.id = plan.insurance_company_id
   AND operator.company_id = plan.company_id
  WHERE tiss.company_id = v_company_id
    AND (p_year IS NULL OR EXTRACT(YEAR FROM tiss.created_at)::INTEGER = p_year)
    AND (p_month IS NULL OR EXTRACT(MONTH FROM tiss.created_at)::INTEGER = p_month)
    AND (
      p_insurance_company_id IS NULL
      OR plan.insurance_company_id = p_insurance_company_id
    )
  ORDER BY tiss.created_at DESC, tiss.id DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_tiss_read_model_secure(INTEGER, INTEGER, INTEGER)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_tiss_read_model_secure(INTEGER, INTEGER, INTEGER)
  TO authenticated;

COMMENT ON FUNCTION public.list_tiss_read_model_secure(INTEGER, INTEGER, INTEGER) IS
  'Read-only tenant-scoped TISS billing projection; operator is derived through insurance_plan_id.';
