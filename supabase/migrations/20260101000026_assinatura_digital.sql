-- =============================================================================
-- Migration: 20260101000026_assinatura_digital
-- Descrição: Assinatura Digital ICP-Brasil
--            Armazena certificados digitais e logs de documentos assinados.
--            Não armazena a chave privada do certificado (apenas metadados).
--            O hash SHA-256 garante integridade; a assinatura PKCS#7
--            garante autenticidade + não-repúdio.
--
--            Fluxo:
--              1. Profissional faz upload do certificado (A1 .pfx / A3 token)
--              2. Sistema valida data de validade e revogação
--              3. Documento é gerado + hash SHA-256 calculado
--              4. Cliente assina com chave privada (browser/native)
--              5. Sistema armazena PKCS#7 + hash + IP
--
--            Conformidade:
--              - MP 2.200-2/2001 (ICP-Brasil)
--              - Resolução CFM 2.314/2022 (assinatura digital em prontuário)
--              - Lei 14.063/2020 (assinaturas eletrônicas em saúde)
-- =============================================================================

-- ============================================================================
-- 4.1. Certificados digitais (A1, A3, ICP-Brasil)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.certificados_digitais (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_profissional BIGINT NOT NULL REFERENCES public.professionals(id) ON DELETE CASCADE,
  tp_certificado VARCHAR(30) NOT NULL CHECK (tp_certificado IN ('A1', 'A3', 'ICP_BRASIL')),
  nr_serie VARCHAR(100) NOT NULL,
  cd_emissor VARCHAR(100),                            -- Autoridade Certificadora
  dt_validade_inicio DATE NOT NULL,
  dt_validade_fim DATE NOT NULL,
  ds_arquivo_url TEXT,                              -- S3/MinIO (apenas A1, jamais exposto)
  -- Validação
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  lg_revogado BOOLEAN DEFAULT FALSE,
  dt_revogacao TIMESTAMPTZ,
  ds_motivo_revogacao TEXT,
  cd_origem_sigh INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uniq_cert_prof_serie UNIQUE(cd_profissional, nr_serie),
  CONSTRAINT chk_cert_validade CHECK (dt_validade_fim > dt_validade_inicio)
);

CREATE INDEX IF NOT EXISTS idx_certificados_company ON public.certificados_digitais(company_id);
CREATE INDEX IF NOT EXISTS idx_certificados_prof ON public.certificados_digitais(cd_profissional);
CREATE INDEX IF NOT EXISTS idx_certificados_ativo ON public.certificados_digitais(cd_profissional) WHERE lg_ativo = TRUE;
CREATE INDEX IF NOT EXISTS idx_certificados_validade ON public.certificados_digitais(dt_validade_fim) WHERE lg_ativo = TRUE;

COMMENT ON TABLE public.certificados_digitais IS 'Certificados digitais ICP-Brasil (A1/A3) — metadados apenas, jamais chave privada';
COMMENT ON COLUMN public.certificados_digitais.ds_arquivo_url IS 'URL S3/MinIO do .pfx (A1). NUNCA expor publicamente. Apenas o profissional owner pode acessar.';

-- ============================================================================
-- 4.2. Documentos assinados digitalmente
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.documentos_assinados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_certificado INTEGER NOT NULL REFERENCES public.certificados_digitais(id),
  cd_profissional BIGINT NOT NULL REFERENCES public.professionals(id),
  tp_documento VARCHAR(30) NOT NULL CHECK (tp_documento IN (
    'RECEITA', 'ATESTADO', 'LAUDO', 'PRESCRICAO',
    'RELATORIO', 'TERMO_CONSENTIMENTO', 'OUTRO'
  )),
  cd_documento_origem BIGINT,                       -- FK polimórfica (genérica)
  ds_hash_documento VARCHAR(64) NOT NULL,            -- SHA-256 do conteúdo (hex)
  ds_hash_assinatura VARCHAR(256) NOT NULL,           -- hash do ICP-Brasil
  ds_assinatura_p7s TEXT,                           -- assinatura PKCS#7 (base64)
  dt_assinatura TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_origem INET,
  -- Validação
  lg_valido BOOLEAN DEFAULT TRUE,
  dt_validacao TIMESTAMPTZ,
  cd_autoridade_certificadora VARCHAR(100),
  nr_protocolo_ans VARCHAR(50),
  ds_motivo_invalidacao TEXT,
  cd_origem_sigh INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doc_assinados_company_data ON public.documentos_assinados(company_id, dt_assinatura DESC);
