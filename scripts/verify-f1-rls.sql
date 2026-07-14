-- Prova F1 de RLS em banco efemero. Nunca executar no DataSIGH.

\if :{?f1_rls_password}
\else
  \echo 'Variavel psql obrigatoria ausente: -v f1_rls_password=<senha temporaria>'
  \quit 1
\endif

DROP ROLE IF EXISTS f1_rls_actor;
CREATE ROLE f1_rls_actor LOGIN PASSWORD :'f1_rls_password';
ALTER ROLE f1_rls_actor NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
GRANT authenticated TO f1_rls_actor;
GRANT USAGE ON SCHEMA public TO f1_rls_actor;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.patients TO f1_rls_actor;

DO $$
DECLARE
  v_owner TEXT;
  v_rls BOOLEAN;
  v_force BOOLEAN;
  v_bypass BOOLEAN;
BEGIN
  SELECT pg_get_userbyid(c.relowner), c.relrowsecurity, c.relforcerowsecurity
    INTO v_owner, v_rls, v_force
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'patients';

  SELECT rolbypassrls INTO v_bypass FROM pg_roles WHERE rolname = 'f1_rls_actor';

  IF NOT v_rls OR NOT v_force THEN
    RAISE EXCEPTION 'F1_RLS_FAIL: patients sem RLS forcado';
  END IF;
  IF v_owner = 'f1_rls_actor' THEN
    RAISE EXCEPTION 'F1_RLS_FAIL: actor e owner de patients';
  END IF;
  IF v_bypass THEN
    RAISE EXCEPTION 'F1_RLS_FAIL: actor possui BYPASSRLS';
  END IF;
END
$$;

SET ROLE f1_rls_actor;

DO $$
DECLARE
  v_visible INTEGER;
  v_cross INTEGER;
  v_update INTEGER;
  v_insert_failed BOOLEAN := FALSE;
  v_sqlstate TEXT;
  v_name TEXT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000011', false);
  SELECT count(*) INTO v_visible FROM public.patients;
  IF v_visible <> 1 THEN
    RAISE EXCEPTION 'F1_RLS_FAIL: tenant A deveria enxergar 1 paciente, obteve %', v_visible;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000012', false);
  SELECT count(*) INTO v_cross FROM public.patients WHERE id = 910001;
  IF v_cross <> 0 THEN
    RAISE EXCEPTION 'F1_RLS_FAIL: tenant B enxergou paciente A';
  END IF;

  BEGIN
    INSERT INTO public.patients (company_id, full_name, lg_ativo)
    VALUES ('f1000000-0000-4000-8000-000000000001', 'F1 cross tenant insert', TRUE);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    IF v_sqlstate IN ('42501', '23514') THEN
      v_insert_failed := TRUE;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_insert_failed THEN
    RAISE EXCEPTION 'F1_RLS_FAIL: tenant B inseriu em tenant A';
  END IF;

  UPDATE public.patients SET full_name = 'F1 cross tenant update' WHERE id = 910001;
  GET DIAGNOSTICS v_update = ROW_COUNT;
  IF v_update <> 0 THEN
    RAISE EXCEPTION 'F1_RLS_FAIL: tenant B atualizou paciente A';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000011', false);
  SELECT full_name INTO v_name FROM public.patients WHERE id = 910001;
  IF v_name <> 'Paciente controlado F1' THEN
    RAISE EXCEPTION 'F1_RLS_FAIL: paciente A foi alterado';
  END IF;

  RAISE NOTICE 'F1_RLS_PASS tenant_visible=% cross_read=% cross_update=%', v_visible, v_cross, v_update;
END
$$;

RESET ROLE;
REVOKE ALL ON public.patients FROM f1_rls_actor;
REVOKE ALL ON SCHEMA public FROM f1_rls_actor;
REVOKE authenticated FROM f1_rls_actor;
DROP ROLE f1_rls_actor;
