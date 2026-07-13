-- PostgreSQL 18 F4 pharmacy gate. Ephemeral replay only.
-- Never execute against production or DataSIGH.

\set ON_ERROR_STOP on

\if :{?f4_dblink_connstr}
SELECT set_config('f4.dblink_connstr', :'f4_dblink_connstr', FALSE) AS f4_conn_configured \gset
\else
SELECT set_config('f4.dblink_connstr', 'dbname=' || current_database(), FALSE) AS f4_conn_configured \gset
\endif

DO $gate$
BEGIN
  IF current_setting('server_version_num')::INTEGER < 180000 THEN
    RAISE EXCEPTION 'F4 pharmacy gate requires PostgreSQL 18, found %', version();
  END IF;
END
$gate$;

BEGIN;

INSERT INTO public.companies (id, name) VALUES
  ('f4000000-0000-4000-8000-000000000001', 'F4 Gate Tenant A'),
  ('f4000000-0000-4000-8000-000000000002', 'F4 Gate Tenant B');

INSERT INTO auth.users (id) VALUES
  ('f4100000-0000-4000-8000-000000000001'),
  ('f4100000-0000-4000-8000-000000000002'),
  ('f4100000-0000-4000-8000-000000000003');

INSERT INTO public.user_profiles
  (id, full_name, email, role_name, role_id, company_id, lg_ativo)
SELECT fixture.id, fixture.full_name, fixture.email, fixture.role_name,
       canonical_role.id, fixture.company_id, TRUE
  FROM (VALUES
    ('f4100000-0000-4000-8000-000000000001'::UUID, 'F4 Pharmacist A',
     'f4-a@test.invalid', 'farmacia', 'f4000000-0000-4000-8000-000000000001'::UUID),
    ('f4100000-0000-4000-8000-000000000002'::UUID, 'F4 Pharmacist B',
     'f4-b@test.invalid', 'farmacia', 'f4000000-0000-4000-8000-000000000002'::UUID),
    ('f4100000-0000-4000-8000-000000000003'::UUID, 'F4 Doctor A',
     'f4-doctor@test.invalid', 'medico', 'f4000000-0000-4000-8000-000000000001'::UUID)
  ) AS fixture(id, full_name, email, role_name, company_id)
  JOIN public.roles AS canonical_role ON canonical_role.name = fixture.role_name;

INSERT INTO public.patients (id, company_id, full_name, lg_ativo)
OVERRIDING SYSTEM VALUE VALUES
  (994001, 'f4000000-0000-4000-8000-000000000001', 'F4 Patient A', TRUE),
  (994002, 'f4000000-0000-4000-8000-000000000002', 'F4 Patient B', TRUE);

INSERT INTO public.professionals (id, company_id, full_name, crm, lg_ativo)
OVERRIDING SYSTEM VALUE VALUES
  (994041, 'f4000000-0000-4000-8000-000000000001', 'F4 Doctor A', 'F4-CRM', TRUE);

INSERT INTO public.receitas_controladas (
  id, company_id, cd_paciente, cd_medico, nr_receita, tp_receita,
  dt_emissao, dt_validade, qt_itens, lg_sngpc_enviado
)
OVERRIDING SYSTEM VALUE VALUES (
  994301, 'f4000000-0000-4000-8000-000000000001', 994001, 994041,
  'F4-CONTROLLED-001', 'AZUL', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '30 days',
  1, FALSE
);

INSERT INTO public.appointments
  (id, company_id, patient_id, appointment_date, start_time, status)
OVERRIDING SYSTEM VALUE VALUES
  (994011, 'f4000000-0000-4000-8000-000000000001', 994001, CURRENT_DATE, '09:00', 'agendado'),
  (994012, 'f4000000-0000-4000-8000-000000000002', 994002, CURRENT_DATE, '10:00', 'agendado');

INSERT INTO public.medicamentos
  (id, company_id, cd_principio_ativo, lg_ativo)
OVERRIDING SYSTEM VALUE VALUES
  (994021, 'f4000000-0000-4000-8000-000000000001', 'F4 Medicine A', TRUE),
  (994022, 'f4000000-0000-4000-8000-000000000002', 'F4 Medicine B', TRUE);

INSERT INTO public.almoxarifados
  (id, company_id, ds_nome, lg_ativo)
