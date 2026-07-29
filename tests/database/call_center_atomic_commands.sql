\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(condition BOOLEAN, message TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'CALL_CENTER_ASSERTION_FAILED: %', message;
  END IF;
END;
$$;

SELECT pg_temp.assert_true(
  (
    SELECT relrowsecurity AND relforcerowsecurity
    FROM pg_class
    WHERE oid = 'public.scheduling_contact_logs'::REGCLASS
  )
  AND (
    SELECT relrowsecurity AND relforcerowsecurity
    FROM pg_class
    WHERE oid = 'public.scheduling_call_center_tasks'::REGCLASS
  ),
  'Call Center command tables must enforce RLS'
);

SELECT pg_temp.assert_true(
  NOT has_table_privilege(
    'authenticated',
    'public.scheduling_contact_logs',
    'INSERT, UPDATE, DELETE, TRUNCATE'
  )
  AND NOT has_table_privilege(
    'app_prontomedic',
    'public.scheduling_contact_logs',
    'INSERT, UPDATE, DELETE, TRUNCATE'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'public.scheduling_call_center_tasks',
    'INSERT, UPDATE, DELETE, TRUNCATE'
  )
  AND NOT has_table_privilege(
    'app_prontomedic',
    'public.scheduling_call_center_tasks',
    'INSERT, UPDATE, DELETE, TRUNCATE'
  ),
  'Browser roles must not mutate Call Center tables directly'
);

SELECT pg_temp.assert_true(
  NOT has_sequence_privilege(
    'authenticated',
    'public.scheduling_contact_logs_id_seq',
    'USAGE, SELECT, UPDATE'
  )
  AND NOT has_sequence_privilege(
    'authenticated',
    'public.scheduling_call_center_tasks_id_seq',
    'USAGE, SELECT, UPDATE'
  ),
  'Browser roles must not access Call Center command sequences'
);

SELECT pg_temp.assert_true(
  has_function_privilege(
    'authenticated',
    'public.record_call_center_contact_secure(bigint,bigint,text,text,text,text,text,text,timestamptz,boolean)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'public.complete_call_center_task_secure(bigint)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.record_call_center_contact_secure(bigint,bigint,text,text,text,text,text,text,timestamptz,boolean)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.complete_call_center_task_secure(bigint)',
    'EXECUTE'
  ),
  'Only authenticated application roles may execute Call Center commands'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'prontomedic_reception_rpc_owner'
      AND (
        rolcanlogin OR rolinherit OR rolbypassrls OR rolsuper
        OR rolcreatedb OR rolcreaterole OR rolreplication
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_class relation
    JOIN pg_roles owner_role ON owner_role.oid = relation.relowner
    WHERE relation.oid IN (
      'public.scheduling_contact_logs'::REGCLASS,
      'public.scheduling_call_center_tasks'::REGCLASS
    )
      AND owner_role.rolname = 'prontomedic_reception_rpc_owner'
  ),
  'RPC owner must remain restricted and distinct from table owners'
);

SELECT pg_temp.assert_true(
  (
    SELECT p.prosecdef
      AND pg_get_userbyid(p.proowner) = 'prontomedic_reception_rpc_owner'
      AND 'search_path=public, pg_temp' = ANY(p.proconfig)
      AND 'row_security=on' = ANY(p.proconfig)
    FROM pg_proc p
    WHERE p.oid =
      'public.record_call_center_contact_secure(bigint,bigint,text,text,text,text,text,text,timestamptz,boolean)'::REGPROCEDURE
  )
  AND (
    SELECT p.prosecdef
      AND pg_get_userbyid(p.proowner) = 'prontomedic_reception_rpc_owner'
      AND 'search_path=public, pg_temp' = ANY(p.proconfig)
      AND 'row_security=on' = ANY(p.proconfig)
    FROM pg_proc p
    WHERE p.oid =
      'public.complete_call_center_task_secure(bigint)'::REGPROCEDURE
  ),
  'Call Center commands must use the restricted owner and fixed runtime settings'
);

SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'scheduling_contact_logs'
      AND policyname = 'scheduling_contact_logs_command_insert'
      AND cmd = 'INSERT'
      AND roles = ARRAY['prontomedic_reception_rpc_owner']::NAME[]
  )
  AND EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'scheduling_call_center_tasks'
      AND policyname = 'scheduling_call_center_tasks_command_update'
      AND cmd = 'UPDATE'
      AND roles = ARRAY['prontomedic_reception_rpc_owner']::NAME[]
  ),
  'Command tables must expose only scoped policies to the restricted owner'
);

ROLLBACK;