CREATE INDEX IF NOT EXISTS idx_doc_assinados_prof ON public.documentos_assinados(cd_profissional);
CREATE INDEX IF NOT EXISTS idx_doc_assinados_hash ON public.documentos_assinados(ds_hash_documento);
CREATE INDEX IF NOT EXISTS idx_doc_assinados_tipo ON public.documentos_assinados(company_id, tp_documento, dt_assinatura DESC);
CREATE INDEX IF NOT EXISTS idx_doc_assinados_doc_origem ON public.documentos_assinados(cd_documento_origem) WHERE cd_documento_origem IS NOT NULL;

COMMENT ON TABLE public.documentos_assinados IS 'Log imutável de documentos assinados digitalmente (LGPD: rastreabilidade)';
COMMENT ON COLUMN public.documentos_assinados.ds_hash_documento IS 'SHA-256 do documento (hex 64 chars). Garante integridade.';
COMMENT ON COLUMN public.documentos_assinados.ds_assinatura_p7s IS 'Assinatura PKCS#7 (base64). Garante autenticidade + não-repúdio.';

-- ============================================================================
-- 4.3. View: auditoria de assinaturas por profissional
-- ============================================================================
CREATE OR REPLACE VIEW public.v_assinaturas_auditoria AS
SELECT
  da.id,
  da.company_id,
  da.cd_profissional,
  p.full_name AS ds_profissional,
  da.tp_documento,
  da.ds_hash_documento,
  da.dt_assinatura,
  da.ip_origem,
  da.lg_valido,
  cd.tp_certificado,
  cd.nr_serie,
  cd.cd_emissor,
  cd.dt_validade_fim
FROM public.documentos_assinados da
INNER JOIN public.professionals p ON p.id = da.cd_profissional
INNER JOIN public.certificados_digitais cd ON cd.id = da.cd_certificado
ORDER BY da.dt_assinatura DESC;

COMMENT ON VIEW public.v_assinaturas_auditoria IS 'Auditoria de assinaturas com info do certificado';

-- ============================================================================
-- 4.4. RLS — apenas admin + próprio profissional
-- ============================================================================
ALTER TABLE public.certificados_digitais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documentos_assinados ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- certificados: admin lê todos; profissional lê o próprio; admin insere/atualiza
  EXECUTE 'DROP POLICY IF EXISTS "certificados_select" ON public.certificados_digitais';
  EXECUTE 'CREATE POLICY "certificados_select" ON public.certificados_digitais FOR SELECT TO authenticated USING (company_id = public.get_my_company_id() AND (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role_name = ''admin'') OR cd_profissional IN (SELECT id FROM public.professionals WHERE user_id = auth.uid())))';
  EXECUTE 'DROP POLICY IF EXISTS "certificados_admin_all" ON public.certificados_digitais';
  EXECUTE 'CREATE POLICY "certificados_admin_all" ON public.certificados_digitais FOR ALL TO authenticated USING (company_id = public.get_my_company_id() AND EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role_name = ''admin'')) WITH CHECK (company_id = public.get_my_company_id())';

  -- documentos assinados: leitura ampla; inserção autenticada
  EXECUTE 'DROP POLICY IF EXISTS "doc_assinados_select" ON public.documentos_assinados';
  EXECUTE 'CREATE POLICY "doc_assinados_select" ON public.documentos_assinados FOR SELECT TO authenticated USING (company_id = public.get_my_company_id())';
  EXECUTE 'DROP POLICY IF EXISTS "doc_assinados_insert" ON public.documentos_assinados';
  EXECUTE 'CREATE POLICY "doc_assinados_insert" ON public.documentos_assinados FOR INSERT TO authenticated WITH CHECK (company_id = public.get_my_company_id() AND EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role_name IN (''admin'', ''médico'', ''medico'')))';
END $$;

GRANT SELECT ON public.v_assinaturas_auditoria TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.certificados_digitais_id_seq TO authenticated;
