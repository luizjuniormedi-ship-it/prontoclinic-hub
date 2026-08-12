BEGIN;

REVOKE ALL ON FUNCTION public.ensure_reception_worklist_for_checkin_secure(UUID)
  FROM PUBLIC, anon, authenticated, app_prontomedic;
DROP FUNCTION IF EXISTS public.ensure_reception_worklist_for_checkin_secure(UUID);

DROP POLICY IF EXISTS m11_appointments_worklist_rpc_select ON public.appointments;
DROP POLICY IF EXISTS m11_appointments_worklist_rpc_update ON public.appointments;
DROP POLICY IF EXISTS m11_patients_worklist_rpc_select ON public.patients;
DROP POLICY IF EXISTS m11_workflow_worklist_rpc_select ON public.reception_checkin_workflows;
DROP POLICY IF EXISTS m11_checkins_worklist_rpc_select ON public.reception_checkins;
DROP POLICY IF EXISTS m11_tickets_worklist_rpc_select ON public.reception_queue_tickets;
DROP POLICY IF EXISTS m11_appointment_types_worklist_rpc_select ON public.appointment_types;

REVOKE UPDATE ON public.appointments FROM prontomedic_worklist_rpc_owner;
REVOKE SELECT ON public.reception_checkin_workflows, public.reception_checkins,
  public.reception_queue_tickets, public.appointment_types
  FROM prontomedic_worklist_rpc_owner;

DELETE FROM supabase_migrations.schema_migrations
WHERE version = '20260811120000';

COMMIT;
