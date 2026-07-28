-- Native VPS auth login lookup under RLS.
-- The login gateway must locate a user before a JWT exists. Keep this lookup
-- private, narrowly executable by the trusted gateway role, and out of the
-- public REST schema. DataSIGH is not involved.

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO app_prontomedic;

DROP FUNCTION IF EXISTS private.lookup_auth_user(TEXT);

CREATE OR REPLACE FUNCTION private.lookup_auth_user(p_identifier TEXT)
RETURNS TABLE (
  id UUID,
  email TEXT,
  encrypted_password TEXT,
  email_confirmed_at TIMESTAMPTZ,
  raw_app_meta_data JSONB,
  raw_user_meta_data JSONB,
  company_id UUID,
  lg_ativo BOOLEAN,
  must_change_password BOOLEAN,
  password_expires_at TIMESTAMPTZ,
  mfa_required BOOLEAN
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, auth, public, private
AS $$
  SELECT u.id,
         u.email::TEXT,
         u.encrypted_password::TEXT,
         u.email_confirmed_at,
         u.raw_app_meta_data,
         u.raw_user_meta_data,
         p.company_id,
         p.lg_ativo,
         COALESCE(s.must_change_password, FALSE),
         s.password_expires_at,
         COALESCE(s.mfa_required, FALSE)
    FROM auth.users AS u
    JOIN public.user_profiles AS p ON p.id = u.id
    LEFT JOIN public.auth_account_security AS s ON s.user_id = u.id
   WHERE (lower(u.email) = lower(p_identifier)
       OR lower(COALESCE(u.raw_user_meta_data->>'username', '')) = lower(p_identifier)
       OR regexp_replace(COALESCE(u.raw_user_meta_data->>'cpf', ''), '\\D', '', 'g') = regexp_replace(p_identifier, '\\D', '', 'g'))
     AND p.lg_ativo IS TRUE
     AND p.blocked_at IS NULL
     AND (p.access_valid_until IS NULL OR p.access_valid_until > now())
     AND (s.account_locked_until IS NULL OR s.account_locked_until <= now())
     AND (s.password_expires_at IS NULL OR s.password_expires_at > now());
$$;

ALTER FUNCTION private.lookup_auth_user(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.lookup_auth_user(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.lookup_auth_user(TEXT) TO app_prontomedic;

COMMENT ON FUNCTION private.lookup_auth_user(TEXT) IS
  'Pre-JWT login lookup for the native VPS gateway. Not exposed through public REST; executable only by app_prontomedic.';

INSERT INTO public.prontomedic_deployment_migrations(filename)
VALUES ('20260719191500_auth_private_login_lookup.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
