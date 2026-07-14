-- Tenant hardening for notification templates.
-- NULL company_id is the explicitly supported global catalog; scoped rows are
-- visible and writable only inside the authenticated user's company.

CREATE OR REPLACE FUNCTION public.can_manage_notification_templates()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.user_profiles
     WHERE id = auth.uid()
       AND role_name IN ('admin', 'manager')
  );
$$;

REVOKE ALL ON FUNCTION public.can_manage_notification_templates() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_notification_templates() TO authenticated;

DROP POLICY IF EXISTS "notification_templates_read" ON public.notification_templates;
CREATE POLICY "notification_templates_read"
  ON public.notification_templates
  FOR SELECT TO authenticated
  USING (
    company_id IS NULL
    OR company_id = public.get_my_company_id()
  );

DROP POLICY IF EXISTS "notification_templates_admin_write" ON public.notification_templates;
CREATE POLICY "notification_templates_admin_write"
  ON public.notification_templates
  FOR ALL TO authenticated
  USING (
    (company_id IS NULL OR company_id = public.get_my_company_id())
    AND public.can_manage_notification_templates()
  )
  WITH CHECK (
    (company_id IS NULL OR company_id = public.get_my_company_id())
    AND public.can_manage_notification_templates()
  );

COMMENT ON POLICY "notification_templates_read" ON public.notification_templates IS
  'Global templates are explicit (company_id NULL); scoped templates require the user company.';

-- RLS remains the authorization boundary; these table privileges enable the
-- admin policy to evaluate writes instead of failing before policy evaluation.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_templates TO authenticated;
