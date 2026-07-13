-- PostgreSQL 18 runtime gate for the atomic nursing triage contract.
-- Ephemeral replay only. Never execute against DataSIGH or production.

BEGIN;

DO $gate$
BEGIN
  IF current_setting('server_version_num')::INTEGER < 180000 THEN
    RAISE EXCEPTION 'Nursing triage runtime gate requires PostgreSQL 18, found %', version();
  END IF;
END
$gate$;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE sql
STABLE
AS $gate$
  SELECT NULLIF(current_setting('app.test_user_id', TRUE), '')::UUID
$gate$;

INSERT INTO public.roles(name, description) VALUES
  ('triage_view_gate', 'Triage view gate'),
  ('triage_create_gate', 'Triage create gate'),
  ('triage_edit_gate', 'Triage edit gate'),
  ('triage_none_gate', 'Triage no permission gate')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.role_permissions(role_id, module, can_view, can_create, can_edit)
SELECT role.id, 'enfermagem', matrix.can_view, matrix.can_create, matrix.can_edit
  FROM (VALUES
    ('triage_view_gate', TRUE, FALSE, FALSE),
    ('triage_create_gate', FALSE, TRUE, FALSE),
    ('triage_edit_gate', FALSE, FALSE, TRUE),
    ('triage_none_gate', FALSE, FALSE, FALSE)
  ) AS matrix(role_name, can_view, can_create, can_edit)
  JOIN public.roles AS role ON role.name = matrix.role_name
ON CONFLICT (role_id, module) DO UPDATE
  SET can_view = EXCLUDED.can_view,
      can_create = EXCLUDED.can_create,
      can_edit = EXCLUDED.can_edit;

INSERT INTO public.companies(id, name) VALUES
  ('71000000-0000-4000-8000-000000000001', 'Triage Tenant A'),
  ('72000000-0000-4000-8000-000000000002', 'Triage Tenant B');

INSERT INTO auth.users(id) VALUES
  ('81000000-0000-4000-8000-000000000001'),
  ('82000000-0000-4000-8000-000000000002'),
  ('83000000-0000-4000-8000-000000000003'),
  ('84000000-0000-4000-8000-000000000004'),
  ('85000000-0000-4000-8000-000000000005'),
  ('86000000-0000-4000-8000-000000000006');

INSERT INTO public.user_profiles(id, full_name, role_name, role_id, company_id, lg_ativo)
SELECT seed.id, seed.full_name, seed.role_name, role.id, seed.company_id, TRUE
  FROM (VALUES
    ('81000000-0000-4000-8000-000000000001'::UUID, 'Nurse A', 'enfermagem', '71000000-0000-4000-8000-000000000001'::UUID),
    ('82000000-0000-4000-8000-000000000002'::UUID, 'Nurse B', 'enfermagem', '72000000-0000-4000-8000-000000000002'::UUID),
    ('83000000-0000-4000-8000-000000000003'::UUID, 'View A', 'triage_view_gate', '71000000-0000-4000-8000-000000000001'::UUID),
    ('84000000-0000-4000-8000-000000000004'::UUID, 'Create A', 'triage_create_gate', '71000000-0000-4000-8000-000000000001'::UUID),
    ('85000000-0000-4000-8000-000000000005'::UUID, 'Edit A', 'triage_edit_gate', '71000000-0000-4000-8000-000000000001'::UUID),
    ('86000000-0000-4000-8000-000000000006'::UUID, 'None A', 'triage_none_gate', '71000000-0000-4000-8000-000000000001'::UUID)
  ) AS seed(id, full_name, role_name, company_id)
  JOIN public.roles AS role ON role.name = seed.role_name;

INSERT INTO public.patients(id, company_id, full_name)
OVERRIDING SYSTEM VALUE VALUES
  (871001, '71000000-0000-4000-8000-000000000001', 'Patient A'),
  (872001, '72000000-0000-4000-8000-000000000002', 'Patient B');

