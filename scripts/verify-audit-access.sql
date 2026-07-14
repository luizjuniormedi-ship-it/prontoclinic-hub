-- Prova efemera do contrato da RPC de auditoria. Nunca executar no DataSIGH.

SET ROLE authenticated;

DO $$
DECLARE
  v_log_id BIGINT;
  v_row BIGINT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000011', false);

  SELECT public.log_data_access(
    'patients', '910001', 'VIEW_RECORD', '{"source":"f1"}'::jsonb
  ) INTO v_log_id;

  IF v_log_id IS NULL THEN
    RAISE EXCEPTION 'AUDIT_RPC_FAIL: retorno nulo';
  END IF;

  SELECT id INTO v_row
    FROM public.audit_logs
   WHERE id = v_log_id
     AND company_id = 'f1000000-0000-4000-8000-000000000001'::uuid
     AND cd_usuario = 'f1000000-0000-4000-8000-000000000011'::uuid
     AND tabela = 'patients'
     AND registro_id = '910001'
     AND acao = 'VIEW_RECORD';

  IF v_row IS DISTINCT FROM v_log_id THEN
    RAISE EXCEPTION 'AUDIT_RPC_FAIL: retorno nao corresponde ao registro inserido';
  END IF;

  BEGIN
    PERFORM public.log_data_access('exames_lab_catalogo', '920002', 'VIEW_RECORD', '{}'::jsonb);
    RAISE EXCEPTION 'AUDIT_RPC_FAIL: acesso cross-tenant foi aceito';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    NULL;
  END;

  BEGIN
    PERFORM public.log_data_access('patients', '910001', 'UPDATE', '{}'::jsonb);
    RAISE EXCEPTION 'AUDIT_RPC_FAIL: acao de escrita foi aceita pela RPC';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    NULL;
  END;

  RAISE NOTICE 'F1_AUDIT_RPC_PASS log_id=%', v_log_id;
END
$$;

RESET ROLE;
