-- Catalog-only contract for billing tenant integrity. No DML.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'billings'
      AND column_name IN ('company_id', 'appointment_id') AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'billings company_id/appointment_id must be NOT NULL';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.appointments'::regclass
      AND conname = 'appointments_company_id_id_key' AND contype = 'u'
  ) THEN
    RAISE EXCEPTION 'appointments(company_id,id) unique key is absent';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.billings'::regclass
      AND conname = 'billings_company_appointment_fkey' AND contype = 'f'
      AND conkey = ARRAY[
        (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.billings'::regclass AND attname = 'company_id'),
        (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.billings'::regclass AND attname = 'appointment_id')
      ]::smallint[]
      AND confkey = ARRAY[
        (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.appointments'::regclass AND attname = 'company_id'),
        (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.appointments'::regclass AND attname = 'id')
      ]::smallint[]
  ) THEN
    RAISE EXCEPTION 'Composite billing FK does not enforce tenant + appointment identity';
  END IF;
END
$$;

ROLLBACK;
