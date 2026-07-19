-- Link TISS guides to the appointment that originated them.
-- Idempotent and intentionally not applied to any remote environment here.
BEGIN;

ALTER TABLE public.tiss_xml
  ADD COLUMN IF NOT EXISTS appointment_id BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.tiss_xml'::regclass
      AND conname = 'tiss_xml_appointment_id_fkey'
  ) THEN
    ALTER TABLE public.tiss_xml
      ADD CONSTRAINT tiss_xml_appointment_id_fkey
      FOREIGN KEY (appointment_id)
      REFERENCES public.appointments(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_tiss_xml_appointment
  ON public.tiss_xml(appointment_id);

COMMIT;
