\set ON_ERROR_STOP on
BEGIN;

DO $plaintext_removed$
BEGIN
  IF EXISTS (SELECT 1 FROM public.pre_cadastro WHERE token_confirmacao IS NOT NULL) THEN
    RAISE EXCEPTION 'contract nao removeu tokens plaintext';
  END IF;
END
$plaintext_removed$;

INSERT INTO public.companies (id, name, lg_ativo)
VALUES ('10000000-0000-4000-8000-000000000001', 'Empresa QA Pre Cadastro', TRUE)
ON CONFLICT (id) DO UPDATE SET lg_ativo = EXCLUDED.lg_ativo;

DO $acl$
DECLARE
  r TEXT;
  f RECORD;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_any_column_privilege(r, 'public.pre_cadastro', 'UPDATE')
      OR has_any_column_privilege(r, 'public.pre_cadastro', 'INSERT') THEN
      RAISE EXCEPTION '% ainda escreve diretamente em pre_cadastro', r;
    END IF;
    FOR f IN SELECT oid FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace
        AND proname IN ('pre_cadastro_edge_request', 'pre_cadastro_edge_confirm', 'pre_cadastro_edge_status',
          'pre_cadastro_edge_resend')
    LOOP
      IF has_function_privilege(r, f.oid, 'EXECUTE') THEN
        RAISE EXCEPTION '% ainda executa funcao restrita %', r, f.oid;
      END IF;
    END LOOP;
  END LOOP;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
    AND tablename = 'pre_cadastro') IS DISTINCT FROM 2::bigint
    OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'pre_cadastro' AND policyname NOT IN
        ('pre_cadastro_staff_select', 'pre_cadastro_admin_delete')) THEN
    RAISE EXCEPTION 'policies historicas conflitantes';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class
    WHERE oid = 'public.pre_cadastros_pendentes'::regclass
      AND reloptions @> ARRAY['security_invoker=true']) THEN
    RAISE EXCEPTION 'view nao respeita RLS do invocador';
  END IF;
  FOR f IN SELECT oid FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname IN ('create_pre_cadastro', 'confirm_pre_cadastro')
  LOOP
    IF has_function_privilege('anon', f.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', f.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'contrato legado ainda executavel %', f.oid::regprocedure;
    END IF;
  END LOOP;
  IF has_table_privilege('anon', 'public.pre_cadastro', 'INSERT') THEN
    RAISE EXCEPTION 'anon ainda insere diretamente em pre_cadastro';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.pre_cadastro_edge_status(character)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role sem contrato Edge';
  END IF;
END
$acl$;

SET LOCAL ROLE service_role;
SELECT * FROM public.pre_cadastro_edge_request(
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  repeat('a', 64)::CHAR(64),
  'Paciente QA', 'paciente.qa@example.test', '(11) 99999-9999', NULL,
  '52998224725', DATE '1990-05-12', 'F', '01310100', 'Avenida Paulista',
  '1000', NULL, 'Bela Vista', 'Sao Paulo', 'SP', NULL,
  'v1.0-qa', repeat('b', 64)::CHAR(64), '127.0.0.1', 'postgres-contract-test'
);
RESET ROLE;

DO $stored$
DECLARE
  v_plain TEXT;
  v_hash TEXT;
BEGIN
  SELECT token_confirmacao, token_confirmacao_hash
  INTO v_plain, v_hash
  FROM public.pre_cadastro
  WHERE company_id = '10000000-0000-4000-8000-000000000001'
    AND email = 'paciente.qa@example.test';
  IF NOT FOUND OR v_plain IS NOT NULL OR v_hash IS DISTINCT FROM repeat('a', 64) THEN
    RAISE EXCEPTION 'credencial de confirmacao armazenada incorretamente';
  END IF;
END
$stored$;

SET LOCAL ROLE service_role;
SELECT * FROM public.pre_cadastro_edge_confirm(repeat('a', 64)::CHAR(64));
SELECT * FROM public.pre_cadastro_edge_confirm(repeat('a', 64)::CHAR(64));
RESET ROLE;

DO $confirmed$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.pre_cadastro
    WHERE email = 'paciente.qa@example.test'
      AND status = 'CONFIRMADO'
      AND lg_confirmado IS TRUE
      AND token_confirmacao IS NULL
      AND token_confirmacao_hash = repeat('a', 64)
  ) THEN
    RAISE EXCEPTION 'confirmacao Edge nao foi persistida de forma idempotente';
  END IF;
END
$confirmed$;

