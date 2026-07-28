-- Module 21 authenticated behavioral contract.
-- Disposable replay database only. Never run on VPS, production or DataSIGH.
BEGIN;

DO $$
DECLARE
  v_table TEXT;
  v_rpc_count INTEGER;
  v_public_definer_count INTEGER;
  v_private_owner_violation_count INTEGER;
  v_policy_count INTEGER;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'care_protocol_definitions', 'care_protocol_versions',
    'care_protocol_executions', 'care_protocol_execution_steps',
    'care_protocol_observations', 'care_protocol_alerts',
    'care_protocol_escalations', 'care_protocol_overrides',
    'care_protocol_tasks', 'care_protocol_events'
  ]
  LOOP
    IF to_regclass('public.' || v_table) IS NULL THEN
      RAISE EXCEPTION 'M21 table missing: %', v_table;
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_class
      WHERE oid = to_regclass('public.' || v_table)
        AND relrowsecurity
        AND relforcerowsecurity
    ) THEN
      RAISE EXCEPTION 'M21 RLS/FORCE RLS missing on %', v_table;
    END IF;
    IF NOT has_table_privilege('authenticated', 'public.' || v_table, 'SELECT') THEN
      RAISE EXCEPTION 'M21 authenticated SELECT grant missing on %', v_table;
    END IF;
    IF has_table_privilege('authenticated', 'public.' || v_table, 'INSERT')
       OR has_table_privilege('authenticated', 'public.' || v_table, 'UPDATE')
       OR has_table_privilege('authenticated', 'public.' || v_table, 'DELETE') THEN
      RAISE EXCEPTION 'M21 direct authenticated write grant found on %', v_table;
    END IF;
    IF NOT has_table_privilege('app_prontomedic', 'public.' || v_table, 'SELECT') THEN
      RAISE EXCEPTION 'M21 app_prontomedic SELECT grant missing on %', v_table;
    END IF;
    IF has_table_privilege('app_prontomedic', 'public.' || v_table, 'INSERT')
       OR has_table_privilege('app_prontomedic', 'public.' || v_table, 'UPDATE')
       OR has_table_privilege('app_prontomedic', 'public.' || v_table, 'DELETE') THEN
      RAISE EXCEPTION 'M21 direct app_prontomedic write grant found on %', v_table;
    END IF;
    IF has_table_privilege('anon', 'public.' || v_table, 'SELECT')
       OR has_table_privilege('anon', 'public.' || v_table, 'INSERT')
       OR has_table_privilege('anon', 'public.' || v_table, 'UPDATE')
       OR has_table_privilege('anon', 'public.' || v_table, 'DELETE') THEN
      RAISE EXCEPTION 'M21 anon privilege found on %', v_table;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename LIKE 'care_protocol_%'
    AND policyname LIKE 'm21_%';
  IF v_policy_count <> 10 THEN
    RAISE EXCEPTION 'M21 policy count mismatch: %', v_policy_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename LIKE 'care_protocol_%'
      AND (
        lower(coalesce(qual, '')) IN ('true', '(true)')
        OR lower(coalesce(with_check, '')) IN ('true', '(true)')
      )
  ) THEN
    RAISE EXCEPTION 'M21 contains an unconditional RLS policy';
  END IF;

  SELECT count(*) INTO v_rpc_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'm21_create_protocol_definition_secure',
      'm21_publish_protocol_version_secure',
      'm21_transition_protocol_definition_secure',
      'm21_start_protocol_execution_secure',
      'm21_transition_protocol_execution_secure',
      'm21_transition_protocol_step_secure',
      'm21_add_protocol_observation_secure',
      'm21_raise_protocol_alert_secure',
      'm21_transition_protocol_alert_secure',
      'm21_escalate_protocol_secure',
      'm21_add_protocol_override_secure'
    )
    AND p.prosecdef
    AND pg_get_userbyid(p.proowner) = 'prontomedic_rpc_owner';
  IF v_rpc_count <> 11 THEN
    RAISE EXCEPTION 'M21 secure wrapper ownership mismatch: %', v_rpc_count;
  END IF;

  SELECT count(*) INTO v_public_definer_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname LIKE 'm21_%_secure'
    AND p.prosecdef;
  IF v_public_definer_count <> 11 THEN
    RAISE EXCEPTION 'M21 public SECURITY DEFINER wrapper count mismatch: %', v_public_definer_count;
  END IF;

  SELECT count(*) INTO v_policy_count
  FROM public.permissions
  WHERE (module = 'protocolos_governanca' AND action IN ('view', 'create', 'edit'))
     OR (module = 'protocolos_execucao' AND action IN ('view', 'create', 'edit'));
  IF v_policy_count <> 6 THEN
    RAISE EXCEPTION 'M21 specific permission catalog is incomplete: %', v_policy_count;
  END IF;

  SELECT count(*) INTO v_policy_count
  FROM public.role_permissions rp
  JOIN public.roles r ON r.id = rp.role_id
  WHERE (
      (rp.module = 'protocolos_governanca'
       AND r.name IN ('admin', 'gestor', 'medico'))
      OR
      (rp.module = 'protocolos_execucao'
       AND r.name IN ('admin', 'gestor', 'medico', 'enfermagem', 'tecnico_enfermagem'))
    )
    AND rp.can_view AND rp.can_create AND rp.can_edit
    AND NOT rp.can_delete AND NOT rp.can_export;
  IF v_policy_count <> (
    SELECT count(*)
    FROM public.roles
    WHERE name IN ('admin', 'gestor', 'medico')
  ) + (
    SELECT count(*)
    FROM public.roles
    WHERE name IN ('admin', 'gestor', 'medico', 'enfermagem', 'tecnico_enfermagem')
  ) OR EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    JOIN public.roles r ON r.id = rp.role_id
    WHERE (
      (rp.module = 'protocolos_governanca'
       AND r.name NOT IN ('admin', 'gestor', 'medico'))
      OR
      (rp.module = 'protocolos_execucao'
       AND r.name NOT IN ('admin', 'gestor', 'medico', 'enfermagem', 'tecnico_enfermagem'))
    )
      AND (rp.can_view OR rp.can_create OR rp.can_edit OR rp.can_delete OR rp.can_export)
  ) THEN
    RAISE EXCEPTION 'M21 role matrix is broader than governance/execution surfaces';
  END IF;

  SELECT count(*) INTO v_private_owner_violation_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_roles r ON r.oid = p.proowner
  WHERE n.nspname = 'private'
    AND p.proname LIKE 'm21_%'
    AND p.prosecdef
    AND NOT (r.rolsuper OR r.rolbypassrls);
  IF v_private_owner_violation_count <> 0 THEN
    RAISE EXCEPTION
      'M21 private mutation functions cannot cross FORCE RLS with their current owner: %',
      v_private_owner_violation_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.care_protocol_versions'::regclass
      AND tgname = 'trg_m21_immutable_versions'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'M21 immutable version trigger missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.care_protocol_versions'::regclass
      AND tgname = 'trg_m21_validate_protocol_version'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'M21 protocol safety validation trigger missing';
  END IF;

  IF to_regclass('public.care_protocol_definition_unit_code_uq') IS NULL
     OR to_regclass('public.care_protocol_definition_corporate_code_uq') IS NULL THEN
    RAISE EXCEPTION 'M21 definition uniqueness indexes are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private'
      AND p.proname = 'm21_validate_protocol_version'
      AND pg_get_functiondef(p.oid) ILIKE '%AUTO_PRESCRIBE%'
      AND pg_get_functiondef(p.oid) ILIKE '%MEDICATION_ORDER%'
  ) THEN
    RAISE EXCEPTION 'M21 automatic prescription guard is missing';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.m21_start_protocol_execution_secure(uuid,integer,bigint,uuid,text,text,jsonb,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'M21 anonymous RPC execution is allowed';
  END IF;

  IF has_function_privilege(
       'authenticated',
       'private.m21_create_definition(integer,text,text,text,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'app_prontomedic',
       'private.m21_start_execution(uuid,integer,bigint,uuid,text,text,jsonb,uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'M21 private helpers are directly executable';
  END IF;

  IF to_regclass('public.prontomedic_deployment_migrations') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM (VALUES ('authenticated'), ('app_prontomedic')) AS role_name(name)
       CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) AS privilege_name(name)
       WHERE has_table_privilege(
         role_name.name,
         'public.prontomedic_deployment_migrations',
         privilege_name.name
       )
     ) THEN
    RAISE EXCEPTION 'M21 deployment ledger is mutable by an application role';
  END IF;
