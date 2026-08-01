-- Allow the restricted patient portal RPC owner to satisfy audit/RLS helpers
-- invoked by appointment mutation triggers. The role remains NOLOGIN,
-- NOINHERIT and NOBYPASSRLS.
DO $block$
BEGIN
  IF to_regrole('prontomedic_patient_portal_rpc_owner') IS NULL THEN
    RAISE EXCEPTION
      'prontomedic_patient_portal_rpc_owner must exist before privilege repair';
  END IF;
END
$block$;

GRANT EXECUTE ON FUNCTION public.audit_current_user_id()
  TO prontomedic_patient_portal_rpc_owner;
GRANT EXECUTE ON FUNCTION public.audit_current_company_id()
  TO prontomedic_patient_portal_rpc_owner;
GRANT EXECUTE ON FUNCTION public.audit_has_role(TEXT[])
  TO prontomedic_patient_portal_rpc_owner;
GRANT EXECUTE ON FUNCTION public.active_company_id()
  TO prontomedic_patient_portal_rpc_owner;
GRANT EXECUTE ON FUNCTION public.active_unit_id()
  TO prontomedic_patient_portal_rpc_owner;
GRANT EXECUTE ON FUNCTION public.can_access(TEXT, TEXT)
  TO prontomedic_patient_portal_rpc_owner;
GRANT EXECUTE ON FUNCTION public.org_can_access_unit(UUID, INTEGER)
  TO prontomedic_patient_portal_rpc_owner;
GRANT EXECUTE ON FUNCTION public.m9_get_professional_schedule_windows_secure(
  BIGINT,
  INTEGER,
  DATE,
  BIGINT
) TO prontomedic_patient_portal_rpc_owner;

GRANT SELECT ON
  public.professional_schedule_grades,
  public.scheduling_blocks
TO prontomedic_patient_portal_rpc_owner;

ALTER FUNCTION public.perform_reception_checkin_secure(
  UUID,
  BIGINT,
  TEXT,
  TEXT
) SET TimeZone = 'America/Sao_Paulo';
