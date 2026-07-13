BEGIN;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::UUID
$$;

CREATE TEMP TABLE gate_state (
  key TEXT PRIMARY KEY,
  value_text TEXT,
  value_bigint BIGINT
);
GRANT ALL ON gate_state TO anon, authenticated;

INSERT INTO auth.users(id) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
ON CONFLICT DO NOTHING;

INSERT INTO public.companies(id, name, lg_ativo) VALUES
  ('11111111-1111-4111-8111-111111111111', 'Gate Tenant A', TRUE),
  ('22222222-2222-4222-8222-222222222222', 'Gate Tenant B', TRUE),
  ('33333333-3333-4333-8333-333333333333', 'Gate Inactive', FALSE)
ON CONFLICT (id) DO UPDATE SET lg_ativo = EXCLUDED.lg_ativo;

INSERT INTO public.user_profiles(id, full_name, role_name, company_id, lg_ativo) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Admin A', 'admin', '11111111-1111-4111-8111-111111111111', TRUE),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Recepcao B', 'recepcao', '22222222-2222-4222-8222-222222222222', TRUE)
ON CONFLICT (id) DO UPDATE SET
  role_name = EXCLUDED.role_name, company_id = EXCLUDED.company_id, lg_ativo = TRUE;

INSERT INTO public.patients(id, company_id, full_name, email, lg_ativo) VALUES
  (910001, '11111111-1111-4111-8111-111111111111', 'Paciente A', 'paciente-a@gate.test', TRUE),
  (920001, '22222222-2222-4222-8222-222222222222', 'Paciente B', 'paciente-b@gate.test', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.professionals(id, company_id, full_name, lg_ativo) VALUES
  (910001, '11111111-1111-4111-8111-111111111111', 'Profissional A', TRUE),
  (920001, '22222222-2222-4222-8222-222222222222', 'Profissional B', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.appointments(
  id, company_id, patient_id, professional_id, appointment_date, start_time, status
) VALUES
  (930001, '11111111-1111-4111-8111-111111111111', 910001, 910001, CURRENT_DATE, '09:00', 'agendado'),
  (930002, '22222222-2222-4222-8222-222222222222', 920001, 920001, CURRENT_DATE, '10:00', 'agendado')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.notification_templates(
  id, company_id, code, channel, subject, body, language, version, is_active
) VALUES
  ('10000000-0000-4000-8000-000000000001', NULL, 'GATE_EMAIL', 'EMAIL', 'Gate', 'Mensagem {{nome}}', 'pt-BR', 1, TRUE),
  ('20000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'PRIVATE_B', 'EMAIL', 'B', 'Privada B', 'pt-BR', 1, TRUE)
ON CONFLICT (id) DO NOTHING;

-- Public registration is allowed only for an active company.
SET LOCAL ROLE anon;
INSERT INTO gate_state(key, value_text)
SELECT 'pre_a', id::TEXT || '|' || token
FROM public.create_pre_cadastro(
  '11111111-1111-4111-8111-111111111111', 'Pre Cadastro A', 'pre-a@gate.test',
  '+5521999999999', DATE '1990-01-01', 'F', '24000-000', 'Rua A', '10', NULL,
  'Centro', 'Niteroi', 'RJ', 'v1', repeat('a', 64), '127.0.0.1', 'runtime-gate'
);

DO $$
BEGIN
  BEGIN
    PERFORM * FROM public.create_pre_cadastro(
      '33333333-3333-4333-8333-333333333333', 'Empresa Inativa', 'inactive@gate.test',
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      'v1', repeat('b', 64), NULL, 'runtime-gate'
    );
    RAISE EXCEPTION 'inactive company registration unexpectedly allowed';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
END;
$$;
RESET ROLE;

-- An authenticated actor cannot assert another tenant.
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', TRUE);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM * FROM public.create_pre_cadastro(
      '22222222-2222-4222-8222-222222222222', 'Cross Tenant', 'cross@gate.test',
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      'v1', repeat('c', 64), NULL, 'runtime-gate'
    );
    RAISE EXCEPTION 'cross-tenant registration unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT count(*) INTO v_count FROM public.pre_cadastros_pendentes;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'tenant A pending view expected 1 row, got %', v_count;
  END IF;
END;
$$;
RESET ROLE;

-- Public token preview is read-only and confirmation is idempotent.
SELECT set_config('request.jwt.claim.sub', '', TRUE);
SET LOCAL ROLE anon;
DO $$
DECLARE
  v_token TEXT := split_part((SELECT value_text FROM gate_state WHERE key = 'pre_a'), '|', 2);
  v_status TEXT;
BEGIN
  SELECT p.status INTO v_status FROM public.pre_confirm_pre_cadastro(v_token) p;
  IF v_status <> 'PENDENTE' THEN RAISE EXCEPTION 'preview changed or lost status'; END IF;
  SELECT c.status INTO v_status FROM public.confirm_pre_cadastro(v_token) c;
  IF v_status <> 'CONFIRMADO' THEN RAISE EXCEPTION 'confirmation failed'; END IF;
  SELECT c.status INTO v_status FROM public.confirm_pre_cadastro(v_token) c;
  IF v_status <> 'CONFIRMADO' THEN RAISE EXCEPTION 'confirmation is not idempotent'; END IF;
END;
$$;
RESET ROLE;

-- Tenant A promotes its own pre-registration and cannot touch tenant B.
INSERT INTO public.pre_cadastro(
  id, company_id, full_name, email, email_hash, versao_termo, texto_termo_hash,
  token_confirmacao, dt_token_exp, lg_confirmado, status
) VALUES (
  '22000000-0000-4000-8000-000000000022', '22222222-2222-4222-8222-222222222222',
  'Pre Cadastro B', 'pre-b@gate.test', repeat('d', 64), 'v1', repeat('e', 64),
  repeat('f', 64), NOW() + INTERVAL '1 day', TRUE, 'CONFIRMADO'
) ON CONFLICT (id) DO NOTHING;

SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', TRUE);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_pre_id UUID := split_part((SELECT value_text FROM gate_state WHERE key = 'pre_a'), '|', 1)::UUID;
  v_first BIGINT;
  v_second BIGINT;
BEGIN
  v_first := public.promote_pre_cadastro(v_pre_id);
  v_second := public.promote_pre_cadastro(v_pre_id);
  IF v_first IS NULL OR v_first <> v_second THEN RAISE EXCEPTION 'promotion is not idempotent'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.patients p WHERE p.id = v_first AND p.company_id = '11111111-1111-4111-8111-111111111111') THEN
    RAISE EXCEPTION 'promotion created patient outside tenant A';
  END IF;
  BEGIN
    PERFORM public.cancel_pre_cadastro('22000000-0000-4000-8000-000000000022', 'cross tenant');
    RAISE EXCEPTION 'cross-tenant cancel unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
RESET ROLE;

-- Queue and preference operations derive tenant from the authenticated session.
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', TRUE);
SET LOCAL ROLE authenticated;
INSERT INTO gate_state(key, value_text)
SELECT 'notification_a', public.queue_notification(
  '11111111-1111-4111-8111-111111111111', 'EMAIL', 'PATIENT', 910001,
  'Paciente A', 'GATE_EMAIL', 'paciente-a@gate.test', NULL, NULL,
  jsonb_build_object('nome', 'Paciente A'), 930001, NULL, NOW(), FALSE
)::TEXT;

DO $$
BEGIN
  BEGIN
    PERFORM public.queue_notification(
      '22222222-2222-4222-8222-222222222222', 'EMAIL', 'PATIENT', 920001,
      'Paciente B', 'GATE_EMAIL', 'paciente-b@gate.test', NULL, NULL,
      '{}'::JSONB, 930002, NULL, NOW(), FALSE
    );
    RAISE EXCEPTION 'cross-tenant queue unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.notifications(
      company_id, recipient_type, recipient_id, channel, body
    ) VALUES (
      '11111111-1111-4111-8111-111111111111', 'PATIENT', 910001, 'EMAIL', 'direct'
    );
    RAISE EXCEPTION 'direct browser insert unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF NOT public.set_my_notification_preference('EMAIL', FALSE, 'gate opt-out') THEN
    RAISE EXCEPTION 'staff preference RPC failed';
  END IF;
  IF NOT public.set_notification_preference('PATIENT', 910001, 'EMAIL', FALSE, 'patient opt-out') THEN
    RAISE EXCEPTION 'patient preference RPC failed';
  END IF;
  IF NOT public.mark_my_notification_read((SELECT value_text::UUID FROM gate_state WHERE key = 'notification_a')) THEN
    RAISE EXCEPTION 'mark read RPC failed';
  END IF;
