\set ON_ERROR_STOP on

SELECT format(
  'CREATE ROLE %I LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
  :'service_login'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'service_login')
\gexec

ALTER ROLE :"service_login"
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  PASSWORD :'service_password';

SELECT 'REVOKE service_role FROM app_prontomedic'
WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_prontomedic')
\gexec
GRANT service_role TO :"service_login";

DO $$
BEGIN
  IF pg_has_role('app_prontomedic', 'service_role', 'MEMBER') THEN
    RAISE EXCEPTION 'app_prontomedic nao pode ser membro de service_role';
  END IF;
END
$$;

SELECT (
  login.rolcanlogin
   AND NOT login.rolinherit
   AND NOT login.rolsuper
   AND NOT login.rolcreatedb
   AND NOT login.rolcreaterole
   AND NOT login.rolreplication
   AND NOT login.rolbypassrls
   AND pg_has_role(login.rolname, 'service_role', 'MEMBER')
)::int AS service_contract_ok
FROM pg_roles login
WHERE login.rolname = :'service_login'
\gset

\if :service_contract_ok
\echo SERVICE_ROLE_LOGIN_OK
\else
\echo 'contrato invalido para login service_role' >&2
\quit 3
\endif
