\set ON_ERROR_STOP on

DO $contract$
DECLARE
  v_owner TEXT;
  v_policy_count INTEGER;
  v_privilege_count INTEGER;
BEGIN
  SELECT owner.rolname
    INTO v_owner
    FROM pg_proc function
    JOIN pg_namespace namespace ON namespace.oid = function.pronamespace
    JOIN pg_roles owner ON owner.oid = function.proowner
   WHERE namespace.nspname = 'private'
     AND function.proname = 'm11_ensure_tiss_guide'
     AND pg_get_function_identity_arguments(function.oid) = 'p_workflow_id uuid, p_guide_type text, p_environment text';

  IF v_owner IS DISTINCT FROM 'prontomedic_reception_rpc_owner' THEN
    RAISE EXCEPTION 'm11_ensure_tiss_guide owner invalido: %', v_owner;
  END IF;

  SELECT count(*)
    INTO v_policy_count
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename = 'tiss_guides'
     AND policyname = 'tiss_guides_reception_rpc_access'
     AND cmd = 'ALL'
     AND roles = ARRAY['prontomedic_reception_rpc_owner']::name[]
     AND qual LIKE '%current_company_id%'
     AND with_check LIKE '%reception_actor_can_access_unit%';

  IF v_policy_count <> 1 THEN
    RAISE EXCEPTION 'Policy TISS da Recepcao ausente ou aberta demais';
  END IF;

  SELECT count(DISTINCT privilege_type)
    INTO v_privilege_count
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public'
     AND table_name = 'tiss_guides'
     AND grantee = 'prontomedic_reception_rpc_owner'
     AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE');

  IF v_privilege_count <> 3 THEN
    RAISE EXCEPTION 'Privilegios TISS da Recepcao incompletos';
  END IF;

  IF has_table_privilege(
    'prontomedic_reception_rpc_owner',
    'public.tiss_guides',
    'DELETE'
  ) THEN
    RAISE EXCEPTION 'Recepcao nao pode excluir guia TISS';
  END IF;
END;
$contract$;

SELECT 'RECEPTION_TISS_OWNER_CONTRACT_PASS';