INSERT INTO public.appointments(id, company_id, patient_id, appointment_date, start_time, status)
OVERRIDING SYSTEM VALUE VALUES
  (873001, '71000000-0000-4000-8000-000000000001', 871001, CURRENT_DATE, TIME '09:00', 'waiting'),
  (874001, '72000000-0000-4000-8000-000000000002', 872001, CURRENT_DATE, TIME '10:00', 'waiting');

INSERT INTO public.mnct_classificacao_risco(
  id, company_id, ds_classificacao, cd_cor_hex,
  nr_tempo_max_atendimento_min, lg_ativo
)
OVERRIDING SYSTEM VALUE VALUES
  (875001, NULL, 'VERMELHO_GATE', '#FF0000', 0, TRUE),
  (875002, '72000000-0000-4000-8000-000000000002', 'VERDE_GATE_B', '#00AA00', 120, TRUE);

DO $gate$
DECLARE
  v_function REGPROCEDURE;
  v_expected_argnames TEXT[];
  v_owner RECORD;
  v_relation RECORD;
  v_ref_guard_definition TEXT;
  v_update_guard_definition TEXT;
BEGIN
  FOREACH v_function IN ARRAY ARRAY[
    'public.enqueue_nursing_triage_secure(bigint,text,integer,uuid)'::REGPROCEDURE,
    'public.call_nursing_triage_secure(bigint,uuid)'::REGPROCEDURE,
    'public.complete_nursing_triage_secure(bigint,bigint,integer,jsonb,uuid)'::REGPROCEDURE
  ] LOOP
    v_expected_argnames := CASE
      WHEN v_function = 'public.enqueue_nursing_triage_secure(bigint,text,integer,uuid)'::REGPROCEDURE
        THEN ARRAY['p_patient_id','p_initial_complaint','p_classification_id','p_idempotency_key']
      WHEN v_function = 'public.call_nursing_triage_secure(bigint,uuid)'::REGPROCEDURE
        THEN ARRAY['p_queue_id','p_idempotency_key']
      ELSE ARRAY['p_queue_id','p_appointment_id','p_classification_id','p_triage','p_idempotency_key']
    END;
    SELECT role.rolname, role.rolsuper, role.rolbypassrls, role.rolcanlogin,
           procedure.proconfig, procedure.proargnames
      INTO v_owner
      FROM pg_proc AS procedure
      JOIN pg_roles AS role ON role.oid = procedure.proowner
     WHERE procedure.oid = v_function;
    IF v_owner.rolname IS DISTINCT FROM 'nursing_rpc_owner'
       OR v_owner.rolsuper OR v_owner.rolbypassrls OR v_owner.rolcanlogin
       OR NOT ('search_path=pg_catalog, public, pg_temp' = ANY(v_owner.proconfig))
       OR v_owner.proargnames IS DISTINCT FROM v_expected_argnames THEN
      RAISE EXCEPTION 'Unsafe nursing triage RPC owner/search_path/argnames: % expected %',
                      row_to_json(v_owner), v_expected_argnames;
    END IF;
    IF EXISTS (
         SELECT 1 FROM pg_proc AS procedure
         CROSS JOIN LATERAL aclexplode(COALESCE(procedure.proacl, acldefault('f', procedure.proowner))) AS privilege
         WHERE procedure.oid = v_function AND privilege.grantee = 0
           AND privilege.privilege_type = 'EXECUTE'
       )
       OR has_function_privilege('anon', v_function, 'EXECUTE')
       OR has_function_privilege('service_role', v_function, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_function, 'EXECUTE') THEN
      RAISE EXCEPTION 'Nursing triage RPC grants are not exact: %', v_function;
    END IF;
  END LOOP;

  FOR v_relation IN
    SELECT class.relname, class.relrowsecurity, class.relforcerowsecurity,
           owner.rolname, owner.rolsuper, owner.rolbypassrls, owner.rolcanlogin
      FROM pg_class AS class
      JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
      JOIN pg_roles AS owner ON owner.oid = class.relowner
     WHERE namespace.nspname = 'public'
       AND class.relname IN (
         'mnct_classificacao_risco', 'mnct_fluxograma', 'triagem_fila', 'triagens',
         'news2_avaliacoes', 'nursing_triage_daily_counters',
         'nursing_triage_audit_events'
       )
  LOOP
    IF NOT v_relation.relrowsecurity OR NOT v_relation.relforcerowsecurity
       OR v_relation.rolname IS DISTINCT FROM 'nursing_data_owner'
       OR v_relation.rolsuper OR v_relation.rolbypassrls OR v_relation.rolcanlogin THEN
      RAISE EXCEPTION 'Unsafe nursing triage relation: %', row_to_json(v_relation);
    END IF;
  END LOOP;

  IF has_table_privilege('anon', 'public.triagem_fila', 'SELECT')
     OR has_table_privilege('authenticated', 'public.triagem_fila', 'INSERT')
     OR has_table_privilege('authenticated', 'public.triagem_fila', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.triagem_fila', 'DELETE')
     OR has_table_privilege('authenticated', 'public.triagens', 'INSERT')
     OR has_table_privilege('authenticated', 'public.news2_avaliacoes', 'INSERT')
     OR has_table_privilege('service_role', 'public.triagem_fila', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.triagem_fila', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.triagens', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.news2_avaliacoes', 'SELECT') THEN
    RAISE EXCEPTION 'Nursing triage table grants are not exact';
  END IF;
  IF to_regclass('public.triagem_fila_daily_ticket_uq') IS NULL
     OR to_regclass('public.triagem_fila_enqueue_idempotency_uq') IS NULL
     OR to_regclass('public.triagens_completion_idempotency_uq') IS NULL THEN
    RAISE EXCEPTION 'Nursing triage uniqueness objects are missing';
  END IF;
  IF (SELECT count(*) FROM pg_constraint
       WHERE conname IN (
         'triagem_fila_tenant_patient_fkey', 'triagem_fila_tenant_appointment_fkey',
         'triagens_tenant_patient_fkey', 'triagens_tenant_appointment_fkey',
         'triagens_tenant_queue_fkey', 'triagens_tenant_actor_fkey',
         'news2_tenant_triage_fkey', 'nursing_triage_audit_tenant_queue_fkey',
         'nursing_triage_audit_tenant_triage_fkey', 'nursing_triage_audit_tenant_actor_fkey'
       ) AND contype = 'f' AND convalidated) <> 10 THEN
    RAISE EXCEPTION 'Composite tenant foreign keys are missing or unvalidated on empty replay';
  END IF;
  IF (SELECT count(*) FROM pg_trigger
       WHERE tgname IN (
         'triagem_fila_classification_tenant_guard',
         'triagens_classification_tenant_guard',
         'classification_reference_tenant_guard',
         'triagem_fila_snapshot_immutable_guard'
       ) AND NOT tgisinternal) <> 4 THEN
    RAISE EXCEPTION 'Classification tenant or snapshot immutability triggers are missing';
  END IF;
  SELECT pg_get_functiondef('public.nursing_classification_tenant_ref_guard()'::REGPROCEDURE)
    INTO v_ref_guard_definition;
  SELECT pg_get_functiondef('public.nursing_classification_tenant_update_guard()'::REGPROCEDURE)
    INTO v_update_guard_definition;
  IF strpos(regexp_replace(v_ref_guard_definition, '[[:space:]]+', '', 'g'),
            'pg_advisory_xact_lock(hashtextextended(''nursing-classification:''||v_classification_id::TEXT,0))') = 0
     OR strpos(regexp_replace(v_update_guard_definition, '[[:space:]]+', '', 'g'),
               'pg_advisory_xact_lock(hashtextextended(''nursing-classification:''||v_classification_id::TEXT,0))') = 0 THEN
    RAISE EXCEPTION 'Classification guards do not share the deterministic advisory lock key';
  END IF;
END
$gate$;

SET LOCAL ROLE authenticated;
SET LOCAL app.test_user_id = '81000000-0000-4000-8000-000000000001';

DO $gate$
DECLARE
  v_first JSONB;
  v_retry JSONB;
  v_called JSONB;
  v_complete JSONB;
  v_complete_retry JSONB;
  v_queue_id BIGINT;
  v_ticket_date DATE;
  v_before INTEGER;
BEGIN
  v_first := public.enqueue_nursing_triage_secure(
    871001, 'Dispneia intensa', 875001, '91000000-0000-4000-8000-000000000001'
  );
  v_queue_id := (v_first->>'id')::BIGINT;
  PERFORM set_config('app.gate_queue_a', v_queue_id::TEXT, TRUE);
  IF v_first->>'company_id' <> '71000000-0000-4000-8000-000000000001'
     OR v_first->>'cd_paciente' <> '871001'
     OR v_first->>'cd_senha' <> 'T001'
     OR v_first->>'tp_status' <> 'AGUARDANDO'
     OR v_first ? 'enqueue_request_hash'
     OR v_first ? 'enqueue_response_snapshot' THEN
    RAISE EXCEPTION 'Enqueue response mismatch: %', v_first;
  END IF;
  v_retry := public.enqueue_nursing_triage_secure(
    871001, 'Dispneia intensa', 875001, '91000000-0000-4000-8000-000000000001'
  );
  IF v_retry IS DISTINCT FROM v_first OR (SELECT count(*) FROM public.triagem_fila) <> 1 THEN
    RAISE EXCEPTION 'Enqueue retry changed state';
  END IF;
  BEGIN
    PERFORM public.enqueue_nursing_triage_secure(
      871001, 'Payload divergente', 875001, '91000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'Divergent enqueue retry was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%reutilizada com payload diferente%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.enqueue_nursing_triage_secure(
      872001, 'Cross tenant', 875001, '91000000-0000-4000-8000-000000000002'
    );
    RAISE EXCEPTION 'Tenant A enqueued Tenant B patient';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%fora do tenant%' THEN RAISE; END IF;
  END;

  v_called := public.call_nursing_triage_secure(
    v_queue_id, '92000000-0000-4000-8000-000000000001'
  );
  IF v_called->>'tp_status' <> 'CHAMADO'
     OR public.call_nursing_triage_secure(
          v_queue_id, '92000000-0000-4000-8000-000000000001'
        ) IS DISTINCT FROM v_called THEN
    RAISE EXCEPTION 'Call transition or retry mismatch';
  END IF;

  v_complete := public.complete_nursing_triage_secure(
    v_queue_id, NULL, 875001,
    '{"queixa_principal":"Dispneia intensa","historia_doenca_atual":"Inicio hoje","medicamentos_uso":"Nenhum","alergias":"Dipirona","observacoes_enfermagem":"Encaminhar imediatamente","sinais_vitais":{"pressaoSistolica":85,"pressaoDiastolica":55,"frequenciaCardiaca":140,"frequenciaRespiratoria":25,"temperatura":39.2,"saturacaoO2":90,"escalaDor":8},"antropometria":{"pesoKg":70.5,"alturaCm":172},"glasgow":{"ocular":3,"verbal":4,"motor":6},"status":"TRIADO"}'::JSONB,
    '93000000-0000-4000-8000-000000000001'
  );
  IF v_complete#>>'{triage,company_id}' <> '71000000-0000-4000-8000-000000000001'
     OR v_complete#>>'{triage,cd_usuario_enfermeiro}' <> '81000000-0000-4000-8000-000000000001'
     OR v_complete#>>'{triage,tp_status}' <> 'TRIADO'
     OR v_complete#>>'{triage,cd_nivel_consciencia}' <> 'C'
     OR v_complete#>>'{triage,cd_appointment}' IS NOT NULL
     OR (v_complete#>>'{news2,nr_score_total}')::INTEGER <> 17
     OR v_complete#>>'{news2,cd_classificacao_risco}' <> 'ALTO'
     OR (SELECT tp_status FROM public.triagem_fila WHERE id = v_queue_id) <> 'TRIADO'
     OR (SELECT count(*) FROM public.triagens WHERE cd_triagem_fila = v_queue_id) <> 1
     OR (SELECT count(*) FROM public.news2_avaliacoes) <> 1 THEN
    RAISE EXCEPTION 'Atomic completion or NEWS2 mismatch: %', v_complete;
  END IF;
  v_complete_retry := public.complete_nursing_triage_secure(
    v_queue_id, NULL, 875001,
    '{"queixa_principal":"Dispneia intensa","historia_doenca_atual":"Inicio hoje","medicamentos_uso":"Nenhum","alergias":"Dipirona","observacoes_enfermagem":"Encaminhar imediatamente","sinais_vitais":{"pressaoSistolica":85,"pressaoDiastolica":55,"frequenciaCardiaca":140,"frequenciaRespiratoria":25,"temperatura":39.2,"saturacaoO2":90,"escalaDor":8},"antropometria":{"pesoKg":70.5,"alturaCm":172},"glasgow":{"ocular":3,"verbal":4,"motor":6},"status":"TRIADO"}'::JSONB,
    '93000000-0000-4000-8000-000000000001'
  );
  IF v_complete_retry IS DISTINCT FROM v_complete
     OR (SELECT count(*) FROM public.triagens WHERE cd_triagem_fila = v_queue_id) <> 1
     OR (SELECT count(*) FROM public.news2_avaliacoes) <> 1 THEN
    RAISE EXCEPTION 'Completion retry changed state';
  END IF;
  v_retry := public.enqueue_nursing_triage_secure(
    871001, 'Dispneia intensa', 875001, '91000000-0000-4000-8000-000000000001'
  );
  IF v_retry IS DISTINCT FROM v_first THEN
    RAISE EXCEPTION 'Enqueue retry after completion did not return original snapshot';
  END IF;
  IF public.call_nursing_triage_secure(
       v_queue_id, '92000000-0000-4000-8000-000000000001'
     ) IS DISTINCT FROM v_called THEN
    RAISE EXCEPTION 'Call retry after completion did not return original snapshot';
  END IF;
  BEGIN
    PERFORM public.complete_nursing_triage_secure(
      v_queue_id, NULL, 875001,
      '{"queixa_principal":"Dispneia intensa","sinais_vitais":{"pressaoSistolica":85,"pressaoDiastolica":55,"frequenciaCardiaca":140,"frequenciaRespiratoria":25,"temperatura":38.0,"saturacaoO2":90},"glasgow":{"ocular":3,"verbal":4,"motor":6},"status":"TRIADO"}'::JSONB,
      '93000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'Divergent completion retry was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%reutilizada com payload diferente%' THEN RAISE; END IF;
  END;

  -- Rapid same-tenant issuance plus the catalog lock/unique checks exercise the
  -- collision barriers available in a single psql gate transaction.
  FOR v_before IN 2..12 LOOP
    v_retry := public.enqueue_nursing_triage_secure(
      871001, 'Carga ' || v_before, 875001,
      ('91000000-0000-4000-8000-' || lpad(v_before::TEXT, 12, '0'))::UUID
    );
    IF v_retry->>'cd_senha' <> 'T' || lpad(v_before::TEXT, 3, '0') THEN
      RAISE EXCEPTION 'Non-sequential daily ticket: %', v_retry;
    END IF;
  END LOOP;
  SELECT min(dt_senha) INTO v_ticket_date FROM public.triagem_fila
   WHERE company_id = '71000000-0000-4000-8000-000000000001';
  PERFORM set_config('app.gate_ticket_date', v_ticket_date::TEXT, TRUE);
  IF (SELECT count(*) FROM public.triagem_fila WHERE company_id = '71000000-0000-4000-8000-000000000001')
     <> (SELECT count(DISTINCT cd_senha) FROM public.triagem_fila WHERE company_id = '71000000-0000-4000-8000-000000000001')
  THEN
    RAISE EXCEPTION 'Daily ticket uniqueness mismatch';
  END IF;
END
$gate$;

-- RBAC exactness: create-only may enqueue but cannot call; edit-only can call;
-- view-only reads but cannot mutate; no-permission sees no rows.
SET LOCAL app.test_user_id = '84000000-0000-4000-8000-000000000004';
DO $gate$
DECLARE v_row JSONB;
BEGIN
  v_row := public.enqueue_nursing_triage_secure(
    871001, 'Create only', 875001, '94000000-0000-4000-8000-000000000001'
  );
  PERFORM set_config('app.gate_create_queue', v_row->>'id', TRUE);
  BEGIN
    PERFORM public.call_nursing_triage_secure(
      (v_row->>'id')::BIGINT, '94000000-0000-4000-8000-000000000002'
    );
    RAISE EXCEPTION 'Create-only actor called queue';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%enfermagem.edit%' THEN RAISE; END IF;
  END;
END
$gate$;

SET LOCAL app.test_user_id = '85000000-0000-4000-8000-000000000005';
DO $gate$
DECLARE v_completed JSONB;
BEGIN
  PERFORM public.call_nursing_triage_secure(
    current_setting('app.gate_create_queue')::BIGINT,
    '95000000-0000-4000-8000-000000000001'
  );
  v_completed := public.complete_nursing_triage_secure(
    current_setting('app.gate_create_queue')::BIGINT, 873001, 875001,
    '{"nivel_consciencia":"A","sinais_vitais":{"pressaoSistolica":120,"pressaoDiastolica":80,"frequenciaCardiaca":75,"frequenciaRespiratoria":16,"temperatura":36.8,"saturacaoO2":98},"status":"TRIADO"}'::JSONB,
    '95000000-0000-4000-8000-000000000003'
  );
  IF v_completed#>>'{triage,cd_appointment}' <> '873001'
     OR v_completed#>>'{triage,cd_nivel_consciencia}' <> 'A' THEN
    RAISE EXCEPTION 'Valid appointment completion mismatch: %', v_completed;
  END IF;
  BEGIN
    PERFORM public.enqueue_nursing_triage_secure(
      871001, 'Edit denied', 875001, '95000000-0000-4000-8000-000000000002'
    );
    RAISE EXCEPTION 'Edit-only actor enqueued queue';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%enfermagem.create%' THEN RAISE; END IF;
  END;
END
$gate$;

SET LOCAL app.test_user_id = '83000000-0000-4000-8000-000000000003';
DO $gate$
BEGIN
  IF (SELECT count(*) FROM public.triagem_fila) < 1 THEN
    RAISE EXCEPTION 'View-only actor cannot read tenant triage queue';
  END IF;
  BEGIN
    PERFORM public.enqueue_nursing_triage_secure(
      871001, 'View denied', 875001, '96000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'View-only actor enqueued queue';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%enfermagem.create%' THEN RAISE; END IF;
  END;
END
$gate$;

SET LOCAL app.test_user_id = '86000000-0000-4000-8000-000000000006';
DO $gate$
BEGIN
  IF EXISTS (SELECT 1 FROM public.triagem_fila)
     OR EXISTS (SELECT 1 FROM public.triagens)
     OR EXISTS (SELECT 1 FROM public.news2_avaliacoes) THEN
    RAISE EXCEPTION 'No-permission actor can read nursing triage data';
  END IF;
  BEGIN
    PERFORM public.enqueue_nursing_triage_secure(
      871001, 'Denied', 875001, '97000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'No-permission actor enqueued queue';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%enfermagem.create%' THEN RAISE; END IF;
  END;
END
$gate$;

-- Tenant B starts its own daily sequence and cannot see Tenant A rows.
SET LOCAL app.test_user_id = '82000000-0000-4000-8000-000000000002';
DO $gate$
DECLARE v_b JSONB;
BEGIN
  IF EXISTS (SELECT 1 FROM public.triagem_fila)
     OR EXISTS (SELECT 1 FROM public.triagens)
     OR EXISTS (SELECT 1 FROM public.news2_avaliacoes) THEN
    RAISE EXCEPTION 'Tenant B can read Tenant A triage data';
  END IF;
  v_b := public.enqueue_nursing_triage_secure(
    872001, 'Tenant B', 875002, '98000000-0000-4000-8000-000000000001'
  );
  PERFORM set_config('app.gate_queue_b', v_b->>'id', TRUE);
  IF v_b->>'cd_senha' <> 'T001'
     OR v_b->>'company_id' <> '72000000-0000-4000-8000-000000000002' THEN
    RAISE EXCEPTION 'Tenant B ticket sequence mismatch: %', v_b;
  END IF;
END
$gate$;

-- Logical rollback: a failed cross-tenant appointment completion leaves the
-- called queue, triage, NEWS2 and audit state unchanged.
SET LOCAL app.test_user_id = '81000000-0000-4000-8000-000000000001';
DO $gate$
DECLARE
  v_queue JSONB;
  v_queue_id BIGINT;
  v_triages_before INTEGER;
  v_news_before INTEGER;
BEGIN
  v_queue := public.enqueue_nursing_triage_secure(
    871001, 'Rollback gate', 875001, '99000000-0000-4000-8000-000000000001'
  );
  v_queue_id := (v_queue->>'id')::BIGINT;
  PERFORM set_config('app.gate_rollback_queue', v_queue_id::TEXT, TRUE);
  PERFORM public.call_nursing_triage_secure(
    v_queue_id, '99000000-0000-4000-8000-000000000002'
  );
  SELECT count(*) INTO v_triages_before FROM public.triagens;
  SELECT count(*) INTO v_news_before FROM public.news2_avaliacoes;
  BEGIN
    PERFORM public.complete_nursing_triage_secure(
      v_queue_id, 874001, 875001,
      '{"nivel_consciencia":"A","sinais_vitais":{"pressaoSistolica":120,"pressaoDiastolica":80,"frequenciaCardiaca":75,"frequenciaRespiratoria":16,"temperatura":36.8,"saturacaoO2":98,"escalaDor":0},"status":"TRIADO"}'::JSONB,
      '99000000-0000-4000-8000-000000000003'
    );
    RAISE EXCEPTION 'Cross-tenant appointment completion was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Agendamento nao pertence%' THEN RAISE; END IF;
  END;
  IF (SELECT tp_status FROM public.triagem_fila WHERE id = v_queue_id) <> 'CHAMADO'
     OR (SELECT count(*) FROM public.triagens) <> v_triages_before
     OR (SELECT count(*) FROM public.news2_avaliacoes) <> v_news_before THEN
    RAISE EXCEPTION 'Failed completion left partial nursing triage state';
  END IF;
END
$gate$;

-- ACL enforcement is checked behaviorally in addition to catalog inspection.
DO $gate$
BEGIN
  BEGIN
    INSERT INTO public.triagem_fila(company_id, cd_paciente, cd_senha)
    VALUES ('71000000-0000-4000-8000-000000000001', 871001, 'T999');
    RAISE EXCEPTION 'Authenticated direct INSERT was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.triagem_fila SET tp_status = 'DESISTIU';
    RAISE EXCEPTION 'Authenticated direct UPDATE was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM public.triagens;
    RAISE EXCEPTION 'Authenticated direct DELETE was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$gate$;

RESET ROLE;

DO $gate$
BEGIN
  IF (SELECT count(*) FROM public.nursing_triage_audit_events
       WHERE queue_id = current_setting('app.gate_queue_a')::BIGINT) <> 3 THEN
    RAISE EXCEPTION 'Idempotent enqueue/call/complete audit cardinality mismatch';
  END IF;
  IF (SELECT count(*) FROM public.nursing_triage_audit_events
       WHERE queue_id = current_setting('app.gate_rollback_queue')::BIGINT) <> 2 THEN
    RAISE EXCEPTION 'Failed completion wrote an audit event or lost queue audit history';
  END IF;
  IF (SELECT last_number FROM public.nursing_triage_daily_counters
       WHERE company_id = '71000000-0000-4000-8000-000000000001'
         AND ticket_date = current_setting('app.gate_ticket_date')::DATE) <> 14 THEN
    RAISE EXCEPTION 'Daily triage counter mismatch';
  END IF;

  BEGIN
    INSERT INTO public.triagem_fila(company_id, cd_paciente, cd_senha)
    VALUES ('71000000-0000-4000-8000-000000000001', 872001, 'TXP1');
    RAISE EXCEPTION 'Composite queue/patient tenant FK accepted cross-tenant row';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.triagem_fila(company_id, cd_paciente, cd_appointment, cd_senha)
    VALUES ('71000000-0000-4000-8000-000000000001', 871001, 874001, 'TXA1');
    RAISE EXCEPTION 'Composite queue/appointment tenant FK accepted cross-tenant row';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.triagens(
      company_id, cd_paciente, cd_triagem_fila, tp_status
    ) VALUES (
      '71000000-0000-4000-8000-000000000001', 871001,
      current_setting('app.gate_queue_b')::BIGINT, 'TRIADO'
    );
    RAISE EXCEPTION 'Composite triage/queue tenant FK accepted cross-tenant row';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.nursing_triage_audit_events(
      company_id, queue_id, actor_id, action, idempotency_key, request_hash
    ) VALUES (
      '71000000-0000-4000-8000-000000000001',
      current_setting('app.gate_queue_a')::BIGINT,
      '82000000-0000-4000-8000-000000000002', 'CALLED',
      '9a000000-0000-4000-8000-000000000001', repeat('a', 64)
    );
    RAISE EXCEPTION 'Composite audit/actor tenant FK accepted cross-tenant row';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.triagem_fila(
      company_id, cd_paciente, cd_classificacao_id, cd_senha
    ) VALUES (
      '71000000-0000-4000-8000-000000000001', 871001, 875002, 'TXC1'
    );
    RAISE EXCEPTION 'Queue accepted a private classification from another tenant';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.triagens(
      company_id, cd_paciente, cd_classificacao_id, tp_status
    ) VALUES (
      '71000000-0000-4000-8000-000000000001', 871001, 875002, 'TRIADO'
    );
    RAISE EXCEPTION 'Triage accepted a private classification from another tenant';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.mnct_classificacao_risco
       SET company_id = '72000000-0000-4000-8000-000000000002'
     WHERE id = 875001;
    RAISE EXCEPTION 'Referenced global classification moved across tenants';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.triagem_fila
       SET enqueue_response_snapshot = '{"tampered":true}'::JSONB
     WHERE id = current_setting('app.gate_queue_a')::BIGINT;
    RAISE EXCEPTION 'Immutable enqueue snapshot was changed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END
$gate$;

-- The unique index remains the final defense if an internal caller bypasses the
-- RPC allocator. The statement subtransaction must roll back cleanly.
DO $gate$
DECLARE
  v_date DATE;
BEGIN
  SELECT dt_senha INTO v_date FROM public.triagem_fila
   WHERE company_id = '71000000-0000-4000-8000-000000000001'
   ORDER BY id LIMIT 1;
  BEGIN
    INSERT INTO public.triagem_fila(
      company_id, cd_paciente, dt_senha, cd_senha, tp_status
    ) VALUES (
      '71000000-0000-4000-8000-000000000001', 871001, v_date, 'T001', 'AGUARDANDO'
    );
    RAISE EXCEPTION 'Duplicate daily triage ticket was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END
$gate$;

ROLLBACK;

SELECT 'F1_RUNTIME_NURSING_TRIAGE_GATE=PASS' AS result;

