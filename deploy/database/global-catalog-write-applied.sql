\set ON_ERROR_STOP on

DO $smoke$
DECLARE
  v_role TEXT;
  v_table TEXT;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'app_prontomedic'] LOOP
    FOREACH v_table IN ARRAY ARRAY['notification_templates', 'roles', 'role_permissions'] LOOP
      IF has_table_privilege(v_role, 'public.' || v_table, 'INSERT')
         OR has_table_privilege(v_role, 'public.' || v_table, 'UPDATE')
         OR has_table_privilege(v_role, 'public.' || v_table, 'DELETE') THEN
        RAISE EXCEPTION 'DML direto permanece aberto para % em %', v_role, v_table;
      END IF;
    END LOOP;
    IF has_table_privilege(v_role, 'public.password_resets', 'SELECT')
       OR has_table_privilege(v_role, 'public.password_resets', 'INSERT')
       OR has_table_privilege(v_role, 'public.password_resets', 'UPDATE')
       OR has_table_privilege(v_role, 'public.password_resets', 'DELETE') THEN
      RAISE EXCEPTION 'Acesso direto a password_resets permanece aberto para %', v_role;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1
      FROM pg_class table_record
      CROSS JOIN LATERAL aclexplode(
        COALESCE(table_record.relacl, acldefault('r', table_record.relowner))
      ) privilege
     WHERE table_record.oid IN (
       'public.notification_templates'::regclass,
       'public.roles'::regclass,
       'public.role_permissions'::regclass,
       'public.password_resets'::regclass
     )
       AND privilege.grantee = 0
       AND privilege.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'PUBLIC conserva acesso direto em catalogo global';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND policyname IN (
         'notification_templates_admin_write', 'module_roles_admin',
         'roles_select_authenticated', 'module2_role_permissions_admin',
         'module_role_permissions_admin', 'Users can read own password_resets',
         'Service role can insert password_resets',
         'Service role can update password_resets', 'password_resets_no_client_access'
       )
  ) THEN
    RAISE EXCEPTION 'Policy permissiva removida reapareceu';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('notification_templates', 'roles', 'role_permissions', 'password_resets')
       AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'Policy de escrita desconhecida permanece em catalogo global';
  END IF;
END;
$smoke$;
