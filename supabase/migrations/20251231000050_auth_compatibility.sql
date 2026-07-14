-- Compatibility layer for clean PostgreSQL replays outside Supabase.
-- On Supabase, auth.users already exists and both statements are no-ops.
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

-- O auth proxy local persiste refresh tokens para reproduzir o contrato do
-- Supabase. No Supabase real esta tabela ja existe; no replay limpo ela precisa
-- ser criada para que o primeiro login nao falhe depois da senha valida.
CREATE TABLE IF NOT EXISTS auth.refresh_tokens (
  token UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_user
  ON auth.refresh_tokens(user_id, revoked);

-- A tabela real do Supabase já existe; estes ADDs tornam apenas o replay
-- limpo compatível com o seed E2E e com o auth server local.
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS instance_id UUID;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS aud TEXT;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS role TEXT;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS encrypted_password TEXT;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at TIMESTAMPTZ;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_app_meta_data JSONB;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_user_meta_data JSONB;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS confirmation_token TEXT;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_change TEXT;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_change_token_new TEXT;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS recovery_token TEXT;

-- Supabase provides auth.uid(); keep an inert compatibility function for
-- clean PostgreSQL replays without replacing an existing implementation.
DO $$
BEGIN
  IF to_regprocedure('auth.uid()') IS NULL THEN
    EXECUTE 'CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS ''SELECT NULL::uuid''';
  END IF;
END
$$;
