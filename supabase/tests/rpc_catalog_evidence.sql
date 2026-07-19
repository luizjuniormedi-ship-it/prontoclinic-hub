-- Read-only RPC catalog evidence. Execute only after an approved local replay.
-- No DDL/DML; captures definitions, identity signatures, SECURITY DEFINER and ACLs.

\set ON_ERROR_STOP on

WITH expected(name) AS (
  VALUES
    ('anonymize_patient'), ('bedside_check'), ('billing_check_pending'),
    ('calc_imc'), ('calcular_kpis_diarios'), ('calcular_valor_estoque'),
    ('cancel_pre_cadastro'), ('check_prescription_safety'),
    ('confirm_pre_cadastro'), ('create_pre_cadastro'), ('current_company_id'),
    ('detectar_alertas_bi'), ('finalizar_sala_telemedicina'), ('find_price'),
    ('gerar_senha_triagem'), ('log_data_access'), ('promote_pre_cadastro'),
    ('publish_dicom_report'), ('queue_notification'), ('recalc_tiss_total_glosa'),
    ('registrar_consentimento_gravacao'), ('registrar_movimentacao_estoque'),
    ('tiss_get_stats')
)
SELECT e.name AS expected_rpc,
       p.oid::regprocedure AS actual_signature,
       pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       pg_get_function_result(p.oid) AS return_type,
       p.prosecdef AS security_definer,
       pg_get_userbyid(p.proowner) AS owner_name,
       COALESCE(array_to_string(p.proconfig, ';'), '') AS settings,
       CASE WHEN p.oid IS NULL THEN 'SQL_DEFINITION_MISSING' ELSE 'FOUND' END AS status
FROM expected e
LEFT JOIN pg_proc p
  ON p.pronamespace = 'public'::regnamespace
 AND p.proname = e.name
ORDER BY e.name, actual_signature;

SELECT p.oid::regprocedure AS function_signature,
       grantee.rolname AS grantee,
       privilege_type,
       grantor.rolname AS grantor
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
LEFT JOIN pg_roles grantor ON grantor.oid = acl.grantor
WHERE n.nspname = 'public'
  AND p.proname IN (
    'anonymize_patient', 'bedside_check', 'billing_check_pending', 'calc_imc',
    'calcular_kpis_diarios', 'calcular_valor_estoque', 'cancel_pre_cadastro',
    'check_prescription_safety', 'confirm_pre_cadastro', 'create_pre_cadastro',
    'current_company_id', 'detectar_alertas_bi', 'finalizar_sala_telemedicina',
    'find_price', 'gerar_senha_triagem', 'log_data_access', 'promote_pre_cadastro',
    'publish_dicom_report', 'queue_notification', 'recalc_tiss_total_glosa',
    'registrar_consentimento_gravacao', 'registrar_movimentacao_estoque',
    'tiss_get_stats'
  )
ORDER BY function_signature, grantee, privilege_type;
