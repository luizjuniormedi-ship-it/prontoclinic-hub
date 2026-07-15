-- =============================================================================
-- Migration: 20260101000028_units_fix
-- Descrição: CRÍTICO — Cria a tabela public.units que está REFERENCIADA
--            (FK) em outras migrations mas nunca foi criada.
--
--            Tabelas que dependem de public.units (FK quebrada):
--              - public.almoxarifados.cd_unidade    (migration 000015)
--              - public.leitos.cd_unidade           (migration 000023)
--
--            Sem esta migration, as migrations 000015 e 000023 falham
--            com erro "relation public.units does not exist".
--
-- Decisões:
--   - Tabela multi-tenant (company_id)
--   - RLS granular (admin gerencia, todos leem da própria empresa)
--   - Soft delete via lg_ativo
--   - Seed mínimo: cria unidade "Matriz" para cada empresa existente
-- =============================================================================

-- ============================================================================
-- 1.1. Tabela units (unidades da empresa: matriz, filial, etc)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.units (
  id SERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_codigo VARCHAR(20) NOT NULL,                  -- código interno (ex: U001)
  ds_nome VARCHAR(100) NOT NULL,                   -- nome fantasia da unidade
  ds_razao_social VARCHAR(200),                    -- razão social (CNPJ diferente)
  nr_cnpj VARCHAR(14),                             -- CNPJ próprio (14 dígitos)
  tp_unidade VARCHAR(30) CHECK (tp_unidade IN (
    'HOSPITAL', 'CLINICA', 'UPA', 'UBS', 'LABORATORIO', 'CONSULTORIO', 'MATRIZ', 'FILIAL'
  )) DEFAULT 'MATRIZ',
  ds_endereco VARCHAR(200),
  nr_endereco VARCHAR(20),
  ds_complemento VARCHAR(100),
  ds_bairro VARCHAR(100),
  ds_cidade VARCHAR(100),
  ds_uf VARCHAR(2),
  nr_cep VARCHAR(8),
  nr_telefone VARCHAR(20),
  ds_email VARCHAR(200),
  cd_ibge_municipio VARCHAR(7),
  lg_principal BOOLEAN DEFAULT FALSE,              -- marca a unidade principal
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  cd_origem_sigh INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uniq_unit_codigo UNIQUE(company_id, cd_codigo),
  CONSTRAINT uniq_unit_cnpj UNIQUE(company_id, nr_cnpj)
);

CREATE INDEX IF NOT EXISTS idx_units_company ON public.units(company_id);
CREATE INDEX IF NOT EXISTS idx_units_principal ON public.units(company_id, lg_principal) WHERE lg_principal = TRUE;
CREATE INDEX IF NOT EXISTS idx_units_ativo ON public.units(company_id, lg_ativo);
CREATE INDEX IF NOT EXISTS idx_units_cnpj ON public.units(nr_cnpj) WHERE nr_cnpj IS NOT NULL;

COMMENT ON TABLE public.units IS 'Unidades da empresa (matriz, filiais, UPA, etc) — resolve FK quebrada das migrations 000015 e 000023';

DROP TRIGGER IF EXISTS trg_units_updated_at ON public.units;
CREATE TRIGGER trg_units_updated_at
  BEFORE UPDATE ON public.units
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 1.2. RLS — admin gerencia, todos da empresa leem
-- ============================================================================
ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "units_select" ON public.units;
CREATE POLICY "units_select" ON public.units FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id());

DROP POLICY IF EXISTS "units_admin" ON public.units;
CREATE POLICY "units_admin" ON public.units FOR ALL TO authenticated
  USING (
    company_id = public.get_my_company_id()
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role_name IN ('admin')
    )
  )
  WITH CHECK (company_id = public.get_my_company_id());

-- ============================================================================
-- 1.3. Grants
-- ============================================================================
GRANT SELECT ON public.units TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.units_id_seq TO authenticated;

-- ============================================================================
-- 1.4. Seed: cria unidade "Matriz" para cada empresa existente
--      (necessário porque 000015/000023 podem ter INSERTs pendentes)
-- ============================================================================
INSERT INTO public.units (company_id, cd_codigo, ds_nome, tp_unidade, lg_principal, lg_ativo)
SELECT
  c.id,
  'U001',
  COALESCE(c.name, 'Unidade Matriz') || ' — Matriz',
  'MATRIZ',
  TRUE,
  TRUE
FROM public.companies c
WHERE NOT EXISTS (
  SELECT 1
  FROM public.units u
  WHERE u.company_id = c.id
    AND (u.lg_principal = TRUE OR u.cd_codigo = 'U001')
);

-- ============================================================================
-- 1.5. Compat: garantir que almoxarifados e leitos existentes tenham
--      cd_unidade apontando para a unidade principal da empresa
-- ============================================================================
UPDATE public.almoxarifados a
SET cd_unidade = u.id
FROM public.units u
WHERE u.company_id = a.company_id
  AND u.lg_principal = TRUE
  AND a.cd_unidade IS NULL;

UPDATE public.leitos l
SET cd_unidade = u.id
FROM public.units u
WHERE u.company_id = l.company_id
  AND u.lg_principal = TRUE
  AND l.cd_unidade IS NULL;

-- ============================================================================
-- 1.6. Adiciona coluna company_id onde faltar (segurança)
--      A tabela units não existia antes, então está limpo.
-- ============================================================================

COMMENT ON COLUMN public.units.cd_origem_sigh IS 'ID original do SIGH (unidades.SOMA)';
COMMENT ON COLUMN public.units.tp_unidade IS 'HOSPITAL, CLINICA, UPA, UBS, LABORATORIO, CONSULTORIO, MATRIZ, FILIAL';