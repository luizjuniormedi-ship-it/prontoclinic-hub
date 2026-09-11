DO $edge_prerequisite$
DECLARE
  edge_function RECORD;
  function_count INTEGER := 0;
BEGIN
  FOR edge_function IN
    SELECT oid FROM pg_catalog.pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname IN (
        'pre_cadastro_edge_request', 'pre_cadastro_edge_confirm',
        'pre_cadastro_edge_status', 'pre_cadastro_edge_resend'
      )
  LOOP
    function_count := function_count + 1;
    IF has_function_privilege('anon', edge_function.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', edge_function.oid, 'EXECUTE')
      OR NOT has_function_privilege('service_role', edge_function.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'privilegios Edge divergentes em %', edge_function.oid::regprocedure;
    END IF;
  END LOOP;
  IF function_count <> 4 THEN
    RAISE EXCEPTION 'contrato Edge predecessor incompleto';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20260910223000'
  ) THEN
    RAISE EXCEPTION 'migration Edge predecessora ausente';
  END IF;
END
$edge_prerequisite$;

DO $smoke$
DECLARE
  legacy_function RECORD;
  target_role TEXT;
  create_function OID := to_regprocedure(
    'public.create_pre_cadastro(uuid,character varying,character varying,character varying,date,character varying,character varying,character varying,character varying,character varying,character varying,character varying,character varying,character varying,character,inet,text)');
  confirm_function OID := to_regprocedure(
    'public.confirm_pre_cadastro(character varying)');
BEGIN
  IF create_function IS NULL OR confirm_function IS NULL THEN
    RAISE EXCEPTION 'rollback perdeu assinatura canonica';
  END IF;
  FOR legacy_function IN
    SELECT oid FROM pg_catalog.pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('create_pre_cadastro', 'confirm_pre_cadastro')
  LOOP
    FOREACH target_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF legacy_function.oid = ANY (ARRAY[create_function, confirm_function]) THEN
        IF NOT has_function_privilege(target_role, legacy_function.oid, 'EXECUTE') THEN
          RAISE EXCEPTION 'rollback nao restaurou % em %', target_role,
            legacy_function.oid::regprocedure;
        END IF;
      ELSIF has_function_privilege(target_role, legacy_function.oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'rollback ampliou % em overload desconhecido %', target_role,
          legacy_function.oid::regprocedure;
      END IF;
    END LOOP;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20260910224500'
  ) THEN
    RAISE EXCEPTION 'rollback manteve ledger da retirada dos RPCs legados';
  END IF;
END
$smoke$;

BEGIN;
INSERT INTO public.companies (id, name, lg_ativo)
VALUES ('42000000-0000-4000-8000-000000000001', 'Empresa QA Rollback', TRUE)
ON CONFLICT (id) DO UPDATE SET lg_ativo = TRUE;
INSERT INTO public.pre_cadastro (
  id, company_id, full_name, email, versao_termo, texto_termo_hash,
  token_confirmacao, token_confirmacao_hash, dt_token_exp, status
) VALUES (
  '42000000-0000-4000-8000-000000000002',
  '42000000-0000-4000-8000-000000000001',
  'Paciente QA Hash Only', 'hash-only.rollback@example.test', 'v1.0-qa',
  repeat('a', 64), NULL,
  encode(public.digest('rollback-hash-only-token-qa', 'sha256'), 'hex'),
  clock_timestamp() + interval '1 day', 'PENDENTE'
);
SET LOCAL ROLE anon;
SELECT public.confirm_pre_cadastro('rollback-hash-only-token-qa');
RESET ROLE;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.pre_cadastro
    WHERE id = '42000000-0000-4000-8000-000000000002'
      AND status = 'CONFIRMADO'
  ) THEN
    RAISE EXCEPTION 'rollback nao confirmou registro hash-only pelo contrato legado';
  END IF;
END $$;
ROLLBACK;
