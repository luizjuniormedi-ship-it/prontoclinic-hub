-- Allow the fixed-purpose reception transition to lock only its authorized appointment.

DROP POLICY IF EXISTS appointments_reception_rpc_select
  ON public.appointments;
CREATE POLICY appointments_reception_rpc_select
  ON public.appointments
  FOR SELECT TO prontomedic_reception_rpc_owner
  USING (
    company_id = public.current_company_id()
    AND (
      unit_id IS NULL
      OR private.reception_actor_can_access_unit(company_id, unit_id)
    )
  );

INSERT INTO public.prontomedic_deployment_migrations(filename)
VALUES ('20260728163000_reception_appointment_rpc_read_scope.sql')
ON CONFLICT (filename) DO NOTHING;
