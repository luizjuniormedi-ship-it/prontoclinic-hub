-- =============================================================================
-- Migration: 20260101000017_telemedicina
-- Descrição: Telemedicina com videochamada
--            Conforme Resolução CFM 2.299/2021
--            LGPD compliance: gravação com consentimento explícito
-- =============================================================================

-- ============================================================================
-- 1.1. Salas de telemedicina
-- Cada consulta por videochamada gera uma sala com token único de acesso.
-- O token JWT permite entrada sem expor credenciais Daily.co no client.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.telemedicina_salas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_appointment BIGINT REFERENCES public.appointments(id),
  cd_paciente BIGINT NOT NULL REFERENCES public.patients(id),
  cd_medico BIGINT NOT NULL REFERENCES public.professionals(id),
  ds_token_acesso VARCHAR(100) NOT NULL UNIQUE,    -- token JWT-like para entrar na sala
  dt_criacao TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dt_inicio TIMESTAMPTZ,                          -- quando médico/paciente entraram
  dt_fim TIMESTAMPTZ,                              -- quando a consulta terminou
  ds_url_daily VARCHAR(500),                      -- URL completa da sala Daily.co
  ds_sala_daily VARCHAR(100),                      -- nome curto da sala Daily.co
  duracao_segundos INTEGER,                        -- duração efetiva em segundos
  tp_status VARCHAR(20) NOT NULL DEFAULT 'AGUARDANDO'
    CHECK (tp_status IN ('AGUARDANDO', 'EM_ANDAMENTO', 'FINALIZADA', 'CANCELADA', 'FALHOU')),
  lg_gravacao_habilitada BOOLEAN DEFAULT FALSE,
  ds_url_gravacao TEXT,                            -- URL do arquivo de gravação (S3/Daily)
  lg_consentimento_gravacao BOOLEAN DEFAULT FALSE, -- LGPD: paciente consentiu
  dt_consentimento TIMESTAMPTZ,                    -- momento do consentimento
  -- Métricas de qualidade (coletadas via Daily webhook)
  vl_bitrate_medio INTEGER,                        -- kbps
  vl_latencia_media INTEGER,                       -- ms
  vl_packet_loss DECIMAL(5,2),                     -- %
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE  public.telemedicina_salas IS 'Salas de telemedicina (CFM 2.299/2021) com token único de acesso e gravação condicional';
COMMENT ON COLUMN public.telemedicina_salas.ds_token_acesso IS 'Token gerado por gerar_token_telemedicina() — 32 bytes hex';
COMMENT ON COLUMN public.telemedicina_salas.lg_consentimento_gravacao IS 'LGPD art. 7º II — consentimento explícito para gravação da consulta';
COMMENT ON COLUMN public.telemedicina_salas.tp_status IS 'AGUARDANDO (criada) → EM_ANDAMENTO (alguém entrou) → FINALIZADA/CANCELADA/FALHOU';

CREATE INDEX IF NOT EXISTS idx_telemedicina_salas_company
  ON public.telemedicina_salas(company_id, dt_criacao DESC);
CREATE INDEX IF NOT EXISTS idx_telemedicina_salas_paciente
  ON public.telemedicina_salas(cd_paciente);
CREATE INDEX IF NOT EXISTS idx_telemedicina_salas_status
  ON public.telemedicina_salas(tp_status, dt_criacao DESC);
CREATE INDEX IF NOT EXISTS idx_telemedicina_salas_medico
  ON public.telemedicina_salas(cd_medico, dt_criacao DESC);

-- ============================================================================
-- 1.2. Participantes — log de quem entrou na sala
-- Útil para auditoria LGPD e métricas de uso.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.telemedicina_participantes (
  id BIGSERIAL PRIMARY KEY,
  cd_sala UUID NOT NULL REFERENCES public.telemedicina_salas(id) ON DELETE CASCADE,
  cd_usuario UUID,                                -- auth.users.id
  tp_participante VARCHAR(20) NOT NULL
    CHECK (tp_participante IN ('MEDICO', 'PACIENTE', 'OBSERVADOR', 'INTERPRETE')),
  nm_nome VARCHAR(200),
  dt_entrada TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dt_saida TIMESTAMPTZ,
  ip_origem INET,
  user_agent TEXT,
  -- Eventos de mídia
  lg_microfone_ativo BOOLEAN,
  lg_camera_ativa BOOLEAN,
  lg_tela_compartilhada BOOLEAN
);

CREATE INDEX IF NOT EXISTS idx_telemedicina_part_sala
  ON public.telemedicina_participantes(cd_sala, dt_entrada);
