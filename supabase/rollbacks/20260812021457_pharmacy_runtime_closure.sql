-- Operational rollback preserves additive clinical traceability and FORCE RLS.
-- It disables only the new dispensing command until a corrective release lands.
BEGIN;

REVOKE EXECUTE ON FUNCTION public.dispensar_estoque_atomic(
  UUID, BIGINT, BIGINT, BIGINT, UUID, TEXT, JSONB
) FROM authenticated, app_prontomedic;

COMMIT;
