-- =============================================================================
-- Migration: 20260101000022_nps
-- Descrição: NPS (Net Promoter Score) e Feedback do Paciente
--            Pesquisas configuráveis (titulo, descrição, período, público-alvo),
--            respostas com nota 0-10, categorização automática
--            (Promotor/Neutro/Detrator) e view agregada v_nps_analise.
--
--            Decisões:
--              - Resposta anônima (anon role) para permitir surveys via link público
--              - Categorização via GENERATED ALWAYS AS ... STORED
--              - View materializada em runtime (volume baixo, dados recentes)
--              - Template de perguntas em JSONB (flexível)
--              - UNIQUE(pesquisa, paciente) impede resposta duplicada
-- =============================================================================

-- ============================================================================
-- 3.1. Pesquisas NPS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.nps_pesquisas (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  ds_titulo VARCHAR(200) NOT NULL,
  ds_descricao TEXT,
  dt_inicio DATE NOT NULL,
  dt_fim DATE,
  tp_publico VARCHAR(30) CHECK (tp_publico IN ('TODOS_PACIENTES', 'APOS_CONSULTA', 'APOS_INTERNACAO', 'CUSTOMIZADO')),
  cd_template_perguntas JSONB,
  lg_ativo BOOLEAN DEFAULT TRUE,
  cd_usuario UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nps_pesquisas_company ON public.nps_pesquisas(company_id);
CREATE INDEX IF NOT EXISTS idx_nps_pesquisas_ativo ON public.nps_pesquisas(company_id, lg_ativo);

-- ============================================================================
-- 3.2. Respostas NPS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.nps_respostas (
  id BIGSERIAL PRIMARY KEY,
  cd_pesquisa BIGINT NOT NULL REFERENCES public.nps_pesquisas(id) ON DELETE CASCADE,
  cd_paciente BIGINT NOT NULL REFERENCES public.patients(id),
  cd_appointment BIGINT REFERENCES public.appointments(id),
  dt_resposta TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  nr_nota_nps SMALLINT CHECK (nr_nota_nps BETWEEN 0 AND 10),
  ds_comentario TEXT,
  tp_promotor VARCHAR(20) CHECK (tp_promotor IN ('PROMOTOR', 'NEUTRO', 'DETRATOR')) GENERATED ALWAYS AS (
    CASE
      WHEN nr_nota_nps >= 9 THEN 'PROMOTOR'
      WHEN nr_nota_nps >= 7 THEN 'NEUTRO'
      ELSE 'DETRATOR'
    END
  ) STORED,
  ds_origem VARCHAR(20) CHECK (ds_origem IN ('EMAIL', 'WHATSAPP', 'SMS', 'PRESENCIAL')),
  ip_origem INET,
  user_agent TEXT,
  ds_respostas JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(cd_pesquisa, cd_paciente)
);

CREATE INDEX IF NOT EXISTS idx_nps_respostas_pesquisa ON public.nps_respostas(cd_pesquisa, dt_resposta DESC);
CREATE INDEX IF NOT EXISTS idx_nps_respostas_promotor ON public.nps_respostas(tp_promotor);
CREATE INDEX IF NOT EXISTS idx_nps_respostas_paciente ON public.nps_respostas(cd_paciente);

-- ============================================================================
-- 3.3. View de análise agregada
-- ============================================================================
CREATE OR REPLACE VIEW public.v_nps_analise AS
SELECT
  p.id AS cd_pesquisa,
  p.company_id,
  p.ds_titulo,
  COUNT(r.id) AS nr_respostas,
  COUNT(*) FILTER (WHERE r.tp_promotor = 'PROMOTOR') AS nr_promotores,
  COUNT(*) FILTER (WHERE r.tp_promotor = 'NEUTRO') AS nr_neutros,
  COUNT(*) FILTER (WHERE r.tp_promotor = 'DETRATOR') AS nr_detrators,
  ROUND(100.0 * COUNT(*) FILTER (WHERE r.tp_promotor = 'PROMOTOR') / NULLIF(COUNT(*), 0), 2) AS nr_percent_promotores,
  ROUND(100.0 * COUNT(*) FILTER (WHERE r.tp_promotor = 'DETRATOR') / NULLIF(COUNT(*), 0), 2) AS nr_percent_detrators,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE r.tp_promotor = 'PROMOTOR') / NULLIF(COUNT(*), 0)
    - 100.0 * COUNT(*) FILTER (WHERE r.tp_promotor = 'DETRATOR') / NULLIF(COUNT(*), 0),
    2
  ) AS nr_nps_score,
  AVG(r.nr_nota_nps)::DECIMAL(3,1) AS nr_nota_media
FROM public.nps_pesquisas p
LEFT JOIN public.nps_respostas r ON r.cd_pesquisa = p.id
GROUP BY p.id, p.company_id, p.ds_titulo;

-- ============================================================================
-- 3.4. RLS
-- ============================================================================
ALTER TABLE public.nps_pesquisas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nps_respostas ENABLE ROW LEVEL SECURITY;

-- Pesquisas: leitura para usuários autenticados; escrita para admin
DROP POLICY IF EXISTS "Authenticated can read nps_pesquisas" ON public.nps_pesquisas;
CREATE POLICY "Authenticated can read nps_pesquisas"
  ON public.nps_pesquisas FOR SELECT TO authenticated
  USING (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Admins can manage nps_pesquisas" ON public.nps_pesquisas;
CREATE POLICY "Admins can manage nps_pesquisas"
  ON public.nps_pesquisas FOR ALL TO authenticated
  USING (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role_name IN ('admin', 'gestor', 'administrador')))
  WITH CHECK (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

-- Respostas: anon pode inserir (link público), autenticados podem ler
DROP POLICY IF EXISTS "Anonymous can submit NPS" ON public.nps_respostas;
CREATE POLICY "Anonymous can submit NPS" ON public.nps_respostas
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated can read nps_respostas" ON public.nps_respostas;
CREATE POLICY "Authenticated can read nps_respostas"
  ON public.nps_respostas FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.nps_pesquisas p
    WHERE p.id = nps_respostas.cd_pesquisa
      AND p.company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
  ));