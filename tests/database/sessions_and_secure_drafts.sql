\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(condition boolean, message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(condition, false) THEN
    RAISE EXCEPTION 'SESSIONS_DRAFTS_ASSERTION_FAILED: %', message;
  END IF;
END;
$$;

-- Contratos estruturais e de exposição.
SELECT pg_temp.assert_true(to_regclass('public.application_devices') IS NOT NULL,
  'application_devices must exist');
SELECT pg_temp.assert_true(to_regclass('public.application_sessions') IS NOT NULL,
  'application_sessions must exist');
SELECT pg_temp.assert_true(to_regclass('public.secure_clinical_drafts') IS NOT NULL,
  'secure_clinical_drafts must exist');
SELECT pg_temp.assert_true(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.secure_clinical_drafts'::regclass),
  'secure_clinical_drafts must have RLS enabled');
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'secure_clinical_drafts'
      AND column_name = 'content_ciphertext' AND data_type = 'bytea'
  ), 'draft content must be stored as bytea ciphertext');
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'secure_clinical_drafts'
      AND column_name IN ('content', 'plaintext', 'encryption_key')
  ), 'draft table must not expose plaintext or an encryption key');
SELECT pg_temp.assert_true(
  NOT has_table_privilege('authenticated', 'public.secure_clinical_drafts', 'SELECT'),
  'authenticated must not read ciphertext table directly');
SELECT pg_temp.assert_true(
  NOT has_function_privilege('authenticated', 'public.secure_clinical_draft_key()', 'EXECUTE'),
  'authenticated must never execute the key reader');
SELECT pg_temp.assert_true(
  NOT has_function_privilege('authenticated', 'public.register_application_session(uuid,integer,text,text,text)', 'EXECUTE'),
  'browser must not register a session outside atomic context activation');
SELECT pg_temp.assert_true(
  NOT has_function_privilege('authenticated', 'public.set_access_context(uuid,integer,integer)', 'EXECUTE'),
  'browser must not persist context without an application session');

-- Fixture determinística.
INSERT INTO public.companies (id, name)
VALUES
  ('71000000-0000-0000-0000-000000000001', 'Sessões A'),
  ('72000000-0000-0000-0000-000000000002', 'Sessões B');

INSERT INTO public.units (id, company_id, cd_codigo, ds_nome)
VALUES
  (7101, '71000000-0000-0000-0000-000000000001', 'A1', 'Unidade A'),
  (7201, '72000000-0000-0000-0000-000000000002', 'B1', 'Unidade B');

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at)
VALUES
  ('71000000-0000-0000-0000-000000000011', 'draft.a@example.test', 'test', now()),
  ('72000000-0000-0000-0000-000000000022', 'draft.b@example.test', 'test', now());

INSERT INTO public.user_profiles (
  id, user_id, full_name, email, role_id, role_name, company_id, primary_unit_id, lg_ativo
)
VALUES
  ('71000000-0000-0000-0000-000000000011', '71000000-0000-0000-0000-000000000011',
   'Draft A', 'draft.a@example.test', (SELECT id FROM public.roles WHERE name = 'medico'),
   'medico', '71000000-0000-0000-0000-000000000001', 7101, true),
  ('72000000-0000-0000-0000-000000000022', '72000000-0000-0000-0000-000000000022',
   'Draft B', 'draft.b@example.test', (SELECT id FROM public.roles WHERE name = 'medico'),
   'medico', '72000000-0000-0000-0000-000000000002', 7201, true);

INSERT INTO public.memberships (id, user_id, company_id, status)
VALUES
  ('71000000-0000-0000-0000-000000000044', '71000000-0000-0000-0000-000000000011',
   '71000000-0000-0000-0000-000000000001', 'active'),
  ('72000000-0000-0000-0000-000000000044', '72000000-0000-0000-0000-000000000022',
   '72000000-0000-0000-0000-000000000002', 'active');
