ALTER TABLE auth.refresh_tokens
  ADD COLUMN IF NOT EXISTS session_jti UUID;

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_session
  ON auth.refresh_tokens(user_id, session_jti)
  WHERE revoked = FALSE;

INSERT INTO public.prontomedic_deployment_migrations(filename)
VALUES ('20260731013000_auth_refresh_token_session_parity.sql')
ON CONFLICT (filename) DO NOTHING;
