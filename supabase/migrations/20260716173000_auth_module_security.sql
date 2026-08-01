-- Module 1: authentication, session security and access audit.
-- Local application schema only. No DataSIGH or clinical data is touched.

CREATE TABLE IF NOT EXISTS public.auth_account_security (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  password_changed_at TIMESTAMPTZ,
  password_expires_at TIMESTAMPTZ,
  mfa_required BOOLEAN NOT NULL DEFAULT FALSE,
  last_login_at TIMESTAMPTZ,
  last_login_user_agent TEXT,
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  account_locked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.auth_session_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL CHECK (char_length(device_id) BETWEEN 16 AND 128),
  device_label TEXT NOT NULL DEFAULT 'Navegador',
  user_agent TEXT,
  ip_address INET,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  UNIQUE (user_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_auth_session_devices_user
  ON public.auth_session_devices(user_id, revoked_at, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS public.auth_security_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'login_success', 'login_failure', 'logout', 'logout_all', 'mfa_challenge',
    'mfa_success', 'mfa_failure', 'password_changed', 'password_recovery_requested',
    'session_expired', 'device_revoked', 'account_blocked'
  )),
  success BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_security_events_user_time
  ON public.auth_security_events(user_id, created_at DESC);

ALTER TABLE public.auth_session_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_account_security ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.auth_session_devices TO authenticated;
GRANT SELECT, INSERT ON public.auth_security_events TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.auth_account_security TO authenticated;

DROP POLICY IF EXISTS auth_account_security_select ON public.auth_account_security;
CREATE POLICY auth_account_security_select ON public.auth_account_security
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS auth_account_security_insert ON public.auth_account_security;
CREATE POLICY auth_account_security_insert ON public.auth_account_security
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS auth_account_security_update ON public.auth_account_security;
CREATE POLICY auth_account_security_update ON public.auth_account_security
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS auth_account_security_admin_update ON public.auth_account_security;
CREATE POLICY auth_account_security_admin_update ON public.auth_account_security
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.user_profiles actor
        JOIN public.user_profiles target ON target.id = auth_account_security.user_id
       WHERE actor.id = (SELECT auth.uid())
         AND lower(COALESCE(actor.role_name, '')) = 'admin'
         AND (actor.company_id IS NULL OR actor.company_id = target.company_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.user_profiles actor
        JOIN public.user_profiles target ON target.id = auth_account_security.user_id
       WHERE actor.id = (SELECT auth.uid())
         AND lower(COALESCE(actor.role_name, '')) = 'admin'
         AND (actor.company_id IS NULL OR actor.company_id = target.company_id)
    )
  );

DROP POLICY IF EXISTS auth_session_devices_select ON public.auth_session_devices;
CREATE POLICY auth_session_devices_select ON public.auth_session_devices
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.user_profiles p
      WHERE p.id = (SELECT auth.uid()) AND lower(COALESCE(p.role_name, '')) = 'admin'
    )
  );

DROP POLICY IF EXISTS auth_session_devices_insert ON public.auth_session_devices;
CREATE POLICY auth_session_devices_insert ON public.auth_session_devices
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND company_id IS NOT DISTINCT FROM (
      SELECT p.company_id FROM public.user_profiles p WHERE p.id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS auth_session_devices_update ON public.auth_session_devices;
CREATE POLICY auth_session_devices_update ON public.auth_session_devices
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND company_id IS NOT DISTINCT FROM (
      SELECT p.company_id FROM public.user_profiles p WHERE p.id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS auth_session_devices_delete ON public.auth_session_devices;
CREATE POLICY auth_session_devices_delete ON public.auth_session_devices
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS auth_security_events_select ON public.auth_security_events;
CREATE POLICY auth_security_events_select ON public.auth_security_events
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.user_profiles p
      WHERE p.id = (SELECT auth.uid()) AND lower(COALESCE(p.role_name, '')) = 'admin'
    )
  );

DROP POLICY IF EXISTS auth_security_events_insert ON public.auth_security_events;
CREATE POLICY auth_security_events_insert ON public.auth_security_events
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND company_id IS NOT DISTINCT FROM (
      SELECT p.company_id FROM public.user_profiles p WHERE p.id = (SELECT auth.uid())
    )
  );

CREATE OR REPLACE FUNCTION public.normalize_auth_security_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.user_id := auth.uid();
  SELECT p.company_id INTO NEW.company_id
    FROM public.user_profiles p
   WHERE p.id = auth.uid();
  NEW.success := NEW.event_type NOT LIKE '%failure';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_auth_security_event ON public.auth_security_events;
CREATE TRIGGER trg_normalize_auth_security_event
  BEFORE INSERT ON public.auth_security_events
  FOR EACH ROW EXECUTE FUNCTION public.normalize_auth_security_event();

REVOKE EXECUTE ON FUNCTION public.normalize_auth_security_event() FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.auth_session_devices IS
  'Application device registry. Stores no access or refresh tokens.';
COMMENT ON TABLE public.auth_security_events IS
  'Security events visible only to the subject or authorized administrators.';
COMMENT ON TABLE public.auth_account_security IS
  'Password-expiry, first-access and MFA flags isolated from user_profiles.';
