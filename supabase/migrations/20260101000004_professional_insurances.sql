-- =============================================================================
-- Migration: 20260101000004_professional_insurances
-- Descrição: Credenciamento de profissionais em convênios (espelha SIGH.convxmedi)
--            48.173 registros no SIGH: quem atende em qual convenio
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.professional_insurances (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  professional_id BIGINT NOT NULL REFERENCES public.professionals(id) ON DELETE CASCADE,
  insurance_company_id INTEGER NOT NULL REFERENCES public.insurance_companies(id) ON DELETE CASCADE,
  lg_clinica BOOLEAN DEFAULT FALSE,
  lg_credenciado BOOLEAN DEFAULT FALSE,
  ds_observacao TEXT,
  dt_inicio_vinculo DATE,
  dt_fim_vinculo DATE,
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  cd_origem_sigh_combo VARCHAR(20),
  cd_origem_sigh BIGINT,
  cd_medico BIGINT,
  cd_convenio INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(professional_id, insurance_company_id)
);

CREATE INDEX IF NOT EXISTS idx_professional_insurances_company ON public.professional_insurances(company_id);
CREATE INDEX IF NOT EXISTS idx_professional_insurances_professional ON public.professional_insurances(professional_id);
CREATE INDEX IF NOT EXISTS idx_professional_insurances_insurance ON public.professional_insurances(insurance_company_id);
CREATE INDEX IF NOT EXISTS idx_professional_insurances_active ON public.professional_insurances(company_id, lg_ativo);

COMMENT ON TABLE public.professional_insurances IS 'Credenciamento de profissionais em convenios (SIGH.convxmedi)';

DROP TRIGGER IF EXISTS trg_professional_insurances_updated_at ON public.professional_insurances;
CREATE TRIGGER trg_professional_insurances_updated_at
  BEFORE UPDATE ON public.professional_insurances
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Cotas por convenio (espelha SIGH.agenda_ctrl)
CREATE TABLE IF NOT EXISTS public.insurance_quotas (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  insurance_company_id INTEGER NOT NULL REFERENCES public.insurance_companies(id) ON DELETE CASCADE,
  service_id BIGINT REFERENCES public.services_catalog(id) ON DELETE CASCADE,
  professional_id BIGINT REFERENCES public.professionals(id) ON DELETE CASCADE,
  quantidade_liberada INTEGER NOT NULL DEFAULT 0,
  periodo VARCHAR(1) NOT NULL CHECK (periodo IN ('D', 'M')) DEFAULT 'D',
  dt_inicio DATE NOT NULL,
  dt_fim DATE,
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_insurance_quotas_company ON public.insurance_quotas(company_id);
CREATE INDEX IF NOT EXISTS idx_insurance_quotas_insurance ON public.insurance_quotas(insurance_company_id);
CREATE INDEX IF NOT EXISTS idx_insurance_quotas_service ON public.insurance_quotas(service_id);
CREATE INDEX IF NOT EXISTS idx_insurance_quotas_professional ON public.insurance_quotas(professional_id);

COMMENT ON TABLE public.insurance_quotas IS 'Cotas de vagas por convenio/servico/medico/periodo (SIGH.agenda_ctrl)';
COMMENT ON COLUMN public.insurance_quotas.periodo IS 'D=Diario, M=Mensal';

DROP TRIGGER IF EXISTS trg_insurance_quotas_updated_at ON public.insurance_quotas;
CREATE TRIGGER trg_insurance_quotas_updated_at
  BEFORE UPDATE ON public.insurance_quotas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.professional_insurances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_quotas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read professional_insurances from their company" ON public.professional_insurances;
CREATE POLICY "Users can read professional_insurances from their company"
  ON public.professional_insurances FOR SELECT
  TO authenticated
  USING (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Admins can manage professional_insurances" ON public.professional_insurances;
CREATE POLICY "Admins can manage professional_insurances"
  ON public.professional_insurances FOR ALL
  TO authenticated
  USING (
    company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role_name IN ('admin', 'reception')
    )
  )
  WITH CHECK (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can read insurance_quotas from their company" ON public.insurance_quotas;
CREATE POLICY "Users can read insurance_quotas from their company"
  ON public.insurance_quotas FOR SELECT
  TO authenticated
  USING (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Admins can manage insurance_quotas" ON public.insurance_quotas;
CREATE POLICY "Admins can manage insurance_quotas"
  ON public.insurance_quotas FOR ALL
  TO authenticated
  USING (
    company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role_name IN ('admin', 'reception', 'financial')
    )
  )
  WITH CHECK (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));