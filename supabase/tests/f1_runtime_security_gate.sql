-- F1 runtime security gate.
-- Catalog-only assertions after the empty database replay.
-- Never run against DataSIGH or production.

DO $$
DECLARE
  required_table TEXT;
  protected_tables CONSTANT TEXT[] := ARRAY[
    'user_profiles', 'patients', 'professionals', 'appointments',
    'medical_records', 'billings', 'insurance_authorizations',
    'insurance_eligibility_checks', 'audit_logs',
    'scheduling_contact_logs', 'scheduling_call_center_tasks',
    'roles', 'role_permissions'
  ];
  rel RECORD;
  role_record RECORD;
  owner_record RECORD;
BEGIN
  FOREACH required_table IN ARRAY protected_tables LOOP
    IF to_regclass('public.' || required_table) IS NULL THEN
      RAISE EXCEPTION 'F1 runtime missing table public.%', required_table;
    END IF;
  END LOOP;

  SELECT rolbypassrls INTO role_record FROM pg_roles WHERE rolname = 'service_role';
  IF NOT FOUND OR role_record.rolbypassrls IS NOT TRUE THEN
    RAISE EXCEPTION 'F1 runtime: service_role must have BYPASSRLS';
  END IF;

  FOR role_record IN
    SELECT rolname, rolbypassrls
    FROM pg_roles
    WHERE rolname IN ('anon', 'authenticated')
  LOOP
    IF role_record.rolbypassrls IS TRUE THEN
      RAISE EXCEPTION 'F1 runtime: browser role % must not have BYPASSRLS', role_record.rolname;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'app_owner' AND rolbypassrls IS FALSE
  ) THEN
    RAISE EXCEPTION 'F1 runtime: app_owner must exist without BYPASSRLS';
  END IF;

  FOR rel IN
    SELECT c.relname, c.relowner::regrole::text AS owner_name,
           owner_role.rolbypassrls AS owner_bypassrls,
           owner_role.rolsuper AS owner_superuser,
           c.relrowsecurity, c.relforcerowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_roles owner_role ON owner_role.oid = c.relowner
    WHERE n.nspname = 'public' AND c.relname = ANY(protected_tables)
  LOOP
    IF rel.relrowsecurity IS NOT TRUE THEN
      RAISE EXCEPTION 'F1 runtime: RLS disabled on public.%', rel.relname;
    END IF;
    IF rel.owner_name IN ('anon', 'authenticated') THEN
      RAISE EXCEPTION 'F1 runtime: browser role owns public.%', rel.relname;
    END IF;
    IF rel.owner_bypassrls IS TRUE AND rel.owner_superuser IS NOT TRUE THEN
      RAISE EXCEPTION 'F1 runtime: non-superuser owner % bypasses RLS on public.%', rel.owner_name, rel.relname;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_my_company_id'
      AND p.prosecdef IS TRUE
  ) THEN
    RAISE EXCEPTION 'F1 runtime: tenant helper must be SECURITY DEFINER';
  END IF;

  FOR rel IN
    SELECT c.relname, c.relforcerowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN (
        'scheduling_contact_logs', 'scheduling_call_center_tasks',
        'roles', 'role_permissions'
      )
  LOOP
    IF rel.relforcerowsecurity IS NOT TRUE THEN
      RAISE EXCEPTION 'F1 runtime: FORCE RLS disabled on public.%', rel.relname;
    END IF;
  END LOOP;
END
$$;

SELECT 'F1_RUNTIME_SECURITY_GATE=PASS' AS result;
