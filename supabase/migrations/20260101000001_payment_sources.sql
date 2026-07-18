-- =============================================================================
-- Migration: 20260101000001_payment_sources
-- Descrição: Tabela de Fonte Pagadora (espelha SIGH.fonte_pagadora)
--            PARTICULAR, SUS, CORTESIA, convênios (UNIMED, AMIL, etc)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.payment_sources (
  id SERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('SUS', 'PARTICULAR', 'CORTESIA', 'CONVENIO')),
  cnpj VARCHAR(14),
  razao_social VARCHAR(150),
  inscricao_estadual VARCHAR(20),
  inscricao_municipal VARCHAR(20),
  cd_cat_conta INTEGER,
  cd_centro_custo INTEGER,
  cd_conta_corrente INTEGER,
  dias_prazo_pgto INTEGER DEFAULT 30,
  dias_corte SMALLINT DEFAULT 0,
  dt_inicio_contrato DATE,
  dt_fim_contrato DATE,
  vl_imposto DECIMAL(5,2) DEFAULT 0,
  vl_imposto2 DECIMAL(5,2) DEFAULT 0,
  vl_imposto3 DECIMAL(5,2) DEFAULT 0,
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  lg_valor_automatico BOOLEAN DEFAULT FALSE,
  lg_gerar_conta_paciente BOOLEAN DEFAULT FALSE,
  lg_atualizar_conta_receber BOOLEAN DEFAULT FALSE,
  lg_permite_fatura_parcial BOOLEAN DEFAULT FALSE,
  lg_excluir_fatura_automatica BOOLEAN DEFAULT FALSE,
  lg_padrao_geratiss BOOLEAN DEFAULT FALSE,
  cd_origem_sigh INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_sources_company ON public.payment_sources(company_id);
CREATE INDEX IF NOT EXISTS idx_payment_sources_type ON public.payment_sources(company_id, type);
CREATE INDEX IF NOT EXISTS idx_payment_sources_active ON public.payment_sources(company_id, lg_ativo);

COMMENT ON TABLE public.payment_sources IS 'Fonte Pagadora (SIGH.fonte_pagadora): SUS, PARTICULAR, CORTESIA, Convenios';
COMMENT ON COLUMN public.payment_sources.cd_origem_sigh IS 'ID original do SIGH (fonte_pagadora.CD_FONTE_PAGADORA) para migracao';

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payment_sources_updated_at ON public.payment_sources;
CREATE TRIGGER trg_payment_sources_updated_at
  BEFORE UPDATE ON public.payment_sources
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.payment_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read payment_sources from their company" ON public.payment_sources;
CREATE POLICY "Users can read payment_sources from their company"
  ON public.payment_sources FOR SELECT
  TO authenticated
  USING (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Admins can manage payment_sources in their company" ON public.payment_sources;
CREATE POLICY "Admins can manage payment_sources in their company"
  ON public.payment_sources FOR ALL
  TO authenticated
  USING (
    company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role_name IN ('admin', 'financial')
    )
  )
  WITH CHECK (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));