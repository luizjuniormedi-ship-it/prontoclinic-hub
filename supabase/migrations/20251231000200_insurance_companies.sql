-- =============================================================================
-- Migration: 20260101000002_insurance_companies
-- Descrição: Tabela de Convênios (espelha SIGH.convenios)
--            992 registros no SIGH: UNIMED, AMIL, BRADESCO, SULAMERICA, etc
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.insurance_companies (
  id SERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  payment_source_id INTEGER REFERENCES public.payment_sources(id) ON DELETE SET NULL,
  name VARCHAR(100) NOT NULL,
  registro_ans VARCHAR(20),
  cnpj VARCHAR(14),
  razao_social VARCHAR(150),
  endereco TEXT,
  bairro VARCHAR(50),
  cidade VARCHAR(50),
  uf CHAR(2),
  cep VARCHAR(10),
  contato VARCHAR(100),
  telefone1 VARCHAR(20),
  telefone2 VARCHAR(20),
  telefone3 VARCHAR(20),
  login_prestador VARCHAR(50),
  senha_prestador VARCHAR(50),
  codigo_prestador VARCHAR(15) DEFAULT '1',
  percentual_desconto DECIMAL(5,2) DEFAULT 0,
  dias_validade_senha INTEGER DEFAULT 0,
  tabela_mat CHAR(2),
  tabela_med CHAR(2),
  tabela_taxa CHAR(2),
  tabela_servico CHAR(2),
  tabela_gases CHAR(2),
  tabela_diaria CHAR(2),
  cod_auxiliar1 VARCHAR(20),
  cod_auxiliar2 VARCHAR(20),
  cod_auxiliar3 VARCHAR(20),
  cod_auxiliar4 VARCHAR(20),
  cod_anestesista VARCHAR(20),
  tam_matricula SMALLINT,
  tam_autorizacao SMALLINT,
  tam_guia SMALLINT,
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  lg_guia_obrigatoria BOOLEAN DEFAULT TRUE,
  lg_cid_obrigatorio BOOLEAN DEFAULT TRUE,
  lg_matric_obrigatorio BOOLEAN DEFAULT FALSE,
  lg_autorizac_obrigatorio BOOLEAN DEFAULT FALSE,
  lg_validade_matricula BOOLEAN DEFAULT FALSE,
  lg_guia_automatico BOOLEAN DEFAULT FALSE,
  lg_guia_auto_lancamento BOOLEAN DEFAULT FALSE,
  lg_tipo_atend_automatico BOOLEAN DEFAULT FALSE,
  lg_val_matricula BOOLEAN DEFAULT FALSE,
  lg_val_autorizacao BOOLEAN DEFAULT FALSE,
  lg_verificar_associacao BOOLEAN DEFAULT FALSE,
  lg_avisar_matricula BOOLEAN DEFAULT FALSE,
  lg_atualizar_matricula BOOLEAN DEFAULT FALSE,
  logo_url TEXT,
  observacao TEXT,
  cd_origem_sigh INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_insurance_companies_company ON public.insurance_companies(company_id);
CREATE INDEX idx_insurance_companies_ans ON public.insurance_companies(registro_ans);
CREATE INDEX idx_insurance_companies_payment_source ON public.insurance_companies(payment_source_id);
CREATE INDEX idx_insurance_companies_active ON public.insurance_companies(company_id, lg_ativo);
CREATE INDEX idx_insurance_companies_name ON public.insurance_companies USING gin(name gin_trgm_ops);

COMMENT ON TABLE public.insurance_companies IS 'Convenios (SIGH.convenios): UNIMED, AMIL, BRADESCO, SULAMERICA, PARTICULAR, SUS, etc';
COMMENT ON COLUMN public.insurance_companies.registro_ans IS 'Registro ANS (Agencia Nacional de Saude Suplementar)';
COMMENT ON COLUMN public.insurance_companies.cd_origem_sigh IS 'ID original do SIGH (convenios.CD_CONVENIO)';

CREATE TRIGGER trg_insurance_companies_updated_at
  BEFORE UPDATE ON public.insurance_companies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.insurance_companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read insurance_companies from their company"
  ON public.insurance_companies FOR SELECT
  TO authenticated
  USING (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

CREATE POLICY "Admins and reception can manage insurance_companies"
  ON public.insurance_companies FOR ALL
  TO authenticated
  USING (
    company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role_name IN ('admin', 'reception', 'financial')
    )
  )
  WITH CHECK (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

-- Funcao de validacao: convenio do tipo CONVENIO exige registro_ans
CREATE OR REPLACE FUNCTION public.validate_insurance_company()
RETURNS TRIGGER AS $$
DECLARE
  v_type VARCHAR(20);
BEGIN
  IF NEW.payment_source_id IS NOT NULL THEN
    SELECT type INTO v_type FROM public.payment_sources WHERE id = NEW.payment_source_id;
    IF v_type = 'CONVENIO' AND (NEW.registro_ans IS NULL OR NEW.registro_ans = '') THEN
      RAISE EXCEPTION 'Convenio do tipo CONVENIO exige registro_ans preenchido';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validate_insurance_company
  BEFORE INSERT OR UPDATE ON public.insurance_companies
  FOR EACH ROW EXECUTE FUNCTION public.validate_insurance_company();