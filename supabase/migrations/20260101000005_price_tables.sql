-- =============================================================================
-- Migration: 20260101000005_price_tables
-- Descrição: Tabela de Preços (Price Table) — valores por convenio/servico
--            Complementa o priceTableService existente.
--            Origem SIGH: 99pgm_medicor (3673 regras), servicos.VL_PARTICULAR
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.price_tables (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  appointment_type_id BIGINT REFERENCES public.appointment_types(id) ON DELETE CASCADE,
  service_id BIGINT REFERENCES public.services_catalog(id) ON DELETE CASCADE,
  insurance_plan_id INTEGER REFERENCES public.insurance_plans(id) ON DELETE CASCADE,
  dt_inicio DATE NOT NULL DEFAULT CURRENT_DATE,
  dt_fim DATE,
  vl_particular DECIMAL(10,2) DEFAULT 0,
  vl_convenio DECIMAL(10,2) DEFAULT 0,
  vl_material DECIMAL(10,2) DEFAULT 0,
  vl_medicamento DECIMAL(10,2) DEFAULT 0,
  vl_taxa DECIMAL(10,2) DEFAULT 0,
  vl_diaria DECIMAL(10,2) DEFAULT 0,
  vl_gases DECIMAL(10,2) DEFAULT 0,
  tp_calculo VARCHAR(20) DEFAULT 'FIXO' CHECK (tp_calculo IN ('FIXO', 'PERCENTUAL', 'COBRO')),
  percentual_acrescimo DECIMAL(5,2) DEFAULT 0,
  cd_origem_sigh BIGINT,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_tables_company ON public.price_tables(company_id);
CREATE INDEX IF NOT EXISTS idx_price_tables_service ON public.price_tables(service_id);
CREATE INDEX IF NOT EXISTS idx_price_tables_plan ON public.price_tables(insurance_plan_id);
CREATE INDEX IF NOT EXISTS idx_price_tables_active ON public.price_tables(company_id, active);
CREATE INDEX IF NOT EXISTS idx_price_tables_validity ON public.price_tables(company_id, dt_inicio, dt_fim);

COMMENT ON TABLE public.price_tables IS 'Tabela de Precos por convenio/servico (SIGH.99pgm_medicor + servicos.VL_PARTICULAR)';
COMMENT ON COLUMN public.price_tables.insurance_plan_id IS 'NULL = preco particular, preenchido = preco do convenio';
COMMENT ON COLUMN public.price_tables.cd_origem_sigh IS 'ID original do SIGH (99pgm_medicor.SOMA)';

DROP TRIGGER IF EXISTS trg_price_tables_updated_at ON public.price_tables;
CREATE TRIGGER trg_price_tables_updated_at
  BEFORE UPDATE ON public.price_tables
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- Função: buscar preço com fallback
-- 1. Preço específico do convênio
-- 2. Preço particular
-- 3. services_catalog.price
-- 4. 0
-- =============================================================================
CREATE OR REPLACE FUNCTION public.find_price(
  p_company_id UUID,
  p_service_id BIGINT,
  p_appointment_type_id BIGINT,
  p_insurance_plan_id INTEGER DEFAULT NULL
)
RETURNS TABLE (
  vl_particular DECIMAL(10,2),
  vl_convenio DECIMAL(10,2),
  vl_material DECIMAL(10,2),
  vl_medicamento DECIMAL(10,2),
  vl_taxa DECIMAL(10,2),
  vl_diaria DECIMAL(10,2),
  vl_gases DECIMAL(10,2),
  found BOOLEAN
) AS $$
BEGIN
  -- 1. Convenio especifico
  RETURN QUERY
  SELECT pt.vl_particular, pt.vl_convenio, pt.vl_material, pt.vl_medicamento,
         pt.vl_taxa, pt.vl_diaria, pt.vl_gases, TRUE
  FROM public.price_tables pt
  WHERE pt.company_id = p_company_id
    AND pt.service_id = p_service_id
    AND (pt.appointment_type_id = p_appointment_type_id OR pt.appointment_type_id IS NULL)
    AND pt.insurance_plan_id = p_insurance_plan_id
    AND pt.active = TRUE
    AND pt.dt_inicio <= CURRENT_DATE
    AND (pt.dt_fim IS NULL OR pt.dt_fim >= CURRENT_DATE)
  ORDER BY pt.appointment_type_id NULLS LAST
  LIMIT 1;

  -- 2. Particular (insurance_plan_id NULL)
  IF NOT FOUND THEN
    RETURN QUERY
    SELECT pt.vl_particular, pt.vl_convenio, pt.vl_material, pt.vl_medicamento,
           pt.vl_taxa, pt.vl_diaria, pt.vl_gases, TRUE
    FROM public.price_tables pt
    WHERE pt.company_id = p_company_id
      AND pt.service_id = p_service_id
      AND (pt.appointment_type_id = p_appointment_type_id OR pt.appointment_type_id IS NULL)
      AND pt.insurance_plan_id IS NULL
      AND pt.active = TRUE
      AND pt.dt_inicio <= CURRENT_DATE
      AND (pt.dt_fim IS NULL OR pt.dt_fim >= CURRENT_DATE)
    LIMIT 1;
  END IF;

  -- 3. Fallback para services_catalog.price
  IF NOT FOUND THEN
    RETURN QUERY
    SELECT sc.price, sc.price, 0::DECIMAL(10,2), 0::DECIMAL(10,2),
           0::DECIMAL(10,2), 0::DECIMAL(10,2), 0::DECIMAL(10,2), TRUE
    FROM public.services_catalog sc
    WHERE sc.id = p_service_id
      AND sc.company_id = p_company_id;
  END IF;

  -- 4. Nada encontrado
  IF NOT FOUND THEN
    RETURN QUERY
    SELECT 0::DECIMAL(10,2), 0::DECIMAL(10,2), 0::DECIMAL(10,2), 0::DECIMAL(10,2),
           0::DECIMAL(10,2), 0::DECIMAL(10,2), 0::DECIMAL(10,2), FALSE;
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION public.find_price IS 'Busca preco com prioridade: convenio especifico > particular > services_catalog > 0';

ALTER TABLE public.price_tables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read price_tables from their company" ON public.price_tables;
CREATE POLICY "Users can read price_tables from their company"
  ON public.price_tables FOR SELECT
  TO authenticated
  USING (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Admins and financial can manage price_tables" ON public.price_tables;
CREATE POLICY "Admins and financial can manage price_tables"
  ON public.price_tables FOR ALL
  TO authenticated
  USING (
    company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role_name IN ('admin', 'financial')
    )
  )
  WITH CHECK (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));