INSERT INTO public.membership_roles (membership_id, role_id)
VALUES
  ('71000000-0000-0000-0000-000000000044', (SELECT id FROM public.roles WHERE name = 'medico')),
  ('71000000-0000-0000-0000-000000000044', (SELECT id FROM public.roles WHERE name = 'admin')),
  ('72000000-0000-0000-0000-000000000044', (SELECT id FROM public.roles WHERE name = 'medico'));
INSERT INTO public.membership_units (membership_id, unit_id)
VALUES
  ('71000000-0000-0000-0000-000000000044', 7101),
  ('72000000-0000-0000-0000-000000000044', 7201);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'secure_clinical_drafts_key') THEN
    PERFORM vault.create_secret(
      'test-only-key-with-at-least-thirty-two-bytes',
      'secure_clinical_drafts_key',
      'transactional database test key'
    );
  END IF;
END;
$$;

CREATE TEMP TABLE test_session_context (
  session_id uuid NOT NULL,
  device_id uuid NOT NULL,
  client_device_id uuid NOT NULL,
  draft_id uuid
);
GRANT SELECT, INSERT, UPDATE ON test_session_context TO authenticated;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '71000000-0000-0000-0000-000000000011';
SET LOCAL request.jwt.claims = '{"sub":"71000000-0000-0000-0000-000000000011","role":"authenticated","aal":"aal2","session_id":"71000000-0000-0000-0000-000000000099"}';

WITH registered AS (
  SELECT public.activate_application_context(
    '71000000-0000-0000-0000-000000000044',
    (SELECT id FROM public.roles WHERE name = 'medico'), 7101,
    '71000000-0000-0000-0000-000000000033',
    'Navegador de teste', 'Linux', 'pg-test-agent'
  ) AS value
)
INSERT INTO test_session_context (session_id, device_id, client_device_id)
SELECT (value->>'session_id')::uuid, (value->>'device_id')::uuid,
       '71000000-0000-0000-0000-000000000033'::uuid
FROM registered;

SELECT pg_temp.assert_true(
  public.is_application_session_allowed(
    (SELECT session_id FROM test_session_context),
    (SELECT client_device_id FROM test_session_context)
  ), 'fresh application session must be allowed');
SELECT pg_temp.assert_true(
  public.active_company_id() = '71000000-0000-0000-0000-000000000001'::UUID
  AND public.active_unit_id() = 7101,
  'authorization helpers must require and accept the active application session');

-- Papel corporativo registra sessão válida sem unidade.
SET LOCAL request.jwt.claims = '{"sub":"71000000-0000-0000-0000-000000000011","role":"authenticated","aal":"aal2","session_id":"71000000-0000-0000-0000-000000000097"}';
SELECT public.activate_application_context(
  '71000000-0000-0000-0000-000000000044',
  (SELECT id FROM public.roles WHERE name = 'admin'), NULL,
  '71000000-0000-0000-0000-000000000037',
  'Navegador corporativo', 'Linux', 'pg-test-agent'
);
SELECT pg_temp.assert_true(
  public.active_company_id() = '71000000-0000-0000-0000-000000000001'::UUID
  AND public.active_unit_id() IS NULL,
  'corporate session must be active without a unit');

SET LOCAL request.jwt.claims = '{"sub":"71000000-0000-0000-0000-000000000011","role":"authenticated","aal":"aal2","session_id":"71000000-0000-0000-0000-000000000099"}';

WITH saved AS (
  SELECT public.save_secure_clinical_draft(
    (SELECT session_id FROM test_session_context),
    (SELECT client_device_id FROM test_session_context),
    NULL, 7101, 'encounter', '9001',
    '{"anamnesis":"segredo clínico inequívoco"}'::jsonb, 30
  ) AS value
)
UPDATE test_session_context
SET draft_id = (SELECT (value->>'id')::uuid FROM saved);

RESET ROLE;
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1 FROM public.secure_clinical_drafts
    WHERE id = (SELECT draft_id FROM test_session_context)
      AND encode(content_ciphertext, 'escape') LIKE '%segredo clínico inequívoco%'
  ), 'plaintext must not appear in persisted ciphertext');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '71000000-0000-0000-0000-000000000011';
