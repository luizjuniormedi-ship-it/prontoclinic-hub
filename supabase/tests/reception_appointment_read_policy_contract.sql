\set ON_ERROR_STOP on

DO $contract$
DECLARE
  v_role TEXT;
  v_policy_name TEXT;
  v_qual TEXT;
BEGIN
  FOR v_role, v_policy_name IN
    SELECT expected.role_name, expected.policy_name
      FROM (
        VALUES
          ('authenticated', 'm9_appointments_scoped_select'),
          ('app_prontomedic', 'm9_app_appointments_scoped_select')
      ) AS expected(role_name, policy_name)
  LOOP
    SELECT policy.qual
      INTO v_qual
      FROM pg_policies AS policy
     WHERE policy.schemaname = 'public'
       AND policy.tablename = 'appointments'
       AND policy.policyname = v_policy_name
       AND v_role = ANY(policy.roles);

    IF v_qual IS NULL
       OR position('org_can_access_unit' IN v_qual) = 0
       OR position('org_can_access_unit_runtime' IN v_qual) > 0 THEN
      RAISE EXCEPTION 'Appointment read policy % for % bypasses the safe unit-access wrapper',
        v_policy_name, v_role;
    END IF;
  END LOOP;

  IF to_regprocedure(
    'private.org_can_access_unit_runtime(uuid,integer)'
  ) IS NOT NULL AND (
    has_function_privilege(
      'authenticated',
      'private.org_can_access_unit_runtime(uuid,integer)',
      'EXECUTE'
    ) OR has_function_privilege(
      'app_prontomedic',
      'private.org_can_access_unit_runtime(uuid,integer)',
      'EXECUTE'
    )
  ) THEN
    RAISE EXCEPTION 'Private unit-access helper was exposed to application roles';
  END IF;
END
$contract$;

\echo RECEPTION_APPOINTMENT_READ_POLICY_PASS
