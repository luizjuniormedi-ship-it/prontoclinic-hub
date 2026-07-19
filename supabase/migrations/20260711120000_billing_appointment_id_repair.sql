-- Repair migration for installations where the legacy billings table already
-- existed before the initial stub migration was replayed.
-- This is idempotent and does not read or modify DataSIGH.

ALTER TABLE public.billings
  ADD COLUMN IF NOT EXISTS appointment_id BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'billings_appointment_id_fkey'
      AND conrelid = 'public.billings'::regclass
  ) THEN
    ALTER TABLE public.billings
      ADD CONSTRAINT billings_appointment_id_fkey
      FOREIGN KEY (appointment_id)
      REFERENCES public.appointments(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_billings_appointment
  ON public.billings(appointment_id);
