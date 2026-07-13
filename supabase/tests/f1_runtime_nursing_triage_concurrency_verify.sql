-- Verify the committed effects of concurrent psql sessions, then remove every
-- fixture. Pass -v cleanup_only=1 to skip assertions during emergency cleanup.

\set ON_ERROR_STOP on

SELECT set_config('app.triage_concurrency_company_id', :'company_id', FALSE);
SELECT set_config('app.triage_concurrency_company_b_id', :'company_b_id', FALSE);
SELECT set_config('app.triage_concurrency_actor_id', :'actor_id', FALSE);
SELECT set_config('app.triage_concurrency_role_name', :'role_name', FALSE);
SELECT set_config('app.triage_concurrency_classification_name', :'classification_name', FALSE);
SELECT set_config('app.triage_concurrency_distinct_key_a', :'distinct_key_a', FALSE);
SELECT set_config('app.triage_concurrency_distinct_key_b', :'distinct_key_b', FALSE);
SELECT set_config('app.triage_concurrency_same_key', :'same_key', FALSE);
SELECT set_config('app.triage_concurrency_divergent_key', :'divergent_key', FALSE);
SELECT set_config('app.triage_concurrency_same_complaint', :'same_complaint', FALSE);
SELECT set_config('app.triage_concurrency_divergent_complaint_a', :'divergent_complaint_a', FALSE);
SELECT set_config('app.triage_concurrency_divergent_complaint_b', :'divergent_complaint_b', FALSE);

\if :cleanup_only
  \echo 'Skipping assertions; cleaning nursing triage concurrency fixtures'
\else
DO $verify$
DECLARE
  v_tickets TEXT[];
  v_divergent_complaint TEXT;
  v_classification_company UUID;
  v_classification_id INTEGER;
  v_classification_refs INTEGER;
