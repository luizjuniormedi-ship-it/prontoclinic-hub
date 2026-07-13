-- PostgreSQL 18 runtime gate for atomic LIS result save/release.
-- Ephemeral replay only. Never execute against DataSIGH or production.

BEGIN;

DO $gate$
BEGIN
  IF current_setting('server_version_num')::INTEGER < 180000 THEN
    RAISE EXCEPTION 'LIS runtime gate requires PostgreSQL 18, found %', version();
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

INSERT INTO public.companies (id, name) VALUES
  ('1a000000-0000-4000-8000-000000000001', 'LIS Tenant A'),
  ('1b000000-0000-4000-8000-000000000002', 'LIS Tenant B');

INSERT INTO auth.users (id) VALUES
  ('2a000000-0000-4000-8000-000000000001'),
  ('2b000000-0000-4000-8000-000000000002'),
  ('2c000000-0000-4000-8000-000000000003');

INSERT INTO public.user_profiles
  (id, full_name, email, role_name, role_id, company_id, lg_ativo)
SELECT seed.id, seed.full_name, seed.email, seed.role_name, role.id, seed.company_id, TRUE
  FROM (VALUES
    ('2a000000-0000-4000-8000-000000000001'::UUID, 'Lab A', 'lab-a@test.local', 'laboratorio', '1a000000-0000-4000-8000-000000000001'::UUID),
    ('2b000000-0000-4000-8000-000000000002'::UUID, 'Lab B', 'lab-b@test.local', 'laboratorio', '1b000000-0000-4000-8000-000000000002'::UUID),
    ('2c000000-0000-4000-8000-000000000003'::UUID, 'Manager A', 'manager-a@test.local', 'gestor', '1a000000-0000-4000-8000-000000000001'::UUID)
  ) AS seed(id, full_name, email, role_name, company_id)
  JOIN public.roles AS role ON role.name = seed.role_name;

INSERT INTO public.professionals (id, company_id, full_name, lg_ativo)
OVERRIDING SYSTEM VALUE VALUES
  (980001, '1a000000-0000-4000-8000-000000000001', 'Doctor A', TRUE),
  (980002, '1b000000-0000-4000-8000-000000000002', 'Doctor B', TRUE);

INSERT INTO public.patients (id, company_id, full_name)
OVERRIDING SYSTEM VALUE VALUES
  (980011, '1a000000-0000-4000-8000-000000000001', 'Patient A'),
  (980012, '1b000000-0000-4000-8000-000000000002', 'Patient B');

INSERT INTO public.exames_lab_catalogo
  (id, company_id, ds_exame, ds_sigla, lg_ativo)
OVERRIDING SYSTEM VALUE VALUES
  (980021, '1a000000-0000-4000-8000-000000000001', 'Potassio A', 'K-A', TRUE),
  (980022, '1b000000-0000-4000-8000-000000000002', 'Potassio B', 'K-B', TRUE);

INSERT INTO public.exames_lab_pedido
  (id, company_id, cd_paciente, cd_medico, tp_status)
OVERRIDING SYSTEM VALUE VALUES
  (980031, '1a000000-0000-4000-8000-000000000001', 980011, 980001, 'EM_ANALISE'),
  (980032, '1b000000-0000-4000-8000-000000000002', 980012, 980002, 'EM_ANALISE'),
  (980033, '1a000000-0000-4000-8000-000000000001', 980011, 980001, 'PENDENTE'),
  (980034, '1a000000-0000-4000-8000-000000000001', 980011, 980001, 'EM_ANALISE');

INSERT INTO public.exames_lab_pedido_itens
  (id, company_id, cd_pedido, cd_exame, tp_status)
OVERRIDING SYSTEM VALUE VALUES
  (980041, '1a000000-0000-4000-8000-000000000001', 980031, 980021, 'EM_ANALISE'),
  (980042, '1b000000-0000-4000-8000-000000000002', 980032, 980022, 'EM_ANALISE'),
  (980043, '1a000000-0000-4000-8000-000000000001', 980033, 980021, 'PENDENTE'),
  (980044, '1a000000-0000-4000-8000-000000000001', 980034, 980021, 'EM_ANALISE');

DO $gate$
DECLARE
  v_owner RECORD;
  v_relation RECORD;
  v_function REGPROCEDURE := 'public.save_or_release_lab_result_secure(bigint,text,uuid,jsonb,boolean)'::REGPROCEDURE;
