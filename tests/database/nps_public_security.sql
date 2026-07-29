\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(condition boolean, message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'NPS_PUBLIC_SECURITY_ASSERTION_FAILED: %', message;
  END IF;
END;
$$;

SELECT pg_temp.assert_true(
  (
    SELECT relrowsecurity AND NOT relforcerowsecurity
    FROM pg_class
    WHERE oid = 'public.nps_convites'::regclass
  ),
  'nps_convites precisa de RLS sem FORCE para o RPC owner operar'
);

SELECT pg_temp.assert_true(
  NOT has_table_privilege('anon', 'public.nps_convites', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.nps_convites', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.nps_convites', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.nps_respostas', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.nps_respostas', 'INSERT'),
  'tabelas NPS não podem aceitar acesso público direto'
);

SELECT pg_temp.assert_true(
  has_function_privilege(
    'anon',
    'public.get_nps_survey_public(text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'anon',
    'public.submit_nps_response_public(text,smallint,text,jsonb)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.create_nps_invitation_secure(bigint,bigint,bigint,text,interval)',
    'EXECUTE'
  ),
  'anon deve acessar somente leitura e submissão por token'
);

SELECT pg_temp.assert_true(
  (
    SELECT count(*) = 2
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.prokind = 'f'
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
  ),
  'allowlist anon SECURITY DEFINER deve conter exatamente duas funções'
);

SELECT pg_temp.assert_true(
  (
    SELECT bool_and(
      p.prosecdef
      AND p.proconfig @> ARRAY['search_path=pg_catalog, public, extensions']
    )
    FROM pg_proc p
    WHERE p.oid IN (
      'public.create_nps_invitation_secure(bigint,bigint,bigint,text,interval)'::regprocedure,
      'public.get_nps_survey_public(text)'::regprocedure,
      'public.submit_nps_response_public(text,smallint,text,jsonb)'::regprocedure
    )
  ),
  'RPCs NPS precisam de SECURITY DEFINER e search_path fixo'
);

SET LOCAL ROLE anon;

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM public.get_nps_survey_public('token-previsivel')
  ),
  'token malformado não pode revelar pesquisa'
);

RESET ROLE;
ROLLBACK;
