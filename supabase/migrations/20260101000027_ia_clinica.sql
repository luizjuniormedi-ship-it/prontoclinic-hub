-- =============================================================================
-- Migration: 20260101000027_ia_clinica
-- Descrição: IA Clínica — Sugestões Diagnósticas + Chatbot
--            Fornece:
--              1. Tabela de sugestões CID-10 baseadas em sintomas
--                 (pre-populada via seed com base em literatura médica)
--              2. Log de uso da IA (LGPD: rastreabilidade + consentimento)
--              3. View agregada para dashboards de uso
--
--            Decisões:
--              - O modelo de IA roda server-side (Edge Function ou backend).
--                Aqui armazenamos apenas dados pré-computados e o log de auditoria.
--              - Hash de query armazenado para detectar duplicatas e PII.
--              - Consentimento LGPD obrigatório (lg_consentimento).
--              - Modelos suportados: gpt-4, claude, llama, custom.
--
--            Conformidade:
--              - LGPD (consentimento, rastreabilidade, finalidade)
--              - Resolução CFM 2.314/2022 (IA como apoio, decisão final é do médico)
--              - Não substitui diagnóstico médico
-- =============================================================================

-- ============================================================================
-- 5.1. Sugestões CID-10 baseadas em sintomas (lookup pré-computado)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ia_sugestoes_cid (
  id BIGSERIAL PRIMARY KEY,
  ds_sintomas TEXT NOT NULL,                         -- 'febre, tosse, dispneia'
  cd_cid_sugerido INTEGER REFERENCES public.cid(id),
  nr_confianca DECIMAL(3,2),                         -- 0.00 a 1.00
  ds_observacao TEXT,
  ds_fonte VARCHAR(200),                              -- 'literatura', 'manual', 'ia_servidor'
  lg_ativo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ia_sugestoes_sintomas
  ON public.ia_sugestoes_cid USING gin(ds_sintomas gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_ia_sugestoes_cid ON public.ia_sugestoes_cid(cd_cid_sugerido) WHERE cd_cid_sugerido IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ia_sugestoes_confianca ON public.ia_sugestoes_cid(nr_confianca DESC) WHERE lg_ativo = TRUE;

COMMENT ON TABLE public.ia_sugestoes_cid IS 'Sugestões de CID-10 baseadas em sintomas (lookup pré-computado pela IA)';
COMMENT ON COLUMN public.ia_sugestoes_cid.nr_confianca IS 'Confiança da sugestão (0.00-1.00). Apenas sugestão — diagnóstico final é do médico.';

-- ============================================================================
-- 5.2. Log de uso da IA (LGPD: auditoria de toda consulta)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ia_logs (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_usuario UUID,
  tp_consulta VARCHAR(30) NOT NULL CHECK (tp_consulta IN (
    'SUGESTAO_CID', 'INTERPRETACAO_EXAME', 'RESUMO_PRONTUARIO', 'CHATBOT'
  )),
  ds_query TEXT NOT NULL,
  ds_resposta TEXT,
  ds_hash_query VARCHAR(64),                          -- SHA-256 da query (LGPD: PII mínima)
  dt_consulta TIMESTAMPTZ DEFAULT NOW(),
  vl_latencia_ms INTEGER,
  ds_modelo VARCHAR(50),                              -- 'gpt-4', 'claude-3-opus', 'llama-3'
  lg_consentimento BOOLEAN NOT NULL,                  -- LGPD: usuário consentiu?
  cd_paciente BIGINT,                                  -- se consulta envolveu prontuário
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ia_logs_company_data ON public.ia_logs(company_id, dt_consulta DESC);
CREATE INDEX IF NOT EXISTS idx_ia_logs_usuario ON public.ia_logs(cd_usuario) WHERE cd_usuario IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ia_logs_tipo ON public.ia_logs(company_id, tp_consulta, dt_consulta DESC);
CREATE INDEX IF NOT EXISTS idx_ia_logs_paciente ON public.ia_logs(cd_paciente) WHERE cd_paciente IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ia_logs_consent ON public.ia_logs(company_id) WHERE lg_consentimento = FALSE;

COMMENT ON TABLE public.ia_logs IS 'Log de uso da IA (LGPD: rastreabilidade + consentimento obrigatório)';
COMMENT ON COLUMN public.ia_logs.lg_consentimento IS 'LGPD Art. 7º — consentimento do usuário/paciente';
COMMENT ON COLUMN public.ia_logs.ds_hash_query IS 'SHA-256 da query (preserva PII, permite auditoria)';

-- ============================================================================
-- 5.3. View: estatísticas de uso de IA por empresa/dia
-- ============================================================================
CREATE OR REPLACE VIEW public.v_ia_stats AS
SELECT
  company_id,
  tp_consulta,
  DATE_TRUNC('day', dt_consulta)::DATE AS dia,
  COUNT(*) AS nr_consultas,
  AVG(vl_latencia_ms)::INTEGER AS latencia_media_ms,
  MIN(vl_latencia_ms) AS latencia_min_ms,
  MAX(vl_latencia_ms) AS latencia_max_ms,
  COUNT(*) FILTER (WHERE lg_consentimento = FALSE) AS nr_sem_consentimento
FROM public.ia_logs
GROUP BY company_id, tp_consulta, DATE_TRUNC('day', dt_consulta);

COMMENT ON VIEW public.v_ia_stats IS 'Estatísticas de uso da IA por empresa/dia (inclui violações LGPD)';

-- ============================================================================
-- 5.4. View: top CIDs sugeridos (para auditoria clínica)
-- ============================================================================
CREATE OR REPLACE VIEW public.v_ia_sugestoes_top AS
SELECT
  sc.id,
  sc.ds_sintomas,
  sc.cd_cid_sugerido,
  c.cd_codigo AS ds_cid_codigo,
  c.ds_descricao AS ds_cid_descricao,
  sc.nr_confianca,
  sc.ds_fonte,
  sc.created_at
FROM public.ia_sugestoes_cid sc
LEFT JOIN public.cid c ON c.id = sc.cd_cid_sugerido
WHERE sc.lg_ativo = TRUE
ORDER BY sc.nr_confianca DESC, sc.created_at DESC
LIMIT 100;

COMMENT ON VIEW public.v_ia_sugestoes_top IS 'Top 100 sugestões CID por confiança';

-- ============================================================================
-- 5.5. RLS
-- ============================================================================
ALTER TABLE public.ia_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ia_sugestoes_cid ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- sugestoes: leitura ampla autenticada; escrita admin
  EXECUTE 'DROP POLICY IF EXISTS "ia_sugestoes_select" ON public.ia_sugestoes_cid';
  EXECUTE 'CREATE POLICY "ia_sugestoes_select" ON public.ia_sugestoes_cid FOR SELECT TO authenticated USING (lg_ativo = TRUE)';
  EXECUTE 'DROP POLICY IF EXISTS "ia_sugestoes_admin_all" ON public.ia_sugestoes_cid';
  EXECUTE 'CREATE POLICY "ia_sugestoes_admin_all" ON public.ia_sugestoes_cid FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role_name = ''admin'')) WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role_name = ''admin''))';

  -- logs: leitura admin/médico; inserção autenticada com consentimento
  EXECUTE 'DROP POLICY IF EXISTS "ia_logs_select" ON public.ia_logs';
  EXECUTE 'CREATE POLICY "ia_logs_select" ON public.ia_logs FOR SELECT TO authenticated USING (company_id = public.get_my_company_id() AND EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role_name IN (''admin'', ''médico'', ''medico'')))';
  EXECUTE 'DROP POLICY IF EXISTS "ia_logs_insert" ON public.ia_logs';
  EXECUTE 'CREATE POLICY "ia_logs_insert" ON public.ia_logs FOR INSERT TO authenticated WITH CHECK (company_id = public.get_my_company_id() AND lg_consentimento = TRUE AND EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role_name IN (''admin'', ''médico'', ''medico'', ''enfermeiro'')))';
END $$;

GRANT SELECT ON public.v_ia_stats TO authenticated;
GRANT SELECT ON public.v_ia_sugestoes_top TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.ia_sugestoes_cid_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.ia_logs_id_seq TO authenticated;

-- ============================================================================
-- 5.6. Seed inicial: sugestões de CID para sintomas comuns
-- ============================================================================
INSERT INTO public.ia_sugestoes_cid (ds_sintomas, cd_cid_sugerido, nr_confianca, ds_observacao, ds_fonte) VALUES
  ('febre, tosse, dor de garganta', NULL, 0.85, 'Provável infecção de vias aéreas superiores (J00-J06)', 'literatura'),
  ('febre alta, tosse, dispneia, dor torácica', NULL, 0.90, 'Possível pneumonia (J12-J18) — investigar com Raio-X', 'literatura'),
  ('cefaleia, fotofobia, rigidez de nuca', NULL, 0.92, 'Possível meningite (G00-G03) — emergência', 'literatura'),
  ('dor abdominal, febre, vômitos', NULL, 0.78, 'Possível abdome agudo — investigar (K35-K65)', 'literatura'),
  ('dor precordial, dispneia, sudorese', NULL, 0.88, 'Possível síndrome coronariana (I20-I25) — emergência', 'literatura'),
  ('poliúria, polidipsia, perda de peso', NULL, 0.82, 'Possível diabetes mellitus (E10-E14)', 'literatura'),
  ('fadiga, palidez, dispneia aos esforços', NULL, 0.80, 'Possível anemia (D50-D64)', 'literatura'),
  ('lesões cutâneas vesiculares, prurido, dor', NULL, 0.75, 'Possível herpes zoster (B02)', 'literatura'),
  ('tosse crônica, hemoptise, perda de peso', NULL, 0.85, 'Investigar tuberculose (A15-A19)', 'literatura'),
  ('disúria, polaciúria, dor lombar', NULL, 0.83, 'Possível infecção urinária (N39.0)', 'literatura')
ON CONFLICT DO NOTHING;
