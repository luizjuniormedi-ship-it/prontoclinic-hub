-- Read-only preflight for 20260716203000_auth_foundation.sql.
-- Execute against the existing ProntoMedic PostgreSQL/Supabase database before
-- any migration repair, db push or deployment. This script returns counts only.

\set ON_ERROR_STOP on
\pset pager off

SELECT current_database() AS database_name,
       current_user AS database_user,
       current_setting('server_version') AS postgres_version;

SELECT to_regclass('supabase_migrations.schema_migrations') AS migration_history,
       to_regclass('public.user_profiles') AS user_profiles,
       to_regclass('public.roles') AS roles,
       to_regclass('public.role_permissions') AS role_permissions,
       to_regclass('public.audit_logs') AS audit_logs;

SELECT 'SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;'
WHERE to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
\gexec

SELECT 'SELECT COUNT(*) AS company_count FROM public.companies;'
WHERE to_regclass('public.companies') IS NOT NULL
\gexec

SELECT table_name,
       column_name,
       data_type,
       udt_name,
       is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'roles' AND column_name IN ('id', 'name'))
    OR (table_name = 'user_profiles' AND column_name IN ('id', 'user_id', 'role_id', 'role_name', 'company_id', 'primary_unit_id', 'lg_ativo'))
    OR (table_name = 'role_permissions' AND column_name IN ('company_id', 'role_id', 'module'))
  )
ORDER BY table_name, ordinal_position;

SELECT $query$
  SELECT COUNT(*) FILTER (WHERE name IS NULL OR btrim(name) = '') AS roles_without_name,
         COUNT(*) - COUNT(DISTINCT lower(btrim(name))) AS duplicate_normalized_role_names
  FROM public.roles;
$query$
WHERE to_regclass('public.roles') IS NOT NULL
\gexec

SELECT $query$
  SELECT COUNT(*) AS profile_count,
         COUNT(*) FILTER (WHERE user_id IS NULL) AS profiles_without_user_id,
         COUNT(*) FILTER (WHERE user_id IS DISTINCT FROM id) AS divergent_profile_identities
  FROM public.user_profiles;
$query$
WHERE EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'user_profiles'
    AND column_name = 'user_id'
)
\gexec

SELECT $query$
  SELECT COUNT(*) AS orphan_profiles_without_auth_user
  FROM public.user_profiles up
  LEFT JOIN auth.users au ON au.id = up.id
  WHERE au.id IS NULL;
$query$
WHERE to_regclass('public.user_profiles') IS NOT NULL
  AND to_regclass('auth.users') IS NOT NULL
\gexec

SELECT $query$
  SELECT COUNT(*) AS profiles_with_unknown_role_id
  FROM public.user_profiles up
  LEFT JOIN public.roles r ON r.id = up.role_id
  WHERE up.role_id IS NOT NULL AND r.id IS NULL;
$query$
WHERE to_regclass('public.user_profiles') IS NOT NULL
  AND to_regclass('public.roles') IS NOT NULL
\gexec

SELECT $query$
  SELECT COUNT(*) AS permission_count,
         COUNT(*) FILTER (WHERE company_id IS NULL) AS permissions_without_company,
         COUNT(*) - COUNT(DISTINCT (company_id, role_id, module)) AS duplicate_permission_rows
  FROM public.role_permissions;
$query$
WHERE EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'role_permissions'
    AND column_name = 'company_id'
)
\gexec

SELECT c.relname AS relation,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       c.reloptions
FROM pg_class c
WHERE c.oid IN (
  SELECT to_regclass(relation_name)
  FROM unnest(ARRAY[
    'public.user_profiles',
    'public.roles',
    'public.role_permissions',
    'public.audit_logs',
    'public.audit_logs_stats'
  ]) AS relation_name
  WHERE to_regclass(relation_name) IS NOT NULL
)
ORDER BY c.relname;

SELECT tablename,
       policyname,
       permissive,
       roles,
       cmd,
       qual,
       with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('user_profiles', 'roles', 'role_permissions')
ORDER BY tablename, policyname;

SELECT p.oid::regprocedure AS function_signature,
       pg_get_function_result(p.oid) AS return_type,
       p.prosecdef AS security_definer,
       p.proconfig AS function_settings
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'get_my_company_id',
    'current_company_id',
    'is_admin',
    'auth_profile_company_id',
    'auth_is_company_admin',
    'log_data_access'
  )
ORDER BY p.proname, p.oid::regprocedure::text;
