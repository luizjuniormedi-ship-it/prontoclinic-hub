-- Read-only owner/BYPASSRLS snapshot. Run with psql -X -v ON_ERROR_STOP=1.
-- This file contains SELECTs only and never changes roles, grants or tables.
SELECT
  n.nspname AS schema_name,
  c.relname AS relation_name,
  CASE c.relkind WHEN 'r' THEN 'table' WHEN 'v' THEN 'view' ELSE c.relkind::text END AS relation_kind,
  owner_role.rolname AS owner_name,
  owner_role.rolbypassrls AS owner_bypassrls,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS force_rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_roles owner_role ON owner_role.oid = c.relowner
WHERE n.nspname = 'public'
  AND c.relname IN (
    'companies', 'user_profiles', 'patients', 'professionals', 'units',
    'appointments', 'tiss_xml', 'tiss_protocols', 'medical_records',
    'billings', 'insurance_authorizations', 'insurance_eligibility_checks',
    'reception_authorizations', 'reception_eligibility_checks'
  )
ORDER BY c.relname;

SELECT rolname, rolsuper, rolbypassrls, rolcanlogin
FROM pg_roles
WHERE rolname IN ('anon', 'authenticated', 'app_prontomedic', 'service_role', 'postgres')
ORDER BY rolname;
