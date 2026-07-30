\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(condition BOOLEAN, message TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'MODULE39_BILLING_ASSERTION_FAILED: %', message;
  END IF;
END;
$$;

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'prontomedic_financial_rpc_owner'
      AND (
        rolcanlogin OR rolinherit OR rolbypassrls OR rolsuper
        OR rolcreatedb OR rolcreaterole OR rolreplication
      )
  ),
  'Financial RPC owner must remain restricted'
);

SELECT pg_temp.assert_true(
  (
    SELECT relrowsecurity AND relforcerowsecurity
    FROM pg_class
    WHERE oid = 'public.billing_competence_closures'::REGCLASS
  )
  AND (
    SELECT relrowsecurity AND relforcerowsecurity
    FROM pg_class
    WHERE oid = 'public.billing_command_operations'::REGCLASS
  ),
  'Competence and idempotency tables must enforce RLS'
);

SELECT pg_temp.assert_true(
  NOT has_table_privilege(
    'authenticated',
    'public.billing_competence_closures',
    'SELECT, INSERT, UPDATE, DELETE, TRUNCATE'
  )
  AND NOT has_table_privilege(
    'app_prontomedic',
    'public.billing_competence_closures',
    'SELECT, INSERT, UPDATE, DELETE, TRUNCATE'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'public.billing_command_operations',
    'SELECT, INSERT, UPDATE, DELETE, TRUNCATE'
  )
  AND NOT has_table_privilege(
    'app_prontomedic',
    'public.billing_command_operations',
    'SELECT, INSERT, UPDATE, DELETE, TRUNCATE'
  ),
  'Application roles must not access command tables directly'
);

SELECT pg_temp.assert_true(
  has_function_privilege(
    'authenticated',
    'public.m39_list_billing_accounts_secure(text,text,date,boolean,integer)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'public.m39_review_billing_account_secure(uuid,integer,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'public.m39_reopen_billing_account_secure(uuid,text,integer,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'public.m39_list_billing_competences_secure(integer)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'public.m39_close_billing_competence_secure(date,text,integer,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'public.m39_reopen_billing_competence_secure(date,text,integer,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.m39_review_billing_account_secure(uuid,integer,uuid)',
    'EXECUTE'
  ),
  'Only application roles may execute Module 39 RPCs'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc procedure
    WHERE procedure.oid IN (
      'public.m39_list_billing_accounts_secure(text,text,date,boolean,integer)'::REGPROCEDURE,
      'public.m39_review_billing_account_secure(uuid,integer,uuid)'::REGPROCEDURE,
      'public.m39_reopen_billing_account_secure(uuid,text,integer,uuid)'::REGPROCEDURE,
      'public.m39_list_billing_competences_secure(integer)'::REGPROCEDURE,
      'public.m39_close_billing_competence_secure(date,text,integer,uuid)'::REGPROCEDURE,
      'public.m39_reopen_billing_competence_secure(date,text,integer,uuid)'::REGPROCEDURE
    )
      AND (
        NOT procedure.prosecdef
        OR pg_get_userbyid(procedure.proowner) <> 'prontomedic_financial_rpc_owner'
        OR NOT ('search_path=pg_catalog, public, auth' = ANY(procedure.proconfig))
        OR NOT ('row_security=on' = ANY(procedure.proconfig))
      )
  ),
  'RPCs must be security definer with fixed search path and RLS'
);

SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'billing_accounts'
      AND policyname = 'billing_accounts_financial_command_update'
      AND cmd = 'UPDATE'
      AND roles = ARRAY['prontomedic_financial_rpc_owner']::NAME[]
      AND qual LIKE '%current_company_id%'
      AND qual LIKE '%active_unit_id%'
  )
  AND EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'billing_competence_closures'
      AND policyname = 'billing_competence_closures_financial_all'
      AND roles = ARRAY['prontomedic_financial_rpc_owner']::NAME[]
      AND qual LIKE '%current_company_id%'
      AND qual LIKE '%active_unit_id%'
  ),
  'Policies must isolate company and active unit'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT required.column_name
    FROM (
      VALUES
        ('authorization_number'),
        ('has_denial'),
        ('is_reopened'),
        ('opened_at'),
        ('paid_at'),
        ('version'),
        ('last_reviewed_at'),
        ('last_reviewed_by'),
        ('readiness_snapshot')
    ) required(column_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM information_schema.columns column_info
      WHERE column_info.table_schema = 'public'
        AND column_info.table_name = 'billing_accounts'
        AND column_info.column_name = required.column_name
    )
  ),
  'Billing account compatibility and optimistic version columns must exist'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_get_functiondef(
      'public.m39_review_billing_account_secure(uuid,integer,uuid)'::REGPROCEDURE
    ) ILIKE '%FOR UPDATE%'
      AND pg_get_functiondef(
        'public.m39_review_billing_account_secure(uuid,integer,uuid)'::REGPROCEDURE
      ) ILIKE '%request_aal()%'
      AND pg_get_functiondef(
        'public.m39_review_billing_account_secure(uuid,integer,uuid)'::REGPROCEDURE
      ) ILIKE '%can_access(%faturamento%edit%'
      AND pg_get_functiondef(
        'public.m39_review_billing_account_secure(uuid,integer,uuid)'::REGPROCEDURE
      ) ILIKE '%expected_version%'
  )
  AND (
    SELECT pg_get_functiondef(
      'public.m39_reopen_billing_account_secure(uuid,text,integer,uuid)'::REGPROCEDURE
    ) ILIKE '%FOR UPDATE%'
      AND pg_get_functiondef(
        'public.m39_reopen_billing_account_secure(uuid,text,integer,uuid)'::REGPROCEDURE
      ) ILIKE '%NOT IN (%pronta_envio%baixada%cancelada%'
  ),
  'Account mutations must enforce AAL2, permission, state and optimistic locking'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_get_functiondef(
      'public.m39_close_billing_competence_secure(date,text,integer,uuid)'::REGPROCEDURE
    ) ILIKE '%FOR UPDATE%'
      AND pg_get_functiondef(
        'public.m39_close_billing_competence_secure(date,text,integer,uuid)'::REGPROCEDURE
      ) ILIKE '%blocking_count%'
      AND pg_get_functiondef(
        'public.m39_close_billing_competence_secure(date,text,integer,uuid)'::REGPROCEDURE
      ) ILIKE '%operation_id%'
  )
  AND (
    SELECT pg_get_functiondef(
      'public.m39_reopen_billing_competence_secure(date,text,integer,uuid)'::REGPROCEDURE
    ) ILIKE '%status IS DISTINCT FROM %closed%%'
      AND pg_get_functiondef(
        'public.m39_reopen_billing_competence_secure(date,text,integer,uuid)'::REGPROCEDURE
      ) ILIKE '%expected_version%'
  ),
  'Competence commands must enforce readiness, states and idempotency'
);

SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.billing_command_operations'::REGCLASS
      AND contype = 'p'
      AND pg_get_constraintdef(oid)
        ILIKE '%company_id%unit_id%operation_id%'
  ),
  'Ledger identity must be tenant, unit and operation scoped'
);

SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.billing_accounts'::REGCLASS
      AND tgname = 'trg_audit_billing_accounts'
      AND NOT tgisinternal
  )
  AND EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.billing_competence_closures'::REGCLASS
      AND tgname = 'trg_audit_billing_competence_closures'
      AND NOT tgisinternal
  ),
  'Account and competence mutations must be audited'
);

SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.billing_accounts'::REGCLASS
      AND tgname = 'trg_enforce_open_billing_competence'
      AND NOT tgisinternal
  )
  AND (
    SELECT procedure.prosecdef
      AND pg_get_userbyid(procedure.proowner) =
        'prontomedic_financial_rpc_owner'
      AND 'search_path=pg_catalog, public, auth' =
        ANY(procedure.proconfig)
      AND 'row_security=on' = ANY(procedure.proconfig)
    FROM pg_proc procedure
    WHERE procedure.oid =
      'public.m39_enforce_open_billing_competence()'::REGPROCEDURE
  ),
  'Closed competence must be guarded against new account inclusion'
);

DO $state_contract$
DECLARE
  v_account public.billing_accounts;
  v_readiness JSONB;
