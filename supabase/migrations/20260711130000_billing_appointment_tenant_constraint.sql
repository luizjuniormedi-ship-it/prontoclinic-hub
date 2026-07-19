-- Billing idempotency contract: one billing record per appointment and tenant.
-- Fails closed on duplicates; it never deletes, merges or backfills rows.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.billings') IS NULL THEN
    RAISE EXCEPTION 'P0 billing contract requires public.billings before this migration';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.billings
    WHERE appointment_id IS NOT NULL
    GROUP BY company_id, appointment_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'P0 billing duplicate: company_id + appointment_id requires manual reconciliation';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.billings'::regclass
      AND conname = 'billings_company_appointment_key'
  ) THEN
    ALTER TABLE public.billings
      ADD CONSTRAINT billings_company_appointment_key
      UNIQUE (company_id, appointment_id);
  END IF;
END
$$;

COMMIT;
