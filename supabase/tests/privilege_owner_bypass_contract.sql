-- Catalog-only owner/BYPASSRLS contract. No DML; transaction is rolled back.
BEGIN;

DO $$
DECLARE
  table_name TEXT;
  owner_name TEXT;
  owner_bypass BOOLEAN;
  forced BOOLEAN;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'companies', 'user_profiles', 'patients', 'professionals', 'units',
    'appointments', 'appointment_types', 'services_catalog', 'tiss_xml',
    'paciente_consentimentos', 'paciente_anonimizacao_log',
    'medical_records', 'billings'
  ] LOOP
    SELECT owner_role.rolname, owner_role.rolbypassrls, c.relforcerowsecurity
      INTO owner_name, owner_bypass, forced
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_roles owner_role ON owner_role.oid = c.relowner
    WHERE n.nspname = 'public' AND c.relname = table_name AND c.relrowsecurity;
    IF owner_name IS NULL THEN
      RAISE EXCEPTION 'Tabela public.% sem RLS ou ausente', table_name;
    END IF;
    IF owner_name IN ('anon', 'authenticated', 'app_prontomedic') THEN
      RAISE EXCEPTION 'Tabela public.% tem owner de aplicação: %', table_name, owner_name;
    END IF;
    IF owner_bypass AND NOT forced THEN
      RAISE EXCEPTION 'Tabela public.% tem owner BYPASSRLS sem FORCE ROW LEVEL SECURITY', table_name;
    END IF;
  END LOOP;

  IF to_regclass('public.tiss_protocols') IS NOT NULL THEN
    SELECT owner_role.rolname, owner_role.rolbypassrls, c.relforcerowsecurity
      INTO owner_name, owner_bypass, forced
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_roles owner_role ON owner_role.oid = c.relowner
    WHERE n.nspname = 'public' AND c.relname = 'tiss_protocols' AND c.relrowsecurity;
    IF owner_name IS NULL OR owner_name IN ('anon', 'authenticated', 'app_prontomedic') THEN
      RAISE EXCEPTION 'tiss_protocols owner/RLS invalido';
    END IF;
    IF owner_bypass AND NOT forced THEN
      RAISE EXCEPTION 'tiss_protocols owner BYPASSRLS sem FORCE ROW LEVEL SECURITY';
    END IF;
  END IF;
END
$$;

ROLLBACK;
