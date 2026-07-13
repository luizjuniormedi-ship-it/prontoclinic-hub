-- Least-privilege read model for the billable production page.

ALTER TABLE public.billings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS billings_financial_read_defense ON public.billings;
CREATE POLICY billings_financial_read_defense
  ON public.billings
  FOR SELECT
  TO authenticated
  USING (
    (SELECT auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.user_profiles AS actor
      WHERE actor.id = (SELECT auth.uid())
        AND actor.company_id = billings.company_id
        AND COALESCE(actor.lg_ativo, FALSE) = TRUE
        AND lower(COALESCE(actor.role_name, '')) IN (
          'admin', 'administrador', 'gestor', 'financeiro', 'faturamento'
        )
    )
  );

-- Browser clients must use the permission-checked RPC, not the base table.
REVOKE SELECT ON TABLE public.billings FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.billings FROM anon;

CREATE OR REPLACE FUNCTION public.list_billing_production_secure()
RETURNS TABLE(
  id BIGINT,
  company_id UUID,
  patient_id BIGINT,
  appointment_id BIGINT,
  amount NUMERIC,
  status VARCHAR(20),
  guide_number VARCHAR(120),
  tiss_status VARCHAR(40),
  created_at TIMESTAMPTZ,
  patient_name VARCHAR(200),
  professional_name VARCHAR(200)
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_company_id UUID;
BEGIN
  SELECT actor.company_id
    INTO v_company_id
    FROM public.user_profiles AS actor
   WHERE actor.id = auth.uid()
     AND actor.company_id IS NOT NULL
     AND COALESCE(actor.lg_ativo, FALSE) = TRUE
     AND lower(COALESCE(actor.role_name, '')) IN (
       'admin', 'administrador', 'gestor', 'financeiro', 'faturamento'
     )
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Perfil ativo sem permissao para consultar producao faturavel'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    billing.id,
    billing.company_id,
    billing.patient_id,
    billing.appointment_id,
    billing.amount,
    billing.status,
    billing.guide_number,
    billing.tiss_status,
    billing.created_at,
    patient.full_name,
    professional.full_name
  FROM public.billings AS billing
  LEFT JOIN public.appointments AS appointment
    ON appointment.id = billing.appointment_id
   AND appointment.company_id = billing.company_id
   AND appointment.patient_id = billing.patient_id
  LEFT JOIN public.patients AS patient
    ON patient.id = appointment.patient_id
   AND patient.company_id = appointment.company_id
  LEFT JOIN public.professionals AS professional
    ON professional.id = appointment.professional_id
   AND professional.company_id = appointment.company_id
  WHERE billing.company_id = v_company_id
    AND COALESCE(billing.lg_ativo, FALSE) = TRUE
  ORDER BY billing.created_at DESC, billing.id DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_billing_production_secure() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_billing_production_secure() TO authenticated;