-- Invoke the real RPC with stable synthetic data, never bypass its owner/ACL.
CREATE FUNCTION pg_temp.request_again(p_key UUID, p_hash TEXT, p_email TEXT)
RETURNS TABLE(r_should_send BOOLEAN, r_dt_exp TIMESTAMPTZ)
LANGUAGE sql SECURITY INVOKER AS $$
  SELECT * FROM public.pre_cadastro_edge_request(
    '10000000-0000-4000-8000-000000000001', p_key, p_hash::CHAR(64),
    'Paciente QA', p_email::VARCHAR, '(11) 99999-9999', NULL,
    '52998224725', DATE '1990-05-12', 'F', '01310100', 'Avenida Paulista',
    '1000', NULL, 'Bela Vista', 'Sao Paulo', 'SP', NULL,
    'v1.0-qa', repeat('b', 64)::CHAR(64), '127.0.0.1', 'postgres-contract-test'
  );
$$;

UPDATE public.pre_cadastro SET status = 'CANCELADO', motivo_cancelamento = 'Preservar',
  dt_token_exp = clock_timestamp() - interval '1 day'
WHERE company_id = '10000000-0000-4000-8000-000000000001'
  AND email = 'paciente.qa@example.test';
CREATE TEMP TABLE cancelled_snapshot AS SELECT * FROM public.pre_cadastro
WHERE company_id = '10000000-0000-4000-8000-000000000001'
  AND email = 'paciente.qa@example.test';

DO $$
DECLARE r RECORD;
BEGIN
  SELECT * INTO r FROM pg_temp.request_again(
    '20000000-0000-4000-8000-000000000002', repeat('c', 64), ' PACIENTE.QA@example.test ');
  IF NOT FOUND OR r.r_should_send IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'cancelado permite reenvio';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pre_cadastro_edge_confirm(repeat('f', 64)::CHAR(64))) THEN
    RAISE EXCEPTION 'token inexistente aceito';
  END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF EXISTS (SELECT * FROM cancelled_snapshot EXCEPT SELECT * FROM public.pre_cadastro)
    OR (SELECT count(*) FROM public.pre_cadastro
      WHERE company_id = '10000000-0000-4000-8000-000000000001'
        AND lower(trim(email)) = 'paciente.qa@example.test') IS DISTINCT FROM 1::bigint THEN
    RAISE EXCEPTION 'cancelamento alterado ou registro duplicado';
  END IF;
END $$;

SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    UPDATE public.pre_cadastro SET token_confirmacao_hash = repeat('d', 64);
    RAISE EXCEPTION 'UPDATE sensivel autorizado';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.pre_cadastro_edge_confirm(repeat('a', 64)::CHAR(64));
    RAISE EXCEPTION 'RPC privada autorizada';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

SET LOCAL ROLE service_role;
DO $$
DECLARE r RECORD;
BEGIN
  SELECT * INTO r FROM pg_temp.request_again(
    '20000000-0000-4000-8000-000000000003', repeat('d', 64), 'retry.qa@example.test');
  IF NOT FOUND OR r.r_should_send IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'criacao falhou'; END IF;
  SELECT * INTO r FROM pg_temp.request_again(
    '20000000-0000-4000-8000-000000000003', repeat('d', 64), ' RETRY.QA@example.test ');
  IF NOT FOUND OR r.r_should_send IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'retry falhou'; END IF;
  SELECT * INTO r FROM pg_temp.request_again(
    '20000000-0000-4000-8000-000000000003', repeat('e', 64), 'retry.qa@example.test');
  IF NOT FOUND OR r.r_should_send IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'hash divergente aceito'; END IF;
END $$;
RESET ROLE;
UPDATE public.pre_cadastro SET dt_token_exp = clock_timestamp()
WHERE company_id = '10000000-0000-4000-8000-000000000001' AND email = 'retry.qa@example.test';
SET LOCAL ROLE service_role;
DO $$
DECLARE r RECORD;
BEGIN
  SELECT * INTO r FROM public.pre_cadastro_edge_confirm(repeat('d', 64)::CHAR(64));
  IF NOT FOUND OR r.r_status IS DISTINCT FROM 'EXPIRADO' THEN
    RAISE EXCEPTION 'token expirado confirmado';
  END IF;
END $$;
RESET ROLE;

INSERT INTO public.companies (id, name, lg_ativo)
VALUES ('10000000-0000-4000-8000-000000000002', 'Empresa QA B Pre Cadastro', TRUE);
INSERT INTO public.roles (name, description, lg_ativo)
VALUES ('admin', 'Administrador', TRUE) ON CONFLICT (name) DO NOTHING;
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES ('30000000-0000-4000-8000-000000000001', 'admin.pre.qa@example.test',
  '{}'::jsonb, '{}'::jsonb, now(), now());
