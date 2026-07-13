-- Runtime scheduling/reception tenant gate for an ephemeral PostgreSQL database only.
-- Never run against DataSIGH or production.

BEGIN;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $f1$
  SELECT NULLIF(current_setting('app.test_user_id', true), '')::uuid
$f1$;

DO $catalog_gate$
DECLARE
  v_relation TEXT;
  v_rel RECORD;
  v_proc RECORD;
  v_operational_rpc_names CONSTANT TEXT[] := ARRAY[
    'create_waitlist_entry_secure', 'close_waitlist_entry_secure',
    'convert_waitlist_to_appointment_secure', 'create_schedule_block_secure',
    'cancel_schedule_block_secure', 'get_professional_available_slots',
    'update_reception_authorization_secure', 'update_reception_eligibility_secure'
  ];
BEGIN
  FOREACH v_relation IN ARRAY ARRAY[
    'scheduling_waitlist', 'scheduling_blocks',
    'insurance_authorizations', 'insurance_eligibility_checks'
  ] LOOP
    SELECT c.relrowsecurity, c.relforcerowsecurity INTO v_rel
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = v_relation AND c.relkind = 'r';

    IF NOT FOUND OR NOT v_rel.relrowsecurity OR NOT v_rel.relforcerowsecurity THEN
      RAISE EXCEPTION 'scheduling/reception gate: public.% must ENABLE and FORCE RLS', v_relation;
    END IF;
    IF NOT has_table_privilege('authenticated', format('public.%I', v_relation), 'SELECT') THEN
      RAISE EXCEPTION 'scheduling/reception gate: authenticated lacks SELECT on public.%', v_relation;
    END IF;
    IF has_table_privilege('anon', format('public.%I', v_relation), 'SELECT,INSERT,UPDATE,DELETE')
       OR has_table_privilege('authenticated', format('public.%I', v_relation), 'INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'scheduling/reception gate: unsafe ACL remains on public.%', v_relation;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = v_relation AND cmd <> 'SELECT'
    ) THEN
      RAISE EXCEPTION 'scheduling/reception gate: write policy remains on public.%', v_relation;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = v_relation
        AND cmd = 'SELECT' AND roles = ARRAY['authenticated']::name[]
        AND qual ~ 'get_my_company_id'
    ) THEN
      RAISE EXCEPTION 'scheduling/reception gate: tenant SELECT policy missing on public.%', v_relation;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = format('public.%I', v_relation)::regclass
        AND tgname = 'enforce_operational_tenant_integrity'
        AND NOT tgisinternal
    ) THEN
      RAISE EXCEPTION 'scheduling/reception gate: tenant integrity trigger missing on public.%', v_relation;
    END IF;
  END LOOP;

  FOREACH v_relation IN ARRAY ARRAY[
    'reception_authorizations', 'reception_eligibility_checks'
  ] LOOP
    IF NOT has_table_privilege('authenticated', format('public.%I', v_relation), 'SELECT')
       OR has_table_privilege('anon', format('public.%I', v_relation), 'SELECT,INSERT,UPDATE,DELETE')
       OR has_table_privilege('authenticated', format('public.%I', v_relation), 'INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'scheduling/reception gate: unsafe view ACL on public.%', v_relation;
    END IF;
    IF COALESCE((SELECT reloptions @> ARRAY['security_invoker=true']
                 FROM pg_class WHERE oid = format('public.%I', v_relation)::regclass), false) IS NOT TRUE THEN
      RAISE EXCEPTION 'scheduling/reception gate: public.% is not security_invoker', v_relation;
    END IF;
  END LOOP;

  FOR v_proc IN
    SELECT p.oid, p.oid::regprocedure AS identity
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY(v_operational_rpc_names)
  LOOP
    IF has_function_privilege('anon', v_proc.oid, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_proc.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'scheduling/reception gate: operational RPC ACL is invalid: %', v_proc.identity;
    END IF;
  END LOOP;

  IF COALESCE((
    SELECT p.prosecdef
    FROM pg_proc p
    WHERE p.oid = 'public.get_professional_available_slots(bigint,date,integer,integer)'::regprocedure
  ), TRUE) THEN
    RAISE EXCEPTION 'scheduling/reception gate: availability RPC must be SECURITY INVOKER';
  END IF;
END
$catalog_gate$;

INSERT INTO public.companies (id, name) VALUES
  ('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Scheduling Tenant A'),
  ('cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Scheduling Tenant B');

INSERT INTO auth.users (id) VALUES
  ('c1111111-1111-4111-8111-111111111111'),
  ('c2222222-2222-4222-8222-222222222222');

INSERT INTO public.user_profiles (id, full_name, email, role_name, company_id) VALUES
  ('c1111111-1111-4111-8111-111111111111', 'Reception A', 'reception-a@test.local', 'recepcao', 'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('c2222222-2222-4222-8222-222222222222', 'Reception B', 'reception-b@test.local', 'recepcao', 'cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

INSERT INTO public.patients (id, company_id, full_name)
OVERRIDING SYSTEM VALUE VALUES
  (941001, 'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Scheduling Patient A'),
  (941002, 'cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Scheduling Patient B');

INSERT INTO public.professionals (id, company_id, full_name)
OVERRIDING SYSTEM VALUE VALUES
  (942001, 'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Scheduling Professional A'),
  (942002, 'cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Scheduling Professional B');

INSERT INTO public.professional_schedules (
  company_id, professional_id, day_of_week, slot1_start, slot1_end, slot1_duration, lg_habilitado
) VALUES (
  'cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 942002, 'quarta-feira', 900, 1000, 30, TRUE
);

INSERT INTO public.scheduling_waitlist (id, company_id, patient_id, professional_id, reason) VALUES
  (943001, 'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 941001, 942001, 'Tenant A waitlist'),
  (943002, 'cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 941002, 942002, 'Tenant B waitlist');
INSERT INTO public.scheduling_blocks (id, company_id, professional_id, starts_at, ends_at, reason) VALUES
  (944001, 'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 942001, '2026-07-21 09:00:00+00', '2026-07-21 10:00:00+00', 'Tenant A block'),
  (944002, 'cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 942002, '2026-07-21 10:00:00+00', '2026-07-21 11:00:00+00', 'Tenant B block');
INSERT INTO public.insurance_authorizations (id, company_id, patient_id, status) VALUES
  ('ca111111-1111-4111-8111-111111111111', 'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 941001, 'pendente'),
  ('cb222222-2222-4222-8222-222222222222', 'cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 941002, 'pendente');
INSERT INTO public.insurance_eligibility_checks (id, company_id, patient_id, status) VALUES
  ('ca333333-3333-4333-8333-333333333333', 'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 941001, 'pendente'),
  ('cb444444-4444-4444-8444-444444444444', 'cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 941002, 'pendente');

SET LOCAL ROLE anon;
DO $anon_gate$
DECLARE
  v_denied BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM 1 FROM public.reception_authorizations LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'scheduling/reception gate: anonymous view read was accepted';
  END IF;
END
$anon_gate$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL app.test_user_id = 'c1111111-1111-4111-8111-111111111111';

DO $tenant_behavior$
DECLARE
  v_count INTEGER;
  v_denied BOOLEAN := false;
BEGIN
  SELECT count(*) INTO v_count FROM public.scheduling_waitlist;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'scheduling/reception gate: tenant A sees % waitlist rows, expected 1', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM public.scheduling_blocks;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'scheduling/reception gate: tenant A sees % block rows, expected 1', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM public.reception_authorizations;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'scheduling/reception gate: tenant A sees % authorization rows, expected 1', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM public.reception_eligibility_checks;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'scheduling/reception gate: tenant A sees % eligibility rows, expected 1', v_count;
  END IF;

  BEGIN
    INSERT INTO public.scheduling_waitlist (company_id, patient_id, reason)
    VALUES ('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 941001, 'Direct write must fail');
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'scheduling/reception gate: authenticated direct table write was accepted';
  END IF;

  v_denied := false;
  BEGIN
    UPDATE public.reception_authorizations SET status = 'autorizada';
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'scheduling/reception gate: authenticated direct view write was accepted';
  END IF;
END
$tenant_behavior$;

DO $cross_tenant_rpc_gate$
DECLARE
  v_denied BOOLEAN;
  v_count INTEGER;
BEGIN
  v_denied := false;
  BEGIN
    PERFORM public.create_waitlist_entry_secure(941002, 'Cross tenant', 942002);
  EXCEPTION WHEN OTHERS THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'scheduling/reception gate: cross-tenant waitlist creation was accepted'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.close_waitlist_entry_secure(943002, 'cancelled', 'Cross tenant');
  EXCEPTION WHEN OTHERS THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'scheduling/reception gate: cross-tenant waitlist close was accepted'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.convert_waitlist_to_appointment_secure(943002, DATE '2026-07-22', TIME '09:00', TIME '09:30');
  EXCEPTION WHEN OTHERS THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'scheduling/reception gate: cross-tenant waitlist conversion was accepted'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.create_schedule_block_secure(
      '2026-07-22 09:00:00+00', '2026-07-22 10:00:00+00',
      'Cross tenant', 942002, NULL, 'operational'
    );
  EXCEPTION WHEN OTHERS THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'scheduling/reception gate: cross-tenant block creation was accepted'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.cancel_schedule_block_secure(944002);
  EXCEPTION WHEN OTHERS THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'scheduling/reception gate: cross-tenant block cancellation was accepted'; END IF;

  SELECT count(*) INTO v_count
  FROM public.get_professional_available_slots(942002, DATE '2026-07-22', 30, NULL);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'scheduling/reception gate: availability leaked % cross-tenant slots', v_count;
  END IF;

  IF to_regprocedure('public.update_reception_authorization_secure(uuid,text,text,text,text,date,integer,text)') IS NOT NULL THEN
    v_denied := false;
    BEGIN
      EXECUTE 'SELECT public.update_reception_authorization_secure($1,$2,$3,$4,$5,$6,$7,$8)'
      USING 'cb222222-2222-4222-8222-222222222222'::UUID, 'cancelada', NULL::TEXT,
            NULL::TEXT, NULL::TEXT, NULL::DATE, NULL::INTEGER, 'Cross tenant';
    EXCEPTION WHEN OTHERS THEN v_denied := true;
    END;
    IF NOT v_denied THEN RAISE EXCEPTION 'scheduling/reception gate: cross-tenant authorization update was accepted'; END IF;
  END IF;

  IF to_regprocedure('public.update_reception_eligibility_secure(uuid,text,text,text)') IS NOT NULL THEN
    v_denied := false;
    BEGIN
      EXECUTE 'SELECT public.update_reception_eligibility_secure($1,$2,$3,$4)'
      USING 'cb444444-4444-4444-8444-444444444444'::UUID, 'elegivel', NULL::TEXT, 'Cross tenant';
    EXCEPTION WHEN OTHERS THEN v_denied := true;
    END;
    IF NOT v_denied THEN RAISE EXCEPTION 'scheduling/reception gate: cross-tenant eligibility update was accepted'; END IF;
  END IF;
END
$cross_tenant_rpc_gate$;

RESET ROLE;
ROLLBACK;

SELECT 'F1_RUNTIME_SCHEDULING_RECEPTION_TENANT_GATE=PASS' AS result;

