-- Contrato P0 de RLS/tenant. Somente leitura do catalogo; nao cria, altera ou
-- remove dados. Executar depois do replay das migrations em banco local/efemero.
BEGIN;

DO $$
DECLARE
  expected_tables CONSTANT TEXT[] := ARRAY[
    'companies', 'user_profiles', 'patients', 'professionals', 'units',
    'appointments', 'appointment_types', 'services_catalog', 'tiss_xml',
    'paciente_consentimentos', 'paciente_anonimizacao_log',
    'medical_records', 'billings'
  ];
  table_name TEXT;
  missing_count INTEGER;
  policy_count INTEGER;
  public_exec_count INTEGER;
  log_write_grant_count INTEGER;
BEGIN
  SELECT count(*)
    INTO missing_count
    FROM unnest(expected_tables) AS expected(table_name)
   WHERE NOT EXISTS (
     SELECT 1
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = expected.table_name
        AND c.relrowsecurity
   );
  IF missing_count <> 0 THEN
    RAISE EXCEPTION 'RLS ausente em % tabela(s)', missing_count;
  END IF;

  SELECT count(*) INTO policy_count
    FROM pg_policies
   WHERE schemaname = 'public'
     AND policyname IN (
       'base_companies_select_tenant', 'base_companies_admin_write',
       'base_user_profiles_select_tenant', 'base_user_profiles_insert_admin',
       'base_user_profiles_update_admin', 'base_user_profiles_delete_admin',
       'base_patients_tenant_all', 'base_professionals_tenant_all',
       'base_units_tenant_all', 'base_appointments_tenant_all',
       'base_appointment_types_tenant_all', 'base_services_catalog_tenant_all',
       'base_medical_records_tenant_all', 'base_billings_tenant_all',
       'base_tiss_xml_tenant_select', 'base_consentimentos_tenant_select',
       'base_anonimizacao_tenant_select'
     );
  IF policy_count <> 17 THEN
    RAISE EXCEPTION 'Esperadas 17 policies base, encontradas %', policy_count;
  END IF;

  SELECT count(*) INTO public_exec_count
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   WHERE n.nspname = 'public'
     AND p.proname IN ('get_my_company_id', 'get_scheduling_actor')
     AND a.grantee = 0
     AND a.privilege_type = 'EXECUTE';
  IF public_exec_count <> 0 THEN
    RAISE EXCEPTION 'Helpers tenant-aware ainda executaveis por PUBLIC';
  END IF;

  SELECT count(*) INTO log_write_grant_count
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public'
     AND table_name = 'paciente_anonimizacao_log'
     AND grantee = 'authenticated'
     AND privilege_type IN ('UPDATE', 'DELETE');
  IF log_write_grant_count <> 0 THEN
    RAISE EXCEPTION 'Log LGPD recebeu UPDATE/DELETE para authenticated';
  END IF;
END
$$;

ROLLBACK;
