-- Prova efemera do contrato da RPC de auditoria. Nunca executar no DataSIGH.

SET ROLE authenticated;

SELECT set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000011', false);
SELECT public.log_data_access(
  'patients', '910001', 'VIEW_RECORD', '{"source":"f1"}'::jsonb
) AS audit_log_id \gset

DO $$
BEGIN
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

  RAISE NOTICE 'F1_AUDIT_RPC_CALL_PASS';
END
$$;

RESET ROLE;

SELECT count(*) AS audit_match_count
  FROM public.audit_logs
 WHERE id = :'audit_log_id'::BIGINT
   AND company_id = 'f1000000-0000-4000-8000-000000000001'::uuid
   AND cd_usuario = 'f1000000-0000-4000-8000-000000000011'::uuid
   AND tabela = 'patients'
   AND registro_id = '910001'
   AND acao = 'VIEW_RECORD';

\if :audit_match_count != 1
  \echo 'AUDIT_RPC_FAIL: retorno nao corresponde ao registro inserido'
  \quit 1
\endif

\echo 'F1_AUDIT_RPC_PASS'

SELECT count(*) AS audit_append_only_trigger_count
  FROM pg_trigger
 WHERE tgrelid = 'public.audit_logs'::regclass
   AND tgname = 'trg_audit_logs_append_only'
   AND NOT tgisinternal;

\if :audit_append_only_trigger_count != 1
  \echo 'AUDIT_RPC_FAIL: trigger append-only ausente'
  \quit 1
\endif

\echo 'F1_AUDIT_APPEND_ONLY_CONTRACT_PASS'