END;
$$;

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT count(*) INTO v_count FROM public.v_notifications_stats;
  IF v_count <> 1 THEN RAISE EXCEPTION 'tenant A stats expected 1 group, got %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.v_my_notifications WHERE is_read;
  IF v_count <> 1 THEN RAISE EXCEPTION 'tenant A read model expected 1 read row, got %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.get_my_notification_preferences();
  IF v_count <> 1 THEN RAISE EXCEPTION 'tenant A staff preferences expected 1 row, got %', v_count; END IF;
  IF NOT public.retry_notification((SELECT value_text::UUID FROM gate_state WHERE key = 'notification_a')) THEN
    RAISE EXCEPTION 'admin retry RPC failed';
  END IF;
  v_count := public.cancel_pending_appointment_notifications(930001);
  IF v_count <> 1 THEN RAISE EXCEPTION 'expected one cancelled reminder, got %', v_count; END IF;
END;
$$;
RESET ROLE;

-- Tenant B cannot observe A rows or preferences and can manage only its own pre-registration.
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', TRUE);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT count(*) INTO v_count FROM public.notifications;
  IF v_count <> 0 THEN RAISE EXCEPTION 'tenant B observed tenant A notifications'; END IF;
  SELECT count(*) INTO v_count FROM public.notification_preferences;
  IF v_count <> 0 THEN RAISE EXCEPTION 'tenant B observed tenant A preferences'; END IF;
  SELECT count(*) INTO v_count FROM public.v_notifications_stats;
  IF v_count <> 0 THEN RAISE EXCEPTION 'tenant B observed tenant A stats'; END IF;
  SELECT count(*) INTO v_count FROM public.v_my_notifications;
  IF v_count <> 0 THEN RAISE EXCEPTION 'tenant B observed tenant A read model'; END IF;
  IF NOT public.cancel_pre_cadastro('22000000-0000-4000-8000-000000000022', 'cancelamento local') THEN
    RAISE EXCEPTION 'tenant B could not cancel own pre-registration';
  END IF;
