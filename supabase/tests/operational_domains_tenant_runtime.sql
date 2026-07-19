-- Disposable runtime contract for all 13 operational tables.
-- Fixture data and assertions share one transaction and are always rolled back.
\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.current_company_id()') IS NULL THEN
    RAISE EXCEPTION 'Runtime contract requires public.current_company_id()';
  END IF;
  IF to_regprocedure('public.request_company_id()') IS NULL THEN
    RAISE EXCEPTION 'Runtime contract requires public.request_company_id()';
  END IF;
END
$$;

INSERT INTO public.companies(id, name) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Tenant A'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Tenant B');
INSERT INTO public.user_profiles(id, company_id, role_name) VALUES
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin'),
  ('bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'admin'),
  ('aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'reception');

INSERT INTO public.exames_lab_catalogo(id, company_id, ds_exame, ds_sigla) VALUES
  (101, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Exame A', 'EA'),
  (102, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Exame B', 'EB');
INSERT INTO public.exames_lab_valor_referencia(id, cd_exame, ds_parametro) VALUES
  (201, 101, 'Parametro A'), (202, 102, 'Parametro B');
INSERT INTO public.exames_lab_pedido(id, company_id, cd_paciente, cd_medico) VALUES
  (301, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 1001, 2001),
  (302, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 1002, 2002);
INSERT INTO public.exames_lab_pedido_itens(id, cd_pedido, cd_exame) VALUES
  (401, 301, 101), (402, 302, 102);
INSERT INTO public.exames_lab_resultado(id, cd_item_pedido, cd_valor_referencia, ds_parametro) VALUES
  (501, 401, 201, 'Resultado A'), (502, 402, 202, 'Resultado B');
INSERT INTO public.exames_lab_alerta_critico(id, cd_resultado, cd_paciente, cd_medico) VALUES
  (601, 501, 1001, 2001), (602, 502, 1002, 2002);

INSERT INTO public.nps_pesquisas(id, company_id, ds_titulo) VALUES
  (701, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'NPS A'),
  (702, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'NPS B');
INSERT INTO public.nps_respostas(id, cd_pesquisa, cd_paciente, nr_nota_nps) VALUES
  (801, 701, 1001, 10), (802, 702, 1002, 9);

INSERT INTO public.pre_cadastro(
  id, company_id, full_name, cpf, email, versao_termo, texto_termo_hash,
  token_confirmacao, dt_token_exp
) VALUES
  ('aaaaaaaa-3000-4300-8300-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'Paciente A', '11111111111', 'a@example.test', 'v1', repeat('a', 64), 'token-a',
   now() + interval '1 day'),
  ('bbbbbbbb-3000-4300-8300-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   'Paciente B', '22222222222', 'b@example.test', 'v1', repeat('b', 64), 'token-b',
   now() + interval '1 day');

INSERT INTO public.notification_templates(id, company_id, code, channel, body) VALUES
  ('00000000-4000-4000-8000-000000000001', NULL, 'GLOBAL', 'EMAIL', 'Global'),
  ('aaaaaaaa-4000-4400-8400-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'TENANT_A', 'EMAIL', 'A'),
  ('bbbbbbbb-4000-4400-8400-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'TENANT_B', 'EMAIL', 'B');
INSERT INTO public.notifications(id, company_id, recipient_type, recipient_id, channel, body) VALUES
  ('aaaaaaaa-5000-4500-8500-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'PATIENT', 1001, 'EMAIL', 'A'),
  ('bbbbbbbb-5000-4500-8500-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'PATIENT', 1002, 'EMAIL', 'B');
INSERT INTO public.notification_preferences(id, company_id, recipient_type, recipient_id, channel) VALUES
  ('aaaaaaaa-6000-4600-8600-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'PATIENT', 1001, 'EMAIL'),
  ('bbbbbbbb-6000-4600-8600-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'PATIENT', 1002, 'EMAIL');
INSERT INTO public.notification_logs(id, notification_id, attempt_number, channel, provider, status) VALUES
  (901, 'aaaaaaaa-5000-4500-8500-000000000001', 1, 'EMAIL', 'fixture', 'SENT'),
  (902, 'bbbbbbbb-5000-4500-8500-000000000001', 1, 'EMAIL', 'fixture', 'SENT');

-- Direct application role: every table must expose exactly tenant A, including
-- child rows. Global templates are intentionally excluded from this role.
SET LOCAL ROLE app_prontomedic;
SELECT set_config('request.jwt.claim.company_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
DO $$
DECLARE
  target_table text;
  visible_rows integer;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'exames_lab_catalogo', 'exames_lab_valor_referencia',
    'exames_lab_pedido', 'exames_lab_pedido_itens',
    'exames_lab_resultado', 'exames_lab_alerta_critico',
    'nps_pesquisas', 'nps_respostas', 'pre_cadastro',
    'notification_templates', 'notifications',
    'notification_preferences', 'notification_logs'
  ] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', target_table) INTO visible_rows;
    IF visible_rows <> 1 THEN
      RAISE EXCEPTION 'app_prontomedic expected one tenant row in %, got %', target_table, visible_rows;
    END IF;
  END LOOP;
END
$$;

DO $$
DECLARE
  catalog_id bigint;
  reference_id bigint;
BEGIN
  INSERT INTO public.exames_lab_catalogo(company_id, ds_exame, ds_sigla)
  VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Allowed tenant write', 'ALLOW')
  RETURNING id INTO catalog_id;

  INSERT INTO public.exames_lab_valor_referencia(cd_exame, ds_parametro)
  VALUES (catalog_id, 'Allowed child write')
  RETURNING id INTO reference_id;

  DELETE FROM public.exames_lab_valor_referencia WHERE id = reference_id;
  DELETE FROM public.exames_lab_catalogo WHERE id = catalog_id;
END
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.exames_lab_catalogo(company_id, ds_exame, ds_sigla)
    VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Cross tenant', 'CROSS');
    RAISE EXCEPTION 'Cross-tenant direct insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.exames_lab_valor_referencia(cd_exame, ds_parametro)
    VALUES (102, 'Cross-tenant child');
    RAISE EXCEPTION 'Cross-tenant LIS child insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.notification_templates(id, company_id, code, channel, body)
    VALUES ('00000000-4000-4000-8000-000000000002', NULL, 'GLOBAL_APP_WRITE', 'EMAIL', 'Denied');
    RAISE EXCEPTION 'app_prontomedic created a global template';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    NULL;
  END;
END
$$;

SELECT set_config('request.jwt.claim.company_id', '', true);
DO $$
DECLARE
  target_table text;
  visible_rows integer;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'exames_lab_catalogo', 'exames_lab_valor_referencia',
    'exames_lab_pedido', 'exames_lab_pedido_itens',
    'exames_lab_resultado', 'exames_lab_alerta_critico',
    'nps_pesquisas', 'nps_respostas', 'pre_cadastro',
    'notification_templates', 'notifications',
    'notification_preferences', 'notification_logs'
  ] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', target_table) INTO visible_rows;
    IF visible_rows <> 0 THEN
      RAISE EXCEPTION 'Missing app company claim exposed % row(s) from %', visible_rows, target_table;
    END IF;
  END LOOP;
END
$$;

-- Authenticated admin: tenant data plus the one global read-only template.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa')::text,
  true
);
DO $$
DECLARE
  target_table text;
  visible_rows integer;
  expected_rows integer;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'exames_lab_catalogo', 'exames_lab_valor_referencia',
    'exames_lab_pedido', 'exames_lab_pedido_itens',
    'exames_lab_resultado', 'exames_lab_alerta_critico',
    'nps_pesquisas', 'nps_respostas', 'pre_cadastro',
    'notification_templates', 'notifications',
    'notification_preferences', 'notification_logs'
  ] LOOP
    expected_rows := CASE WHEN target_table = 'notification_templates' THEN 2 ELSE 1 END;
    EXECUTE format('SELECT count(*) FROM public.%I', target_table) INTO visible_rows;
    IF visible_rows <> expected_rows THEN
      RAISE EXCEPTION 'authenticated expected % row(s) in %, got %', expected_rows, target_table, visible_rows;
    END IF;
  END LOOP;
END
$$;

DO $$
DECLARE
  affected integer;
BEGIN
  UPDATE public.notification_templates SET body = 'Not allowed' WHERE company_id IS NULL;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'Authenticated admin modified a global template';
  END IF;
END
$$;

-- A same-tenant non-lab user retains read access but cannot manage LIS.
SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa')::text,
  true
);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.exames_lab_catalogo) <> 1 THEN
    RAISE EXCEPTION 'Authenticated same-tenant LIS read was not preserved';
  END IF;
  BEGIN
    INSERT INTO public.exames_lab_catalogo(company_id, ds_exame, ds_sigla)
    VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Unauthorized', 'NOPE');
    RAISE EXCEPTION 'Non-lab authenticated user managed LIS';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    NULL;
  END;
END
$$;

-- Anonymous public forms remain insert-only where explicitly supported.
RESET ROLE;
SET LOCAL ROLE anon;
INSERT INTO public.nps_respostas(cd_pesquisa, cd_paciente, nr_nota_nps)
VALUES (702, 1999, 8);
INSERT INTO public.pre_cadastro(
  id, company_id, full_name, cpf, email, versao_termo, texto_termo_hash,
  token_confirmacao, dt_token_exp
) VALUES (
  'bbbbbbbb-3000-4300-8300-000000000099', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'Public Patient', '33333333333', 'public@example.test', 'v1', repeat('c', 64),
  'token-public', now() + interval '1 day'
);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.nps_respostas) <> 0
     OR (SELECT count(*) FROM public.pre_cadastro) <> 0 THEN
    RAISE EXCEPTION 'anon gained read access to public-form data';
  END IF;
END
$$;

ROLLBACK;
