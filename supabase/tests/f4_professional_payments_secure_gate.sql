\set ON_ERROR_STOP on

\if :{?f4_dblink_connstr}
SELECT set_config('f4.dblink_connstr', :'f4_dblink_connstr', FALSE) AS f4_conn_configured \gset
\else
SELECT set_config('f4.dblink_connstr', 'dbname=' || current_database(), FALSE) AS f4_conn_configured \gset
\endif

-- Seed an arbitrary owner member after migration pass 1, then require replay
-- to remove every membership without relying on a public-role allowlist.
DO $membership_probe$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = 'professional_payments_membership_probe'
  ) THEN
    CREATE ROLE professional_payments_membership_probe;
  END IF;
  ALTER ROLE professional_payments_membership_probe
    NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
END
$membership_probe$;

GRANT professional_payments_data_owner TO professional_payments_membership_probe;
GRANT professional_payments_ledger_owner TO professional_payments_membership_probe;
GRANT professional_payments_rpc_owner TO professional_payments_membership_probe;
\ir ../migrations/20260713170000_professional_payments_secure_contract.sql

DO $membership_replay_gate$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_auth_members AS membership
      JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
     WHERE granted_role.rolname IN (
       'professional_payments_data_owner',
       'professional_payments_ledger_owner',
       'professional_payments_rpc_owner'
     )
  ) THEN
    RAISE EXCEPTION 'Residual owner membership survived migration replay';
  END IF;
END
$membership_replay_gate$;

DROP ROLE professional_payments_membership_probe;

DO $gate$
BEGIN
  IF current_setting('server_version_num')::INTEGER < 180000
     OR current_setting('server_version_num')::INTEGER >= 190000 THEN
    RAISE EXCEPTION 'F4 professional payments gate requires PostgreSQL 18.x, found %',
      current_setting('server_version');
  END IF;
  IF to_regclass('public.professional_payments') IS NULL
     OR to_regclass('public.professional_payment_events') IS NULL THEN
    RAISE EXCEPTION 'Professional payments secure migration is not applied';
  END IF;
END
$gate$;

BEGIN;

INSERT INTO public.companies (id, name) VALUES
  ('f5000000-0000-4000-8000-000000000001', 'Payments Gate Tenant A'),
  ('f5000000-0000-4000-8000-000000000002', 'Payments Gate Tenant B');

INSERT INTO auth.users (id) VALUES
  ('f5100000-0000-4000-8000-000000000001'),
  ('f5100000-0000-4000-8000-000000000002'),
  ('f5100000-0000-4000-8000-000000000003');

INSERT INTO public.user_profiles
  (id, full_name, email, role_name, role_id, company_id, lg_ativo)
SELECT fixture.id, fixture.full_name, fixture.email, canonical_role.name,
       canonical_role.id, fixture.company_id, TRUE
  FROM (VALUES
    ('f5100000-0000-4000-8000-000000000001'::UUID, 'Tenant A Finance',
      'payments-a@test.invalid', 'financeiro',
      'f5000000-0000-4000-8000-000000000001'::UUID),
    ('f5100000-0000-4000-8000-000000000002'::UUID, 'Tenant B Admin',
      'payments-b@test.invalid', 'admin',
      'f5000000-0000-4000-8000-000000000002'::UUID),
    ('f5100000-0000-4000-8000-000000000003'::UUID, 'Tenant A Reception',
      'payments-denied@test.invalid', 'recepcao',
      'f5000000-0000-4000-8000-000000000001'::UUID)
  ) AS fixture(id, full_name, email, role_name, company_id)
  JOIN public.roles AS canonical_role ON canonical_role.name = fixture.role_name;

INSERT INTO public.professionals (id, company_id, full_name, crm, lg_ativo)
OVERRIDING SYSTEM VALUE VALUES
  (995001, 'f5000000-0000-4000-8000-000000000001', 'Doctor A', 'PAY-A', TRUE),
  (995002, 'f5000000-0000-4000-8000-000000000002', 'Doctor B', 'PAY-B', TRUE);

INSERT INTO public.units (id, company_id, cd_codigo, ds_nome, lg_ativo)
OVERRIDING SYSTEM VALUE VALUES
  (995011, 'f5000000-0000-4000-8000-000000000001', 'PAY-A', 'Unit A', TRUE),
  (995012, 'f5000000-0000-4000-8000-000000000002', 'PAY-B', 'Unit B', TRUE);

