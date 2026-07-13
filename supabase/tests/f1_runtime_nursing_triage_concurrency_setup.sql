-- Persistent fixtures for the multi-session nursing triage concurrency gate.
-- Run only against an ephemeral PostgreSQL 18 test database.

\set ON_ERROR_STOP on

BEGIN;

SELECT set_config('app.triage_concurrency_company_id', :'company_id', FALSE);
SELECT set_config('app.triage_concurrency_company_b_id', :'company_b_id', FALSE);
SELECT set_config('app.triage_concurrency_actor_id', :'actor_id', FALSE);
SELECT set_config('app.triage_concurrency_role_name', :'role_name', FALSE);
SELECT set_config('app.triage_concurrency_classification_name', :'classification_name', FALSE);

DO $setup$
BEGIN
  IF current_setting('server_version_num')::INTEGER < 180000 THEN
    RAISE EXCEPTION 'Nursing triage concurrency gate requires PostgreSQL 18, found %', version();
  END IF;
  IF to_regprocedure('public.enqueue_nursing_triage_secure(bigint,text,integer,uuid)') IS NULL
     OR to_regclass('public.nursing_triage_daily_counters') IS NULL
     OR to_regclass('public.nursing_triage_audit_events') IS NULL THEN
    RAISE EXCEPTION 'Atomic nursing triage contract is not installed';
  END IF;
  IF NOT pg_has_role(current_user, 'authenticated', 'SET') THEN
    RAISE EXCEPTION 'Connection role % cannot SET ROLE authenticated', current_user;
  END IF;
END
$setup$;

DO $setup$
BEGIN
  IF EXISTS (
       SELECT 1 FROM public.companies
        WHERE id = current_setting('app.triage_concurrency_company_id')::UUID
     )
     OR EXISTS (
       SELECT 1 FROM auth.users
        WHERE id = current_setting('app.triage_concurrency_actor_id')::UUID
     )
     OR EXISTS (
       SELECT 1 FROM public.companies
        WHERE id = current_setting('app.triage_concurrency_company_b_id')::UUID
     )
     OR EXISTS (
       SELECT 1 FROM public.roles
        WHERE name = current_setting('app.triage_concurrency_role_name')
     )
     OR EXISTS (
       SELECT 1 FROM public.mnct_classificacao_risco
        WHERE ds_classificacao = current_setting('app.triage_concurrency_classification_name')
     ) THEN
    RAISE EXCEPTION 'Concurrency fixture identifiers already exist';
  END IF;
END
$setup$;

INSERT INTO public.companies(id, name)
VALUES (:'company_id'::UUID, :'company_name');

INSERT INTO public.companies(id, name)
VALUES (:'company_b_id'::UUID, :'company_b_name');

INSERT INTO public.roles(name, description, lg_ativo)
VALUES (:'role_name', 'Ephemeral nursing triage concurrency actor', TRUE);

INSERT INTO public.role_permissions(role_id, module, can_view, can_create, can_edit)
SELECT id, 'enfermagem', TRUE, TRUE, FALSE
  FROM public.roles
 WHERE name = :'role_name';

INSERT INTO auth.users(id) VALUES (:'actor_id'::UUID);

INSERT INTO public.user_profiles(
  id, full_name, email, role_name, role_id, company_id, lg_ativo
)
SELECT :'actor_id'::UUID,
       'Nursing concurrency actor',
       :'actor_email',
       :'role_name',
       role.id,
       :'company_id'::UUID,
       TRUE
  FROM public.roles AS role
 WHERE role.name = :'role_name';

INSERT INTO public.patients(company_id, full_name, lg_ativo) VALUES
  (:'company_id'::UUID, :'patient_a_name', TRUE),
  (:'company_id'::UUID, :'patient_b_name', TRUE);

INSERT INTO public.mnct_classificacao_risco(
  company_id, ds_classificacao, cd_cor_hex,
  nr_tempo_max_atendimento_min, ds_descricao, lg_ativo
) VALUES (
  NULL, :'classification_name', '#445566', 60,
  'Ephemeral classification tenant race', TRUE
);

COMMIT;

\echo 'NURSING_TRIAGE_CONCURRENCY_SETUP_OK'

