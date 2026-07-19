-- Catalog-only billing contract. No DML; transaction is rolled back.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'billings'
      AND column_name IN ('company_id', 'appointment_id')
    GROUP BY table_schema, table_name
    HAVING COUNT(*) = 2
  ) THEN
    RAISE EXCEPTION 'billings must expose company_id and appointment_id';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.billings'::regclass
      AND conname = 'billings_company_appointment_key'
      AND contype = 'u'
  ) THEN
    RAISE EXCEPTION 'billing tenant idempotency constraint is absent';
  END IF;
END
$$;

ROLLBACK;
