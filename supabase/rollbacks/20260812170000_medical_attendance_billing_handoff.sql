BEGIN;
REVOKE EXECUTE ON FUNCTION public.m18_finalize_appointment_with_billing_secure(BIGINT, JSONB, TEXT)
  FROM authenticated, app_prontomedic;
COMMIT;