CREATE INDEX IF NOT EXISTS idx_telemedicina_part_usuario
  ON public.telemedicina_participantes(cd_usuario);

-- ============================================================================
-- 1.3. Mensagens de chat da sala
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.telemedicina_mensagens (
  id BIGSERIAL PRIMARY KEY,
  cd_sala UUID NOT NULL REFERENCES public.telemedicina_salas(id) ON DELETE CASCADE,
  cd_usuario UUID,
  nm_remetente VARCHAR(200),
  ds_mensagem TEXT NOT NULL,
  tp_mensagem VARCHAR(20) DEFAULT 'TEXTO'
    CHECK (tp_mensagem IN ('TEXTO', 'SISTEMA', 'ARQUIVO', 'PRESCRICAO')),
  cd_anexo_url TEXT,
  dt_envio TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_telemedicina_msg_sala
  ON public.telemedicina_mensagens(cd_sala, dt_envio);

-- ============================================================================
-- 1.4. Prescrição gerada durante a consulta
-- Pode ser texto (Markdown/HTML) que será renderizado em PDF + assinatura.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.telemedicina_prescricoes (
  id BIGSERIAL PRIMARY KEY,
  cd_sala UUID NOT NULL REFERENCES public.telemedicina_salas(id) ON DELETE CASCADE,
  cd_paciente BIGINT NOT NULL REFERENCES public.patients(id),
  cd_medico BIGINT NOT NULL REFERENCES public.professionals(id),
  ds_receita TEXT NOT NULL,                       -- texto Markdown/HTML
  ds_observacoes TEXT,
  dt_emissao TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lg_assinada BOOLEAN DEFAULT FALSE,
  cd_origem_sigh INTEGER                          -- ID no SIGH se migrado
);

CREATE INDEX IF NOT EXISTS idx_telemedicina_presc_sala
  ON public.telemedicina_prescricoes(cd_sala);
CREATE INDEX IF NOT EXISTS idx_telemedicina_presc_paciente
  ON public.telemedicina_prescricoes(cd_paciente, dt_emissao DESC);

-- ============================================================================
-- 1.5. Receituário digital (pós-assinatura)
-- Conforme Portaria SVS/MS 344/98 e Lei 14.063/2020 (assinatura eletrônica).
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.telemedicina_receitas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cd_prescricao_id BIGINT NOT NULL REFERENCES public.telemedicina_prescricoes(id) ON DELETE CASCADE,
  cd_paciente BIGINT NOT NULL REFERENCES public.patients(id),
  cd_medico BIGINT NOT NULL REFERENCES public.professionals(id),
  ds_receita_url TEXT,                            -- PDF assinado em storage
  cd_hash_assinatura VARCHAR(64),                 -- SHA-256 do PDF + chave do médico
  dt_assinatura TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cd_certificado_digital TEXT,                    -- ICP-Brasil ou hash equivalente
  tp_receita VARCHAR(20)
    CHECK (tp_receita IN ('BRANCA', 'AZUL', 'AMARELA', 'VERMELHA', 'CONTROLE_ESPECIAL')),
  dt_validade TIMESTAMPTZ,                         -- vencimento do receituário
  lg_dispensada BOOLEAN DEFAULT FALSE,
  dt_dispensacao TIMESTAMPTZ,
  cd_farmacia_id INTEGER REFERENCES public.almoxarifados(id)
);

COMMENT ON TABLE  public.telemedicina_receitas IS 'Receituário digital pós-consulta (Lei 14.063/2020) com hash de integridade';
COMMENT ON COLUMN public.telemedicina_receitas.tp_receita IS 'Tipo conforme Portaria SVS/MS 344/98: BRANCA | AZUL | AMARELA | VERMELHA | CONTROLE_ESPECIAL';

CREATE INDEX IF NOT EXISTS idx_receitas_paciente
  ON public.telemedicina_receitas(cd_paciente, dt_assinatura DESC);
CREATE INDEX IF NOT EXISTS idx_receitas_prescricao
  ON public.telemedicina_receitas(cd_prescricao_id);

-- ============================================================================
-- 1.6. RLS — Row Level Security
-- Acesso: médico/paciente da sala + admin da company.
-- ============================================================================
-- O replay de release pode iniciar a partir do baseline mínimo, no qual os
-- vínculos de identidade ainda não foram materializados. Garanta as colunas
-- antes de compilar as policies que dependem delas.
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.professionals ADD COLUMN IF NOT EXISTS user_id UUID;

