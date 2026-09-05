-- preserve_schema: keep the read contracts and direct-table revocations, but
-- disable privileged nursing mutations until a forward fix is deployed.
BEGIN;
REVOKE EXECUTE ON FUNCTION public.nursing_administer_medication_secure(BIGINT, BIGINT)
  FROM authenticated, app_prontomedic;
REVOKE EXECUTE ON FUNCTION public.nursing_refuse_medication_secure(BIGINT, TEXT)
  FROM authenticated, app_prontomedic;
COMMIT;
