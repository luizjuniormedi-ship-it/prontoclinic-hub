-- Structural contract for explicit MVP CREATE TABLE baseline. No DML.
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
      RAISE EXCEPTION 'MVP canonical table absent: public.%', table_name;
    END IF;
    SELECT format_type(a.atttypid, a.atttypmod) INTO column_type
    FROM pg_attribute a
    WHERE a.attrelid = format('public.%I', table_name)::regclass
      AND a.attname = 'insurance_plan_id' AND NOT a.attisdropped;
    IF column_type IS DISTINCT FROM 'integer' THEN
      RAISE EXCEPTION 'MVP canonical %.insurance_plan_id must be integer, found %', table_name, column_type;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'reception_authorizations' AND relkind = 'v')
     OR NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'reception_eligibility_checks' AND relkind = 'v') THEN
    RAISE EXCEPTION 'MVP reception compatibility views are absent';
  END IF;
END
$$;

ROLLBACK;