END
$$;

INSERT INTO public.companies (id, name, cnpj, lg_ativo)
VALUES
  ('00000000-0000-4000-8000-000000000211', 'M21 Tenant A', '00000000000211', TRUE),
  ('00000000-0000-4000-8000-000000000212', 'M21 Tenant B', '00000000000212', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.units (id, company_id, cd_codigo, ds_nome, lg_principal, lg_ativo)
VALUES
  (21001, '00000000-0000-4000-8000-000000000211', 'M21A', 'M21 Unit A', TRUE, TRUE),
  (21002, '00000000-0000-4000-8000-000000000212', 'M21B', 'M21 Unit B', TRUE, TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at)
VALUES
  ('00000000-0000-4000-8000-000000002101', 'm21-admin-a@example.invalid', 'synthetic', NOW()),
  ('00000000-0000-4000-8000-000000002102', 'm21-admin-b@example.invalid', 'synthetic', NOW()),
  ('00000000-0000-4000-8000-000000002103', 'm21-reception-a@example.invalid', 'synthetic', NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_profiles (
  id, user_id, full_name, email, role_name, company_id, primary_unit_id, lg_ativo
)
VALUES
  ('00000000-0000-4000-8000-000000002101', '00000000-0000-4000-8000-000000002101', 'M21 Admin A', 'm21-admin-a@example.invalid', 'admin', '00000000-0000-4000-8000-000000000211', 21001, TRUE),
  ('00000000-0000-4000-8000-000000002102', '00000000-0000-4000-8000-000000002102', 'M21 Admin B', 'm21-admin-b@example.invalid', 'admin', '00000000-0000-4000-8000-000000000212', 21002, TRUE),
  ('00000000-0000-4000-8000-000000002103', '00000000-0000-4000-8000-000000002103', 'M21 Reception A', 'm21-reception-a@example.invalid', 'recepcao', '00000000-0000-4000-8000-000000000211', 21001, TRUE)
ON CONFLICT (id) DO UPDATE
SET user_id = EXCLUDED.user_id,
    role_name = EXCLUDED.role_name,
    company_id = EXCLUDED.company_id,
    primary_unit_id = EXCLUDED.primary_unit_id,
    lg_ativo = TRUE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000002101';
SET LOCAL request.jwt.claim.role = 'authenticated';
SET LOCAL request.jwt.claim.company_id = '00000000-0000-4000-8000-000000000211';
SET LOCAL request.jwt.claims =
  '{"sub":"00000000-0000-4000-8000-000000002101","company_id":"00000000-0000-4000-8000-000000000211","role":"authenticated"}';

CREATE TEMP TABLE m21_created AS
SELECT *
FROM public.m21_create_protocol_definition_secure(
  21001, 'M21-SEPSIS', 'M21 Sepsis Protocol', 'CLINICAL',
  'Synthetic authenticated contract'
);

DO $behavior$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.care_protocol_definitions
  WHERE company_id = '00000000-0000-4000-8000-000000000211';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'M21 authenticated create/read failed: %', v_count;
  END IF;
END
$behavior$;

SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000002102';
SET LOCAL request.jwt.claim.company_id = '00000000-0000-4000-8000-000000000212';
SET LOCAL request.jwt.claims =
  '{"sub":"00000000-0000-4000-8000-000000002102","company_id":"00000000-0000-4000-8000-000000000212","role":"authenticated"}';

DO $cross_tenant$
DECLARE
  v_count INTEGER;
  v_blocked BOOLEAN := FALSE;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.care_protocol_definitions
  WHERE company_id = '00000000-0000-4000-8000-000000000211';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'M21 cross-tenant definition is visible';
  END IF;

  BEGIN
    PERFORM public.m21_create_protocol_definition_secure(
      21001, 'M21-CROSS', 'Cross tenant', 'CLINICAL', NULL
    );
  EXCEPTION WHEN OTHERS THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'M21 cross-tenant creation was not denied';
  END IF;
END
$cross_tenant$;

SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000002103';
SET LOCAL request.jwt.claim.company_id = '00000000-0000-4000-8000-000000000211';
SET LOCAL request.jwt.claims =
  '{"sub":"00000000-0000-4000-8000-000000002103","company_id":"00000000-0000-4000-8000-000000000211","role":"authenticated"}';

DO $role_denial$
DECLARE
  v_blocked BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.m21_create_protocol_definition_secure(
      21001, 'M21-DENY', 'Role denial', 'CLINICAL', NULL
    );
  EXCEPTION WHEN OTHERS THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'M21 reception role was allowed to manage protocols';
  END IF;
END
$role_denial$;

RESET ROLE;

INSERT INTO public.user_permissions (
  user_id, company_id, permission_id, effect, reason
)
SELECT
  '00000000-0000-4000-8000-000000002103',
  '00000000-0000-4000-8000-000000000211',
  p.id,
  'grant',
  'M21 synthetic governance override'
FROM public.permissions p
WHERE p.module = 'protocolos_governanca'
  AND p.action = 'create';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000002103';
SET LOCAL request.jwt.claim.company_id = '00000000-0000-4000-8000-000000000211';
SET LOCAL request.jwt.claims =
  '{"sub":"00000000-0000-4000-8000-000000002103","company_id":"00000000-0000-4000-8000-000000000211","role":"authenticated"}';

SELECT *
FROM public.m21_create_protocol_definition_secure(
  21001, 'M21-OVERRIDE', 'Override grant protocol', 'CLINICAL',
  'Synthetic user_permissions grant'
);

RESET ROLE;

DO $override_grant$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.care_protocol_definitions
    WHERE company_id = '00000000-0000-4000-8000-000000000211'
      AND code = 'M21-OVERRIDE'
      AND created_by = '00000000-0000-4000-8000-000000002103'
  ) THEN
    RAISE EXCEPTION 'M21 explicit grant override did not reach the RPC';
  END IF;
END
$override_grant$;

SELECT 'M21_CARE_PROTOCOLS_CONTRACT_PASS' AS result;

ROLLBACK;
