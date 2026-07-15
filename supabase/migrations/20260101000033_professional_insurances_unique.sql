-- Migration 033: Adicionar unique constraint em professional_insurances (chave canonica)
-- Necessário para suportar UPSERT idempotente via cd_origem_sigh_combo
-- (a tabela já tem FKs e PK, mas não tinha unique no cd_origem_sigh_combo)
--
-- A combinação (company_id, cd_origem_sigh_combo) é a chave natural para migração
-- pois cada combinação SIGH (CD_MEDICOR, CD_CONVENIO) é única por empresa.

-- 1) Remover duplicatas existentes (se houver), mantendo o registro de menor id
DELETE FROM public.professional_insurances a
USING public.professional_insurances b
WHERE a.id > b.id
  AND a.company_id = b.company_id
  AND a.cd_origem_sigh_combo = b.cd_origem_sigh_combo;

-- 2) Adicionar unique constraint composto
ALTER TABLE public.professional_insurances
  ADD CONSTRAINT professional_insurances_company_origem_unique
  UNIQUE (company_id, cd_origem_sigh_combo);

-- 3) Criar índice auxiliar para performance em queries por cd_origem_sigh_combo
CREATE INDEX IF NOT EXISTS idx_professional_insurances_cd_origem_sigh_combo
  ON public.professional_insurances (cd_origem_sigh_combo);