END;
$$;
RESET ROLE;

-- Catalog checks: FORCE RLS, invoker views and no PUBLIC/anon privileged execution.
DO $$
DECLARE
  v_bad INTEGER;
BEGIN
  SELECT count(*) INTO v_bad
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('notification_templates', 'notifications', 'notification_preferences',
       'notification_logs', 'notification_reads', 'pre_cadastro')
     AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity);
  IF v_bad <> 0 THEN RAISE EXCEPTION 'RLS/FORCE RLS missing on % tables', v_bad; END IF;

  SELECT count(*) INTO v_bad
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('v_notifications_stats', 'v_my_notifications', 'pre_cadastros_pendentes')
     AND NOT coalesce(c.reloptions, ARRAY[]::TEXT[]) @> ARRAY['security_invoker=true'];
  IF v_bad <> 0 THEN RAISE EXCEPTION 'security_invoker missing on % views', v_bad; END IF;

  SELECT count(*) INTO v_bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace,
         LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
   WHERE n.nspname = 'public'
     AND p.proname IN ('queue_notification', 'set_my_notification_preference',
       'set_notification_preference', 'cancel_pending_appointment_notifications',
       'retry_notification', 'renew_pre_cadastro_confirmation',
       'promote_pre_cadastro', 'cancel_pre_cadastro')
     AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE';
  IF v_bad <> 0 THEN RAISE EXCEPTION 'PUBLIC still executes % privileged functions', v_bad; END IF;

  SELECT count(*) INTO v_bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('queue_notification', 'set_my_notification_preference',
       'get_my_notification_preferences', 'mark_my_notification_read',
       'mark_all_my_notifications_read', 'set_notification_preference',
       'cancel_pending_appointment_notifications', 'retry_notification',
       'renew_pre_cadastro_confirmation', 'promote_pre_cadastro', 'cancel_pre_cadastro')
     AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF v_bad <> 0 THEN RAISE EXCEPTION 'anon still executes % privileged functions', v_bad; END IF;

  SELECT count(*) INTO v_bad
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_roles r ON r.oid = p.proowner
   WHERE n.nspname = 'public' AND p.prosecdef
     AND p.proname IN ('queue_notification', 'set_my_notification_preference',
       'get_my_notification_preferences', 'mark_my_notification_read',
       'mark_all_my_notifications_read', 'set_notification_preference',
       'cancel_pending_appointment_notifications', 'retry_notification',
       'create_pre_cadastro', 'pre_confirm_pre_cadastro', 'confirm_pre_cadastro',
       'renew_pre_cadastro_confirmation', 'promote_pre_cadastro', 'cancel_pre_cadastro')
     AND NOT (r.rolsuper OR r.rolbypassrls);
  IF v_bad <> 0 THEN RAISE EXCEPTION '% definers cannot pass FORCE RLS', v_bad; END IF;

  SELECT count(*) INTO v_bad FROM pg_constraint
   WHERE conname IN ('notifications_recipient_identity_ck',
     'notification_preferences_recipient_identity_ck', 'notifications_recipient_user_fk',
     'notification_preferences_recipient_user_fk', 'notification_logs_company_fk')
     AND NOT convalidated;
  IF v_bad <> 0 THEN RAISE EXCEPTION '% canonical constraints remain unvalidated', v_bad; END IF;

  IF NOT has_sequence_privilege('service_role', 'public.notification_logs_id_seq', 'USAGE') THEN
    RAISE EXCEPTION 'service_role lacks notification log sequence privilege';
  END IF;

  SELECT count(*) INTO v_bad FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('queue_notification', 'set_my_notification_preference',
       'set_notification_preference', 'cancel_pending_appointment_notifications',
       'retry_notification', 'create_pre_cadastro', 'renew_pre_cadastro_confirmation',
       'pre_confirm_pre_cadastro', 'confirm_pre_cadastro', 'promote_pre_cadastro', 'cancel_pre_cadastro')
     AND pg_get_functiondef(p.oid) ~* '(datasigh|dblink|postgres_fdw)';
  IF v_bad <> 0 THEN RAISE EXCEPTION 'forbidden external source reference found'; END IF;
END;
$$;

ROLLBACK;