BEGIN
  IF current_setting('server_version_num')::INTEGER < 180000 THEN
    RAISE EXCEPTION 'Nursing triage concurrency verification requires PostgreSQL 18';
  END IF;

  SELECT array_agg(cd_senha ORDER BY substring(cd_senha FROM 2)::INTEGER)
    INTO v_tickets
    FROM public.triagem_fila
   WHERE company_id = current_setting('app.triage_concurrency_company_id')::UUID;

  IF (SELECT count(*) FROM public.triagem_fila
       WHERE company_id = current_setting('app.triage_concurrency_company_id')::UUID) <> 4
     OR v_tickets IS DISTINCT FROM ARRAY['T001', 'T002', 'T003', 'T004']::TEXT[]
     OR (SELECT count(DISTINCT cd_senha) FROM public.triagem_fila
          WHERE company_id = current_setting('app.triage_concurrency_company_id')::UUID) <> 4 THEN
    RAISE EXCEPTION 'Expected exactly four unique sequential tickets, found %', v_tickets;
  END IF;

  IF (SELECT count(*) FROM public.triagem_fila
       WHERE company_id = current_setting('app.triage_concurrency_company_id')::UUID
         AND enqueue_idempotency_key IN (
           current_setting('app.triage_concurrency_distinct_key_a')::UUID,
           current_setting('app.triage_concurrency_distinct_key_b')::UUID
         )) <> 2 THEN
    RAISE EXCEPTION 'Distinct concurrent idempotency keys did not create two rows';
  END IF;

  IF (SELECT count(*) FROM public.triagem_fila
       WHERE company_id = current_setting('app.triage_concurrency_company_id')::UUID
         AND enqueue_idempotency_key = current_setting('app.triage_concurrency_same_key')::UUID
         AND ds_queixa_inicial = current_setting('app.triage_concurrency_same_complaint')) <> 1 THEN
    RAISE EXCEPTION 'Equal concurrent retries did not converge to one row';
  END IF;

  SELECT ds_queixa_inicial
    INTO v_divergent_complaint
    FROM public.triagem_fila
   WHERE company_id = current_setting('app.triage_concurrency_company_id')::UUID
     AND enqueue_idempotency_key = current_setting('app.triage_concurrency_divergent_key')::UUID;
  IF NOT FOUND
     OR v_divergent_complaint NOT IN (
       current_setting('app.triage_concurrency_divergent_complaint_a'),
       current_setting('app.triage_concurrency_divergent_complaint_b')
     )
     OR (SELECT count(*) FROM public.triagem_fila
          WHERE company_id = current_setting('app.triage_concurrency_company_id')::UUID
            AND enqueue_idempotency_key = current_setting('app.triage_concurrency_divergent_key')::UUID) <> 1 THEN
    RAISE EXCEPTION 'Divergent concurrent requests did not produce exactly one accepted row';
  END IF;

  IF (SELECT last_number FROM public.nursing_triage_daily_counters
       WHERE company_id = current_setting('app.triage_concurrency_company_id')::UUID
         AND ticket_date = (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::DATE)
       IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'Daily counter did not finish at four';
  END IF;

  IF (SELECT count(*) FROM public.nursing_triage_audit_events
       WHERE company_id = current_setting('app.triage_concurrency_company_id')::UUID
         AND action = 'ENQUEUED') <> 4
     OR (SELECT count(DISTINCT idempotency_key) FROM public.nursing_triage_audit_events
          WHERE company_id = current_setting('app.triage_concurrency_company_id')::UUID
            AND action = 'ENQUEUED') <> 4 THEN
    RAISE EXCEPTION 'Enqueue audit events do not match committed queue rows';
  END IF;

  SELECT id, company_id
    INTO STRICT v_classification_id, v_classification_company
    FROM public.mnct_classificacao_risco
   WHERE ds_classificacao = current_setting('app.triage_concurrency_classification_name');
  SELECT count(*) INTO v_classification_refs
    FROM public.triagens
   WHERE cd_classificacao_id = v_classification_id;

  IF EXISTS (
       SELECT 1
         FROM public.triagens AS triage_row
         JOIN public.mnct_classificacao_risco AS classification
           ON classification.id = triage_row.cd_classificacao_id
        WHERE classification.id = v_classification_id
          AND classification.company_id IS NOT NULL
          AND classification.company_id <> triage_row.company_id
     ) OR EXISTS (
       SELECT 1
         FROM public.triagem_fila AS queue_row
         JOIN public.mnct_classificacao_risco AS classification
           ON classification.id = queue_row.cd_classificacao_id
        WHERE classification.id = v_classification_id
          AND classification.company_id IS NOT NULL
          AND classification.company_id <> queue_row.company_id
     ) THEN
    RAISE EXCEPTION 'Classification race left a cross-tenant reference';
  END IF;

  IF NOT (
    (v_classification_company = current_setting('app.triage_concurrency_company_b_id')::UUID
     AND v_classification_refs = 0)
    OR
    (v_classification_company IS NULL
     AND v_classification_refs = 1
     AND EXISTS (
       SELECT 1 FROM public.triagens
        WHERE cd_classificacao_id = v_classification_id
          AND company_id = current_setting('app.triage_concurrency_company_id')::UUID
     ))
  ) THEN
    RAISE EXCEPTION 'Classification race did not commit exactly one valid operation: company %, refs %',
      v_classification_company, v_classification_refs;
  END IF;
END
$verify$;

\echo 'NURSING_TRIAGE_CONCURRENCY_VERIFY_OK'
\endif

BEGIN;

DELETE FROM public.nursing_triage_audit_events
 WHERE company_id = :'company_id'::UUID;
DELETE FROM public.news2_avaliacoes
 WHERE company_id = :'company_id'::UUID;
DELETE FROM public.triagens
 WHERE company_id = :'company_id'::UUID;
DELETE FROM public.triagem_fila
 WHERE company_id = :'company_id'::UUID;
DELETE FROM public.nursing_triage_daily_counters
 WHERE company_id = :'company_id'::UUID;
DELETE FROM public.patients
 WHERE company_id = :'company_id'::UUID;
DELETE FROM public.mnct_classificacao_risco
 WHERE ds_classificacao = :'classification_name';
DELETE FROM public.user_profiles
 WHERE id = :'actor_id'::UUID;
DELETE FROM auth.users
 WHERE id = :'actor_id'::UUID;
DELETE FROM public.role_permissions
 WHERE role_id = (SELECT id FROM public.roles WHERE name = :'role_name');
DELETE FROM public.roles
 WHERE name = :'role_name';
DELETE FROM public.companies
 WHERE id = :'company_id'::UUID;
DELETE FROM public.companies
 WHERE id = :'company_b_id'::UUID;

DO $cleanup$
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
     )
     OR EXISTS (
       SELECT 1 FROM public.triagem_fila
        WHERE company_id = current_setting('app.triage_concurrency_company_id')::UUID
     )
     OR EXISTS (
       SELECT 1 FROM public.nursing_triage_daily_counters
        WHERE company_id = current_setting('app.triage_concurrency_company_id')::UUID
     )
     OR EXISTS (
       SELECT 1 FROM public.nursing_triage_audit_events
        WHERE company_id = current_setting('app.triage_concurrency_company_id')::UUID
     ) THEN
    RAISE EXCEPTION 'Nursing triage concurrency fixture cleanup was incomplete';
  END IF;
END
$cleanup$;

COMMIT;

\echo 'NURSING_TRIAGE_CONCURRENCY_CLEANUP_OK'