DO $acl$
DECLARE
  v_function REGPROCEDURE;
  v_owner RECORD;
  v_table REGCLASS;
  v_transition_definition TEXT;
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_auth_members AS membership
      JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
     WHERE granted_role.rolname IN (
             'professional_payments_data_owner',
             'professional_payments_ledger_owner',
             'professional_payments_rpc_owner'
           )
  ) THEN
    RAISE EXCEPTION 'Residual owner membership survived migration replay';
  END IF;

  IF (SELECT owner_role.rolname
        FROM pg_class AS class
        JOIN pg_roles AS owner_role ON owner_role.oid = class.relowner
       WHERE class.oid = 'public.professional_payments'::REGCLASS)
       IS DISTINCT FROM 'professional_payments_data_owner'
     OR (SELECT owner_role.rolname
           FROM pg_class AS class
           JOIN pg_roles AS owner_role ON owner_role.oid = class.relowner
          WHERE class.oid = 'public.professional_payment_events'::REGCLASS)
       IS DISTINCT FROM 'professional_payments_ledger_owner' THEN
    RAISE EXCEPTION 'Required protected-table owner was revoked or replaced';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint AS constraint_row
     WHERE constraint_row.conrelid = 'public.professional_payments'::REGCLASS
       AND constraint_row.confrelid = 'public.professionals'::REGCLASS
       AND constraint_row.contype = 'f'
       AND constraint_row.convalidated
       AND ARRAY(
             SELECT attribute.attname
               FROM unnest(constraint_row.conkey) WITH ORDINALITY AS key(attnum, position)
               JOIN pg_attribute AS attribute
                 ON attribute.attrelid = constraint_row.conrelid
                AND attribute.attnum = key.attnum
              ORDER BY key.position
           ) = ARRAY['company_id', 'cd_professional']::NAME[]
       AND ARRAY(
             SELECT attribute.attname
               FROM unnest(constraint_row.confkey) WITH ORDINALITY AS key(attnum, position)
               JOIN pg_attribute AS attribute
                 ON attribute.attrelid = constraint_row.confrelid
                AND attribute.attnum = key.attnum
              ORDER BY key.position
           ) = ARRAY['company_id', 'id']::NAME[]
  ) THEN
    RAISE EXCEPTION 'Exact (company_id, professional_id) tenant FK is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint AS constraint_row
     WHERE constraint_row.conrelid = 'public.professional_payments'::REGCLASS
       AND constraint_row.confrelid = 'public.units'::REGCLASS
       AND constraint_row.contype = 'f'
       AND constraint_row.convalidated
       AND ARRAY(
             SELECT attribute.attname
               FROM unnest(constraint_row.conkey) WITH ORDINALITY AS key(attnum, position)
               JOIN pg_attribute AS attribute
                 ON attribute.attrelid = constraint_row.conrelid
                AND attribute.attnum = key.attnum
              ORDER BY key.position
           ) = ARRAY['company_id', 'cd_unit']::NAME[]
       AND ARRAY(
             SELECT attribute.attname
               FROM unnest(constraint_row.confkey) WITH ORDINALITY AS key(attnum, position)
               JOIN pg_attribute AS attribute
                 ON attribute.attrelid = constraint_row.confrelid
                AND attribute.attnum = key.attnum
              ORDER BY key.position
           ) = ARRAY['company_id', 'id']::NAME[]
  ) THEN
    RAISE EXCEPTION 'Exact (company_id, unit_id) tenant FK is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class
     WHERE oid = 'public.professional_payments'::REGCLASS
       AND relrowsecurity AND relforcerowsecurity
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_class
     WHERE oid = 'public.professional_payment_events'::REGCLASS
       AND relrowsecurity AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'FORCE RLS is missing';
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'public.professional_payments'::REGCLASS,
    'public.professional_payment_events'::REGCLASS
  ] LOOP
    IF has_table_privilege('anon', v_table, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
       OR has_table_privilege('authenticated', v_table, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
       OR EXISTS (
         SELECT 1 FROM pg_class AS class
         CROSS JOIN LATERAL aclexplode(
           COALESCE(class.relacl, acldefault('r', class.relowner))
         ) AS privilege
         WHERE class.oid = v_table AND privilege.grantee = 0
       ) THEN
      RAISE EXCEPTION 'Direct table privilege leaked on %', v_table;
    END IF;
  END LOOP;

  IF has_table_privilege(
       'service_role', 'public.professional_payments',
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'
     ) OR has_table_privilege(
       'service_role', 'public.professional_payment_events',
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'
     ) THEN
    RAISE EXCEPTION 'service_role has direct protected-table privileges';
  END IF;

  IF has_sequence_privilege('anon', 'public.professional_payments_id_seq', 'USAGE')
     OR has_sequence_privilege('authenticated', 'public.professional_payments_id_seq', 'USAGE')
     OR has_sequence_privilege('anon', 'public.professional_payment_events_id_seq', 'USAGE')
     OR has_sequence_privilege('authenticated', 'public.professional_payment_events_id_seq', 'USAGE')
     OR has_sequence_privilege('service_role', 'public.professional_payments_id_seq', 'USAGE,SELECT,UPDATE')
     OR has_sequence_privilege('service_role', 'public.professional_payment_events_id_seq', 'USAGE,SELECT,UPDATE') THEN
    RAISE EXCEPTION 'Sequence ACL mismatch';
  END IF;

  IF (
    SELECT count(*)
      FROM pg_proc AS procedure
      JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'public'
       AND procedure.proname IN (
         'create_professional_payment',
         'list_professional_payments',
         'transition_professional_payment'
       )
  ) <> 3 THEN
    RAISE EXCEPTION 'Stale professional payment RPC overloads remain';
  END IF;

  FOREACH v_function IN ARRAY ARRAY[
    'public.create_professional_payment(uuid,bigint,bigint,date,text,integer,numeric,numeric,text,numeric,text)'::REGPROCEDURE,
    'public.list_professional_payments(bigint,bigint,text,date,date,integer,integer,text)'::REGPROCEDURE,
    'public.transition_professional_payment(uuid,bigint,text,text,date)'::REGPROCEDURE
  ] LOOP
    IF has_function_privilege('anon', v_function, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_function, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_function, 'EXECUTE')
       OR EXISTS (
         SELECT 1 FROM pg_proc AS procedure
         CROSS JOIN LATERAL aclexplode(
           COALESCE(procedure.proacl, acldefault('f', procedure.proowner))
         ) AS privilege
         WHERE procedure.oid = v_function
           AND privilege.grantee = 0 AND privilege.privilege_type = 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'Function ACL mismatch for %', v_function;
    END IF;

    SELECT role.rolname, role.rolsuper, role.rolbypassrls, role.rolcanlogin,
           procedure.prosecdef, procedure.proconfig
      INTO v_owner
      FROM pg_proc AS procedure
      JOIN pg_roles AS role ON role.oid = procedure.proowner
     WHERE procedure.oid = v_function;
    IF v_owner.rolname IS DISTINCT FROM 'professional_payments_rpc_owner'
       OR v_owner.rolsuper OR v_owner.rolbypassrls OR v_owner.rolcanlogin
       OR NOT v_owner.prosecdef
       OR NOT (v_owner.proconfig @> ARRAY['search_path=pg_catalog, public']) THEN
      RAISE EXCEPTION 'Unsafe owner/function configuration for %: %',
        v_function, row_to_json(v_owner);
    END IF;
  END LOOP;

  SELECT pg_get_functiondef(
           'public.transition_professional_payment(uuid,bigint,text,text,date)'::REGPROCEDURE
         )
    INTO v_transition_definition;
  IF position('America/Sao_Paulo' IN v_transition_definition) = 0
     OR position('CURRENT_DATE' IN upper(v_transition_definition)) > 0 THEN
    RAISE EXCEPTION 'Payment-date fallback is not pinned to America/Sao_Paulo';
  END IF;
END
$acl$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'f5100000-0000-4000-8000-000000000001', TRUE);

DO $tenant_a$
DECLARE
  v_created RECORD;
  v_replay RECORD;
  v_transition RECORD;
  v_cancel RECORD;
  v_cancel_payment BIGINT;
  v_created_updated_at TIMESTAMPTZ;
  v_conferred_updated_at TIMESTAMPTZ;
  v_list RECORD;
  v_sp_date DATE;
  v_original_timezone TEXT;
  v_discriminating_timezone TEXT;
BEGIN
  BEGIN
    PERFORM 1 FROM public.professional_payments;
    RAISE EXCEPTION 'Authenticated direct SELECT was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.professional_payments (
      company_id, cd_professional, dt_reference, total_value, status
    ) VALUES (
      'f5000000-0000-4000-8000-000000000001', 995001, CURRENT_DATE, 1, 'apurado'
    );
    RAISE EXCEPTION 'Authenticated direct INSERT was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.create_professional_payment(
      'f5200000-0000-4000-8000-000000000001', 995002, 995011,
      DATE '2026-07-01', 'cross professional', 1, 100, 0, 'FIXED', 0, NULL
    );
    RAISE EXCEPTION 'Cross-tenant professional was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Profissional inexistente, inativo ou fora do tenant%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.create_professional_payment(
      'f5200000-0000-4000-8000-000000000002', 995001, 995012,
      DATE '2026-07-01', 'cross unit', 1, 100, 0, 'FIXED', 0, NULL
    );
    RAISE EXCEPTION 'Cross-tenant unit was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Unidade inexistente, inativa ou fora do tenant%' THEN RAISE; END IF;
  END;

  SELECT * INTO v_created FROM public.create_professional_payment(
    'f5200000-0000-4000-8000-000000000010', 995001, 995011,
    DATE '2026-07-01', 'July production', 8, 1250.50, 100, 'PERCENTAGE', 35,
    'Gate payment'
  );
  IF v_created.idempotent_replay OR v_created.company_id IS DISTINCT FROM
     'f5000000-0000-4000-8000-000000000001'::UUID
     OR v_created.status <> 'apurado' THEN
    RAISE EXCEPTION 'Initial create result mismatch';
  END IF;
  v_created_updated_at := v_created.updated_at;

  SELECT * INTO v_replay FROM public.create_professional_payment(
    'f5200000-0000-4000-8000-000000000010', 995001, 995011,
    DATE '2026-07-01', 'July production', 8, 1250.50, 100, 'PERCENTAGE', 35,
    'Gate payment'
  );
  IF NOT v_replay.idempotent_replay OR v_replay.id <> v_created.id THEN
    RAISE EXCEPTION 'Create idempotent replay failed';
  END IF;

  BEGIN
    PERFORM public.create_professional_payment(
      'f5200000-0000-4000-8000-000000000010', 995001, 995011,
      DATE '2026-07-01', 'July production', 8, 999, 100, 'PERCENTAGE', 35,
      'Gate payment'
    );
    RAISE EXCEPTION 'Divergent create replay was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%payload diferente%' THEN RAISE; END IF;
  END;

  IF (SELECT count(*) FROM public.list_professional_payments()) <> 1
     OR EXISTS (
       SELECT 1 FROM public.list_professional_payments()
        WHERE company_id <> 'f5000000-0000-4000-8000-000000000001'
     ) THEN
    RAISE EXCEPTION 'Tenant A list isolation failed';
  END IF;

  BEGIN
    PERFORM public.transition_professional_payment(
      'f5200000-0000-4000-8000-000000000011', v_created.id, 'pago', NULL, NULL
    );
    RAISE EXCEPTION 'State jump apurado->pago was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Transicao de estado invalida%' THEN RAISE; END IF;
  END;

  SELECT * INTO v_transition FROM public.transition_professional_payment(
    'f5200000-0000-4000-8000-000000000012', v_created.id, 'conferido', NULL, NULL
  );
  IF v_transition.status <> 'conferido' OR v_transition.idempotent_replay THEN
    RAISE EXCEPTION 'apurado->conferido failed';
  END IF;
  v_conferred_updated_at := v_transition.updated_at;
  SELECT * INTO v_replay FROM public.create_professional_payment(
    'f5200000-0000-4000-8000-000000000010', 995001, 995011,
    DATE '2026-07-01', 'July production', 8, 1250.50, 100, 'PERCENTAGE', 35,
    'Gate payment'
  );
  IF NOT v_replay.idempotent_replay
     OR v_replay.id <> v_created.id
     OR v_replay.status <> 'apurado'
     OR v_replay.paid_on IS NOT NULL
     OR v_replay.cancel_reason IS NOT NULL
     OR v_replay.updated_at IS DISTINCT FROM v_created_updated_at THEN
    RAISE EXCEPTION 'Create replay did not preserve its original apurado snapshot';
  END IF;
  SELECT * INTO v_replay FROM public.transition_professional_payment(
    'f5200000-0000-4000-8000-000000000012', v_created.id, 'conferido', NULL, NULL
  );
  IF NOT v_replay.idempotent_replay OR v_replay.id <> v_created.id THEN
    RAISE EXCEPTION 'Transition idempotent replay failed';
  END IF;
  BEGIN
    PERFORM public.transition_professional_payment(
      'f5200000-0000-4000-8000-000000000012', v_created.id, 'cancelado', 'changed', NULL
    );
    RAISE EXCEPTION 'Divergent transition replay was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%payload diferente%' THEN RAISE; END IF;
  END;

  v_sp_date := timezone('America/Sao_Paulo', CURRENT_TIMESTAMP)::DATE;
  v_original_timezone := current_setting('TimeZone');
  IF timezone('Pacific/Kiritimati', CURRENT_TIMESTAMP)::DATE <> v_sp_date THEN
    v_discriminating_timezone := 'Pacific/Kiritimati';
  ELSE
    v_discriminating_timezone := 'Etc/GMT+12';
  END IF;
  PERFORM set_config('TimeZone', v_discriminating_timezone, TRUE);
  IF CURRENT_DATE = v_sp_date THEN
    RAISE EXCEPTION 'Gate could not establish a timezone-distinct civil date';
  END IF;

  SELECT * INTO v_transition FROM public.transition_professional_payment(
    'f5200000-0000-4000-8000-000000000013', v_created.id, 'pago', NULL, NULL
  );
  PERFORM set_config('TimeZone', v_original_timezone, TRUE);
  IF v_transition.status <> 'pago' OR v_transition.paid_on <> v_sp_date THEN
    RAISE EXCEPTION 'conferido->pago Sao Paulo fallback failed: %',
      row_to_json(v_transition);
  END IF;
  SELECT * INTO v_replay FROM public.transition_professional_payment(
    'f5200000-0000-4000-8000-000000000013', v_created.id, 'pago', NULL, NULL
  );
  IF NOT v_replay.idempotent_replay
     OR v_replay.id <> v_created.id
     OR v_replay.paid_on <> v_sp_date THEN
    RAISE EXCEPTION 'Payment-date fallback replay failed';
  END IF;
  SELECT * INTO v_replay FROM public.transition_professional_payment(
    'f5200000-0000-4000-8000-000000000012', v_created.id, 'conferido', NULL, NULL
  );
  IF NOT v_replay.idempotent_replay
     OR v_replay.status <> 'conferido'
     OR v_replay.paid_on IS NOT NULL
     OR v_replay.updated_at IS DISTINCT FROM v_conferred_updated_at
     OR v_replay.status = v_transition.status THEN
    RAISE EXCEPTION 'Transition replay returned mutable current state';
  END IF;
  BEGIN
    PERFORM public.transition_professional_payment(
      'f5200000-0000-4000-8000-000000000014', v_created.id,
      'cancelado', 'cannot cancel paid', NULL
    );
    RAISE EXCEPTION 'Paid payment cancellation was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Transicao de estado invalida%' THEN RAISE; END IF;
  END;

  SELECT id INTO v_cancel_payment FROM public.create_professional_payment(
    'f5200000-0000-4000-8000-000000000020', 995001, 995011,
    DATE '2026-08-01', 'August production', 1, 50, 0, 'FIXED', 0, NULL
  );
  BEGIN
    PERFORM public.transition_professional_payment(
      'f5200000-0000-4000-8000-000000000021', v_cancel_payment,
      'cancelado', NULL, NULL
    );
    RAISE EXCEPTION 'Cancellation without reason was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Motivo de cancelamento e obrigatorio%' THEN RAISE; END IF;
  END;
  SELECT * INTO v_cancel FROM public.transition_professional_payment(
    'f5200000-0000-4000-8000-000000000022', v_cancel_payment,
    'cancelado', 'Duplicate production entry', NULL
  );
  IF v_cancel.status <> 'cancelado'
     OR v_cancel.cancel_reason <> 'Duplicate production entry' THEN
    RAISE EXCEPTION 'Cancellation contract failed';
  END IF;

  SELECT * INTO STRICT v_list
    FROM public.list_professional_payments(
      p_limit => 1,
      p_offset => 0,
      p_search => '  production  '
    );
  IF v_list.total_count IS DISTINCT FROM 2::BIGINT
     OR v_list.reference_description NOT ILIKE '%production%' THEN
    RAISE EXCEPTION 'Description search or pre-pagination total_count failed: %',
      row_to_json(v_list);
  END IF;

  IF (SELECT count(*) FROM public.list_professional_payments(
        p_search => 'dOcToR a'
      )) <> 2
     OR EXISTS (
       SELECT 1 FROM public.list_professional_payments(p_search => 'dOcToR a')
        WHERE total_count <> 2
     ) THEN
    RAISE EXCEPTION 'Professional-name search failed';
  END IF;

  SELECT * INTO STRICT v_list
    FROM public.list_professional_payments(
      p_status => 'cancelado',
      p_reference_from => DATE '2026-08-01',
      p_reference_to => DATE '2026-08-01',
      p_limit => 1,
      p_offset => 0,
      p_search => 'August production'
    );
  IF v_list.total_count IS DISTINCT FROM 1::BIGINT
     OR v_list.status IS DISTINCT FROM 'cancelado' THEN
    RAISE EXCEPTION 'Search total_count did not reflect all list filters';
  END IF;