ALTER TABLE public.telemedicina_salas         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telemedicina_participantes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telemedicina_mensagens      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telemedicina_prescricoes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telemedicina_receitas       ENABLE ROW LEVEL SECURITY;

-- === telemedicina_salas ===
DROP POLICY IF EXISTS "telemed_salas_select"   ON public.telemedicina_salas;
DROP POLICY IF EXISTS "telemed_salas_insert"   ON public.telemedicina_salas;
DROP POLICY IF EXISTS "telemed_salas_update"   ON public.telemedicina_salas;

CREATE POLICY "telemed_salas_select"
  ON public.telemedicina_salas FOR SELECT TO authenticated
  USING (
    company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
    AND (
      EXISTS (SELECT 1 FROM public.professionals WHERE id = telemedicina_salas.cd_medico AND user_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.patients       WHERE id = telemedicina_salas.cd_paciente AND user_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.user_profiles  WHERE id = auth.uid() AND role_name IN ('admin', 'médico'))
    )
  );

CREATE POLICY "telemed_salas_insert"
  ON public.telemedicina_salas FOR INSERT TO authenticated
  WITH CHECK (
    company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role_name IN ('admin', 'médico', 'recepção')
    )
  );

CREATE POLICY "telemed_salas_update"
  ON public.telemedicina_salas FOR UPDATE TO authenticated
  USING (
    company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
    AND (
      EXISTS (SELECT 1 FROM public.professionals WHERE id = telemedicina_salas.cd_medico AND user_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.user_profiles  WHERE id = auth.uid() AND role_name IN ('admin', 'médico'))
    )
  )
  WITH CHECK (
    company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
  );

-- === telemedicina_participantes (log de auditoria — leitura ampla, escrita pelo service) ===
DROP POLICY IF EXISTS "telemed_part_select" ON public.telemedicina_participantes;
DROP POLICY IF EXISTS "telemed_part_insert" ON public.telemedicina_participantes;
DROP POLICY IF EXISTS "telemed_part_update" ON public.telemedicina_participantes;

CREATE POLICY "telemed_part_select"
  ON public.telemedicina_participantes FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.telemedicina_salas s
      WHERE s.id = telemedicina_participantes.cd_sala
        AND s.company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
    )
  );

CREATE POLICY "telemed_part_insert"
  ON public.telemedicina_participantes FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.telemedicina_salas s
      WHERE s.id = telemedicina_participantes.cd_sala
        AND s.company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
    )
  );

CREATE POLICY "telemed_part_update"
  ON public.telemedicina_participantes FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.telemedicina_salas s
      WHERE s.id = telemedicina_participantes.cd_sala
        AND s.company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
    )
  );

-- === telemedicina_mensagens ===
DROP POLICY IF EXISTS "telemed_msg_select" ON public.telemedicina_mensagens;
DROP POLICY IF EXISTS "telemed_msg_insert" ON public.telemedicina_mensagens;

CREATE POLICY "telemed_msg_select"
  ON public.telemedicina_mensagens FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.telemedicina_salas s
      WHERE s.id = telemedicina_mensagens.cd_sala
        AND s.company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
    )
  );

CREATE POLICY "telemed_msg_insert"
  ON public.telemedicina_mensagens FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.telemedicina_salas s
      WHERE s.id = telemedicina_mensagens.cd_sala
        AND s.company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
    )
  );

-- === telemedicina_prescricoes (médico escreve, paciente/admin leem) ===
DROP POLICY IF EXISTS "telemed_presc_select" ON public.telemedicina_prescricoes;
DROP POLICY IF EXISTS "telemed_presc_insert" ON public.telemedicina_prescricoes;
DROP POLICY IF EXISTS "telemed_presc_update" ON public.telemedicina_prescricoes;

CREATE POLICY "telemed_presc_select"
  ON public.telemedicina_prescricoes FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.professionals WHERE id = telemedicina_prescricoes.cd_medico AND user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.patients      WHERE id = telemedicina_prescricoes.cd_paciente AND user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role_name IN ('admin', 'médico'))
  );

CREATE POLICY "telemed_presc_insert"
  ON public.telemedicina_prescricoes FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.professionals WHERE id = telemedicina_prescricoes.cd_medico AND user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role_name IN ('admin'))
  );

CREATE POLICY "telemed_presc_update"
  ON public.telemedicina_prescricoes FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.professionals WHERE id = telemedicina_prescricoes.cd_medico AND user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role_name IN ('admin'))
  );

