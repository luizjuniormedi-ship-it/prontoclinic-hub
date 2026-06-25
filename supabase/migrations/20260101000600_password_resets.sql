-- =============================================================================
-- Migration: 20260101000006_password_resets
-- Descrição: Tokens de redefinição de senha (first-access) para usuários
--            migrados do SIGH. Como o SIGH armazena senhas em texto puro
--            e a LGPD proíbe migrá-las, geramos token de primeiro acesso.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.password_resets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  token VARCHAR(64) UNIQUE NOT NULL,
  dt_exp TIMESTAMPTZ NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  ip_origem INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at TIMESTAMPTZ
);

CREATE INDEX idx_password_resets_user ON public.password_resets(user_id);
CREATE INDEX idx_password_resets_token ON public.password_resets(token);
CREATE INDEX idx_password_resets_active ON public.password_resets(token, used, dt_exp)
  WHERE used = FALSE;

COMMENT ON TABLE public.password_resets IS
  'Tokens de redefinição de senha (first-access) para usuários migrados do SIGH';
COMMENT ON COLUMN public.password_resets.token IS
  'Token URL-safe (32 bytes hex = 64 chars) enviado por e-mail ao usuário';
COMMENT ON COLUMN public.password_resets.dt_exp IS
  'Expiração do token (default: NOW() + 72h)';
COMMENT ON COLUMN public.password_resets.ip_origem IS
  'IP de origem da requisição de reset (auditoria)';

ALTER TABLE public.password_resets ENABLE ROW LEVEL SECURITY;

-- Usuário só vê os próprios tokens
CREATE POLICY "Users can read own password_resets"
  ON public.password_resets FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Service role (migração) pode inserir livremente
CREATE POLICY "Service role can insert password_resets"
  ON public.password_resets FOR INSERT
  TO service_role
  WITH CHECK (TRUE);

-- Service role pode atualizar (marcar used)
CREATE POLICY "Service role can update password_resets"
  ON public.password_resets FOR UPDATE
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

-- Função utilitária: cria token de primeiro acesso para um user_id
CREATE OR REPLACE FUNCTION public.create_password_reset(
  p_user_id UUID,
  p_ttl_hours INTEGER DEFAULT 72,
  p_ip INET DEFAULT NULL
)
RETURNS VARCHAR(64) AS $$
DECLARE
  v_token VARCHAR(64);
BEGIN
  -- 32 bytes hex = 64 chars (sem dependência de pgcrypto)
  v_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO public.password_resets (user_id, token, dt_exp, ip_origem)
  VALUES (p_user_id, v_token, NOW() + (p_ttl_hours || ' hours')::INTERVAL, p_ip);
  RETURN v_token;
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER;

COMMENT ON FUNCTION public.create_password_reset IS
  'Cria token de redefinição de senha (32 bytes hex) com TTL configurável (default 72h)';
