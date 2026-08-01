-- Close permissive company-wide policies introduced after the original
-- operational RLS closure. PostgreSQL ORs permissive policies, so leaving the
-- legacy rules active would bypass the selected unit context.

BEGIN;

ALTER TABLE public.insurance_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_authorizations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_eligibility_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_eligibility_checks FORCE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_authorization_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_authorization_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_authorization_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_authorization_attachments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments FORCE ROW LEVEL SECURITY;

-- row_security=off leaked into the eligibility audit trigger. The function
-- already validates tenant, unit, actor, AAL and permissions explicitly.
ALTER FUNCTION public.create_appointment_with_requirements_secure(
  BIGINT, BIGINT, DATE, TIME, TIME, UUID, INTEGER, INTEGER,
  BIGINT, BIGINT, TEXT, BOOLEAN, BOOLEAN, TEXT, INTEGER, TEXT, TEXT
) RESET row_security;

DROP POLICY IF EXISTS m15_authorizations_select
  ON public.insurance_authorizations;
DROP POLICY IF EXISTS m15_authorizations_insert
  ON public.insurance_authorizations;
DROP POLICY IF EXISTS m15_authorizations_update
  ON public.insurance_authorizations;
DROP POLICY IF EXISTS insurance_eligibility_select_tenant
  ON public.insurance_eligibility_checks;
DROP POLICY IF EXISTS m15_authorization_events_select
  ON public.insurance_authorization_events;
DROP POLICY IF EXISTS m15_authorization_attachments_select
  ON public.insurance_authorization_attachments;
DROP POLICY IF EXISTS insurance_authorization_events_unit_select
  ON public.insurance_authorization_events;
DROP POLICY IF EXISTS insurance_authorization_attachments_unit_select
  ON public.insurance_authorization_attachments;
DROP POLICY IF EXISTS m9_appointments_scoped_select
  ON public.appointments;
DROP POLICY IF EXISTS m9_app_appointments_scoped_select
  ON public.appointments;
DROP POLICY IF EXISTS appointments_app_context_select
  ON public.appointments;

DROP POLICY IF EXISTS insurance_authorizations_select_unit
  ON public.insurance_authorizations;
CREATE POLICY insurance_authorizations_select_unit
  ON public.insurance_authorizations
  FOR SELECT
  TO authenticated
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND (
      public.can_access('recepcao', 'view')
      OR public.can_access('faturamento', 'view')
      OR public.can_access('agenda', 'view')
    )
  );

DROP POLICY IF EXISTS insurance_eligibility_select_unit
  ON public.insurance_eligibility_checks;
CREATE POLICY insurance_eligibility_select_unit
  ON public.insurance_eligibility_checks
  FOR SELECT
  TO authenticated
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND (
      public.can_access('recepcao', 'view')
      OR public.can_access('faturamento', 'view')
      OR public.can_access('agenda', 'view')
    )
  );

CREATE POLICY insurance_authorization_events_unit_select
  ON public.insurance_authorization_events
  FOR SELECT
  TO authenticated, app_prontomedic
  USING (
    company_id = public.active_company_id()
    AND EXISTS (
      SELECT 1
      FROM public.insurance_authorizations authz
      WHERE authz.id = authorization_id
        AND authz.company_id = insurance_authorization_events.company_id
        AND authz.unit_id = public.active_unit_id()
    )
    AND (
      public.can_access('recepcao', 'view')
      OR public.can_access('faturamento', 'view')
      OR public.can_access('agenda', 'view')
    )
  );

CREATE POLICY insurance_authorization_attachments_unit_select
  ON public.insurance_authorization_attachments
  FOR SELECT
  TO authenticated, app_prontomedic
  USING (
    company_id = public.active_company_id()
    AND deleted_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.insurance_authorizations authz
      WHERE authz.id = authorization_id
        AND authz.company_id = insurance_authorization_attachments.company_id
        AND authz.unit_id = public.active_unit_id()
    )
    AND (
      public.can_access('recepcao', 'view')
      OR public.can_access('faturamento', 'view')
      OR public.can_access('agenda', 'view')
    )
  );

CREATE POLICY appointments_app_context_select
  ON public.appointments
  FOR SELECT
  TO app_prontomedic
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND (
      public.can_access('appointments', 'view')
      OR public.can_access('agenda', 'view')
      OR public.can_access('recepcao', 'view')
    )
  );

DROP POLICY IF EXISTS insurance_eligibility_events_unit_select
  ON public.insurance_eligibility_events;
CREATE POLICY insurance_eligibility_events_unit_select
  ON public.insurance_eligibility_events
  FOR SELECT
  TO authenticated, app_prontomedic
  USING (
    company_id = public.active_company_id()
    AND EXISTS (
      SELECT 1
      FROM public.insurance_eligibility_checks eligibility
      WHERE eligibility.id = eligibility_check_id
        AND eligibility.company_id = insurance_eligibility_events.company_id
        AND eligibility.unit_id = public.active_unit_id()
    )
    AND (
      public.can_access('recepcao', 'view')
      OR public.can_access('faturamento', 'view')
      OR public.can_access('agenda', 'view')
    )
  );

DROP POLICY IF EXISTS insurance_eligibility_events_reception_owner_insert
  ON public.insurance_eligibility_events;
CREATE POLICY insurance_eligibility_events_reception_owner_insert
  ON public.insurance_eligibility_events
  FOR INSERT
  TO prontomedic_reception_rpc_owner
  WITH CHECK (
    company_id = COALESCE(
      public.current_company_id(),
      NULLIF(
        current_setting('request.jwt.claim.company_id', true),
        ''
      )::UUID
    )
  );

DO $policy_guard$
DECLARE
  v_policy RECORD;
BEGIN
  FOR v_policy IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'appointments',
        'insurance_authorizations',
        'insurance_authorization_events',
        'insurance_authorization_attachments',
        'insurance_eligibility_checks'
      )
      AND 'authenticated' = ANY(roles)
      AND cmd = 'SELECT'
      AND policyname NOT IN (
        'appointments_access_select',
        'insurance_authorizations_select_unit',
        'insurance_authorization_events_unit_select',
        'insurance_authorization_attachments_unit_select',
        'insurance_eligibility_select_unit'
      )
  LOOP
    RAISE EXCEPTION
      'RECEPTION_UNIT_RLS_OVERLAP: public.%.%',
      v_policy.tablename,
      v_policy.policyname;
  END LOOP;
END
$policy_guard$;

INSERT INTO public.prontomedic_deployment_migrations(filename)
VALUES ('20260727045440_close_reception_unit_rls.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
