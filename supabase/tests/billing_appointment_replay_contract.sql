-- Read-only contract gate for the billing replay repair.
-- It verifies the schema required by the application without touching data.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'billings'
      AND column_name = 'appointment_id'
      AND data_type = 'bigint'
  ) THEN
    RAISE EXCEPTION 'billing replay contract failed: public.billings.appointment_id BIGINT is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'billings_appointment_id_fkey'
      AND conrelid = 'public.billings'::regclass
  ) THEN
    RAISE EXCEPTION 'billing replay contract failed: appointment foreign key is missing';
  END IF;

  IF to_regclass('public.idx_billings_appointment') IS NULL THEN
    RAISE EXCEPTION 'billing replay contract failed: appointment index is missing';
  END IF;
END
$$;
