-- Lock and update the reception appointment only inside the selected AAL2 context.

GRANT EXECUTE ON FUNCTION public.active_company_id(),
  public.active_unit_id()
  TO prontomedic_reception_rpc_owner;

DROP POLICY IF EXISTS appointments_reception_rpc_select
  ON public.appointments;
CREATE POLICY appointments_reception_rpc_select
  ON public.appointments
  FOR SELECT TO prontomedic_reception_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
  );

DROP POLICY IF EXISTS appointments_reception_rpc_update
  ON public.appointments;
CREATE POLICY appointments_reception_rpc_update
  ON public.appointments
  FOR UPDATE TO prontomedic_reception_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
  )
  WITH CHECK (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
  );

INSERT INTO public.prontomedic_deployment_migrations(filename)
VALUES ('20260728170000_reception_appointment_active_context.sql')
ON CONFLICT (filename) DO NOTHING;