SET LOCAL request.jwt.claims = '{"sub":"71000000-0000-0000-0000-000000000011","role":"authenticated","aal":"aal2","session_id":"71000000-0000-0000-0000-000000000099"}';
SELECT pg_temp.assert_true(
  (public.get_secure_clinical_draft(
    (SELECT session_id FROM test_session_context),
    (SELECT client_device_id FROM test_session_context),
    (SELECT draft_id FROM test_session_context)
  )->'content'->>'anamnesis') = 'segredo clínico inequívoco',
  'authorized owner must decrypt its draft through RPC');
RESET ROLE;

-- Outra sessão GoTrue do mesmo usuário não pode reutilizar a sessão da aplicação.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '71000000-0000-0000-0000-000000000011';
SET LOCAL request.jwt.claims = '{"sub":"71000000-0000-0000-0000-000000000011","role":"authenticated","aal":"aal2","session_id":"71000000-0000-0000-0000-000000000098"}';
SELECT pg_temp.assert_true(
  NOT public.is_application_session_allowed(
    (SELECT session_id FROM test_session_context),
    (SELECT client_device_id FROM test_session_context)
  ), 'application session must be bound to the current GoTrue session_id');
RESET ROLE;

-- Outro usuário/tenant não pode usar a sessão nem ler o rascunho.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '72000000-0000-0000-0000-000000000022';
SET LOCAL request.jwt.claims = '{"sub":"72000000-0000-0000-0000-000000000022","role":"authenticated","aal":"aal2","session_id":"72000000-0000-0000-0000-000000000099"}';
SELECT pg_temp.assert_true(
  NOT public.is_application_session_allowed(
    (SELECT session_id FROM test_session_context),
    (SELECT client_device_id FROM test_session_context)
  ), 'application session must be bound to its user');
DO $$
BEGIN
  PERFORM public.get_secure_clinical_draft(
    (SELECT session_id FROM test_session_context),
    (SELECT client_device_id FROM test_session_context),
    (SELECT draft_id FROM test_session_context)
  );
  RAISE EXCEPTION 'SESSIONS_DRAFTS_ASSERTION_FAILED: cross-tenant draft read succeeded';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END;
$$;
RESET ROLE;

-- Revogação individual bloqueia imediatamente o contexto da aplicação.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '71000000-0000-0000-0000-000000000011';
SET LOCAL request.jwt.claims = '{"sub":"71000000-0000-0000-0000-000000000011","role":"authenticated","aal":"aal2","session_id":"71000000-0000-0000-0000-000000000099"}';
SELECT pg_temp.assert_true(
  public.revoke_application_device(
    (SELECT device_id FROM test_session_context), 'dispositivo perdido'
  ), 'owner must revoke one application device');
SELECT pg_temp.assert_true(
  NOT public.is_application_session_allowed(
    (SELECT session_id FROM test_session_context),
    (SELECT client_device_id FROM test_session_context)
  ), 'revoked device must fail closed');
SELECT pg_temp.assert_true(
  public.active_company_id() IS NULL
  AND public.active_unit_id() IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.user_access_context
    WHERE user_id = '71000000-0000-0000-0000-000000000011'::UUID
      AND session_id = '71000000-0000-0000-0000-000000000099'::UUID
  ), 'device revocation must invalidate the matching access context');
RESET ROLE;

-- Expiração é parte do contrato e não depende de limpeza física imediata.
UPDATE public.secure_clinical_drafts
SET created_at = now() - interval '2 seconds',
    expires_at = now() - interval '1 second'
WHERE id = (SELECT draft_id FROM test_session_context);
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1 FROM public.secure_clinical_drafts
    WHERE id = (SELECT draft_id FROM test_session_context) AND expires_at > now()
  ), 'expired draft must no longer be active');

ROLLBACK;