END
$tenant_a$;

RESET ROLE;

DO $audit$
BEGIN
  IF (SELECT count(*) FROM public.professional_payments
       WHERE company_id = 'f5000000-0000-4000-8000-000000000001') <> 2 THEN
    RAISE EXCEPTION 'Rejected/replayed calls changed payment cardinality';
  END IF;
  IF (SELECT count(*) FROM public.professional_payment_events
       WHERE company_id = 'f5000000-0000-4000-8000-000000000001') <> 5 THEN
    RAISE EXCEPTION 'Audit/idempotency ledger cardinality mismatch';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.professional_payment_events
     WHERE actor_id <> 'f5100000-0000-4000-8000-000000000001'
        OR request_hash IS NULL OR idempotency_key IS NULL
  ) THEN
    RAISE EXCEPTION 'Audit actor/hash/key mismatch';
  END IF;
END
$audit$;

SELECT set_config(
  'f4.tenant_a_payment_id',
  (
    SELECT min(id)::TEXT FROM public.professional_payments
     WHERE company_id = 'f5000000-0000-4000-8000-000000000001'
       AND status = 'pago'
  ),
  TRUE
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'f5100000-0000-4000-8000-000000000003', TRUE);
DO $denied$
BEGIN
  BEGIN
    PERFORM public.list_professional_payments();
    RAISE EXCEPTION 'Unauthorized profile listed payments';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Perfil sem permissao%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.create_professional_payment(
      'f5200000-0000-4000-8000-000000000030', 995001, 995011,
      DATE '2026-09-01', NULL, 0, 10, 0, 'FIXED', 0, NULL
    );
    RAISE EXCEPTION 'Unauthorized profile created payment';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Perfil sem permissao%' THEN RAISE; END IF;
  END;