OVERRIDING SYSTEM VALUE VALUES
  (994031, 'f4000000-0000-4000-8000-000000000001', 'F4 Warehouse A', TRUE),
  (994032, 'f4000000-0000-4000-8000-000000000002', 'F4 Warehouse B', TRUE);

INSERT INTO public.lotes
  (id, company_id, cd_produto_tipo, cd_medicamento_id, cd_lote,
   dt_validade, qt_inicial, qt_atual, vl_custo_unitario, cd_almoxarifado, lg_ativo)
OVERRIDING SYSTEM VALUE VALUES
  (994101, 'f4000000-0000-4000-8000-000000000001', 'MEDICAMENTO', 994021,
   'F4-A-VALID', CURRENT_DATE + 90, 10, 10, 2.50, 994031, TRUE),
  (994102, 'f4000000-0000-4000-8000-000000000001', 'MEDICAMENTO', 994021,
   'F4-A-LOW', CURRENT_DATE + 120, 2, 2, 3.00, 994031, TRUE),
  (994103, 'f4000000-0000-4000-8000-000000000001', 'MEDICAMENTO', 994021,
   'F4-A-EXPIRED', CURRENT_DATE - 1, 5, 5, 4.00, 994031, TRUE),
  (994201, 'f4000000-0000-4000-8000-000000000002', 'MEDICAMENTO', 994022,
   'F4-B-VALID', CURRENT_DATE + 90, 8, 8, 10.00, 994032, TRUE);

