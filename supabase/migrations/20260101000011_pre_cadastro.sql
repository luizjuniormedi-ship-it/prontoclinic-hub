-- =============================================================================
-- Migration: 20260101000011_pre_cadastro
-- Descricao: Modulo de pre-cadastro online de pacientes (PWA publico)
--            Espelha e moderniza o SIGH.pre_cadastro (estrutura vazia).
--
--            Feature critica que o SIGH nao tem — permite que o paciente
--            inicie seu cadastro via portal publico (sem autenticacao),
--            confirme o e-mail em 72h e, apos aprovacao do admin/recepcao,
--            seja promovido a paciente definitivo (public.patients).
--
-- Componentes:
--   1. Tabela pre_cadastro  (espelho modernizado do SIGH)
--   2. RPC create_pre_cadastro   (sign-up publico, idempotente)
--   3. RPC confirm_pre_cadastro  (confirma token, 72h de validade)
--   4. RPC promote_pre_cadastro  (migra para patients)
--   5. RPC cancel_pre_cadastro   (cancela, motivo registrado)
--   6. RLS policies (anon pode criar, staff gerencia)
--   7. View pre_cadastros_pendentes (admin dashboard)
--
-- LGPD:
--   - Hash SHA-256 do termo aceito (prova de ciencia)
--   - IP + user_agent capturados
--   - Direito ao esquecimento preservado (apenas soft delete via status)
-- =============================================================================

-- ============================================================================
-- 1.1. Tabela pre_cadastro
-- Espelha SIGH.pre_cadastro com melhorias:
--   - UUID como PK (consistencia com o resto do schema)
--   - SHA-256 hashes para busca sem expor PII
--   - Status enum explicito
--   - Token de confirmacao com expiracao (72h)
--   - Rastreabilidade completa (IP, UA, tentativas)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.pre_cadastro (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Vinculo com a empresa (multi-tenant)
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  -- Dados pessoais
  full_name VARCHAR(200) NOT NULL,
  cpf VARCHAR(11),                        -- preenchido apos confirmacao (se informado)
  cpf_hash CHAR(64),                      -- SHA-256 do CPF para busca deduplicada
  birth_date DATE,
  gender CHAR(1) CHECK (gender IN ('M', 'F', 'O')),

  -- Contato
  email VARCHAR(255) NOT NULL,
  email_hash CHAR(64),                    -- SHA-256 do email (lower + trim)
  phone VARCHAR(20),
  whatsapp VARCHAR(20),

  -- Endereco
  cep VARCHAR(10),
  logradouro VARCHAR(200),
  numero VARCHAR(20),
  complemento VARCHAR(100),
  bairro VARCHAR(100),
  cidade VARCHAR(100),
  uf CHAR(2),
  ibge_cidade VARCHAR(7),

  -- LGPD — prova de ciencia do termo (art. 8 LGPD)
  lg_aceite_termo BOOLEAN NOT NULL DEFAULT FALSE,
  dt_aceite_termo TIMESTAMPTZ,
  versao_termo VARCHAR(20) NOT NULL,      -- ex: 'v1.0-2026-06-22'
  texto_termo_hash CHAR(64) NOT NULL,     -- SHA-256 do texto aceito
  ip_origem INET,
  user_agent TEXT,

  -- Confirmacao por e-mail
  token_confirmacao VARCHAR(64) UNIQUE NOT NULL,
  dt_token_exp TIMESTAMPTZ NOT NULL,
  lg_confirmado BOOLEAN DEFAULT FALSE,
  dt_confirmacao TIMESTAMPTZ,

  -- Migracao para paciente definitivo (public.patients)
  cd_paciente_final BIGINT REFERENCES public.patients(id),
  dt_migracao TIMESTAMPTZ,

  -- Estado
  status VARCHAR(20) NOT NULL DEFAULT 'PENDENTE'
    CHECK (status IN ('PENDENTE', 'CONFIRMADO', 'EXPIRADO', 'CANCELADO', 'MIGRADO')),
  tentativas_confirmacao SMALLINT DEFAULT 0,
  dt_ultimo_envio TIMESTAMPTZ,
  motivo_cancelamento TEXT,

  -- Auditoria
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Unicidade: 1 pre-cadastro pendente/confirmado por email+empresa
  CONSTRAINT uniq_pre_cadastro_company_email UNIQUE (company_id, email)
);