END
$denied$;

SELECT set_config('request.jwt.claim.sub', 'f5100000-0000-4000-8000-000000000002', TRUE);
DO $tenant_b$
DECLARE
  v_row RECORD;
BEGIN
  IF (SELECT count(*) FROM public.list_professional_payments()) <> 0 THEN
    RAISE EXCEPTION 'Tenant B list leaked Tenant A rows';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.list_professional_payments(p_search => 'Doctor A')
  ) THEN
    RAISE EXCEPTION 'Server-side search leaked a cross-tenant professional';
  END IF;
  BEGIN
    PERFORM public.transition_professional_payment(
      'f5200000-0000-4000-8000-000000000041',
      current_setting('f4.tenant_a_payment_id')::BIGINT,
      'conferido', NULL, NULL
    );
    RAISE EXCEPTION 'Cross-tenant payment transition was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Repasse inexistente, inativo ou fora do tenant%' THEN RAISE; END IF;
  END;
  SELECT * INTO v_row FROM public.create_professional_payment(
    'f5200000-0000-4000-8000-000000000042', 995002, 995012,
    DATE '2026-07-01', 'Tenant B', 2, 200, 0, 'FIXED', 0, NULL
  );
  IF v_row.company_id <> 'f5000000-0000-4000-8000-000000000002'::UUID
     OR (SELECT count(*) FROM public.list_professional_payments()) <> 1 THEN
    RAISE EXCEPTION 'Tenant B create/list failed';
  END IF;
