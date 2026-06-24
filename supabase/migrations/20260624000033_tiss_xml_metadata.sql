-- =============================================================================
-- Migration: 20260624000033_tiss_xml_metadata.sql
-- Descrição: Adiciona colunas para armazenar metadados de XMLs TISS
--            (os arquivos BL_XML em si ficam no Supabase Storage bucket
--            'tiss-xml' em path 'sigh/{cd_xml}.xml').
-- =============================================================================

ALTER TABLE public.tiss_xml
  ADD COLUMN IF NOT EXISTS cd_origem_sigh BIGINT UNIQUE,
  ADD COLUMN IF NOT EXISTS cd_lote INTEGER,
  ADD COLUMN IF NOT EXISTS cd_convenio INTEGER,
  ADD COLUMN IF NOT EXISTS nr_protocolo VARCHAR(100),
  ADD COLUMN IF NOT EXISTS dt_envio TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tp_status VARCHAR(20),
  ADD COLUMN IF NOT EXISTS nr_versao_tiss VARCHAR(20),
  ADD COLUMN IF NOT EXISTS vl_total DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS ds_observacao TEXT,
  ADD COLUMN IF NOT EXISTS storage_path VARCHAR(500),
  ADD COLUMN IF NOT EXISTS lg_ativo BOOLEAN DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_tiss_xml_cd_origem_sigh ON public.tiss_xml(cd_origem_sigh);
CREATE INDEX IF NOT EXISTS idx_tiss_xml_status ON public.tiss_xml(tp_status);
CREATE INDEX IF NOT EXISTS idx_tiss_xml_dt_envio ON public.tiss_xml(dt_envio DESC);
CREATE INDEX IF NOT EXISTS idx_tiss_xml_empresa ON public.tiss_xml(company_id);

COMMENT ON TABLE public.tiss_xml IS 'TISS XML metadata (arquivos em Supabase Storage bucket tiss-xml)';