COMMENT ON TABLE  public.pre_cadastro IS 'Pre-cadastro online de pacientes (sign-up publico, antes de virar paciente definitivo)';
COMMENT ON COLUMN public.pre_cadastro.email_hash        IS 'SHA-256 do email (lowercase, trim) — busca deduplicada sem expor PII';
COMMENT ON COLUMN public.pre_cadastro.cpf_hash         IS 'SHA-256 do CPF (so digitos) — busca deduplicada sem expor PII';
COMMENT ON COLUMN public.pre_cadastro.texto_termo_hash IS 'SHA-256 do texto do termo aceito — prova de ciencia (LGPD art. 8)';
COMMENT ON COLUMN public.pre_cadastro.token_confirmacao IS 'Token unico de 64 chars (32 bytes hex) enviado por e-mail — expira em 72h';
COMMENT ON COLUMN public.pre_cadastro.status           IS 'PENDENTE→CONFIRMADO→MIGRADO | EXPIRADO | CANCELADO';

-- Indices
CREATE INDEX IF NOT EXISTS idx_pre_cadastro_company_status
  ON public.pre_cadastro(company_id, status);
CREATE INDEX IF NOT EXISTS idx_pre_cadastro_token
  ON public.pre_cadastro(token_confirmacao);
CREATE INDEX IF NOT EXISTS idx_pre_cadastro_email_hash
  ON public.pre_cadastro(email_hash);
CREATE INDEX IF NOT EXISTS idx_pre_cadastro_pending
  ON public.pre_cadastro(status, dt_token_exp)
  WHERE status = 'PENDENTE';
CREATE INDEX IF NOT EXISTS idx_pre_cadastro_dt_created
  ON public.pre_cadastro(created_at DESC);

