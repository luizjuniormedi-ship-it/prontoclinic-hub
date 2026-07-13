-- F1 TISS glosa/protocol read gate. Ephemeral PostgreSQL only; all fixtures roll back.
BEGIN;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID LANGUAGE sql STABLE AS $f1$
  SELECT NULLIF(current_setting('app.test_user_id', true), '')::UUID
$f1$;

DO $f1$
DECLARE
  v_function REGPROCEDURE;
  v_names TEXT[];
  v_forbidden CONSTANT TEXT[] := ARRAY[
    'company_id', 'p_company_id', 'ds_endpoint', 'cd_certificado_a1_path',
    'ds_certificado_senha', 'ds_usuario', 'ds_senha', 'bl_xml_recurso',
    'notes', 'ds_observacao'
  ];
BEGIN
  FOREACH v_function IN ARRAY ARRAY[
    'public.list_tiss_glosas_read_secure(bigint)'::REGPROCEDURE,
    'public.list_tiss_protocols_read_secure()'::REGPROCEDURE
  ] LOOP
    IF NOT has_function_privilege('authenticated', v_function, 'EXECUTE')
       OR has_function_privilege('anon', v_function, 'EXECUTE') THEN
      RAISE EXCEPTION 'F1 TISS RPC grants are unsafe for %', v_function;
    END IF;

    IF (SELECT provolatile <> 's' FROM pg_proc WHERE oid = v_function)
       OR pg_get_functiondef(v_function) ~* '\m(insert|update|delete|merge)\M' THEN
      RAISE EXCEPTION 'F1 TISS RPC % is not read-only/stable', v_function;
    END IF;

    SELECT COALESCE(proargnames, ARRAY[]::TEXT[])
      INTO v_names
      FROM pg_proc
     WHERE oid = v_function;
    IF v_names && v_forbidden THEN
      RAISE EXCEPTION 'F1 TISS RPC % exposes forbidden arguments/fields: %',
        v_function, v_names;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
      FROM pg_class
     WHERE oid IN ('public.tiss_glosas'::REGCLASS, 'public.tiss_protocols'::REGCLASS)
       AND (NOT relrowsecurity OR NOT relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'F1 TISS tables do not FORCE RLS';
  END IF;

  IF has_table_privilege('authenticated', 'public.tiss_glosas', 'SELECT')
     OR has_table_privilege('authenticated', 'public.tiss_glosas', 'INSERT')
     OR has_table_privilege('authenticated', 'public.tiss_glosas', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.tiss_glosas', 'DELETE')
     OR has_table_privilege('authenticated', 'public.tiss_protocols', 'SELECT')
     OR has_table_privilege('authenticated', 'public.tiss_protocols', 'INSERT')
     OR has_table_privilege('authenticated', 'public.tiss_protocols', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.tiss_protocols', 'DELETE') THEN
    RAISE EXCEPTION 'F1 authenticated has direct TISS table privileges';
  END IF;

  IF to_regprocedure('public.tiss_get_stats(uuid,integer)') IS NOT NULL
     AND (
       has_function_privilege('PUBLIC', 'public.tiss_get_stats(uuid,integer)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.tiss_get_stats(uuid,integer)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.tiss_get_stats(uuid,integer)', 'EXECUTE')
     ) THEN
    RAISE EXCEPTION 'F1 legacy tiss_get_stats remains executable';
  END IF;

  IF to_regclass('public.vw_tiss_glosas_pendentes') IS NOT NULL
     AND (
       has_table_privilege('PUBLIC', 'public.vw_tiss_glosas_pendentes', 'SELECT')
       OR has_table_privilege('anon', 'public.vw_tiss_glosas_pendentes', 'SELECT')
       OR has_table_privilege('authenticated', 'public.vw_tiss_glosas_pendentes', 'SELECT')
     ) THEN
    RAISE EXCEPTION 'F1 legacy TISS glosa view remains selectable';
  END IF;
END
$f1$;

DO $f1$
DECLARE
  v_local SMALLINT[];
  v_target SMALLINT[];
BEGIN
  SELECT ARRAY[
    (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.tiss_glosas'::REGCLASS AND attname = 'company_id'),
    (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.tiss_glosas'::REGCLASS AND attname = 'cd_tiss_xml')
  ]::SMALLINT[] INTO v_local;
  SELECT ARRAY[
    (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.tiss_xml'::REGCLASS AND attname = 'company_id'),
    (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.tiss_xml'::REGCLASS AND attname = 'id')
  ]::SMALLINT[] INTO v_target;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.tiss_glosas'::REGCLASS
       AND confrelid = 'public.tiss_xml'::REGCLASS
       AND contype = 'f' AND conkey = v_local AND confkey = v_target
       AND convalidated
  ) THEN
    RAISE EXCEPTION 'F1 composite glosa/TISS foreign key is missing';
  END IF;

  SELECT ARRAY[
    (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.tiss_protocols'::REGCLASS AND attname = 'company_id'),
    (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.tiss_protocols'::REGCLASS AND attname = 'cd_convenio')
  ]::SMALLINT[] INTO v_local;
  SELECT ARRAY[
    (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.insurance_companies'::REGCLASS AND attname = 'company_id'),
    (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.insurance_companies'::REGCLASS AND attname = 'id')
  ]::SMALLINT[] INTO v_target;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.tiss_protocols'::REGCLASS
       AND confrelid = 'public.insurance_companies'::REGCLASS
       AND contype = 'f' AND conkey = v_local AND confkey = v_target
       AND convalidated
  ) THEN
    RAISE EXCEPTION 'F1 composite protocol/operator foreign key is missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint AS c
     WHERE c.conrelid IN (
         'public.tiss_glosas'::REGCLASS,
         'public.tiss_protocols'::REGCLASS
       )
       AND c.contype = 'f'
       AND c.confrelid = 'public.companies'::REGCLASS
       AND c.conkey = ARRAY[(
         SELECT attnum FROM pg_attribute
          WHERE attrelid = c.conrelid AND attname = 'company_id'
       )]::SMALLINT[]
       AND NOT c.convalidated
  ) THEN
    RAISE EXCEPTION 'F1 TISS company foreign key remains NOT VALID';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.tiss_glosas'::REGCLASS
       AND conname IN ('tiss_glosas_nonnegative_amount_check', 'tiss_glosas_status_check')
     GROUP BY conrelid HAVING count(*) = 2
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.tiss_protocols'::REGCLASS
       AND conname = 'tiss_protocols_environment_check'
  ) THEN
    RAISE EXCEPTION 'F1 TISS value/status/environment checks are incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_index
     WHERE indrelid = 'public.tiss_protocols'::REGCLASS
       AND indisunique AND indisvalid
       AND indpred IS NULL AND indexprs IS NULL
       AND indnatts = 3 AND indnkeyatts = 3
       AND indkey[0] = (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.tiss_protocols'::REGCLASS AND attname = 'company_id')
       AND indkey[1] = (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.tiss_protocols'::REGCLASS AND attname = 'cd_convenio')
       AND indkey[2] = (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.tiss_protocols'::REGCLASS AND attname = 'tp_ambiente')
  ) THEN
    RAISE EXCEPTION 'F1 protocol tenant/operator/environment uniqueness is missing';
  END IF;
END
$f1$;

INSERT INTO public.companies (id, name) VALUES
  ('61111111-aaaa-4111-8111-111111111111', 'TISS Glosa A'),
  ('62222222-bbbb-4222-8222-222222222222', 'TISS Glosa B');
INSERT INTO auth.users (id) VALUES
  ('61111111-0000-4000-8000-000000000001'),
  ('62222222-0000-4000-8000-000000000001'),
  ('63333333-0000-4000-8000-000000000001'),
  ('64444444-0000-4000-8000-000000000001');
INSERT INTO public.roles (name, description) VALUES
  ('tiss_reader_test', 'F1 role with explicit TISS read permission'),
  ('tiss_denied_test', 'F1 role without TISS read permission')
ON CONFLICT (name) DO NOTHING;
INSERT INTO public.role_permissions (role_id, module, can_view)
SELECT id, 'faturamento', TRUE
  FROM public.roles
 WHERE name = 'tiss_reader_test'
ON CONFLICT (role_id, module) DO UPDATE SET can_view = EXCLUDED.can_view;
INSERT INTO public.user_profiles (id, full_name, email, role_name, company_id, lg_ativo) VALUES
  ('61111111-0000-4000-8000-000000000001', 'TISS User A', 'glosa-a@tiss.test', 'tiss_reader_test', '61111111-aaaa-4111-8111-111111111111', TRUE),
  ('62222222-0000-4000-8000-000000000001', 'TISS User B', 'glosa-b@tiss.test', 'tiss_reader_test', '62222222-bbbb-4222-8222-222222222222', TRUE),
  ('63333333-0000-4000-8000-000000000001', 'TISS No Company', 'no-company@tiss.test', 'tiss_reader_test', NULL, TRUE),
  ('64444444-0000-4000-8000-000000000001', 'TISS Denied', 'denied@tiss.test', 'tiss_denied_test', '61111111-aaaa-4111-8111-111111111111', TRUE);
INSERT INTO public.insurance_companies (id, company_id, name) OVERRIDING SYSTEM VALUE VALUES
  (980001, '61111111-aaaa-4111-8111-111111111111', 'Operator A'),
  (980002, '62222222-bbbb-4222-8222-222222222222', 'Operator B');
INSERT INTO public.tiss_xml (id, company_id, billing_id, created_at)
OVERRIDING SYSTEM VALUE VALUES
  (980003, '61111111-aaaa-4111-8111-111111111111', NULL, '2026-07-12T12:00:00Z'),
  (980004, '62222222-bbbb-4222-8222-222222222222', NULL, '2026-07-12T13:00:00Z');
INSERT INTO public.tiss_glosas (
  id, company_id, cd_tiss_xml, cd_glosa_code, ds_motivo, vl_glosa, dt_glosa
) OVERRIDING SYSTEM VALUE VALUES
  (980005, '61111111-aaaa-4111-8111-111111111111', 980003, '7101', 'Glosa A', 12.50, '2026-07-12'),
  (980006, '62222222-bbbb-4222-8222-222222222222', 980004, '7102', 'Glosa B', 25.00, '2026-07-12');
INSERT INTO public.tiss_protocols (
  id, company_id, cd_convenio, ds_endpoint, cd_certificado_a1_path,
  ds_certificado_senha, ds_usuario, ds_senha, ds_observacao,
  ds_versao_tiss, tp_ambiente
) OVERRIDING SYSTEM VALUE VALUES
  (980007, '61111111-aaaa-4111-8111-111111111111', 980001, 'https://canary-endpoint-a.invalid', '/canary/a.pfx', 'canary-cert-a', 'canary-user-a', 'canary-pass-a', 'canary-note-a', '3.05.00', 'HOMOLOGACAO'),
  (980008, '62222222-bbbb-4222-8222-222222222222', 980002, 'https://canary-endpoint-b.invalid', '/canary/b.pfx', 'canary-cert-b', 'canary-user-b', 'canary-pass-b', 'canary-note-b', '3.05.00', 'PRODUCAO');

DO $f1$
DECLARE v_denied BOOLEAN := FALSE;
BEGIN
  BEGIN
    INSERT INTO public.tiss_glosas (company_id, cd_tiss_xml, vl_glosa)
    VALUES ('61111111-aaaa-4111-8111-111111111111', 980004, 1);
  EXCEPTION WHEN foreign_key_violation THEN v_denied := TRUE;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'F1 composite glosa FK accepted a cross-tenant TISS reference';
  END IF;

  v_denied := FALSE;
  BEGIN
    INSERT INTO public.tiss_protocols (company_id, cd_convenio, ds_endpoint)
    VALUES ('61111111-aaaa-4111-8111-111111111111', 980002, 'https://cross-tenant.invalid');
  EXCEPTION WHEN foreign_key_violation THEN v_denied := TRUE;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'F1 composite protocol FK accepted a cross-tenant operator reference';
  END IF;
END
$f1$;

SET LOCAL ROLE authenticated;
SET LOCAL app.test_user_id = '61111111-0000-4000-8000-000000000001';

DO $f1$
DECLARE
  v_glosa RECORD;
  v_protocol RECORD;
  v_denied BOOLEAN := FALSE;
BEGIN
  SELECT * INTO STRICT v_glosa FROM public.list_tiss_glosas_read_secure(NULL);
  IF v_glosa.id <> 980005 OR v_glosa.denial_reason <> 'Glosa A' THEN
    RAISE EXCEPTION 'F1 tenant-safe glosa projection mismatch: %', row_to_json(v_glosa);
  END IF;

  SELECT * INTO STRICT v_protocol FROM public.list_tiss_protocols_read_secure();
  IF v_protocol.id <> 980007
     OR pg_typeof(v_protocol.id) <> 'bigint'::REGTYPE
     OR v_protocol.insurance_company_name <> 'Operator A'
     OR row_to_json(v_protocol)::TEXT ~* 'canary|endpoint|password|senha|certificado|observacao|notes' THEN
    RAISE EXCEPTION 'F1 tenant-safe protocol projection mismatch: %', row_to_json(v_protocol);
  END IF;

  BEGIN
    PERFORM 1 FROM public.tiss_glosas;
  EXCEPTION WHEN insufficient_privilege THEN v_denied := TRUE;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'F1 direct glosa SELECT was allowed'; END IF;

  v_denied := FALSE;
  BEGIN
    PERFORM 1 FROM public.tiss_protocols;
  EXCEPTION WHEN insufficient_privilege THEN v_denied := TRUE;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'F1 direct protocol SELECT was allowed'; END IF;

END
$f1$;

SET LOCAL app.test_user_id = '64444444-0000-4000-8000-000000000001';
DO $f1$
DECLARE v_denied BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.list_tiss_glosas_read_secure(NULL);
  EXCEPTION WHEN insufficient_privilege THEN v_denied := TRUE;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'F1 role without permission read TISS glosas'; END IF;

  v_denied := FALSE;
  BEGIN
    PERFORM public.list_tiss_protocols_read_secure();
  EXCEPTION WHEN insufficient_privilege THEN v_denied := TRUE;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'F1 role without permission read TISS protocols'; END IF;
END
$f1$;

SET LOCAL app.test_user_id = '63333333-0000-4000-8000-000000000001';
DO $f1$
DECLARE v_denied BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.list_tiss_glosas_read_secure(NULL);
  EXCEPTION WHEN insufficient_privilege THEN v_denied := TRUE;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'F1 user without company read TISS glosas'; END IF;

  v_denied := FALSE;
  BEGIN
    PERFORM public.list_tiss_protocols_read_secure();
  EXCEPTION WHEN insufficient_privilege THEN v_denied := TRUE;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'F1 user without company read TISS protocols'; END IF;
END
$f1$;
RESET ROLE;

SET LOCAL ROLE anon;
DO $f1$
DECLARE v_denied BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.list_tiss_glosas_read_secure(NULL);
  EXCEPTION WHEN insufficient_privilege THEN v_denied := TRUE;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'F1 anon executed glosa RPC'; END IF;

  v_denied := FALSE;
  BEGIN
    PERFORM public.list_tiss_protocols_read_secure();
  EXCEPTION WHEN insufficient_privilege THEN v_denied := TRUE;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'F1 anon executed protocol RPC'; END IF;
END
$f1$;
RESET ROLE;

ROLLBACK;
SELECT 'F1_RUNTIME_TISS_GLOSA_PROTOCOL_READ=PASS' AS result;
