-- =============================================================================
-- Migration: 20260101000030_professional_payments
-- Descrição: Tabela de repasses/produção médica por profissional.
--            Espelha SIGH.finrepasse (repasse médico).
--            Substitui o mock api.getProfessionalPayments() que retornava
--            dados fixos via setTimeout.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.professional_payments (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_professional INTEGER NOT NULL REFERENCES public.professionals(id) ON DELETE CASCADE,
  cd_unit INTEGER REFERENCES public.units(id) ON DELETE SET NULL,
  dt_reference DATE NOT NULL,                       -- mês/ano de referência
  ds_reference VARCHAR(200),                        -- descrição (ex: "Produção Jan/2026")
  total_procedures INTEGER DEFAULT 0,                -- qtd de procedimentos
  total_value DECIMAL(12,2) NOT NULL DEFAULT 0,      -- valor total a pagar
  total_received DECIMAL(12,2) DEFAULT 0,            -- valor já recebido
  tp_remuneration VARCHAR(20) CHECK (tp_remuneration IN ('FIXED', 'PACKAGE', 'CH', 'PERCENTAGE')) DEFAULT 'PERCENTAGE',
  percentage DECIMAL(5,2) DEFAULT 0,                 -- % sobre produção (se PERCENTAGE)
  status VARCHAR(20) NOT NULL DEFAULT 'apurado' CHECK (status IN ('apurado', 'conferido', 'pago', 'cancelado')),
  dt_pago DATE,                                      -- data do pagamento
  ds_observacao TEXT,
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  cd_origem_sigh INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_professional_payments_company ON public.professional_payments(company_id);
CREATE INDEX IF NOT EXISTS idx_professional_payments_professional ON public.professional_payments(cd_professional);
CREATE INDEX IF NOT EXISTS idx_professional_payments_unit ON public.professional_payments(cd_unit);
CREATE INDEX IF NOT EXISTS idx_professional_payments_status ON public.professional_payments(company_id, status);
CREATE INDEX IF NOT EXISTS idx_professional_payments_reference ON public.professional_payments(company_id, dt_reference DESC);
CREATE INDEX IF NOT EXISTS idx_professional_payments_active ON public.professional_payments(company_id, lg_ativo);

COMMENT ON TABLE public.professional_payments IS 'Repasses/produção médica por profissional (SIGH.finrepasse)';

DROP TRIGGER IF EXISTS trg_professional_payments_updated_at ON public.professional_payments;
CREATE TRIGGER trg_professional_payments_updated_at
  BEFORE UPDATE ON public.professional_payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.professional_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "prof_payments_select" ON public.professional_payments;
CREATE POLICY "prof_payments_select" ON public.professional_payments FOR SELECT TO authenticated
  USING (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "prof_payments_financial" ON public.professional_payments;
CREATE POLICY "prof_payments_financial" ON public.professional_payments FOR ALL TO authenticated
  USING (
    company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role_name IN ('admin', 'financial')
    )
  )
  WITH CHECK (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

-- Grants
GRANT SELECT ON public.professional_payments TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.professional_payments_id_seq TO authenticated;