END
$tenant_b$;

RESET ROLE;

INSERT INTO public.professional_payments (
  company_id, cd_professional, cd_unit, dt_reference, ds_reference,
  total_procedures, total_value, total_received, tp_remuneration,
  percentage, status, lg_ativo
) VALUES (
  'f5000000-0000-4000-8000-000000000002', 995002, 995012,
  DATE '2026-12-01', 'Legacy nullable columns', NULL, 0, NULL, NULL,
  NULL, 'apurado', TRUE
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'f5100000-0000-4000-8000-000000000002', TRUE);
DO $legacy_nulls$
DECLARE
  v_row RECORD;
BEGIN
  SELECT * INTO STRICT v_row
    FROM public.list_professional_payments(
      NULL, NULL, NULL, DATE '2026-12-01', DATE '2026-12-01', 100, 0
    );

  IF v_row.total_procedures IS DISTINCT FROM 0
     OR v_row.total_value IS DISTINCT FROM 0::NUMERIC
     OR v_row.total_received IS DISTINCT FROM 0::NUMERIC
     OR v_row.remuneration_type IS DISTINCT FROM 'PERCENTAGE'
     OR v_row.percentage IS DISTINCT FROM 0::NUMERIC
     OR v_row.total_count IS DISTINCT FROM 1::BIGINT THEN
    RAISE EXCEPTION 'Legacy nullable payment columns broke list DTO defaults: %',
      row_to_json(v_row);
  END IF;
