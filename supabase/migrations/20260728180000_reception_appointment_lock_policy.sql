-- Use one capability policy for SELECT ... FOR UPDATE in the reception transition.

DROP POLICY IF EXISTS appointments_reception_rpc_select
  ON public.appointments;
DROP POLICY IF EXISTS appointments_reception_rpc_update
  ON public.appointments;
DROP POLICY IF EXISTS appointments_reception_rpc_lock
  ON public.appointments;

CREATE POLICY appointments_reception_rpc_lock
  ON public.appointments
  FOR ALL TO prontomedic_reception_rpc_owner
  USING (
    id = NULLIF(
      current_setting('app.reception.appointment_id', TRUE),
      ''
    )::BIGINT
    AND company_id = NULLIF(
      current_setting('app.reception.company_id', TRUE),
      ''
    )::UUID
    AND unit_id = NULLIF(
      current_setting('app.reception.unit_id', TRUE),
      ''
    )::INTEGER
  )
  WITH CHECK (
    id = NULLIF(
      current_setting('app.reception.appointment_id', TRUE),
      ''
    )::BIGINT
    AND company_id = NULLIF(
      current_setting('app.reception.company_id', TRUE),
      ''
    )::UUID
    AND unit_id = NULLIF(
      current_setting('app.reception.unit_id', TRUE),
      ''
    )::INTEGER
  );

INSERT INTO public.prontomedic_deployment_migrations(filename)
VALUES ('20260728180000_reception_appointment_lock_policy.sql')
ON CONFLICT (filename) DO NOTHING;