BEGIN
  v_account.id := gen_random_uuid();
  v_account.version := 1;
  v_account.status := 'aberta';
  v_account.billing_type := 'convenio';
  v_account.total_gross_amount := 100;
  v_account.total_net_amount := 100;
  v_account.total_paid_amount := 0;
  v_account.total_pending_amount := 100;
  v_account.has_denial := FALSE;

  v_readiness := public.m39_billing_readiness(v_account);

  PERFORM pg_temp.assert_true(
    (v_readiness ->> 'can_close')::BOOLEAN IS FALSE
    AND (v_readiness ->> 'blocking_count')::INTEGER >= 5,
    'Incomplete insurance account must fail readiness'
  );

  v_account.unit_id := 1;
  v_account.patient_id := 1;
  v_account.insurance_id := 1;
  v_account.competence_month := DATE '2026-07-01';
  v_account.guide_number := 'GUIA-QA';
  v_account.authorization_number := 'AUTH-QA';

  v_readiness := public.m39_billing_readiness(v_account);

  PERFORM pg_temp.assert_true(
    (v_readiness ->> 'can_close')::BOOLEAN IS TRUE
    AND (v_readiness ->> 'blocking_count')::INTEGER = 0,
    'Complete insurance account must pass deterministic readiness'
  );
END
$state_contract$;

-- Runtime fixtures exercise real session context, RLS, optimistic versioning,
-- state transitions and idempotent retries across two companies and units.
INSERT INTO public.companies (id, name)
VALUES
  ('39000000-0000-4000-8000-000000000001', 'Billing Contract A'),
  ('39000000-0000-4000-8000-000000000002', 'Billing Contract B')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.units (id, company_id, cd_codigo, ds_nome, lg_ativo)
VALUES
  (939001, '39000000-0000-4000-8000-000000000001', 'M39-A1', 'Billing A1', TRUE),
  (939002, '39000000-0000-4000-8000-000000000001', 'M39-A2', 'Billing A2', TRUE),
  (939003, '39000000-0000-4000-8000-000000000002', 'M39-B1', 'Billing B1', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at)
