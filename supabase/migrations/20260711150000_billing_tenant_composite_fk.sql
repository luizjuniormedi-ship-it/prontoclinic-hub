-- Billing tenant-integrity contract. Review/local only; no approximation.
-- Fails closed before changing constraints when nulls or duplicates exist.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.billings') IS NULL OR to_regclass('public.appointments') IS NULL THEN
    RAISE EXCEPTION 'Billing composite contract requires public.billings and public.appointments';
  END IF;

  IF EXISTS (SELECT 1 FROM public.billings WHERE company_id IS NULL OR appointment_id IS NULL) THEN
    RAISE EXCEPTION 'Billing composite contract blocked: null company_id or appointment_id exists';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.billings
    GROUP BY company_id, appointment_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Billing composite contract blocked: duplicate company_id + appointment_id';
  END IF;

  IF EXISTS (SELECT 1 FROM public.appointments WHERE company_id IS NULL) THEN
    RAISE EXCEPTION 'Billing composite contract blocked: appointment company_id is null';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.appointments
    GROUP BY company_id, id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Billing composite contract blocked: duplicate appointment company_id + id';
  END IF;
END
$$;

ALTER TABLE public.billings
  ALTER COLUMN company_id SET NOT NULL,
  ALTER COLUMN appointment_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.appointments'::regclass
      AND conname = 'appointments_company_id_id_key'
  ) THEN
    ALTER TABLE public.appointments
      ADD CONSTRAINT appointments_company_id_id_key UNIQUE (company_id, id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.billings'::regclass
      AND conname = 'billings_company_appointment_fkey'
  ) THEN
    ALTER TABLE public.billings
      ADD CONSTRAINT billings_company_appointment_fkey
      FOREIGN KEY (company_id, appointment_id)
      REFERENCES public.appointments (company_id, id);
  END IF;
END
$$;

COMMIT;
