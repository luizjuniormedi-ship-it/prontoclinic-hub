-- Minimal Supabase-compatible shim for disposable PostgreSQL replay only.
-- Never run this file against VPS, hosted Supabase or production databases.

DO $roles$
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    CREATE ROLE supabase_auth_admin NOLOGIN BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    CREATE ROLE supabase_admin NOLOGIN BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_prontomedic') THEN
    CREATE ROLE app_prontomedic NOLOGIN NOINHERIT NOBYPASSRLS;
  END IF;
END
$roles$;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY,
  email VARCHAR(255),
  encrypted_password VARCHAR(255),
  email_confirmed_at TIMESTAMPTZ,
  raw_app_meta_data JSONB NOT NULL DEFAULT '{}'::JSONB,
  raw_user_meta_data JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth.refresh_tokens (
  token TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent TEXT,
  session_jti UUID,
  assurance_level TEXT NOT NULL DEFAULT 'aal1'
    CHECK (assurance_level IN ('aal1', 'aal2')),
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE SQL
STABLE
AS $function$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', TRUE), '')::UUID
$function$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS TEXT
LANGUAGE SQL
STABLE
AS $function$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', TRUE), ''),
    'authenticated'
  )
$function$;

CREATE OR REPLACE FUNCTION auth.jwt()
RETURNS JSONB
LANGUAGE SQL
STABLE
AS $function$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claims', TRUE), '')::JSONB,
    '{}'::JSONB
  )
$function$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role(), auth.jwt()
  TO anon, authenticated, service_role;