VALUES (
  '39000000-0000-4000-8000-000000000010',
  'module39.billing@example.test',
  'test',
  NOW()
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_profiles (
  id, user_id, full_name, email, role_id, role_name,
  company_id, primary_unit_id, lg_ativo
)
SELECT
  '39000000-0000-4000-8000-000000000010',
  '39000000-0000-4000-8000-000000000010',
  'Module 39 Billing User',
  'module39.billing@example.test',
  role_record.id,
  role_record.name,
  '39000000-0000-4000-8000-000000000001',
  939001,
  TRUE
FROM public.roles role_record
WHERE role_record.name = 'admin'
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.memberships (id, user_id, company_id, status)
VALUES (
  '39000000-0000-4000-8000-000000000020',
  '39000000-0000-4000-8000-000000000010',
  '39000000-0000-4000-8000-000000000001',
  'active'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.membership_roles (membership_id, role_id)
SELECT
  '39000000-0000-4000-8000-000000000020',
  role_record.id
FROM public.roles role_record
WHERE role_record.name = 'admin'
ON CONFLICT DO NOTHING;

INSERT INTO public.membership_units (membership_id, unit_id)
VALUES
  ('39000000-0000-4000-8000-000000000020', 939001),
  ('39000000-0000-4000-8000-000000000020', 939002)
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (
  company_id, role_id, module,
  can_view, can_create, can_edit, can_delete, can_export
)
SELECT
  '39000000-0000-4000-8000-000000000001',
  role_record.id,
  'faturamento',
  TRUE, TRUE, TRUE, FALSE, FALSE
FROM public.roles role_record
WHERE role_record.name = 'admin'
ON CONFLICT (company_id, role_id, module) DO UPDATE
SET can_view = TRUE, can_create = TRUE, can_edit = TRUE;

INSERT INTO public.patients (id, company_id, unit_id, full_name)
VALUES
  (939001, '39000000-0000-4000-8000-000000000001', 939001, 'Billing Patient A1'),
  (939002, '39000000-0000-4000-8000-000000000001', 939002, 'Billing Patient A2'),
  (939003, '39000000-0000-4000-8000-000000000002', 939003, 'Billing Patient B1');

ALTER TABLE public.billing_accounts
  DISABLE TRIGGER trg_enforce_open_billing_competence;
INSERT INTO public.billing_accounts (
  id, company_id, unit_id, patient_id, billing_type, account_type,
  status, competence_month, total_gross_amount, total_net_amount,
  total_paid_amount, total_pending_amount, version
)
VALUES
  (
    '39000000-0000-4000-8000-000000000101',
    '39000000-0000-4000-8000-000000000001',
    939001, 939001, 'particular', 'ambulatorial',
    'pronta_envio', DATE '2026-07-01', 100, 100, 0, 100, 1
  ),
  (
    '39000000-0000-4000-8000-000000000102',
    '39000000-0000-4000-8000-000000000001',
    939001, 939001, 'particular', 'ambulatorial',
    'paga', DATE '2026-07-01', 50, 50, 50, 0, 1
  ),
  (
    '39000000-0000-4000-8000-000000000103',
    '39000000-0000-4000-8000-000000000001',
    939002, 939002, 'particular', 'ambulatorial',
    'paga', DATE '2026-07-01', 75, 75, 75, 0, 1
  ),
  (
    '39000000-0000-4000-8000-000000000104',
    '39000000-0000-4000-8000-000000000002',
    939003, 939003, 'particular', 'ambulatorial',
    'paga', DATE '2026-07-01', 80, 80, 80, 0, 1
  ),
  (
    '39000000-0000-4000-8000-000000000105',
    '39000000-0000-4000-8000-000000000001',
    939001, 939001, 'particular', 'ambulatorial',
    'paga', DATE '2026-08-01', 90, 90, 90, 0, 1
  );
ALTER TABLE public.billing_accounts
  ENABLE TRIGGER trg_enforce_open_billing_competence;

CREATE TEMP TABLE module39_runtime_results (
  result_name TEXT PRIMARY KEY,
  payload JSONB NOT NULL
) ON COMMIT DROP;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE module39_runtime_results TO authenticated;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub =
  '39000000-0000-4000-8000-000000000010';
SET LOCAL request.jwt.claim.aal = 'aal2';
SET LOCAL request.jwt.claims =
  '{"sub":"39000000-0000-4000-8000-000000000010","role":"authenticated","aal":"aal2","session_id":"39000000-0000-4000-8000-000000000099"}';

SELECT public.activate_application_context(
  '39000000-0000-4000-8000-000000000020',
  (SELECT id FROM public.roles WHERE name = 'admin'),
  939001,
  '39000000-0000-4000-8000-000000000077',
  'Module 39 runtime contract',
  'psql',
  'module39-billing-account-operational-closure'
);

SELECT pg_temp.assert_true(
  public.current_company_id() =
    '39000000-0000-4000-8000-000000000001'
  AND public.active_unit_id() = 939001
  AND public.can_access('faturamento', 'edit'),
  'Billing runtime context must be active at AAL2'
);

SELECT pg_temp.assert_true(
  (
    SELECT array_agg(account.id ORDER BY account.id)
    FROM public.m39_list_billing_accounts_secure() account
  ) = ARRAY[
    '39000000-0000-4000-8000-000000000101',
    '39000000-0000-4000-8000-000000000102',
    '39000000-0000-4000-8000-000000000105'
  ]::UUID[],
  'Secure list must isolate both company and active unit'
);

SELECT pg_temp.assert_true(
  (
    SELECT account.patient_name
    FROM public.m39_list_billing_accounts_secure() account
    WHERE account.id = '39000000-0000-4000-8000-000000000101'
  ) = 'Billing Patient A1',
  'Secure list must project the patient name in the active tenant'
);

DO $cross_scope$
BEGIN
  PERFORM public.m39_review_billing_account_secure(
    '39000000-0000-4000-8000-000000000103',
    1,
    '39000000-0000-4000-8000-000000000201'
  );
  RAISE EXCEPTION
    'MODULE39_BILLING_ASSERTION_FAILED: cross-unit account was reviewed';
EXCEPTION
  WHEN no_data_found THEN NULL;
END
$cross_scope$;

INSERT INTO module39_runtime_results (result_name, payload)
SELECT
  'reopen_first',
  public.m39_reopen_billing_account_secure(
    '39000000-0000-4000-8000-000000000101',
    'Revisão operacional QA',
    1,
    '39000000-0000-4000-8000-000000000202'
  );

INSERT INTO module39_runtime_results (result_name, payload)
SELECT
  'reopen_retry',
  public.m39_reopen_billing_account_secure(
    '39000000-0000-4000-8000-000000000101',
    'Revisão operacional QA',
    1,
    '39000000-0000-4000-8000-000000000202'
  );

SELECT pg_temp.assert_true(
  (
    SELECT payload FROM module39_runtime_results
    WHERE result_name = 'reopen_first'
  ) = (
    SELECT payload FROM module39_runtime_results
    WHERE result_name = 'reopen_retry'
  )
  AND (
    SELECT (payload ->> 'version')::INTEGER
    FROM module39_runtime_results
    WHERE result_name = 'reopen_first'
  ) = 2,
  'Same operation and payload must return the original result exactly once'
);

DO $idempotency_conflict$
BEGIN
  PERFORM public.m39_reopen_billing_account_secure(
    '39000000-0000-4000-8000-000000000101',
    'Payload diferente',
    1,
    '39000000-0000-4000-8000-000000000202'
  );
  RAISE EXCEPTION
    'MODULE39_BILLING_ASSERTION_FAILED: conflicting idempotency payload was accepted';
EXCEPTION
  WHEN raise_exception THEN
    IF SQLERRM LIKE 'MODULE39_BILLING_ASSERTION_FAILED:%' THEN
      RAISE;
    END IF;
END
$idempotency_conflict$;

DO $paid_state$
BEGIN
  PERFORM public.m39_reopen_billing_account_secure(
    '39000000-0000-4000-8000-000000000102',
    'Não deve reabrir pagamento',
    1,
    '39000000-0000-4000-8000-000000000203'
  );
  RAISE EXCEPTION
    'MODULE39_BILLING_ASSERTION_FAILED: paid account was reopened';
EXCEPTION
  WHEN raise_exception THEN
    IF SQLERRM LIKE 'MODULE39_BILLING_ASSERTION_FAILED:%' THEN
      RAISE;
    END IF;
END
$paid_state$;

DO $stale_version$
BEGIN
  PERFORM public.m39_review_billing_account_secure(
    '39000000-0000-4000-8000-000000000101',
    1,
    '39000000-0000-4000-8000-000000000204'
  );
  RAISE EXCEPTION
    'MODULE39_BILLING_ASSERTION_FAILED: stale version was accepted';
EXCEPTION
  WHEN raise_exception THEN
    IF SQLERRM LIKE 'MODULE39_BILLING_ASSERTION_FAILED:%' THEN
      RAISE;
    END IF;
END
$stale_version$;

INSERT INTO module39_runtime_results (result_name, payload)
SELECT
  'competence_close',
  public.m39_close_billing_competence_secure(
    DATE '2026-08-01',
    'Fechamento operacional QA',
    1,
    '39000000-0000-4000-8000-000000000205'
  );

INSERT INTO module39_runtime_results (result_name, payload)
SELECT
  'competence_close_retry',
  public.m39_close_billing_competence_secure(
    DATE '2026-08-01',
    'Fechamento operacional QA',
    1,
    '39000000-0000-4000-8000-000000000205'
  );

SELECT pg_temp.assert_true(
  (
    SELECT payload FROM module39_runtime_results
    WHERE result_name = 'competence_close'
  ) = (
    SELECT payload FROM module39_runtime_results
    WHERE result_name = 'competence_close_retry'
  )
  AND (
    SELECT payload ->> 'status'
    FROM module39_runtime_results
    WHERE result_name = 'competence_close'
  ) = 'closed',
  'Competence close must be idempotent'
);

INSERT INTO module39_runtime_results (result_name, payload)
SELECT
  'competence_reopen',
  public.m39_reopen_billing_competence_secure(
    DATE '2026-08-01',
    'Reabertura operacional QA',
    2,
    '39000000-0000-4000-8000-000000000206'
  );

SELECT pg_temp.assert_true(
  (
    SELECT payload ->> 'status'
    FROM module39_runtime_results
    WHERE result_name = 'competence_reopen'
  ) = 'open'
  AND (
    SELECT (payload ->> 'version')::INTEGER
    FROM module39_runtime_results
    WHERE result_name = 'competence_reopen'
  ) = 3,
  'Closed competence must reopen with optimistic version increment'
);

SET LOCAL request.jwt.claim.aal = 'aal1';
DO $aal1_denied$
BEGIN
  PERFORM public.m39_review_billing_account_secure(
    '39000000-0000-4000-8000-000000000101',
    2,
    '39000000-0000-4000-8000-000000000207'
  );
  RAISE EXCEPTION
    'MODULE39_BILLING_ASSERTION_FAILED: AAL1 mutation was accepted';
EXCEPTION
  WHEN insufficient_privilege THEN NULL;
END
$aal1_denied$;

RESET ROLE;

ROLLBACK;
