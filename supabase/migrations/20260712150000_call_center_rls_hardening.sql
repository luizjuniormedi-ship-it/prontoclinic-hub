-- Harden Call Center tables: force RLS and remove browser-side direct mutations.
-- Mutations must use the tenant/role-checked SECURITY DEFINER RPCs.

ALTER TABLE public.scheduling_contact_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.scheduling_call_center_tasks FORCE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE ON public.scheduling_contact_logs FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.scheduling_call_center_tasks FROM anon, authenticated;
REVOKE USAGE, SELECT ON SEQUENCE public.scheduling_contact_logs_id_seq FROM anon, authenticated;
REVOKE USAGE, SELECT ON SEQUENCE public.scheduling_call_center_tasks_id_seq FROM anon, authenticated;

GRANT SELECT ON public.scheduling_contact_logs TO authenticated;
GRANT SELECT ON public.scheduling_call_center_tasks TO authenticated;