BEGIN
  SELECT role.rolname, role.rolsuper, role.rolbypassrls, role.rolcanlogin
    INTO v_owner
    FROM pg_proc AS procedure
    JOIN pg_roles AS role ON role.oid = procedure.proowner
   WHERE procedure.oid = v_function;
  IF v_owner.rolname IS DISTINCT FROM 'lis_rpc_owner'
     OR v_owner.rolsuper OR v_owner.rolbypassrls OR v_owner.rolcanlogin THEN
    RAISE EXCEPTION 'Unsafe LIS SECURITY DEFINER owner: %', row_to_json(v_owner);
  END IF;

  FOR v_relation IN
    SELECT class.relname, class.relrowsecurity, class.relforcerowsecurity,
           owner.rolsuper, owner.rolbypassrls
      FROM pg_class AS class
      JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
      JOIN pg_roles AS owner ON owner.oid = class.relowner
     WHERE namespace.nspname = 'public'
       AND class.relname IN (
         'exames_lab_pedido', 'exames_lab_pedido_itens',
         'exames_lab_resultado', 'exames_lab_alerta_critico',
         'lis_result_mutations'
       )
  LOOP
    IF NOT v_relation.relrowsecurity OR NOT v_relation.relforcerowsecurity THEN
      RAISE EXCEPTION 'RLS/FORCE RLS missing on %', v_relation.relname;
    END IF;
    IF v_relation.rolsuper OR v_relation.rolbypassrls THEN
      RAISE EXCEPTION 'Unsafe owner/BYPASSRLS on %', v_relation.relname;
    END IF;
  END LOOP;

  IF EXISTS (
       SELECT 1
       FROM pg_proc AS procedure
       CROSS JOIN LATERAL aclexplode(
         COALESCE(procedure.proacl, acldefault('f', procedure.proowner))
       ) AS privilege
       WHERE procedure.oid = v_function
         AND privilege.grantee = 0
         AND privilege.privilege_type = 'EXECUTE'
     )
     OR has_function_privilege('anon', v_function, 'EXECUTE')
     OR has_function_privilege('service_role', v_function, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'LIS RPC grants are not exact';
  END IF;

  IF has_table_privilege('anon', 'public.exames_lab_resultado', 'SELECT')
     OR has_table_privilege('authenticated', 'public.exames_lab_resultado', 'INSERT')
     OR has_table_privilege('authenticated', 'public.exames_lab_resultado', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.exames_lab_resultado', 'DELETE')
     OR has_table_privilege('service_role', 'public.exames_lab_resultado', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.exames_lab_resultado', 'SELECT') THEN
    RAISE EXCEPTION 'LIS result table grants are not exact';
  END IF;
END
$gate$;

SET LOCAL ROLE authenticated;
SET LOCAL app.test_user_id = '2a000000-0000-4000-8000-000000000001';

DO $gate$
DECLARE
  v_first JSONB;
  v_retry JSONB;
  v_before INTEGER;
BEGIN
  v_first := public.save_or_release_lab_result_secure(
    980041, 'EM_ANALISE', '3a000000-0000-4000-8000-000000000001',
    '[{"ds_parametro":"Potassio","vl_resultado":7.2,"ds_unidade":"mmol/L","vl_minimo_referencia":3.5,"vl_maximo_referencia":5.1,"tp_resultado":"CRITICO_ALTO"}]'::JSONB,
    TRUE
  );
  IF v_first->>'company_id' <> '1a000000-0000-4000-8000-000000000001'
     OR v_first->>'actor_id' <> '2a000000-0000-4000-8000-000000000001'
     OR v_first->>'item_status' <> 'LIBERADO'
     OR v_first->>'order_status' <> 'LIBERADO'
     OR (v_first->>'released')::BOOLEAN IS NOT TRUE THEN
    RAISE EXCEPTION 'Atomic release response mismatch: %', v_first;
  END IF;
  IF (SELECT tp_status FROM public.exames_lab_pedido_itens WHERE id = 980041) <> 'LIBERADO'
     OR (SELECT tp_status FROM public.exames_lab_pedido WHERE id = 980031) <> 'LIBERADO'
     OR (SELECT count(*) FROM public.exames_lab_resultado WHERE cd_item_pedido = 980041 AND lg_liberado) <> 1
     OR (SELECT count(*) FROM public.exames_lab_alerta_critico WHERE company_id = '1a000000-0000-4000-8000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'Result, alert, item and order were not committed atomically';
  END IF;

  SELECT count(*) INTO v_before FROM public.exames_lab_resultado WHERE cd_item_pedido = 980041;
  v_retry := public.save_or_release_lab_result_secure(
    980041, 'EM_ANALISE', '3a000000-0000-4000-8000-000000000001',
    '[{"ds_parametro":"Potassio","vl_resultado":7.2,"ds_unidade":"mmol/L","vl_minimo_referencia":3.5,"vl_maximo_referencia":5.1,"tp_resultado":"CRITICO_ALTO"}]'::JSONB,
    TRUE
  );
  IF v_retry IS DISTINCT FROM v_first
     OR (SELECT count(*) FROM public.exames_lab_resultado WHERE cd_item_pedido = 980041) <> v_before
     OR (SELECT count(*) FROM public.exames_lab_alerta_critico WHERE company_id = '1a000000-0000-4000-8000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'Idempotent retry changed LIS state';
  END IF;

  BEGIN
    PERFORM public.save_or_release_lab_result_secure(
      980041, 'EM_ANALISE', '3a000000-0000-4000-8000-000000000001',
      '[{"ds_parametro":"Potassio","vl_resultado":6.9,"tp_resultado":"CRITICO_ALTO"}]'::JSONB,
      TRUE
    );
    RAISE EXCEPTION 'Divergent idempotency payload was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%reutilizada com payload diferente%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.save_or_release_lab_result_secure(
      980042, 'EM_ANALISE', '3a000000-0000-4000-8000-000000000002',
      '[{"ds_parametro":"Potassio","vl_resultado":4.2}]'::JSONB,
      TRUE
    );
    RAISE EXCEPTION 'Tenant A released Tenant B item';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%fora do tenant%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.save_or_release_lab_result_secure(
      980043, 'PENDENTE', '3a000000-0000-4000-8000-000000000003',
      '[{"ds_parametro":"Potassio","vl_resultado":4.2}]'::JSONB,
      TRUE
    );
    RAISE EXCEPTION 'Invalid status transition was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Liberacao exige item EM_ANALISE%' THEN RAISE; END IF;
  END;
  IF (SELECT tp_status FROM public.exames_lab_pedido_itens WHERE id = 980043) <> 'PENDENTE'
     OR EXISTS (SELECT 1 FROM public.exames_lab_resultado WHERE cd_item_pedido = 980043) THEN
    RAISE EXCEPTION 'Invalid transition left partial state';
  END IF;

  BEGIN
    PERFORM public.save_or_release_lab_result_secure(
      980044, 'EM_ANALISE', '3a000000-0000-4000-8000-000000000004',
      '[{"ds_parametro":"Primeiro","vl_resultado":4.2},{"ds_parametro":"Segundo","vl_resultado":"not-a-number"}]'::JSONB,
      FALSE
    );
    RAISE EXCEPTION 'Invalid numeric payload was accepted';
  EXCEPTION WHEN invalid_text_representation THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.exames_lab_resultado WHERE cd_item_pedido = 980044)
     OR EXISTS (SELECT 1 FROM public.lis_result_mutations WHERE item_id = 980044)
     OR (SELECT tp_status FROM public.exames_lab_pedido_itens WHERE id = 980044) <> 'EM_ANALISE'
     OR (SELECT tp_status FROM public.exames_lab_pedido WHERE id = 980034) <> 'EM_ANALISE' THEN
    RAISE EXCEPTION 'Logical rollback left result, ledger, item or order state';
  END IF;
END
$gate$;

SET LOCAL app.test_user_id = '2c000000-0000-4000-8000-000000000003';
DO $gate$
BEGIN
  BEGIN
    PERFORM public.save_or_release_lab_result_secure(
      980044, 'EM_ANALISE', '3c000000-0000-4000-8000-000000000001',
      '[{"ds_parametro":"Potassio","vl_resultado":4.2}]'::JSONB,
      FALSE
    );
    RAISE EXCEPTION 'Actor without laboratorio.can_edit was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%sem permissao laboratorio.can_edit%' THEN RAISE; END IF;
  END;
END
$gate$;

SET LOCAL app.test_user_id = '2b000000-0000-4000-8000-000000000002';
DO $gate$
DECLARE
  v_response JSONB;
BEGIN
  v_response := public.save_or_release_lab_result_secure(
    980042, 'EM_ANALISE', '3b000000-0000-4000-8000-000000000001',
    '[{"ds_parametro":"Potassio","vl_resultado":1.1,"tp_resultado":"CRITICO_BAIXO"}]'::JSONB,
    TRUE
  );
  IF v_response->>'company_id' <> '1b000000-0000-4000-8000-000000000002'
     OR (SELECT count(*) FROM public.exames_lab_alerta_critico) <> 1
     OR EXISTS (
       SELECT 1 FROM public.exames_lab_alerta_critico
        WHERE company_id = '1a000000-0000-4000-8000-000000000001'
     ) THEN
    RAISE EXCEPTION 'Tenant B release or alert isolation failed';
  END IF;
END
$gate$;

RESET ROLE;

DO $gate$
DECLARE
  v_result_id BIGINT;
BEGIN
  SELECT id INTO v_result_id FROM public.exames_lab_resultado WHERE cd_item_pedido = 980041;
  BEGIN
    UPDATE public.exames_lab_resultado SET ds_observacao = 'mutacao indevida' WHERE id = v_result_id;
    RAISE EXCEPTION 'Released result update was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%liberado e imutavel%' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM public.exames_lab_resultado WHERE id = v_result_id;
    RAISE EXCEPTION 'Released result delete was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%liberado e imutavel%' THEN RAISE; END IF;
  END;
END
$gate$;

ROLLBACK;

SELECT 'F1_RUNTIME_LIS_ATOMIC_RESULT_GATE=PASS' AS result;

