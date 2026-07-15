-- =============================================================================
-- Migration: 20260101000003_insurance_plans
-- Descrição: Planos dentro de cada Convênio (espelha SIGH.convenio_planos)
--            395 registros no SIGH: PADRAO, AMBULATORIAL, ESSENCIAL, etc
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.insurance_plans (
  id SERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  insurance_company_id INTEGER NOT NULL REFERENCES public.insurance_companies(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  codigo VARCHAR(20),
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  lg_coparticipacao BOOLEAN DEFAULT FALSE,
  percentual_coparticipacao DECIMAL(5,2) DEFAULT 0,
  valor_coparticipacao DECIMAL(10,2) DEFAULT 0,
  dias_carencia_consulta INTEGER DEFAULT 0,
  dias_carencia_exame INTEGER DEFAULT 0,
  dias_carencia_internacao INTEGER DEFAULT 0,
  tipo_acomodacao VARCHAR(20) CHECK (tipo_acomodacao IN ('ENFERMARIA', 'APARTAMENTO', 'AMBULATORIAL', 'HOME_CARE', NULL)),
  limite_mensal DECIMAL(10,2),
  limite_anual DECIMAL(10,2),
  cd_origem_sigh INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_insurance_plans_company ON public.insurance_plans(company_id);
CREATE INDEX idx_insurance_plans_insurance ON public.insurance_plans(insurance_company_id);
CREATE INDEX idx_insurance_plans_active ON public.insurance_plans(company_id, lg_ativo);

COMMENT ON TABLE public.insurance_plans IS 'Planos dentro de cada Convenio (SIGH.convenio_planos)';
COMMENT ON COLUMN public.insurance_plans.codigo IS 'Codigo do plano na operadora (ex: 0003604)';
COMMENT ON COLUMN public.insurance_plans.cd_origem_sigh IS 'ID original do SIGH (convenio_planos.CD_PLANO)';

CREATE TRIGGER trg_insurance_plans_updated_at
  BEFORE UPDATE ON public.insurance_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.insurance_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read insurance_plans from their company"
  ON public.insurance_plans FOR SELECT
  TO authenticated
  USING (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

CREATE POLICY "Admins and reception can manage insurance_plans"
  ON public.insurance_plans FOR ALL
  TO authenticated
  USING (
    company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role_name IN ('admin', 'reception', 'financial')
    )
  )
  WITH CHECK (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));