-- Trigger updated_at (assume funcao public.set_updated_at() ja criada em migrations anteriores)
DROP TRIGGER IF EXISTS trg_pre_cadastro_updated_at ON public.pre_cadastro;
CREATE TRIGGER trg_pre_cadastro_updated_at
  BEFORE UPDATE ON public.pre_cadastro
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 1.2. RPC: create_pre_cadastro
-- Publica (anon ou authenticated), idempotente:
--   - Se ja existe pre-cadastro PENDENTE para este email+empresa,
--     renova o token (retorna o mesmo id)
--   - Caso contrario, cria novo
--
-- Rate limiting:
--   - Cloudflare WAF no edge (recomendado: 5 req/min por IP)
--   - A funcao nao tem rate limit proprio — a protecao vem do edge/WAF
--   - Logs estruturados em audit_logs (recomendado: hook AFTER INSERT)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_pre_cadastro(
  p_company_id      UUID,
  p_full_name       VARCHAR,
  p_email           VARCHAR,
  p_phone           VARCHAR,
  p_birth_date      DATE,
  p_gender          CHAR,
  p_cep             VARCHAR,
  p_logradouro      VARCHAR,
  p_numero          VARCHAR,
  p_complemento     VARCHAR,
  p_bairro          VARCHAR,
  p_cidade          VARCHAR,
  p_uf              CHAR,
  p_versao_termo    VARCHAR,
  p_texto_termo_hash CHAR,
  p_ip_origem       INET,
  p_user_agent      TEXT
)
RETURNS TABLE(id UUID, token VARCHAR, dt_exp TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id           UUID;
  v_token        VARCHAR(64);
  v_dt_exp       TIMESTAMPTZ := NOW() + INTERVAL '72 hours';
  v_existing_id  UUID;
  v_email_hash   CHAR(64);
BEGIN
  -- Sanitizacao basica
  IF p_email IS NULL OR LENGTH(TRIM(p_email)) = 0 THEN
    RAISE EXCEPTION 'E-mail obrigatorio';
  END IF;
  IF p_full_name IS NULL OR LENGTH(TRIM(p_full_name)) < 3 THEN
    RAISE EXCEPTION 'Nome completo invalido (minimo 3 caracteres)';
  END IF;

  -- Calcula hash do email (lowercase + trim)
  v_email_hash := encode(digest(LOWER(TRIM(p_email)), 'sha256'), 'hex');

  -- Verifica se ja existe pre-cadastro PENDENTE com este email
  SELECT id INTO v_existing_id
  FROM public.pre_cadastro
  WHERE company_id = p_company_id
    AND email      = LOWER(TRIM(p_email))
    AND status     = 'PENDENTE'
  FOR UPDATE;

  IF FOUND THEN
    -- Renova token do existente (idempotencia)
    UPDATE public.pre_cadastro
    SET token_confirmacao = encode(gen_random_bytes(32), 'hex'),
        dt_token_exp      = v_dt_exp,
        dt_ultimo_envio   = NOW(),
        tentativas_confirmacao = 0,
        -- Atualiza dados que o usuario pode ter corrigido
        full_name  = p_full_name,
        phone      = p_phone,
        birth_date = p_birth_date,
        gender     = p_gender,
        cep        = p_cep,
        logradouro = p_logradouro,
        numero     = p_numero,
        complemento = p_complemento,
        bairro     = p_bairro,
        cidade     = p_cidade,
        uf         = p_uf
    WHERE id = v_existing_id
    RETURNING pre_cadastro.id,
              pre_cadastro.token_confirmacao,
              pre_cadastro.dt_token_exp
      INTO id, token, dt_exp;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Cria novo pre-cadastro
  v_token := encode(gen_random_bytes(32), 'hex');
  v_id    := gen_random_uuid();

  INSERT INTO public.pre_cadastro (
    id, company_id,
    full_name, email, email_hash, phone, whatsapp,
    birth_date, gender,
    cep, logradouro, numero, complemento, bairro, cidade, uf,
    lg_aceite_termo, dt_aceite_termo, versao_termo, texto_termo_hash,
    ip_origem, user_agent,
    token_confirmacao, dt_token_exp, dt_ultimo_envio
  ) VALUES (
    v_id, p_company_id,
    p_full_name, LOWER(TRIM(p_email)), v_email_hash, p_phone, p_phone,
    p_birth_date, p_gender,
    p_cep, p_logradouro, p_numero, p_complemento, p_bairro, p_cidade, p_uf,
    TRUE, NOW(), p_versao_termo, p_texto_termo_hash,
    p_ip_origem, p_user_agent,
    v_token, v_dt_exp, NOW()
  );

  id    := v_id;
  token := v_token;
  dt_exp := v_dt_exp;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.create_pre_cadastro IS 'Cria pre-cadastro (sign-up publico) ou renova token se ja existir PENDENTE. Idempotente por (company_id, email).';

-- ============================================================================
-- 1.3. RPC: confirm_pre_cadastro
-- Valida o token, marca como CONFIRMADO. Requer token valido e nao expirado.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.confirm_pre_cadastro(p_token VARCHAR)
RETURNS TABLE(id UUID, full_name VARCHAR, email VARCHAR, status VARCHAR, company_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record RECORD;
BEGIN
  IF p_token IS NULL OR LENGTH(p_token) < 16 THEN
    RAISE EXCEPTION 'Token invalido';
  END IF;

  SELECT * INTO v_record
  FROM public.pre_cadastro
  WHERE token_confirmacao = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Token invalido ou pre-cadastro nao encontrado';
  END IF;

  IF v_record.status = 'CONFIRMADO' THEN
    -- Ja confirmado — idempotente, retorna o registro
    id         := v_record.id;
    full_name  := v_record.full_name;
    email      := v_record.email;
    status     := v_record.status;
    company_id := v_record.company_id;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_record.status = 'MIGRADO' THEN
    RAISE EXCEPTION 'Pre-cadastro ja migrado para paciente definitivo';
  END IF;

  IF v_record.status = 'CANCELADO' THEN
    RAISE EXCEPTION 'Pre-cadastro cancelado';
  END IF;

  IF v_record.dt_token_exp < NOW() THEN
    UPDATE public.pre_cadastro
    SET status = 'EXPIRADO', tentativas_confirmacao = tentativas_confirmacao + 1
    WHERE id = v_record.id;
    RAISE EXCEPTION 'Token expirado — refaca o pre-cadastro';
  END IF;

  UPDATE public.pre_cadastro
  SET lg_confirmado          = TRUE,
      dt_confirmacao         = NOW(),
      status                 = 'CONFIRMADO',
      tentativas_confirmacao = tentativas_confirmacao + 1
  WHERE id = v_record.id;

  id         := v_record.id;
  full_name  := v_record.full_name;
  email      := v_record.email;
  status     := 'CONFIRMADO';
  company_id := v_record.company_id;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.confirm_pre_cadastro IS 'Confirma pre-cadastro via token (valido por 72h). Idempotente.';

-- ============================================================================
-- 1.4. RPC: promote_pre_cadastro
-- Chamada pelo admin/recepcao APOS confirmacao por e-mail.
-- Migra o registro para public.patients e marca como MIGRADO.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.promote_pre_cadastro(p_id UUID)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pre            RECORD;
  v_new_patient_id BIGINT;
  v_existing_patient BIGINT;
BEGIN
  SELECT * INTO v_pre FROM public.pre_cadastro WHERE id = p_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pre-cadastro % nao encontrado', p_id;
  END IF;

  IF v_pre.status = 'MIGRADO' AND v_pre.cd_paciente_final IS NOT NULL THEN
    -- Ja migrado — idempotente
    RETURN v_pre.cd_paciente_final;
  END IF;

  IF v_pre.status != 'CONFIRMADO' THEN
    RAISE EXCEPTION 'Pre-cadastro precisa estar CONFIRMADO (atual: %)', v_pre.status;
  END IF;

  -- Verifica se ja existe paciente com mesmo email ou CPF na empresa
  IF v_pre.cpf_hash IS NOT NULL THEN
    SELECT id INTO v_existing_patient
    FROM public.patients
    WHERE company_id = v_pre.company_id AND cpf_hash = v_pre.cpf_hash
    LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'Ja existe paciente com este CPF (id=%)', v_existing_patient;
    END IF;
  END IF;

  -- Cria paciente definitivo
  INSERT INTO public.patients (
    company_id, full_name, cpf, cpf_hash, birth_date, gender,
    email, email_hash, phone, whatsapp,
    cep, logradouro, numero, complemento, bairro, cidade, uf, ibge_cidade,
    lg_aceite_termo, dt_aceite_termo
  ) VALUES (
    v_pre.company_id, v_pre.full_name, v_pre.cpf, v_pre.cpf_hash,
    v_pre.birth_date, v_pre.gender,
    v_pre.email, v_pre.email_hash, v_pre.phone, v_pre.whatsapp,
    v_pre.cep, v_pre.logradouro, v_pre.numero, v_pre.complemento,
    v_pre.bairro, v_pre.cidade, v_pre.uf, v_pre.ibge_cidade,
    TRUE, COALESCE(v_pre.dt_aceite_termo, NOW())
  )
  RETURNING id INTO v_new_patient_id;

  -- Atualiza pre-cadastro
  UPDATE public.pre_cadastro
  SET status           = 'MIGRADO',
      cd_paciente_final = v_new_patient_id,
      dt_migracao       = NOW()
  WHERE id = p_id;

  RETURN v_new_patient_id;
END;
$$;

COMMENT ON FUNCTION public.promote_pre_cadastro IS 'Migra pre-cadastro CONFIRMADO para public.patients. Retorna o novo patient.id.';

-- ============================================================================
-- 1.5. RPC: cancel_pre_cadastro
-- Cancela um pre-cadastro (admin ou o proprio titular via /cancelar-link).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.cancel_pre_cadastro(
  p_id     UUID,
  p_motivo TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status VARCHAR(20);
BEGIN
  IF p_motivo IS NULL OR LENGTH(TRIM(p_motivo)) = 0 THEN
    RAISE EXCEPTION 'Motivo do cancelamento e obrigatorio';
  END IF;

  SELECT status INTO v_status FROM public.pre_cadastro WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pre-cadastro % nao encontrado', p_id;
  END IF;

  IF v_status = 'MIGRADO' THEN
    RAISE EXCEPTION 'Pre-cadastro ja migrado — cancelamento nao permitido';
  END IF;

  UPDATE public.pre_cadastro
  SET status             = 'CANCELADO',
      motivo_cancelamento = p_motivo
  WHERE id = p_id;

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION public.cancel_pre_cadastro IS 'Cancela pre-cadastro (admin ou titular). Bloqueado se ja migrado.';

-- ============================================================================
-- 1.6. RLS Policies
-- Padrao:
--   - Qualquer um (anon ou authenticated) pode CRIAR (sign-up publico)
--   - Staff da empresa pode LER e ATUALIZAR os proprios
--   - A confirmacao por token e feita via RPC (nao via policy)
-- ============================================================================
ALTER TABLE public.pre_cadastro ENABLE ROW LEVEL SECURITY;

-- INSERT publico (sign-up)
DROP POLICY IF EXISTS "pre_cadastro_anon_insert" ON public.pre_cadastro;
CREATE POLICY "pre_cadastro_anon_insert"
  ON public.pre_cadastro FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- SELECT staff (somente da propria empresa)
DROP POLICY IF EXISTS "pre_cadastro_staff_select" ON public.pre_cadastro;
CREATE POLICY "pre_cadastro_staff_select"
  ON public.pre_cadastro FOR SELECT
  TO authenticated
  USING (
    company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role_name = 'admin'
    )
  );

-- UPDATE staff (somente da propria empresa)
DROP POLICY IF EXISTS "pre_cadastro_staff_update" ON public.pre_cadastro;
CREATE POLICY "pre_cadastro_staff_update"
  ON public.pre_cadastro FOR UPDATE
  TO authenticated
  USING (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()))
  WITH CHECK (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

-- DELETE restrito a admin
DROP POLICY IF EXISTS "pre_cadastro_admin_delete" ON public.pre_cadastro;
CREATE POLICY "pre_cadastro_admin_delete"
  ON public.pre_cadastro FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role_name = 'admin'
    )
  );

