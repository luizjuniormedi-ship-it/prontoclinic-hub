-- Module 16 / TISS scoped prerequisites.
-- Adds only the appointment link used by TISS and the minimum billing account
-- identity required by the Module 16 runtime closure.
-- This migration never transmits XML and never accesses DataSIGH.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DO $preflight$
BEGIN
  IF to_regclass('public.companies') IS NULL THEN
    RAISE EXCEPTION 'Module 16 prerequisites require public.companies';
  END IF;
  IF to_regclass('public.appointments') IS NULL THEN
    RAISE EXCEPTION 'Module 16 prerequisites require public.appointments';
  END IF;
  IF to_regclass('public.insurance_companies') IS NULL THEN
    RAISE EXCEPTION 'Module 16 prerequisites require public.insurance_companies';
  END IF;
  IF to_regclass('public.tiss_xml') IS NULL THEN
    RAISE EXCEPTION 'Module 16 prerequisites require public.tiss_xml';
  END IF;
END
$preflight$;

DO $billing_accounts$
BEGIN
  IF to_regclass('public.billing_accounts') IS NULL THEN
    CREATE TABLE public.billing_accounts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id UUID NOT NULL
        REFERENCES public.companies(id) ON DELETE CASCADE
    );

    ALTER TABLE public.billing_accounts ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.billing_accounts FROM PUBLIC, anon, authenticated;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'billing_accounts'
       AND column_name = 'id'
       AND data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION 'public.billing_accounts.id must exist as UUID';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'billing_accounts'
       AND column_name = 'company_id'
       AND data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION 'public.billing_accounts.company_id must exist as UUID';
  END IF;
END
$billing_accounts$;

-- Required by tenant-safe composite FKs created by the runtime closure.
-- Existing compatible constraints/indexes are reused. If tenant identities are
-- duplicated, CREATE UNIQUE INDEX aborts replay instead of hiding corruption.
DO $parent_candidate_keys$
DECLARE
  v_spec RECORD;
BEGIN
  FOR v_spec IN
    SELECT *
      FROM (VALUES
        ('appointments', 'appointments_company_id_id_m16_uq'),
        ('insurance_companies', 'insurance_companies_company_id_id_m16_uq')
      ) AS specs(table_name, index_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_index index_meta
       WHERE index_meta.indrelid =
             format('public.%I', v_spec.table_name)::regclass
         AND index_meta.indisunique
         AND index_meta.indpred IS NULL
         AND index_meta.indexprs IS NULL
         AND index_meta.indnkeyatts = 2
         AND (
           SELECT array_agg(attribute.attname ORDER BY key.ordinality)
             FROM unnest(index_meta.indkey::SMALLINT[])
                  WITH ORDINALITY AS key(attnum, ordinality)
             JOIN pg_attribute attribute
               ON attribute.attrelid = index_meta.indrelid
              AND attribute.attnum = key.attnum
            WHERE key.ordinality <= index_meta.indnkeyatts
         ) = ARRAY['company_id'::NAME, 'id'::NAME]
    ) THEN
      EXECUTE format(
        'CREATE UNIQUE INDEX %I ON public.%I(company_id, id)',
        v_spec.index_name,
        v_spec.table_name
      );
    END IF;
  END LOOP;
END
$parent_candidate_keys$;

ALTER TABLE public.tiss_xml
  ADD COLUMN IF NOT EXISTS appointment_id BIGINT;

DO $appointment_link$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.tiss_xml xml
      LEFT JOIN public.appointments appointment
        ON appointment.id = xml.appointment_id
       AND appointment.company_id = xml.company_id
     WHERE xml.appointment_id IS NOT NULL
       AND appointment.id IS NULL
  ) THEN
    RAISE EXCEPTION
      'Module 16 prerequisites found missing or cross-company TISS appointment links';
  END IF;

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
$appointment_link$;

CREATE INDEX IF NOT EXISTS idx_tiss_xml_appointment
  ON public.tiss_xml(appointment_id);

COMMENT ON TABLE public.billing_accounts IS
  'Minimum tenant billing account identity required by the scoped TISS runtime.';
COMMENT ON COLUMN public.tiss_xml.appointment_id IS
  'Appointment that originated the local TISS XML; no external transmission.';

COMMIT;