END
$legacy_nulls$;
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.sub', 'f5100000-0000-4000-8000-000000000002', TRUE);
DO $service$
DECLARE v_row RECORD;
BEGIN
  BEGIN
    INSERT INTO public.professional_payments (
      company_id, cd_professional, cd_unit, dt_reference, total_value,
      status, lg_ativo
    ) VALUES (
      'f5000000-0000-4000-8000-000000000002', 995002, 995012,
      DATE '2026-10-01', 10, 'apurado', TRUE
    );
    RAISE EXCEPTION 'service_role direct INSERT was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM public.professional_payment_events;
    RAISE EXCEPTION 'service_role direct ledger SELECT was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  SELECT * INTO v_row FROM public.create_professional_payment(
    'f5200000-0000-4000-8000-000000000050', 995002, 995012,
    DATE '2026-10-01', 'service RPC', 1, 10, 0, 'FIXED', 0, NULL
  );
  IF v_row.idempotent_replay
     OR v_row.company_id <> 'f5000000-0000-4000-8000-000000000002'::UUID
     OR (SELECT count(*) FROM public.list_professional_payments(
       NULL, NULL, NULL, DATE '2026-10-01', DATE '2026-10-01', 100, 0
     )) <> 1 THEN
    RAISE EXCEPTION 'service_role secure RPC operation failed';
  END IF;
END
$service$;
RESET ROLE;

DO $append_only$
BEGIN
  BEGIN
    UPDATE public.professional_payment_events SET reason = reason
     WHERE id = (SELECT min(id) FROM public.professional_payment_events);
    RAISE EXCEPTION 'Ledger UPDATE was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%audit ledger is append-only%' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM public.professional_payment_events
     WHERE id = (SELECT min(id) FROM public.professional_payment_events);
    RAISE EXCEPTION 'Ledger DELETE was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%audit ledger is append-only%' THEN RAISE; END IF;
  END;
  BEGIN
    TRUNCATE public.professional_payment_events;
    RAISE EXCEPTION 'Ledger TRUNCATE was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%audit ledger is append-only%' THEN RAISE; END IF;
  END;
END
$append_only$;

ROLLBACK;

DO $rollback$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.companies
     WHERE id IN (
       'f5000000-0000-4000-8000-000000000001',
       'f5000000-0000-4000-8000-000000000002'
     )
  ) OR EXISTS (
    SELECT 1 FROM public.professional_payment_events
     WHERE company_id IN (
       'f5000000-0000-4000-8000-000000000001',
       'f5000000-0000-4000-8000-000000000002'
     )
  ) THEN
    RAISE EXCEPTION 'Gate rollback left fixture data';
  END IF;
END
$rollback$;

CREATE EXTENSION IF NOT EXISTS dblink;

DO $concurrency$
DECLARE
  v_conn TEXT := current_setting('f4.dblink_connstr');
  v_payment_id BIGINT;
  v_result_count INTEGER;
  v_replay_count INTEGER;
  v_result_payment_count INTEGER;
  v_min_updated_at TIMESTAMPTZ;
  v_max_updated_at TIMESTAMPTZ;
  v_replay_status TEXT;
  v_replay_updated_at TIMESTAMPTZ;
  v_deadline TIMESTAMPTZ;
  v_error TEXT;
