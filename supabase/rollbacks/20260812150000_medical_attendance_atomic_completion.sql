-- Operational rollback preserves finalized clinical records and disables only
-- the new atomic completion command until a corrective release is available.
BEGIN;

REVOKE EXECUTE ON FUNCTION public.m18_complete_attendance_secure(UUID, JSONB, TEXT)
  FROM authenticated, app_prontomedic;

COMMIT;
