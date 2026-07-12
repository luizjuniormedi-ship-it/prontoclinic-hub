-- MVP release baseline: password reset tokens are service-only.
-- Canonical clean-baseline artifact. No broad USING(TRUE) policy.
CREATE TABLE IF NOT EXISTS public.password_resets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token VARCHAR(64) UNIQUE NOT NULL,
  dt_exp TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  ip_origem INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_password_resets_user
  ON public.password_resets(user_id);
CREATE INDEX IF NOT EXISTS idx_password_resets_active
  ON public.password_resets(token, used, dt_exp)
  WHERE used = FALSE;

ALTER TABLE public.password_resets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_resets FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  DROP POLICY IF EXISTS mvp_password_resets_service_only ON public.password_resets;
  CREATE POLICY mvp_password_resets_service_only
    ON public.password_resets FOR ALL TO service_role
    USING (current_user = 'service_role')
    WITH CHECK (current_user = 'service_role');
END
$$;

REVOKE ALL ON TABLE public.password_resets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.password_resets TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.password_resets_id_seq TO service_role;
