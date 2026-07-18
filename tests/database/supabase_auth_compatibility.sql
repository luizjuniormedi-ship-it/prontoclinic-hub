-- Test-only compatibility layer for replaying Supabase migrations on plain PostgreSQL.
-- This file MUST NOT be deployed as a Supabase migration.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY,
  instance_id UUID,
  aud TEXT,
  role TEXT,
  email TEXT,
  encrypted_password TEXT,
  email_confirmed_at TIMESTAMPTZ,
  raw_app_meta_data JSONB,
  raw_user_meta_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  confirmation_token TEXT,
  email_change TEXT,
  email_change_token_new TEXT,
  recovery_token TEXT
);

CREATE TABLE IF NOT EXISTS auth.refresh_tokens (
  token UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent UUID,
  session_id UUID,
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE auth.refresh_tokens ADD COLUMN IF NOT EXISTS parent UUID;
ALTER TABLE auth.refresh_tokens ADD COLUMN IF NOT EXISTS session_id UUID;

CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_user
  ON auth.refresh_tokens(user_id, revoked);

DO $$
BEGIN
  IF to_regprocedure('auth.uid()') IS NULL THEN
    EXECUTE $fn$
      CREATE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE
      AS 'SELECT NULLIF(current_setting(''request.jwt.claim.sub'', true), '''')::uuid'
    $fn$;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION auth.jwt()
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN NULLIF(current_setting('request.jwt.claims', true), '') IS NOT NULL
      THEN current_setting('request.jwt.claims', true)::jsonb
    WHEN NULLIF(current_setting('request.jwt.claim.sub', true), '') IS NOT NULL
      THEN jsonb_build_object(
        'sub', current_setting('request.jwt.claim.sub', true),
        'role', 'authenticated'
      )
    ELSE '{}'::jsonb
  END;
$$;

-- Test-only Supabase Vault compatibility. Production uses the real
-- `supabase_vault` extension; this exists only in plain PostgreSQL replay DBs.
CREATE SCHEMA IF NOT EXISTS vault;

CREATE TABLE IF NOT EXISTS vault.secrets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  secret TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE VIEW vault.decrypted_secrets AS
SELECT id, name, description, secret AS decrypted_secret, created_at, updated_at
FROM vault.secrets;

CREATE OR REPLACE FUNCTION vault.create_secret(
  new_secret TEXT,
  new_name TEXT DEFAULT NULL,
  new_description TEXT DEFAULT ''
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO vault.secrets(name, description, secret)
  VALUES (new_name, new_description, new_secret)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
