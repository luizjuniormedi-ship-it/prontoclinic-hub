-- Local Auth administrative contract: suspension plus one-time invite/recovery
-- challenges. This migration does not access DataSIGH or clinical data.

BEGIN;

ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS banned_until TIMESTAMPTZ;

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.local_auth_challenges (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('invite', 'recovery')),
  redirect_to TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  session_id UUID UNIQUE,
  password_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE private.local_auth_challenges
  ADD COLUMN IF NOT EXISTS session_id UUID UNIQUE,
  ADD COLUMN IF NOT EXISTS password_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS local_auth_challenges_lookup_idx
  ON private.local_auth_challenges (token_hash, type)
  WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS auth_users_banned_until_idx
  ON auth.users (banned_until)
  WHERE banned_until IS NOT NULL;

REVOKE ALL ON TABLE private.local_auth_challenges FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE private.local_auth_challenges TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE auth.users, auth.refresh_tokens TO service_role;

INSERT INTO public.prontomedic_deployment_migrations(filename)
VALUES ('20260802183000_local_auth_admin_contract.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
