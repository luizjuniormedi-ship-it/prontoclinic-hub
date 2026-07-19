-- Explicit RLS owner/BYPASSRLS contract. Local review migration only.
-- FORCE RLS prevents table owners from silently bypassing policies.
BEGIN;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'companies', 'user_profiles', 'patients', 'professionals', 'units',
    'appointments', 'appointment_types', 'services_catalog', 'tiss_xml',
    'paciente_consentimentos', 'paciente_anonimizacao_log',
    'medical_records', 'billings',
    'insurance_authorizations', 'insurance_eligibility_checks'
  ] LOOP
    IF to_regclass(format('public.%I', table_name)) IS NULL THEN
      RAISE EXCEPTION 'RLS owner contract requires public.%', table_name;
    END IF;
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
  END LOOP;

  IF to_regclass('public.tiss_protocols') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.tiss_protocols ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.tiss_protocols FORCE ROW LEVEL SECURITY';
  END IF;
END
$$;

DO $$
DECLARE
  role_name TEXT;
  bypass BOOLEAN;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'app_prontomedic'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      SELECT rolbypassrls INTO bypass FROM pg_roles WHERE rolname = role_name;
      IF bypass THEN
        RAISE EXCEPTION 'Role % nao pode possuir BYPASSRLS', role_name;
      END IF;
    END IF;
  END LOOP;
END
$$;

COMMIT;
