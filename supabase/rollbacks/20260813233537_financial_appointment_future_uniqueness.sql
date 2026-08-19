BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DROP TRIGGER IF EXISTS trg_financial_appointment_uniqueness
  ON public.billing_accounts;
DROP TRIGGER IF EXISTS trg_zz_financial_appointment_uniqueness
  ON public.billing_accounts;
DROP TRIGGER IF EXISTS trg_financial_appointment_uniqueness
  ON public.billings;
DROP TRIGGER IF EXISTS trg_zz_financial_appointment_uniqueness
  ON public.billings;

DROP FUNCTION IF EXISTS private.enforce_financial_appointment_uniqueness();
DROP VIEW IF EXISTS private.financial_appointment_duplicate_audit;

COMMIT;