INSERT INTO public.user_profiles (id, full_name, email, role_name, company_id, lg_ativo)
VALUES ('30000000-0000-4000-8000-000000000001', 'Admin Pre QA', 'admin.pre.qa@example.test',
  'admin', '10000000-0000-4000-8000-000000000001', TRUE)
ON CONFLICT (id) DO UPDATE SET role_name = 'admin',
  company_id = EXCLUDED.company_id, lg_ativo = TRUE;
INSERT INTO public.application_devices (
  id, user_id, company_id, client_device_id, display_name, platform
) VALUES (
  '33000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '34000000-0000-4000-8000-000000000001', 'Dispositivo QA', 'test'
);
INSERT INTO public.application_sessions (
  id, user_id, company_id, device_id, gotrue_session_id,
  idle_expires_at, absolute_expires_at
) VALUES (
  '35000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '33000000-0000-4000-8000-000000000001',
  '32000000-0000-4000-8000-000000000001',
  now() + interval '30 minutes', now() + interval '12 hours'
);
INSERT INTO public.memberships (id, user_id, company_id, status)
VALUES ('31000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001', 'active')
ON CONFLICT (user_id, company_id) DO UPDATE SET status = 'active';
INSERT INTO public.membership_roles (membership_id, role_id)
SELECT m.id, r.id
FROM public.memberships m
JOIN public.roles r ON r.name = 'admin'
WHERE m.user_id = '30000000-0000-4000-8000-000000000001'
  AND m.company_id = '10000000-0000-4000-8000-000000000001'
ON CONFLICT DO NOTHING;
INSERT INTO public.user_access_context (user_id, session_id, membership_id, role_id, unit_id)
SELECT '30000000-0000-4000-8000-000000000001',
  '32000000-0000-4000-8000-000000000001',
  m.id, r.id, NULL
FROM public.memberships m
JOIN public.roles r ON r.name = 'admin'
WHERE m.user_id = '30000000-0000-4000-8000-000000000001'
  AND m.company_id = '10000000-0000-4000-8000-000000000001'
ON CONFLICT (user_id, session_id) DO UPDATE
SET membership_id = EXCLUDED.membership_id, role_id = EXCLUDED.role_id, unit_id = NULL;

DO $$
DECLARE
  v_id UUID;
  r RECORD;
BEGIN
  SELECT id INTO v_id FROM public.pre_cadastro
  WHERE company_id = '10000000-0000-4000-8000-000000000001'
    AND email = 'retry.qa@example.test';
  SELECT * INTO r FROM public.pre_cadastro_edge_resend(
    '30000000-0000-4000-8000-000000000001',
    '32000000-0000-4000-8000-000000000001', 'aal2', v_id,
    '20000000-0000-4000-8000-000000000004', repeat('f', 64)::CHAR(64));
  IF NOT FOUND OR r.r_should_send IS DISTINCT FROM TRUE
    OR r.r_email IS DISTINCT FROM 'retry.qa@example.test' THEN
    RAISE EXCEPTION 'reenvio autorizado falhou';
  END IF;
  SELECT * INTO r FROM public.pre_cadastro_edge_resend(
    '30000000-0000-4000-8000-000000000001',
    '32000000-0000-4000-8000-000000000001', 'aal2', v_id,
    '20000000-0000-4000-8000-000000000004', repeat('f', 64)::CHAR(64));
  IF NOT FOUND OR r.r_should_send IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'retry idempotente do reenvio falhou';
  END IF;
  SELECT * INTO r FROM public.pre_cadastro_edge_resend(
    '30000000-0000-4000-8000-000000000001',
    '32000000-0000-4000-8000-000000000001', 'aal2', v_id,
    '20000000-0000-4000-8000-000000000006', repeat('b', 64)::CHAR(64));
  IF NOT FOUND OR r.r_should_send IS DISTINCT FROM FALSE
    OR r.r_retry_after_seconds NOT BETWEEN 1 AND 300 THEN
    RAISE EXCEPTION 'cooldown de reenvio nao foi sinalizado';
  END IF;
  UPDATE public.pre_cadastro SET dt_ultimo_envio = clock_timestamp() - interval '6 minutes'
  WHERE id = v_id;
  SELECT * INTO r FROM public.pre_cadastro_edge_resend(
    '30000000-0000-4000-8000-000000000001',
    '32000000-0000-4000-8000-000000000001', 'aal2', v_id,
    '20000000-0000-4000-8000-000000000007', repeat('c', 64)::CHAR(64));
  IF NOT FOUND OR r.r_should_send IS DISTINCT FROM TRUE
    OR r.r_retry_after_seconds IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'cooldown concluido nao liberou novo envio';
  END IF;
