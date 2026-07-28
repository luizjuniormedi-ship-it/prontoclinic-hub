-- Module 1 parity: native auth backend contracts for MFA, recovery,
-- sessions/devices and security audit. No DataSIGH or clinical data is touched.

BEGIN;

CREATE TABLE IF NOT EXISTS public.auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  jti UUID NOT NULL UNIQUE,
  user_agent TEXT,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.password_resets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  token VARCHAR(64) UNIQUE NOT NULL,
  token_hash VARCHAR(64),
  dt_exp TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  ip_origem INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at TIMESTAMPTZ
);
ALTER TABLE public.password_resets ADD COLUMN IF NOT EXISTS token_hash VARCHAR(64);

CREATE TABLE IF NOT EXISTS public.auth_mfa_factors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  factor_type TEXT NOT NULL DEFAULT 'totp' CHECK (factor_type = 'totp'),
  friendly_name TEXT NOT NULL DEFAULT 'ProntoMedic',
  secret_ciphertext BYTEA NOT NULL,
  status TEXT NOT NULL DEFAULT 'unverified' CHECK (status IN ('unverified', 'verified', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, friendly_name)
);

ALTER TABLE public.auth_security_events ADD COLUMN IF NOT EXISTS ip_address INET;
ALTER TABLE public.auth_security_events DROP CONSTRAINT IF EXISTS auth_security_events_event_type_check;
ALTER TABLE public.auth_security_events ADD CONSTRAINT auth_security_events_event_type_check
  CHECK (event_type IN (
    'login_success', 'login_failure', 'logout', 'logout_all', 'mfa_challenge',
    'mfa_success', 'mfa_failure', 'password_changed', 'password_recovery_requested',
    'password_reset_completed', 'session_expired', 'device_revoked',
    'account_blocked', 'admin_user_invited'
  ));

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_active
  ON public.auth_sessions(user_id, revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_password_resets_active
  ON public.password_resets(token_hash, used, dt_exp);
CREATE INDEX IF NOT EXISTS idx_auth_mfa_factors_user
  ON public.auth_mfa_factors(user_id, status);

ALTER TABLE public.auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_resets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_mfa_factors ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.auth_sessions, public.password_resets, public.auth_mfa_factors FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.auth_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.auth_mfa_factors TO authenticated;

DROP POLICY IF EXISTS auth_sessions_self ON public.auth_sessions;
CREATE POLICY auth_sessions_self ON public.auth_sessions FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()) OR private.is_module_admin())
  WITH CHECK (user_id = (SELECT auth.uid()) OR private.is_module_admin());

DROP POLICY IF EXISTS auth_mfa_factors_self ON public.auth_mfa_factors;
CREATE POLICY auth_mfa_factors_self ON public.auth_mfa_factors FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()) OR private.is_module_admin())
  WITH CHECK (user_id = (SELECT auth.uid()) OR private.is_module_admin());

DROP POLICY IF EXISTS password_resets_no_client_access ON public.password_resets;
CREATE POLICY password_resets_no_client_access ON public.password_resets FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

INSERT INTO public.prontomedic_deployment_migrations(filename)
VALUES ('20260719160000_auth_module1_parity.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
