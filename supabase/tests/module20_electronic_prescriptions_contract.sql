-- Module 20 authenticated behavioral contract.
-- Disposable replay database only. Never run on VPS, production or DataSIGH.
BEGIN;

DO $$
DECLARE
  v_table_count INTEGER;
  v_rls_count INTEGER;
  v_rpc_count INTEGER;
  v_trigger_count INTEGER;
  v_public_definer_count INTEGER;
  v_status_constraint TEXT;
BEGIN
  SELECT COUNT(*) INTO v_table_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relname IN (
      'electronic_prescriptions',
      'electronic_prescription_items',
      'prescription_safety_events',
      'pharmaceutical_reviews',
      'electronic_prescription_versions'
    );
  IF v_table_count <> 5 THEN
    RAISE EXCEPTION 'M20 tables incomplete: %', v_table_count;
  END IF;

  SELECT COUNT(*) INTO v_rls_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN (
      'electronic_prescriptions',
      'electronic_prescription_items',
      'prescription_safety_events',
      'pharmaceutical_reviews',
      'electronic_prescription_versions'
    )
    AND c.relrowsecurity
    AND c.relforcerowsecurity;
  IF v_rls_count <> 5 THEN
    RAISE EXCEPTION 'M20 RLS/FORCE RLS incomplete: %', v_rls_count;
  END IF;

  SELECT COUNT(*) INTO v_rpc_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'm20_create_prescription_secure',
      'm20_upsert_prescription_item_secure',
      'm20_remove_prescription_item_secure',
      'm20_validate_prescription_secure',
      'm20_resolve_safety_event_secure',
      'm20_record_pharmaceutical_review_secure',
      'm20_transition_prescription_secure'
    );
  IF v_rpc_count <> 7 THEN
    RAISE EXCEPTION 'M20 public RPCs incomplete: %', v_rpc_count;
  END IF;

  SELECT COUNT(*) INTO v_public_definer_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'm20_create_prescription_secure',
      'm20_upsert_prescription_item_secure',
      'm20_remove_prescription_item_secure',
      'm20_validate_prescription_secure',
      'm20_resolve_safety_event_secure',
      'm20_record_pharmaceutical_review_secure',
      'm20_transition_prescription_secure'
    )
    AND p.prosecdef
    AND pg_get_userbyid(p.proowner) = 'prontomedic_rpc_owner';
  IF v_public_definer_count <> 7 THEN
    RAISE EXCEPTION 'M20 secure wrapper ownership is incomplete: %', v_public_definer_count;
  END IF;

  SELECT COUNT(*) INTO v_table_count
  FROM public.permissions
  WHERE (module = 'prescricao_eletronica' AND action IN ('view', 'create', 'edit'))
     OR (module = 'revisao_farmaceutica' AND action IN ('view', 'create', 'edit'));
  IF v_table_count <> 6 THEN
    RAISE EXCEPTION 'M20 specific permission catalog is incomplete: %', v_table_count;
  END IF;

  SELECT COUNT(*) INTO v_table_count
  FROM public.role_permissions rp
  JOIN public.roles r ON r.id = rp.role_id
  WHERE (
      (rp.module = 'prescricao_eletronica'
       AND r.name IN ('admin', 'medico')
       AND rp.can_view AND rp.can_create AND rp.can_edit)
      OR
      (rp.module = 'prescricao_eletronica'
       AND r.name IN ('farmacia', 'enfermagem')
       AND rp.can_view AND NOT rp.can_create AND NOT rp.can_edit)
      OR
      (rp.module = 'revisao_farmaceutica'
       AND r.name IN ('admin', 'farmacia')
       AND rp.can_view AND rp.can_create AND rp.can_edit)
    )
    AND NOT rp.can_delete
    AND NOT rp.can_export;
  IF v_table_count <> (
    SELECT count(*)
    FROM public.roles
    WHERE name IN ('admin', 'medico', 'farmacia', 'enfermagem')
  ) + (
    SELECT count(*)
    FROM public.roles
    WHERE name IN ('admin', 'farmacia')
  ) OR EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    JOIN public.roles r ON r.id = rp.role_id
    WHERE (
      (rp.module = 'prescricao_eletronica'
       AND r.name NOT IN ('admin', 'medico', 'farmacia', 'enfermagem'))
      OR
      (rp.module = 'revisao_farmaceutica'
       AND r.name NOT IN ('admin', 'farmacia'))
    )
      AND (rp.can_view OR rp.can_create OR rp.can_edit OR rp.can_delete OR rp.can_export)
  ) THEN
    RAISE EXCEPTION 'M20 role matrix is broader than the prescription/review surfaces';
  END IF;

  SELECT COUNT(*) INTO v_trigger_count
  FROM pg_trigger t
  WHERE NOT t.tgisinternal
    AND t.tgname IN (
      'trg_m20_guard_prescription',
      'trg_m20_guard_item',
      'trg_m20_safety_append_only',
      'trg_m20_review_append_only',
      'trg_m20_version_append_only'
    );
  IF v_trigger_count <> 5 THEN
    RAISE EXCEPTION 'M20 immutability triggers incomplete: %', v_trigger_count;
  END IF;

  IF has_table_privilege('authenticated', 'public.electronic_prescriptions', 'INSERT')
     OR has_table_privilege('authenticated', 'public.electronic_prescriptions', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.electronic_prescriptions', 'DELETE')
     OR has_table_privilege('app_prontomedic', 'public.electronic_prescription_items', 'INSERT')
     OR has_table_privilege('app_prontomedic', 'public.prescription_safety_events', 'UPDATE')
     OR has_table_privilege('app_prontomedic', 'public.electronic_prescription_versions', 'DELETE') THEN
    RAISE EXCEPTION 'M20 application roles can mutate tables directly';
  END IF;

  IF has_function_privilege('anon', 'public.m20_create_prescription_secure(integer,uuid,bigint,bigint,bigint,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.m20_transition_prescription_secure(uuid,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'private.m20_create_prescription_impl(integer,uuid,bigint,bigint,bigint,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'M20 anonymous execution grant detected';
  END IF;

  IF has_function_privilege('authenticated', 'private.m20_append_version(uuid,text,text)', 'EXECUTE')
     OR has_function_privilege('app_prontomedic', 'private.m20_append_version(uuid,text,text)', 'EXECUTE')
     OR has_function_privilege(
       'authenticated',
       'private.m20_create_prescription_impl(integer,uuid,bigint,bigint,bigint,text,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'M20 immutable history helper is callable by application roles';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'prontomedic_rpc_owner'
      AND NOT rolcanlogin
      AND rolbypassrls
      AND NOT rolsuper
  ) THEN
    RAISE EXCEPTION 'M20 technical owner role is not hardened';
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
    RAISE EXCEPTION 'M20 deployment ledger is mutable by an application role';
  END IF;

  IF pg_get_function_arguments(
    'public.m20_transition_prescription_secure(uuid,text,text)'::regprocedure
  ) ~* 'signature|signed_at|signed_by|company_id' THEN
    RAISE EXCEPTION 'M20 client can forge server signature or tenant context';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_status_constraint
  FROM pg_constraint
  WHERE conrelid = 'public.electronic_prescriptions'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%draft%'
    AND pg_get_constraintdef(oid) LIKE '%expired%'
  LIMIT 1;
  IF v_status_constraint IS NULL
     OR v_status_constraint NOT LIKE '%validated%'
     OR v_status_constraint NOT LIKE '%signed%'
     OR v_status_constraint NOT LIKE '%active%'
     OR v_status_constraint NOT LIKE '%suspended%'
     OR v_status_constraint NOT LIKE '%cancelled%'
     OR v_status_constraint NOT LIKE '%completed%' THEN
    RAISE EXCEPTION 'M20 lifecycle states are incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'electronic_prescriptions'
      AND column_name = 'encounter_id'
      AND is_nullable = 'YES'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'electronic_prescriptions'
      AND column_name = 'medical_record_id'
      AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'M20 optional M17/M18 references are missing';
  END IF;
END
$$;

INSERT INTO public.companies (id, name, cnpj, lg_ativo)
VALUES
  ('00000000-0000-4000-8000-000000000201', 'M20 Tenant A', '00000000000201', TRUE),
  ('00000000-0000-4000-8000-000000000202', 'M20 Tenant B', '00000000000202', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.units (id, company_id, cd_codigo, ds_nome, lg_principal, lg_ativo)
VALUES
  (20001, '00000000-0000-4000-8000-000000000201', 'M20A', 'M20 Unit A', TRUE, TRUE),
  (20002, '00000000-0000-4000-8000-000000000202', 'M20B', 'M20 Unit B', TRUE, TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at)
VALUES
  ('00000000-0000-4000-8000-000000002001', 'm20-admin-a@example.invalid', 'synthetic', NOW()),
  ('00000000-0000-4000-8000-000000002002', 'm20-admin-b@example.invalid', 'synthetic', NOW()),
  ('00000000-0000-4000-8000-000000002003', 'm20-reception-a@example.invalid', 'synthetic', NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_profiles (
  id, user_id, full_name, email, role_name, company_id, primary_unit_id, lg_ativo
)
VALUES
  ('00000000-0000-4000-8000-000000002001', '00000000-0000-4000-8000-000000002001', 'M20 Admin A', 'm20-admin-a@example.invalid', 'admin', '00000000-0000-4000-8000-000000000201', 20001, TRUE),
  ('00000000-0000-4000-8000-000000002002', '00000000-0000-4000-8000-000000002002', 'M20 Admin B', 'm20-admin-b@example.invalid', 'admin', '00000000-0000-4000-8000-000000000202', 20002, TRUE),
  ('00000000-0000-4000-8000-000000002003', '00000000-0000-4000-8000-000000002003', 'M20 Reception A', 'm20-reception-a@example.invalid', 'recepcao', '00000000-0000-4000-8000-000000000201', 20001, TRUE)
ON CONFLICT (id) DO UPDATE
SET user_id = EXCLUDED.user_id,
    role_name = EXCLUDED.role_name,
    company_id = EXCLUDED.company_id,
    primary_unit_id = EXCLUDED.primary_unit_id,
    lg_ativo = TRUE;

INSERT INTO public.patients (id, company_id, full_name, cpf, lg_ativo)
VALUES
  (20001, '00000000-0000-4000-8000-000000000201', 'M20 Patient A', '00000000201', TRUE),
  (20002, '00000000-0000-4000-8000-000000000202', 'M20 Patient B', '00000000202', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.professionals (
  id, company_id, user_id, full_name, specialty, lg_ativo
)
VALUES
  (
    20001, '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000002003',
    'M20 Synthetic Prescriber A', 'Clinica', TRUE
  ),
  (
    20002, '00000000-0000-4000-8000-000000000202',
    '00000000-0000-4000-8000-000000002002',
    'M20 Doctor B', 'Clinica', TRUE
  )
ON CONFLICT (id) DO UPDATE
SET user_id = EXCLUDED.user_id,
    lg_ativo = TRUE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000002001';
SET LOCAL request.jwt.claim.role = 'authenticated';
SET LOCAL request.jwt.claim.company_id = '00000000-0000-4000-8000-000000000201';
SET LOCAL request.jwt.claims =
  '{"sub":"00000000-0000-4000-8000-000000002001","company_id":"00000000-0000-4000-8000-000000000201","role":"authenticated"}';

CREATE TEMP TABLE m20_created AS
SELECT *
FROM public.m20_create_prescription_secure(
  20001, NULL, 20001, 20001, NULL,
  'Clinical indication M20', 'Synthetic contract'
);

DO $behavior$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.electronic_prescriptions
  WHERE company_id = '00000000-0000-4000-8000-000000000201';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'M20 authenticated create/read failed: %', v_count;
  END IF;
END
$behavior$;

SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000002002';
SET LOCAL request.jwt.claim.company_id = '00000000-0000-4000-8000-000000000202';
SET LOCAL request.jwt.claims =
  '{"sub":"00000000-0000-4000-8000-000000002002","company_id":"00000000-0000-4000-8000-000000000202","role":"authenticated"}';

DO $cross_tenant$
DECLARE
  v_count INTEGER;
  v_blocked BOOLEAN := FALSE;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.electronic_prescriptions
  WHERE company_id = '00000000-0000-4000-8000-000000000201';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'M20 cross-tenant prescription is visible';
  END IF;

  BEGIN
    PERFORM public.m20_create_prescription_secure(
      20001, NULL, 20001, 20001, NULL, 'Cross tenant', NULL
    );
  EXCEPTION WHEN OTHERS THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'M20 cross-tenant creation was not denied';
  END IF;
END
$cross_tenant$;

SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000002003';
SET LOCAL request.jwt.claim.company_id = '00000000-0000-4000-8000-000000000201';
SET LOCAL request.jwt.claims =
  '{"sub":"00000000-0000-4000-8000-000000002003","company_id":"00000000-0000-4000-8000-000000000201","role":"authenticated"}';

DO $role_denial$
DECLARE
  v_blocked BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.m20_create_prescription_secure(
      20001, NULL, 20001, 20001, NULL, 'Role denial', NULL
    );
  EXCEPTION WHEN OTHERS THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'M20 reception role was allowed to prescribe';
  END IF;
END
$role_denial$;

RESET ROLE;

INSERT INTO public.user_permissions (
  user_id, company_id, permission_id, effect, reason
)
SELECT
  '00000000-0000-4000-8000-000000002003',
  '00000000-0000-4000-8000-000000000201',
  p.id,
  'grant',
  'M20 synthetic grant override'
FROM public.permissions p
WHERE p.module = 'prescricao_eletronica'
  AND p.action = 'create';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000002003';
SET LOCAL request.jwt.claim.company_id = '00000000-0000-4000-8000-000000000201';
SET LOCAL request.jwt.claims =
  '{"sub":"00000000-0000-4000-8000-000000002003","company_id":"00000000-0000-4000-8000-000000000201","role":"authenticated"}';

SELECT *
FROM public.m20_create_prescription_secure(
  20001, NULL, 20001, 20001, NULL,
  'Explicit grant override M20', 'Synthetic override'
);

RESET ROLE;

DO $override_grant$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.electronic_prescriptions
    WHERE company_id = '00000000-0000-4000-8000-000000000201'
      AND created_by = '00000000-0000-4000-8000-000000002003'
  ) THEN
    RAISE EXCEPTION 'M20 explicit grant override did not reach the RPC';
  END IF;
END
$override_grant$;

SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'electronic_prescriptions',
    'electronic_prescription_items',
    'prescription_safety_events',
    'pharmaceutical_reviews',
    'electronic_prescription_versions'
  )
ORDER BY tablename, policyname;

SELECT 'M20_ELECTRONIC_PRESCRIPTIONS_CONTRACT_PASS' AS result;

ROLLBACK;