END $$;

-- Two visible pending rows, one in each tenant, provide a positive control.
UPDATE public.pre_cadastro SET status = 'PENDENTE', dt_token_exp = now() + interval '1 day'
WHERE company_id = '10000000-0000-4000-8000-000000000001' AND email = 'retry.qa@example.test';
INSERT INTO public.pre_cadastro (id, company_id, full_name, email, versao_termo,
  texto_termo_hash, token_confirmacao_hash, dt_token_exp, status)
VALUES ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'Paciente B QA', 'tenant.b.qa@example.test',
  'v1.0-qa', repeat('b', 64), repeat('e', 64), now() + interval '1 day', 'PENDENTE');
INSERT INTO public.pre_cadastro (id, company_id, full_name, email, versao_termo,
  texto_termo_hash, token_confirmacao_hash, dt_token_exp, status, lg_confirmado)
VALUES ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Paciente B Confirmado',
  'tenant.b.confirmed@example.test', 'v1.0-qa', repeat('b', 64), repeat('9', 64),
  now() + interval '1 day', 'CONFIRMADO', TRUE);
SELECT set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000001', TRUE);
SELECT set_config('request.jwt.claims',
  '{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"32000000-0000-4000-8000-000000000001"}', TRUE);
SET LOCAL ROLE authenticated;
DO $$
DECLARE n BIGINT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.pre_cadastros_pendentes
    WHERE email = 'retry.qa@example.test') THEN
    RAISE EXCEPTION 'controle positivo da view falhou';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pre_cadastro
    WHERE company_id = '10000000-0000-4000-8000-000000000002')
    OR EXISTS (SELECT 1 FROM public.pre_cadastros_pendentes
      WHERE email = 'tenant.b.qa@example.test') THEN
    RAISE EXCEPTION 'admin A le dados B';
  END IF;
  BEGIN
    PERFORM public.cancel_pre_cadastro(
      '40000000-0000-4000-8000-000000000001', 'tentativa cross-tenant');
    RAISE EXCEPTION 'cancelamento cross-tenant autorizado';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
             WHEN raise_exception THEN
               IF SQLERRM = 'cancelamento cross-tenant autorizado' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.promote_pre_cadastro('40000000-0000-4000-8000-000000000002');
    RAISE EXCEPTION 'promocao cross-tenant autorizada';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
             WHEN raise_exception THEN
               IF SQLERRM = 'promocao cross-tenant autorizada' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM public.pre_cadastro
      WHERE company_id = '10000000-0000-4000-8000-000000000002';
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE EXCEPTION 'DELETE direto autorizado (% linhas)', n;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
UPDATE public.memberships SET status = 'suspended'
WHERE user_id = '30000000-0000-4000-8000-000000000001'
  AND company_id = '10000000-0000-4000-8000-000000000001';
SELECT set_config('test.suspended_pre_cadastro_id', id::TEXT, FALSE)
FROM public.pre_cadastro
WHERE company_id = '10000000-0000-4000-8000-000000000001'
  AND email = 'retry.qa@example.test';
SET LOCAL ROLE service_role;
DO $$
DECLARE
  v_id UUID := current_setting('test.suspended_pre_cadastro_id')::UUID;
BEGIN
  BEGIN
    PERFORM public.pre_cadastro_edge_resend(
      '30000000-0000-4000-8000-000000000001',
      '32000000-0000-4000-8000-000000000001', 'aal2', v_id,
      '20000000-0000-4000-8000-000000000005', repeat('a', 64)::CHAR(64));
    RAISE EXCEPTION 'reenvio por vinculo suspenso autorizado';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'reenvio por vinculo suspenso autorizado' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.pre_cadastros_pendentes) THEN
    RAISE EXCEPTION 'vinculo suspenso ainda le pre-cadastros';
  END IF;
END $$;
RESET ROLE;
UPDATE public.memberships SET status = 'active'
WHERE user_id = '30000000-0000-4000-8000-000000000001'
  AND company_id = '10000000-0000-4000-8000-000000000001';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.pre_cadastro
    WHERE company_id = '10000000-0000-4000-8000-000000000002'
      AND email = 'tenant.b.qa@example.test') THEN
    RAISE EXCEPTION 'readback B falhou';
  END IF;
END $$;

ROLLBACK;
SELECT 'PRE_CADASTRO_EDGE_CONTRACT_PASS';
