\set ON_ERROR_STOP on

BEGIN;

DROP POLICY IF EXISTS m9_appointments_scoped_select
  ON public.appointments;
CREATE POLICY m9_appointments_scoped_select
  ON public.appointments
  FOR SELECT TO authenticated
  USING (
    company_id = private.current_company_id()
    AND (
      unit_id IS NULL
      OR public.org_can_access_unit(company_id, unit_id)
    )
  );

DROP POLICY IF EXISTS m9_app_appointments_scoped_select
  ON public.appointments;
CREATE POLICY m9_app_appointments_scoped_select
  ON public.appointments
  FOR SELECT TO app_prontomedic
  USING (
    company_id = private.current_company_id()
    AND (
      unit_id IS NULL
      OR public.org_can_access_unit(company_id, unit_id)
    )
  );

INSERT INTO public.prontomedic_deployment_migrations(filename)
VALUES ('20260726191000_module11_reception_appointment_read_policy_boundary.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