BEGIN
  PERFORM dblink_connect('f4_pay_setup', v_conn);
  PERFORM dblink_connect('f4_pay_blocker', v_conn);
  PERFORM dblink_connect('f4_pay_worker_a', v_conn);
  PERFORM dblink_connect('f4_pay_worker_b', v_conn);
  PERFORM dblink_connect('f4_pay_verifier', v_conn);

  -- A prior interrupted gate must not turn this run into a false positive.
  PERFORM dblink_exec('f4_pay_setup', $cleanup$
    SET session_replication_role = replica;
    DELETE FROM public.professional_payment_events
     WHERE company_id = 'f5000000-0000-4000-8000-000000000009';
    DELETE FROM public.professional_payments
     WHERE company_id = 'f5000000-0000-4000-8000-000000000009';
    SET session_replication_role = origin;
    DELETE FROM public.units WHERE id = 995019;
    DELETE FROM public.professionals WHERE id = 995009;
    DELETE FROM public.user_profiles
     WHERE id = 'f5100000-0000-4000-8000-000000000009';
    DELETE FROM auth.users
     WHERE id = 'f5100000-0000-4000-8000-000000000009';
    DELETE FROM public.companies
     WHERE id = 'f5000000-0000-4000-8000-000000000009';
  $cleanup$);

  PERFORM dblink_exec('f4_pay_setup', $setup$
    INSERT INTO public.companies (id, name)
    VALUES ('f5000000-0000-4000-8000-000000000009', 'Payments Concurrency Tenant');
    INSERT INTO auth.users (id)
    VALUES ('f5100000-0000-4000-8000-000000000009');
    INSERT INTO public.user_profiles
      (id, full_name, email, role_name, role_id, company_id, lg_ativo)
    SELECT
      'f5100000-0000-4000-8000-000000000009', 'Concurrent Finance',
      'payments-concurrency@test.invalid', canonical_role.name,
      canonical_role.id, 'f5000000-0000-4000-8000-000000000009', TRUE
      FROM public.roles AS canonical_role
     WHERE canonical_role.name = 'financeiro';
    INSERT INTO public.professionals (id, company_id, full_name, crm, lg_ativo)
      OVERRIDING SYSTEM VALUE
    VALUES (
      995009, 'f5000000-0000-4000-8000-000000000009',
      'Concurrent Doctor', 'PAY-CONCURRENT', TRUE
    );
    INSERT INTO public.units (id, company_id, cd_codigo, ds_nome, lg_ativo)
      OVERRIDING SYSTEM VALUE
    VALUES (
      995019, 'f5000000-0000-4000-8000-000000000009',
      'PAY-CONCURRENT', 'Concurrent Unit', TRUE
    );
  $setup$);

  PERFORM dblink_exec('f4_pay_worker_a', 'SET ROLE authenticated');
  PERFORM dblink_exec('f4_pay_worker_b', 'SET ROLE authenticated');
  PERFORM dblink_exec(
    'f4_pay_worker_a',
    $$SET request.jwt.claim.sub = 'f5100000-0000-4000-8000-000000000009'$$
  );
  PERFORM dblink_exec(
    'f4_pay_worker_b',
    $$SET request.jwt.claim.sub = 'f5100000-0000-4000-8000-000000000009'$$
  );
  PERFORM dblink_exec('f4_pay_verifier', 'SET ROLE authenticated');
  PERFORM dblink_exec(
    'f4_pay_verifier',
    $$SET request.jwt.claim.sub = 'f5100000-0000-4000-8000-000000000009'$$
  );

  SELECT result.id INTO v_payment_id
    FROM dblink(
      'f4_pay_worker_a',
      $$SELECT id FROM public.create_professional_payment(
        'f5200000-0000-4000-8000-000000000090', 995009, 995019,
        DATE '2026-11-01', 'concurrent transition', 1, 100, 0, 'FIXED', 0, NULL
      )$$
    ) AS result(id BIGINT);
  IF v_payment_id IS NULL THEN
    RAISE EXCEPTION 'Concurrency fixture RPC did not create a payment';
  END IF;

  PERFORM dblink_exec('f4_pay_blocker', 'BEGIN');
  PERFORM * FROM dblink(
    'f4_pay_blocker',
    format('SELECT id FROM public.professional_payments WHERE id = %s FOR UPDATE', v_payment_id)
  ) AS locked(id BIGINT);

  PERFORM dblink_send_query(
    'f4_pay_worker_a',
    format($sql$SELECT * FROM public.transition_professional_payment(
      'f5200000-0000-4000-8000-000000000091', %s, 'conferido', NULL, NULL
    )$sql$, v_payment_id)
  );
  PERFORM dblink_send_query(
    'f4_pay_worker_b',
    format($sql$SELECT * FROM public.transition_professional_payment(
      'f5200000-0000-4000-8000-000000000091', %s, 'conferido', NULL, NULL
    )$sql$, v_payment_id)
  );
  PERFORM pg_sleep(0.25);
  IF dblink_is_busy('f4_pay_worker_a') <> 1
     OR dblink_is_busy('f4_pay_worker_b') <> 1 THEN
    RAISE EXCEPTION 'Concurrent transition workers did not overlap on the locked payment row';
  END IF;

  PERFORM dblink_exec('f4_pay_blocker', 'COMMIT');
  v_deadline := clock_timestamp() + INTERVAL '10 seconds';
  WHILE dblink_is_busy('f4_pay_worker_a') = 1
     OR dblink_is_busy('f4_pay_worker_b') = 1 LOOP
    IF clock_timestamp() > v_deadline THEN
      RAISE EXCEPTION 'Concurrent transition workers timed out';
    END IF;
    PERFORM pg_sleep(0.05);
  END LOOP;

  SELECT count(*), count(*) FILTER (WHERE idempotent_replay),
         count(DISTINCT id), min(updated_at), max(updated_at)
    INTO v_result_count, v_replay_count, v_result_payment_count,
         v_min_updated_at, v_max_updated_at
    FROM (
      SELECT * FROM dblink_get_result('f4_pay_worker_a', FALSE) AS result(
        id BIGINT, company_id UUID, professional_id BIGINT, unit_id BIGINT,
        reference_date DATE, status TEXT, paid_on DATE, cancel_reason TEXT,
        updated_by UUID, updated_at TIMESTAMPTZ, idempotent_replay BOOLEAN
      )
      UNION ALL
      SELECT * FROM dblink_get_result('f4_pay_worker_b', FALSE) AS result(
        id BIGINT, company_id UUID, professional_id BIGINT, unit_id BIGINT,
        reference_date DATE, status TEXT, paid_on DATE, cancel_reason TEXT,
        updated_by UUID, updated_at TIMESTAMPTZ, idempotent_replay BOOLEAN
      )
    ) AS concurrent_results
   WHERE status = 'conferido' AND paid_on IS NULL;

  IF v_result_count <> 2 OR v_replay_count <> 1
     OR v_result_payment_count <> 1
     OR v_min_updated_at IS DISTINCT FROM v_max_updated_at
     OR (SELECT count(*) FROM public.professional_payment_events
          WHERE company_id = 'f5000000-0000-4000-8000-000000000009'
            AND idempotency_key = 'f5200000-0000-4000-8000-000000000091') <> 1
     OR (SELECT status FROM public.professional_payments WHERE id = v_payment_id)
          <> 'conferido' THEN
    RAISE EXCEPTION
      'Concurrency invariant failed: rows=%, replays=%, payments=%, min_ts=%, max_ts=%',
      v_result_count, v_replay_count, v_result_payment_count,
      v_min_updated_at, v_max_updated_at;
  END IF;

  PERFORM * FROM dblink(
    'f4_pay_verifier',
    format($sql$SELECT id FROM public.transition_professional_payment(
      'f5200000-0000-4000-8000-000000000092', %s, 'pago', NULL, DATE '2026-11-13'
    )$sql$, v_payment_id)
  ) AS paid(id BIGINT);
  SELECT result.status, result.updated_at
    INTO v_replay_status, v_replay_updated_at
    FROM dblink(
      'f4_pay_verifier',
      format($sql$SELECT status, updated_at FROM public.transition_professional_payment(
        'f5200000-0000-4000-8000-000000000091', %s, 'conferido', NULL, NULL
      )$sql$, v_payment_id)
    ) AS result(status TEXT, updated_at TIMESTAMPTZ);
  IF v_replay_status <> 'conferido'
     OR v_replay_updated_at IS DISTINCT FROM v_min_updated_at THEN
    RAISE EXCEPTION 'Concurrent replay did not preserve its original snapshot';
  END IF;

  PERFORM dblink_exec('f4_pay_setup', $cleanup$
    SET session_replication_role = replica;
    DELETE FROM public.professional_payment_events
     WHERE company_id = 'f5000000-0000-4000-8000-000000000009';
    DELETE FROM public.professional_payments
     WHERE company_id = 'f5000000-0000-4000-8000-000000000009';
    SET session_replication_role = origin;
    DELETE FROM public.units WHERE id = 995019;
    DELETE FROM public.professionals WHERE id = 995009;
    DELETE FROM public.user_profiles
     WHERE id = 'f5100000-0000-4000-8000-000000000009';
    DELETE FROM auth.users
     WHERE id = 'f5100000-0000-4000-8000-000000000009';
    DELETE FROM public.companies
     WHERE id = 'f5000000-0000-4000-8000-000000000009';
  $cleanup$);

  PERFORM dblink_disconnect('f4_pay_worker_a');
  PERFORM dblink_disconnect('f4_pay_worker_b');
  PERFORM dblink_disconnect('f4_pay_verifier');
  PERFORM dblink_disconnect('f4_pay_blocker');
  PERFORM dblink_disconnect('f4_pay_setup');
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
  BEGIN PERFORM dblink_cancel_query('f4_pay_worker_a'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM dblink_cancel_query('f4_pay_worker_b'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM dblink_exec('f4_pay_blocker', 'ROLLBACK'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN
    PERFORM dblink_exec('f4_pay_setup', $cleanup$
      SET session_replication_role = replica;
      DELETE FROM public.professional_payment_events
       WHERE company_id = 'f5000000-0000-4000-8000-000000000009';
      DELETE FROM public.professional_payments
       WHERE company_id = 'f5000000-0000-4000-8000-000000000009';
      SET session_replication_role = origin;
      DELETE FROM public.units WHERE id = 995019;
      DELETE FROM public.professionals WHERE id = 995009;
      DELETE FROM public.user_profiles
       WHERE id = 'f5100000-0000-4000-8000-000000000009';
      DELETE FROM auth.users
       WHERE id = 'f5100000-0000-4000-8000-000000000009';
      DELETE FROM public.companies
       WHERE id = 'f5000000-0000-4000-8000-000000000009';
    $cleanup$);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN PERFORM dblink_disconnect('f4_pay_worker_a'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM dblink_disconnect('f4_pay_worker_b'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM dblink_disconnect('f4_pay_verifier'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM dblink_disconnect('f4_pay_blocker'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM dblink_disconnect('f4_pay_setup'); EXCEPTION WHEN OTHERS THEN NULL; END;
  RAISE EXCEPTION 'F4 professional payments concurrency gate failed: %', v_error;
END
$concurrency$;

SELECT 'F4_PROFESSIONAL_PAYMENTS_SECURE_GATE=PASS' AS result;