-- === telemedicina_receitas (leitura para médico/paciente/admin) ===
DROP POLICY IF EXISTS "telemed_receitas_select" ON public.telemedicina_receitas;
DROP POLICY IF EXISTS "telemed_receitas_insert" ON public.telemedicina_receitas;

CREATE POLICY "telemed_receitas_select"
  ON public.telemedicina_receitas FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.professionals WHERE id = telemedicina_receitas.cd_medico AND user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.patients      WHERE id = telemedicina_receitas.cd_paciente AND user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role_name IN ('admin', 'médico', 'recepção'))
  );

CREATE POLICY "telemed_receitas_insert"
  ON public.telemedicina_receitas FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.professionals WHERE id = telemedicina_receitas.cd_medico AND user_id = auth.uid())
  );

-- ============================================================================
-- 1.7. Função: gerar token de acesso único (32 bytes hex = 64 chars)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.gerar_token_telemedicina()
RETURNS VARCHAR(100)
LANGUAGE plpgsql
AS $$
DECLARE
  v_token VARCHAR(100);
BEGIN
  v_token := encode(gen_random_bytes(32), 'hex');
  RETURN v_token;
END;
$$;

COMMENT ON FUNCTION public.gerar_token_telemedicina IS 'Gera token hex de 64 chars (32 bytes) para autenticar entrada na sala';

-- ============================================================================
-- 1.8. Função: criar sala a partir de um agendamento
-- SECURITY DEFINER: pode ser invocada por médicos sem policy complexa.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.criar_sala_telemedicina(p_appointment_id BIGINT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sala_id     UUID;
  v_appointment RECORD;
BEGIN
  SELECT * INTO v_appointment FROM public.appointments WHERE id = p_appointment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento % não encontrado', p_appointment_id;
  END IF;

  INSERT INTO public.telemedicina_salas (
    company_id, cd_appointment, cd_paciente, cd_medico,
    ds_token_acesso, ds_sala_daily
  ) VALUES (
    v_appointment.company_id,
    v_appointment.id,
    v_appointment.cd_paciente,
    v_appointment.cd_medico,
    public.gerar_token_telemedicina(),
    'pm-' || v_appointment.id::TEXT
  )
  RETURNING id INTO v_sala_id;

  RETURN v_sala_id;
END;
$$;

COMMENT ON FUNCTION public.criar_sala_telemedicina IS 'Cria sala de telemedicina vinculada a um agendamento, gerando token único';

-- ============================================================================
-- 1.9. Função: registrar consentimento de gravação (LGPD art. 7º II)
-- Bloqueia a habilitação de gravação sem consentimento explícito.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.registrar_consentimento_gravacao(
  p_sala_id       UUID,
  p_consentimento BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.telemedicina_salas
  SET
    lg_consentimento_gravacao = p_consentimento,
    dt_consentimento          = CASE WHEN p_consentimento THEN NOW() ELSE NULL END,
    lg_gravacao_habilitada    = p_consentimento  -- habilita somente se consentiu
  WHERE id = p_sala_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sala % não encontrada', p_sala_id;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.registrar_consentimento_gravacao IS 'Registra consentimento LGPD para gravação e habilita/desabilita automaticamente';

-- ============================================================================
-- 1.10. Função: finalizar consulta e calcular métricas
-- ============================================================================
CREATE OR REPLACE FUNCTION public.finalizar_sala_telemedicina(
  p_sala_id          UUID,
  p_duracao_segundos INTEGER,
  p_bitrate_medio    INTEGER DEFAULT NULL,
  p_latencia_media   INTEGER DEFAULT NULL,
  p_packet_loss      DECIMAL(5,2) DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.telemedicina_salas
  SET
    dt_fim            = NOW(),
    duracao_segundos  = p_duracao_segundos,
    vl_bitrate_medio  = p_bitrate_medio,
    vl_latencia_media = p_latencia_media,
    vl_packet_loss    = p_packet_loss,
    tp_status         = 'FINALIZADA'
  WHERE id = p_sala_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sala % não encontrada', p_sala_id;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.finalizar_sala_telemedicina IS 'Finaliza consulta, calcula duração e armazena métricas de qualidade';

-- ============================================================================
-- 1.11. Grants
-- ============================================================================
GRANT USAGE ON SCHEMA public TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.gerar_token_telemedicina()                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.criar_sala_telemedicina(BIGINT)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_consentimento_gravacao(UUID, BOOL) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalizar_sala_telemedicina(
  UUID, INTEGER, INTEGER, INTEGER, DECIMAL
) TO authenticated;