DO $gate$
DECLARE
  v_function REGPROCEDURE;
  v_owner RECORD;
  v_table REGCLASS;
  v_sequence REGCLASS;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
     WHERE oid = 'public.v_estoque_atual'::REGCLASS
       AND reloptions @> ARRAY['security_invoker=true']
  ) THEN
    RAISE EXCEPTION 'v_estoque_atual is not security_invoker';
  END IF;
  IF EXISTS (
    SELECT required.name
      FROM (VALUES ('cd_medicamento_id'), ('cd_material_id'), ('nr_lote')) AS required(name)
     WHERE NOT EXISTS (
       SELECT 1 FROM information_schema.columns AS column_info
        WHERE column_info.table_schema = 'public'
          AND column_info.table_name = 'v_estoque_atual'
          AND column_info.column_name = required.name
     )
  ) THEN
    RAISE EXCEPTION 'v_estoque_atual is missing columns consumed by pharmacyService';
  END IF;

  FOREACH v_function IN ARRAY ARRAY[
    'public.registrar_movimentacao_estoque(bigint,character varying,integer,text,bigint,bigint,bigint,text)'::REGPROCEDURE,
    'public.calcular_valor_estoque(uuid)'::REGPROCEDURE,
    'public.dispensar_estoque(uuid,bigint,jsonb,bigint,bigint,text)'::REGPROCEDURE
  ]
  LOOP
    IF has_function_privilege('anon', v_function, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_function, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_function, 'EXECUTE')
       OR EXISTS (
         SELECT 1
           FROM pg_proc AS procedure
           CROSS JOIN LATERAL aclexplode(
             COALESCE(procedure.proacl, acldefault('f', procedure.proowner))
           ) AS privilege
          WHERE procedure.oid = v_function
            AND privilege.grantee = 0
            AND privilege.privilege_type = 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'Function ACL mismatch for %', v_function;
    END IF;
  END LOOP;

  FOREACH v_function IN ARRAY ARRAY[
    'public.registrar_movimentacao_estoque(bigint,character varying,integer,text,bigint,bigint,bigint,text)'::REGPROCEDURE,
    'public.calcular_valor_estoque(uuid)'::REGPROCEDURE,
    'public.dispensar_estoque(uuid,bigint,jsonb,bigint,bigint,text)'::REGPROCEDURE
  ]
  LOOP
    SELECT role.rolname, role.rolsuper, role.rolbypassrls, role.rolcanlogin
      INTO v_owner
      FROM pg_proc AS procedure
      JOIN pg_roles AS role ON role.oid = procedure.proowner
     WHERE procedure.oid = v_function;
    IF v_owner.rolname IS DISTINCT FROM 'pharmacy_rpc_owner'
       OR v_owner.rolsuper OR v_owner.rolbypassrls OR v_owner.rolcanlogin THEN
      RAISE EXCEPTION 'Unsafe function owner for %: %', v_function, row_to_json(v_owner);
    END IF;
  END LOOP;

  FOREACH v_table IN ARRAY ARRAY[
    'public.lotes'::REGCLASS,
    'public.movimentacoes_estoque'::REGCLASS,
    'public.dispensacoes'::REGCLASS,
    'public.dispensacao_itens'::REGCLASS,
    'public.receitas_controladas'::REGCLASS
  ]
  LOOP
    IF has_table_privilege('anon', v_table, 'INSERT,UPDATE,DELETE,TRUNCATE')
       OR has_table_privilege('authenticated', v_table, 'INSERT,UPDATE,DELETE,TRUNCATE')
       OR NOT has_table_privilege('service_role', v_table, 'INSERT')
       OR NOT has_table_privilege('service_role', v_table, 'UPDATE')
       OR NOT has_table_privilege('service_role', v_table, 'DELETE')
       OR NOT has_table_privilege('service_role', v_table, 'TRUNCATE')
       OR EXISTS (
         SELECT 1
           FROM pg_class AS class
           CROSS JOIN LATERAL aclexplode(
             COALESCE(class.relacl, acldefault('r', class.relowner))
           ) AS privilege
          WHERE class.oid = v_table
            AND privilege.grantee = 0
            AND privilege.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
       ) THEN
      RAISE EXCEPTION 'Direct DML remains available on %', v_table;
    END IF;
  END LOOP;

  IF has_column_privilege('anon', 'public.receitas_controladas', 'lg_sngpc_enviado', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.receitas_controladas', 'lg_sngpc_enviado', 'UPDATE')
     OR NOT has_column_privilege('service_role', 'public.receitas_controladas', 'lg_sngpc_enviado', 'UPDATE') THEN
    RAISE EXCEPTION 'lg_sngpc_enviado column ACL mismatch';
  END IF;

  FOREACH v_sequence IN ARRAY ARRAY[
    'public.lotes_id_seq'::REGCLASS,
    'public.movimentacoes_estoque_id_seq'::REGCLASS,
    'public.dispensacoes_id_seq'::REGCLASS,
    'public.dispensacao_itens_id_seq'::REGCLASS,
    'public.receitas_controladas_id_seq'::REGCLASS
  ]
  LOOP
    IF has_sequence_privilege('anon', v_sequence, 'USAGE,UPDATE')
       OR has_sequence_privilege('authenticated', v_sequence, 'USAGE,UPDATE')
       OR NOT has_sequence_privilege('service_role', v_sequence, 'USAGE')
       OR NOT has_sequence_privilege('service_role', v_sequence, 'SELECT')
       OR NOT has_sequence_privilege('service_role', v_sequence, 'UPDATE') THEN
      RAISE EXCEPTION 'Sequence ACL mismatch for %', v_sequence;
    END IF;
  END LOOP;
END
$gate$;

SET LOCAL ROLE service_role;
UPDATE public.receitas_controladas
   SET lg_sngpc_enviado = TRUE,
       dt_sngpc_envio = CURRENT_TIMESTAMP
 WHERE id = 994301;
DO $gate$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.receitas_controladas
     WHERE id = 994301 AND lg_sngpc_enviado = TRUE AND dt_sngpc_envio IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'service_role lost operational SNGPC update capability';
  END IF;
END
$gate$;
RESET ROLE;
UPDATE public.receitas_controladas
   SET lg_sngpc_enviado = FALSE,
       dt_sngpc_envio = NULL
 WHERE id = 994301;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'f4100000-0000-4000-8000-000000000001', TRUE);

DO $gate$
DECLARE
  v_first RECORD;
  v_replay RECORD;
  v_before_count INTEGER;
  v_before_qty INTEGER;
  v_value NUMERIC;
BEGIN
  IF (SELECT count(*) FROM public.v_estoque_atual) <> 3
     OR EXISTS (SELECT 1 FROM public.v_estoque_atual WHERE company_id <> 'f4000000-0000-4000-8000-000000000001')
     OR (SELECT nr_lote FROM public.v_estoque_atual WHERE cd_lote = 994101) <> 'F4-A-VALID' THEN
    RAISE EXCEPTION 'Tenant A view isolation/columns failed';
  END IF;

  v_value := public.calcular_valor_estoque();
  IF v_value <> 51.00 THEN
    RAISE EXCEPTION 'Tenant A inventory value leaked or mismatched: %', v_value;
  END IF;
  BEGIN
    PERFORM public.calcular_valor_estoque('f4000000-0000-4000-8000-000000000002');
    RAISE EXCEPTION 'Cross-tenant valuation was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%fora do tenant%' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE public.lotes SET qt_atual = 0 WHERE id = 994101;
    RAISE EXCEPTION 'Authenticated direct inventory update was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    UPDATE public.receitas_controladas
       SET lg_sngpc_enviado = TRUE,
           dt_sngpc_envio = CURRENT_TIMESTAMP
     WHERE id = 994301;
    RAISE EXCEPTION 'Authenticated/Data API direct SNGPC marking was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF (SELECT lg_sngpc_enviado FROM public.receitas_controladas WHERE id = 994301)
     OR (SELECT dt_sngpc_envio FROM public.receitas_controladas WHERE id = 994301) IS NOT NULL THEN
    RAISE EXCEPTION 'Denied SNGPC update changed controlled prescription state';
  END IF;

  BEGIN
    PERFORM public.registrar_movimentacao_estoque(
      994101, 'SAIDA', 1, 'unsupported prescription link', 994001, 994011, 994301, NULL
    );
    RAISE EXCEPTION 'Stock movement accepted cd_prescricao_id without a canonical relation';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Vinculo de prescricao sem relacao canonica nao e aceito%' THEN RAISE; END IF;
  END;
  IF (SELECT qt_atual FROM public.lotes WHERE id = 994101) <> 10
     OR EXISTS (SELECT 1 FROM public.movimentacoes_estoque WHERE cd_lote = 994101) THEN
    RAISE EXCEPTION 'Rejected movement prescription link changed state';
  END IF;

  BEGIN
    PERFORM public.dispensar_estoque(
      'f4200000-0000-4000-8000-000000000007', 994001,
      '[{"cd_lote":994101,"qt_dispensada":1}]', 994011, 994301,
      'unsupported prescription link'
    );
    RAISE EXCEPTION 'Dispensing accepted cd_prescricao_id without a canonical relation';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Vinculo de prescricao sem relacao canonica nao e aceito%' THEN RAISE; END IF;
  END;
  IF (SELECT qt_atual FROM public.lotes WHERE id = 994101) <> 10
     OR EXISTS (
       SELECT 1 FROM public.dispensacoes
        WHERE idempotency_key = 'f4200000-0000-4000-8000-000000000007'
     )
     OR EXISTS (SELECT 1 FROM public.movimentacoes_estoque WHERE cd_lote = 994101) THEN
    RAISE EXCEPTION 'Rejected dispensing prescription link changed state';
  END IF;

  BEGIN
    PERFORM public.registrar_movimentacao_estoque(
      994201, 'SAIDA', 1, 'cross tenant', 994001, NULL, NULL, NULL
    );
    RAISE EXCEPTION 'Cross-tenant movement was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%fora do tenant%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.dispensar_estoque(
      'f4200000-0000-4000-8000-000000000001', 994001,
      '[{"cd_lote":994101,"qt_dispensada":1},{"cd_lote":994102,"qt_dispensada":99}]',
      994011, NULL, 'must rollback'
    );
    RAISE EXCEPTION 'Insufficient multi-item dispensing was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Estoque insuficiente%' THEN RAISE; END IF;
  END;
  IF EXISTS (
       SELECT 1 FROM public.dispensacoes
        WHERE idempotency_key = 'f4200000-0000-4000-8000-000000000001'
     )
     OR EXISTS (SELECT 1 FROM public.dispensacao_itens WHERE cd_lote IN (994101, 994102))
     OR EXISTS (SELECT 1 FROM public.movimentacoes_estoque WHERE cd_lote IN (994101, 994102))
     OR (SELECT qt_atual FROM public.lotes WHERE id = 994101) <> 10
     OR (SELECT qt_atual FROM public.lotes WHERE id = 994102) <> 2 THEN
    RAISE EXCEPTION 'Failed dispensing left partial state';
  END IF;

  BEGIN
    PERFORM public.dispensar_estoque(
      'f4200000-0000-4000-8000-000000000002', 994001,
      '[{"cd_lote":994103,"qt_dispensada":1}]', NULL, NULL, NULL
    );
    RAISE EXCEPTION 'Expired lot was dispensed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%vencido%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.dispensar_estoque(
      'f4200000-0000-4000-8000-000000000003', 994001,
      '[{"cd_lote":994201,"qt_dispensada":1}]', NULL, NULL, NULL
    );
    RAISE EXCEPTION 'Tenant A dispensed Tenant B lot';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%fora do tenant%' THEN RAISE; END IF;
  END;

  SELECT count(*), qt_atual INTO v_before_count, v_before_qty
    FROM public.lotes WHERE id = 994101 GROUP BY qt_atual;
  SELECT * INTO v_first FROM public.dispensar_estoque(
    'f4200000-0000-4000-8000-000000000004', 994001,
    '[{"cd_lote":994101,"qt_dispensada":3}]', 994011, NULL, 'idempotent success'
  );
  IF v_first.idempotent_replay OR v_first.company_id <> 'f4000000-0000-4000-8000-000000000001'
     OR (SELECT qt_atual FROM public.lotes WHERE id = 994101) <> 7
     OR (SELECT count(*) FROM public.dispensacao_itens WHERE cd_dispensacao = v_first.id) <> 1
     OR (SELECT count(*) FROM public.movimentacoes_estoque WHERE cd_lote = 994101) <> 1 THEN
    RAISE EXCEPTION 'Atomic dispensing result mismatch';
  END IF;

  SELECT * INTO v_replay FROM public.dispensar_estoque(
    'f4200000-0000-4000-8000-000000000004', 994001,
    '[{"qt_dispensada":3,"cd_lote":994101}]', 994011, NULL, 'idempotent success'
  );
  IF NOT v_replay.idempotent_replay OR v_replay.id <> v_first.id
     OR (SELECT qt_atual FROM public.lotes WHERE id = 994101) <> 7
     OR (SELECT count(*) FROM public.movimentacoes_estoque WHERE cd_lote = 994101) <> 1 THEN
    RAISE EXCEPTION 'Idempotent retry changed state';
  END IF;

  BEGIN
    PERFORM public.dispensar_estoque(
      'f4200000-0000-4000-8000-000000000004', 994001,
      '[{"cd_lote":994101,"qt_dispensada":2}]', 994011, NULL, 'idempotent success'
    );
    RAISE EXCEPTION 'Divergent idempotency payload was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%payload diferente%' THEN RAISE; END IF;
  END;
