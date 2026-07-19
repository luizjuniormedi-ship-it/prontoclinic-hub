-- Runtime/catalog contract for tenant constraints and owner/BYPASSRLS.
-- Execute only in an approved disposable local database. No production/VPS use.

\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.billings') IS NULL
     OR to_regclass('public.medical_records') IS NULL
     OR to_regclass('public.insurance_authorizations') IS NULL
     OR to_regclass('public.insurance_eligibility_checks') IS NULL THEN
    RAISE EXCEPTION 'required MVP physical tables are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.appointments'::regclass
      AND conname = 'appointments_company_id_id_key'
      AND contype = 'u'
  ) THEN RAISE EXCEPTION 'appointments tenant unique key missing'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.billings'::regclass
      AND conname = 'billings_company_appointment_fkey'
      AND contype = 'f'
  ) THEN RAISE EXCEPTION 'billing composite FK missing'; END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'billings'
      AND column_name IN ('company_id', 'appointment_id') AND is_nullable = 'YES'
  ) THEN RAISE EXCEPTION 'billing tenant columns remain nullable'; END IF;
END
$$;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname, owner_role.rolname, owner_role.rolbypassrls,
           c.relrowsecurity, c.relforcerowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_roles owner_role ON owner_role.oid = c.relowner
    WHERE n.nspname = 'public'
      AND c.relname IN ('patients','appointments','billings','medical_records',
                        'insurance_authorizations','insurance_eligibility_checks')
  LOOP
    IF r.rolname IN ('anon','authenticated','app_prontomedic') THEN
      RAISE EXCEPTION 'application role owns protected table %', r.relname;
    END IF;
    IF r.rolbypassrls AND NOT r.relforcerowsecurity THEN
      RAISE EXCEPTION 'owner bypasses RLS without FORCE on %', r.relname;
    END IF;
    IF NOT r.relrowsecurity THEN
      RAISE EXCEPTION 'RLS disabled on %', r.relname;
    END IF;
  END LOOP;
END
$$;

ROLLBACK;
