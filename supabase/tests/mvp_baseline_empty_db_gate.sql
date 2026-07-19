-- Empty database MVP baseline gate. Run only after the manifest replay.
-- Catalog-only assertions; no DML and ends with ROLLBACK.
BEGIN;

DO $$
DECLARE
  required_name TEXT;
  required_tables CONSTANT TEXT[] := ARRAY[
    'companies', 'user_profiles', 'patients', 'professionals', 'appointments',
    'insurance_companies', 'insurance_plans', 'insurance_authorizations',
    'insurance_eligibility_checks', 'billings', 'medical_records'
  ];
BEGIN
  FOREACH required_name IN ARRAY required_tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = required_name AND c.relkind = 'r'
    ) THEN
      RAISE EXCEPTION 'MVP baseline missing physical table public.%', required_name;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN ('reception_authorizations', 'reception_eligibility_checks') AND c.relkind = 'r'
  ) THEN
    RAISE EXCEPTION 'MVP baseline has physical reception_* table';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('insurance_authorizations','insurance_eligibility_checks','billings')
      AND coalesce(qual, '') ~* '^\s*\(?\s*true\s*\)?\s*$'
  ) THEN
    RAISE EXCEPTION 'MVP baseline contains broad USING(true) policy on protected table';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_company_id_id_key') THEN
    RAISE EXCEPTION 'MVP baseline missing appointments tenant key';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billings_company_appointment_fkey') THEN
    RAISE EXCEPTION 'MVP baseline missing billing composite FK';
  END IF;
END
$$;

ROLLBACK;
