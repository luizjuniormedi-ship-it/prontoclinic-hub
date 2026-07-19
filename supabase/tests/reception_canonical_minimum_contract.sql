-- Structural contract for the minimum canonical insurance schema. No DML.
BEGIN;

DO $$
DECLARE
  table_name TEXT;
  column_type TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['insurance_authorizations', 'insurance_eligibility_checks'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = table_name AND c.relkind = 'r'
    ) THEN
      RAISE EXCEPTION 'Canonical table missing: public.%', table_name;
    END IF;

    SELECT format_type(a.atttypid, a.atttypmod) INTO column_type
    FROM pg_attribute a
    WHERE a.attrelid = format('public.%I', table_name)::regclass
      AND a.attname = 'insurance_plan_id' AND NOT a.attisdropped;
    IF column_type IS DISTINCT FROM 'integer' THEN
      RAISE EXCEPTION 'public.%.insurance_plan_id must be integer, found %', table_name, column_type;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
      WHERE c.conrelid = format('public.%I', table_name)::regclass
        AND c.contype = 'f'
        AND c.confrelid = 'public.insurance_plans'::regclass
    ) THEN
      RAISE EXCEPTION 'public.%.insurance_plan_id must reference insurance_plans(id)', table_name;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN ('reception_authorizations', 'reception_eligibility_checks')
      AND c.relkind = 'r'
  ) THEN
    RAISE EXCEPTION 'reception_* cannot be physical tables in canonical schema';
  END IF;
END
$$;

ROLLBACK;