END
$gate$;

SELECT set_config('request.jwt.claim.sub', 'f4100000-0000-4000-8000-000000000003', TRUE);
DO $gate$
BEGIN
  BEGIN
    PERFORM public.dispensar_estoque(
      'f4200000-0000-4000-8000-000000000005', 994001,
      '[{"cd_lote":994102,"qt_dispensada":1}]', NULL, NULL, NULL
    );
    RAISE EXCEPTION 'Unauthorized profile dispensed stock';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Perfil sem permissao%' THEN RAISE; END IF;
  END;
END
$gate$;

SELECT set_config('request.jwt.claim.sub', 'f4100000-0000-4000-8000-000000000002', TRUE);
DO $gate$
DECLARE v_row RECORD;
BEGIN
  IF (SELECT count(*) FROM public.v_estoque_atual) <> 1
     OR EXISTS (SELECT 1 FROM public.v_estoque_atual WHERE company_id <> 'f4000000-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'Tenant B view isolation failed';
  END IF;
  SELECT * INTO v_row FROM public.dispensar_estoque(
    'f4200000-0000-4000-8000-000000000006', 994002,
    '[{"cd_lote":994201,"qt_dispensada":2}]', 994012, NULL, 'tenant B'
  );
  IF v_row.company_id <> 'f4000000-0000-4000-8000-000000000002'
     OR (SELECT qt_atual FROM public.lotes WHERE id = 994201) <> 6 THEN
    RAISE EXCEPTION 'Tenant B dispensing failed';
  END IF;
END
$gate$;

RESET ROLE;
ROLLBACK;

CREATE EXTENSION IF NOT EXISTS dblink;

DO $concurrency$
DECLARE
  v_conn TEXT := current_setting('f4.dblink_connstr');
  v_success_a INTEGER := 0;
  v_success_b INTEGER := 0;
  v_deadline TIMESTAMPTZ;
  v_error TEXT;
BEGIN
  PERFORM dblink_connect('f4_setup', v_conn);
  PERFORM dblink_connect('f4_blocker', v_conn);
  PERFORM dblink_connect('f4_worker_a', v_conn);
  PERFORM dblink_connect('f4_worker_b', v_conn);

  PERFORM dblink_exec('f4_setup', $sql$
    INSERT INTO public.companies (id, name)
    VALUES ('f4000000-0000-4000-8000-000000000009', 'F4 Concurrency Tenant');
    INSERT INTO auth.users (id)
    VALUES ('f4100000-0000-4000-8000-000000000009');
    INSERT INTO public.user_profiles
      (id, full_name, email, role_name, role_id, company_id, lg_ativo)
    SELECT
      'f4100000-0000-4000-8000-000000000009', 'F4 Concurrent Pharmacist',
      'f4-concurrency@test.invalid', canonical_role.name, canonical_role.id,
      'f4000000-0000-4000-8000-000000000009', TRUE
      FROM public.roles AS canonical_role
     WHERE canonical_role.name = 'farmacia';
    INSERT INTO public.patients (id, company_id, full_name, lg_ativo)
      OVERRIDING SYSTEM VALUE
    VALUES (994009, 'f4000000-0000-4000-8000-000000000009', 'F4 Concurrent Patient', TRUE);
    INSERT INTO public.medicamentos (id, company_id, cd_principio_ativo, lg_ativo)
      OVERRIDING SYSTEM VALUE
    VALUES (994029, 'f4000000-0000-4000-8000-000000000009', 'F4 Concurrent Medicine', TRUE);
    INSERT INTO public.almoxarifados (id, company_id, ds_nome, lg_ativo)
      OVERRIDING SYSTEM VALUE
    VALUES (994039, 'f4000000-0000-4000-8000-000000000009', 'F4 Concurrent Warehouse', TRUE);
    INSERT INTO public.lotes
      (id, company_id, cd_produto_tipo, cd_medicamento_id, cd_lote,
       dt_validade, qt_inicial, qt_atual, vl_custo_unitario, cd_almoxarifado, lg_ativo)
      OVERRIDING SYSTEM VALUE
    VALUES (
      994109, 'f4000000-0000-4000-8000-000000000009', 'MEDICAMENTO', 994029,
      'F4-CONCURRENT', CURRENT_DATE + 90, 10, 10, 1.00, 994039, TRUE
    );
  $sql$);

  PERFORM dblink_exec('f4_worker_a', 'SET ROLE authenticated');
  PERFORM dblink_exec('f4_worker_b', 'SET ROLE authenticated');
  PERFORM dblink_exec(
    'f4_worker_a',
    $$SET request.jwt.claim.sub = 'f4100000-0000-4000-8000-000000000009'$$
  );
  PERFORM dblink_exec(
    'f4_worker_b',
    $$SET request.jwt.claim.sub = 'f4100000-0000-4000-8000-000000000009'$$
  );

  PERFORM dblink_exec('f4_blocker', 'BEGIN');
  PERFORM * FROM dblink(
    'f4_blocker', 'SELECT id FROM public.lotes WHERE id = 994109 FOR UPDATE'
  ) AS locked(id BIGINT);

  PERFORM dblink_send_query(
    'f4_worker_a',
    $$SELECT * FROM public.dispensar_estoque(
      'f4200000-0000-4000-8000-000000000091', 994009,
      '[{"cd_lote":994109,"qt_dispensada":7}]', NULL, NULL, 'concurrency A'
    )$$
  );
  PERFORM dblink_send_query(
    'f4_worker_b',
    $$SELECT * FROM public.dispensar_estoque(
      'f4200000-0000-4000-8000-000000000092', 994009,
      '[{"cd_lote":994109,"qt_dispensada":7}]', NULL, NULL, 'concurrency B'
    )$$
  );
  PERFORM pg_sleep(0.25);
  IF dblink_is_busy('f4_worker_a') <> 1 OR dblink_is_busy('f4_worker_b') <> 1 THEN
    RAISE EXCEPTION 'Workers did not overlap on the locked inventory row';
  END IF;

  PERFORM dblink_exec('f4_blocker', 'COMMIT');
  v_deadline := clock_timestamp() + INTERVAL '10 seconds';
  WHILE dblink_is_busy('f4_worker_a') = 1 OR dblink_is_busy('f4_worker_b') = 1 LOOP
    IF clock_timestamp() > v_deadline THEN
      RAISE EXCEPTION 'Concurrent dispensing workers timed out';
    END IF;
    PERFORM pg_sleep(0.05);
  END LOOP;

  SELECT count(*) INTO v_success_a
    FROM dblink_get_result('f4_worker_a', FALSE) AS result(
      id BIGINT, company_id UUID, cd_paciente BIGINT, dt_dispensacao TIMESTAMPTZ,
      cd_usuario UUID, idempotent_replay BOOLEAN
    );
  SELECT count(*) INTO v_success_b
    FROM dblink_get_result('f4_worker_b', FALSE) AS result(
      id BIGINT, company_id UUID, cd_paciente BIGINT, dt_dispensacao TIMESTAMPTZ,
      cd_usuario UUID, idempotent_replay BOOLEAN
    );

  IF v_success_a + v_success_b <> 1
     OR (SELECT qt_atual FROM public.lotes WHERE id = 994109) <> 3
     OR EXISTS (SELECT 1 FROM public.lotes WHERE id = 994109 AND qt_atual < 0)
     OR (SELECT count(*) FROM public.dispensacoes WHERE company_id = 'f4000000-0000-4000-8000-000000000009') <> 1
     OR (SELECT count(*) FROM public.dispensacao_itens WHERE cd_lote = 994109) <> 1
     OR (SELECT count(*) FROM public.movimentacoes_estoque WHERE cd_lote = 994109 AND qt_posterior >= 0) <> 1 THEN
    RAISE EXCEPTION 'Concurrency invariant failed: success_a=%, success_b=%', v_success_a, v_success_b;
  END IF;

  PERFORM dblink_disconnect('f4_worker_a');
  PERFORM dblink_disconnect('f4_worker_b');
  PERFORM dblink_disconnect('f4_blocker');
  PERFORM dblink_disconnect('f4_setup');

  DELETE FROM public.movimentacoes_estoque WHERE cd_lote = 994109;
  DELETE FROM public.dispensacao_itens WHERE cd_lote = 994109;
  DELETE FROM public.dispensacoes WHERE company_id = 'f4000000-0000-4000-8000-000000000009';
  DELETE FROM public.lotes WHERE id = 994109;
  DELETE FROM public.almoxarifados WHERE id = 994039;
  DELETE FROM public.medicamentos WHERE id = 994029;
  DELETE FROM public.patients WHERE id = 994009;
  DELETE FROM public.user_profiles WHERE id = 'f4100000-0000-4000-8000-000000000009';
  DELETE FROM auth.users WHERE id = 'f4100000-0000-4000-8000-000000000009';
  DELETE FROM public.companies WHERE id = 'f4000000-0000-4000-8000-000000000009';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
  BEGIN PERFORM dblink_exec('f4_blocker', 'ROLLBACK'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM dblink_disconnect('f4_worker_a'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM dblink_disconnect('f4_worker_b'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM dblink_disconnect('f4_blocker'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM dblink_disconnect('f4_setup'); EXCEPTION WHEN OTHERS THEN NULL; END;
  DELETE FROM public.movimentacoes_estoque WHERE cd_lote = 994109;
  DELETE FROM public.dispensacao_itens WHERE cd_lote = 994109;
  DELETE FROM public.dispensacoes WHERE company_id = 'f4000000-0000-4000-8000-000000000009';
  DELETE FROM public.lotes WHERE id = 994109;
  DELETE FROM public.almoxarifados WHERE id = 994039;
  DELETE FROM public.medicamentos WHERE id = 994029;
  DELETE FROM public.patients WHERE id = 994009;
  DELETE FROM public.user_profiles WHERE id = 'f4100000-0000-4000-8000-000000000009';
  DELETE FROM auth.users WHERE id = 'f4100000-0000-4000-8000-000000000009';
  DELETE FROM public.companies WHERE id = 'f4000000-0000-4000-8000-000000000009';
  RAISE EXCEPTION 'F4 concurrency gate failed: %', v_error;
END
$concurrency$;

SELECT 'F4_PHARMACY_ATOMIC_TENANT_GATE=PASS' AS result;

