-- Read-only catalog gate for the TISS -> appointment relationship.
-- The migration must already have been replayed by the caller.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tiss_xml'
      AND column_name = 'appointment_id'
      AND data_type = 'bigint'
  ) THEN
    RAISE EXCEPTION 'tiss appointment contract failed: appointment_id BIGINT is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.tiss_xml'::regclass
      AND conname = 'tiss_xml_appointment_id_fkey'
      AND contype = 'f'
  ) THEN
    RAISE EXCEPTION 'tiss appointment contract failed: appointment foreign key is missing';
  END IF;

  IF to_regclass('public.idx_tiss_xml_appointment') IS NULL THEN
    RAISE EXCEPTION 'tiss appointment contract failed: appointment index is missing';
  END IF;
END
$$;

ROLLBACK;
