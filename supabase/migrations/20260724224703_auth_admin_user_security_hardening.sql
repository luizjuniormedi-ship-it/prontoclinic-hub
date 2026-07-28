-- Module 1 hardening for administrator-provisioned users.
-- Keeps password state server-owned, makes audit events complete, and lets an
-- expired or temporary password authenticate only far enough to be replaced.
-- DataSIGH is not accessed by this migration.

BEGIN;

ALTER TABLE public.auth_security_events
  DROP CONSTRAINT IF EXISTS auth_security_events_event_type_check;
ALTER TABLE public.auth_security_events
  ADD CONSTRAINT auth_security_events_event_type_check
  CHECK (event_type IN (
    'login_success', 'login_failure', 'logout', 'logout_all', 'mfa_challenge',
    'mfa_success', 'mfa_failure', 'password_changed', 'password_recovery_requested',
    'password_reset_completed', 'session_expired', 'device_revoked',
    'account_blocked', 'admin_user_invited', 'admin_user_updated',
    'admin_password_reset'
  ));

ALTER TABLE public.auth_account_security ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_account_security FORCE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE ON public.auth_account_security FROM authenticated;
GRANT SELECT ON public.auth_account_security TO authenticated;

DROP POLICY IF EXISTS auth_account_security_insert ON public.auth_account_security;
DROP POLICY IF EXISTS auth_account_security_update ON public.auth_account_security;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_prontomedic') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.auth_account_security TO app_prontomedic';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS auth_users_username_ci_unique
  ON auth.users ((lower(raw_user_meta_data->>'username')))
  WHERE NULLIF(BTRIM(raw_user_meta_data->>'username'), '') IS NOT NULL;

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
   WHERE (
       lower(u.email) = lower(p_identifier)
       OR lower(COALESCE(u.raw_user_meta_data->>'username', '')) = lower(p_identifier)
       OR regexp_replace(COALESCE(p.cpf, ''), '\D', '', 'g') = regexp_replace(p_identifier, '\D', '', 'g')
       OR regexp_replace(COALESCE(u.raw_user_meta_data->>'cpf', ''), '\D', '', 'g') = regexp_replace(p_identifier, '\D', '', 'g')
     )
     AND p.lg_ativo IS TRUE
     AND p.blocked_at IS NULL
     AND (p.access_valid_until IS NULL OR p.access_valid_until > now())
     AND (s.account_locked_until IS NULL OR s.account_locked_until <= now());
$$;

ALTER FUNCTION private.lookup_auth_user(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.lookup_auth_user(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.lookup_auth_user(TEXT) TO app_prontomedic;

INSERT INTO public.prontomedic_deployment_migrations(filename)
VALUES ('20260724224703_auth_admin_user_security_hardening.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
