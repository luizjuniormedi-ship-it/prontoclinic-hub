\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(condition BOOLEAN, message TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'MODULE37_BILLING_AUDIT_ASSERTION_FAILED: %', message;
  END IF;
END;
$$;

SELECT pg_temp.assert_true(
  (
    SELECT relrowsecurity AND relforcerowsecurity
    FROM pg_class
    WHERE oid = 'public.billing_account_audit_reviews'::REGCLASS
  ),
  'Audit reviews must force RLS'
);

SELECT pg_temp.assert_true(
  NOT has_table_privilege(
    'authenticated',
    'public.billing_account_audit_reviews',
    'SELECT, INSERT, UPDATE, DELETE, TRUNCATE'
  )
  AND NOT has_table_privilege(
    'app_prontomedic',
    'public.billing_account_audit_reviews',
    'SELECT, INSERT, UPDATE, DELETE, TRUNCATE'
  ),
  'Browser and runtime roles must not access audit reviews directly'
);

SELECT pg_temp.assert_true(
  has_function_privilege(
    'authenticated',
    'public.m37_list_billing_audit_queue_secure(text,integer)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'public.m37_claim_billing_audit_secure(uuid,integer,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'public.m37_decide_billing_audit_secure(uuid,uuid,text,text,jsonb,integer,integer,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.m37_claim_billing_audit_secure(uuid,integer,uuid)',
    'EXECUTE'
  ),
  'Only authenticated application roles may execute audit RPCs'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc procedure
    WHERE procedure.oid IN (
      'public.m37_list_billing_audit_queue_secure(text,integer)'::REGPROCEDURE,
      'public.m37_claim_billing_audit_secure(uuid,integer,uuid)'::REGPROCEDURE,
      'public.m37_decide_billing_audit_secure(uuid,uuid,text,text,jsonb,integer,integer,uuid)'::REGPROCEDURE
    )
      AND (
        NOT procedure.prosecdef
        OR pg_get_userbyid(procedure.proowner) <> 'prontomedic_financial_rpc_owner'
        OR NOT ('search_path=pg_catalog, public, auth' = ANY(procedure.proconfig))
        OR NOT ('row_security=on' = ANY(procedure.proconfig))
      )
  ),
  'Audit RPCs must use the restricted owner, fixed search path and RLS'
);

SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'billing_account_audit_reviews'
      AND policyname = 'billing_account_audit_reviews_financial_all'
      AND roles = ARRAY['prontomedic_financial_rpc_owner']::NAME[]
      AND qual LIKE '%current_company_id%'
      AND qual LIKE '%active_unit_id%'
  ),
  'Audit records must be isolated by company and active unit'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_get_functiondef(
      'public.m37_claim_billing_audit_secure(uuid,integer,uuid)'::REGPROCEDURE
    ) ILIKE '%request_aal()%'
      AND pg_get_functiondef(
        'public.m37_claim_billing_audit_secure(uuid,integer,uuid)'::REGPROCEDURE
      ) ILIKE '%FOR UPDATE%'
      AND pg_get_functiondef(
        'public.m37_claim_billing_audit_secure(uuid,integer,uuid)'::REGPROCEDURE
      ) ILIKE '%expected_account_version%'
  )
  AND (
    SELECT pg_get_functiondef(
      'public.m37_decide_billing_audit_secure(uuid,uuid,text,text,jsonb,integer,integer,uuid)'::REGPROCEDURE
    ) ILIKE '%m39_billing_readiness%'
      AND pg_get_functiondef(
        'public.m37_decide_billing_audit_secure(uuid,uuid,text,text,jsonb,integer,integer,uuid)'::REGPROCEDURE
      ) ILIKE '%reviewer_id IS DISTINCT FROM v_actor_id%'
      AND pg_get_functiondef(
        'public.m37_decide_billing_audit_secure(uuid,uuid,text,text,jsonb,integer,integer,uuid)'::REGPROCEDURE
      ) ILIKE '%Conta com pendências bloqueadoras não pode ser aprovada%'
  ),
  'Claims and decisions must enforce AAL2, locking, ownership and readiness'
);

SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'billing_account_audit_reviews'
      AND indexname = 'billing_account_audit_reviews_active_uq'
      AND indexdef ILIKE '%WHERE (status = %assigned%::text)%'
  )
  AND EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.billing_account_audit_reviews'::REGCLASS
      AND tgname = 'trg_audit_billing_account_audit_reviews'
      AND NOT tgisinternal
  ),
  'Each account may have one active reviewer and every mutation must be audited'
);

ROLLBACK;