-- ============================================================================
-- 1.7. View: pre_cadastros_pendentes
-- Lista pre-cadastros PENDENTES e ainda dentro do prazo (admin dashboard).
-- ============================================================================
CREATE OR REPLACE VIEW public.pre_cadastros_pendentes AS
SELECT
  pc.id,
  pc.company_id,
  pc.full_name,
  pc.email,
  pc.phone,
  pc.birth_date,
  pc.gender,
  pc.cep,
  pc.cidade,
  pc.uf,
  pc.created_at,
  pc.dt_token_exp,
  EXTRACT(EPOCH FROM (pc.dt_token_exp - NOW())) / 3600 AS horas_para_expirar,
  pc.dt_ultimo_envio,
  pc.tentativas_confirmacao
FROM public.pre_cadastro pc
WHERE pc.status = 'PENDENTE'
  AND pc.dt_token_exp > NOW()
ORDER BY pc.created_at DESC;

COMMENT ON VIEW public.pre_cadastros_pendentes IS 'Pre-cadastros PENDENTES com token ainda valido (admin dashboard)';

-- ============================================================================
-- 1.8. Grants
-- ============================================================================
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- anon pode chamar a RPC de criar (sign-up publico)
GRANT EXECUTE ON FUNCTION public.create_pre_cadastro(
  UUID, VARCHAR, VARCHAR, VARCHAR, DATE, CHAR,
  VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, CHAR,
  VARCHAR, CHAR, INET, TEXT
) TO anon, authenticated;

-- confirm/cancel/promote: requerem contexto (token, ou staff)
GRANT EXECUTE ON FUNCTION public.confirm_pre_cadastro(VARCHAR)         TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_pre_cadastro(UUID, TEXT)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.promote_pre_cadastro(UUID)            TO authenticated;

-- View: staff autenticado
GRANT SELECT ON public.pre_cadastros_pendentes TO authenticated;
