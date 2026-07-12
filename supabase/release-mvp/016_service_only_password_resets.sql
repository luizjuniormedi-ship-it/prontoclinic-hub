-- MVP release baseline: password reset writes are service-only.
-- Existing broad policies are not replayed in this baseline.
ALTER TABLE public.password_resets ENABLE ROW LEVEL SECURITY;
CREATE POLICY mvp_password_resets_service_only
  ON public.password_resets FOR ALL TO service_role
  USING (true) WITH CHECK (true);

