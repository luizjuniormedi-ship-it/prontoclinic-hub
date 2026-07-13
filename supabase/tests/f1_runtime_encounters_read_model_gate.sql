-- F1 encounters read-model gate. Ephemeral PostgreSQL only; all fixtures roll back.
BEGIN;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID LANGUAGE sql STABLE AS $f1$
  SELECT NULLIF(current_setting('app.test_user_id', true), '')::UUID
$f1$;

DO $f1$
DECLARE
  v_relkind "char";
  v_reloptions TEXT[];
  v_definition TEXT;
  v_is_updatable TEXT;
  v_check_option TEXT;
BEGIN
  SELECT c.relkind, c.reloptions, pg_get_viewdef(c.oid, TRUE)
    INTO v_relkind, v_reloptions, v_definition
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'v_encounters_read_model';

  IF v_relkind IS DISTINCT FROM 'v' THEN
    RAISE EXCEPTION 'v_encounters_read_model is missing or is not a view';
  END IF;
  IF NOT COALESCE(v_reloptions @> ARRAY['security_invoker=true'], FALSE) THEN
    RAISE EXCEPTION 'v_encounters_read_model is not security_invoker';
  END IF;
  IF v_definition !~ 'patient.id = mr.patient_id'
     OR v_definition !~ 'patient.company_id = mr.company_id'
     OR v_definition !~ 'appointment.id = mr.appointment_id'
     OR v_definition !~ 'appointment.company_id = mr.company_id'
     OR v_definition !~ 'signer.id = mr.signed_by'
     OR v_definition !~ 'signer.company_id = mr.company_id' THEN
    RAISE EXCEPTION 'v_encounters_read_model has a join without id + company_id tenant binding';
  END IF;
  IF v_definition ~* '\m(insert|update|delete|merge|call)\M'
     OR v_definition ~* 'security[[:space:]]+definer' THEN
    RAISE EXCEPTION 'v_encounters_read_model contains DML or SECURITY DEFINER';
  END IF;

  SELECT is_updatable, check_option
    INTO v_is_updatable, v_check_option
    FROM information_schema.views
   WHERE table_schema = 'public'
     AND table_name = 'v_encounters_read_model';
  IF v_is_updatable IS DISTINCT FROM 'NO'
     OR v_check_option IS DISTINCT FROM 'NONE' THEN
    RAISE EXCEPTION 'v_encounters_read_model must be non-updatable with no check option';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.v_encounters_read_model', 'SELECT')
     OR has_table_privilege('authenticated', 'public.v_encounters_read_model', 'INSERT')
     OR has_table_privilege('authenticated', 'public.v_encounters_read_model', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.v_encounters_read_model', 'DELETE')
     OR has_table_privilege('anon', 'public.v_encounters_read_model', 'SELECT')
     OR EXISTS (
       SELECT 1
         FROM aclexplode(COALESCE(
           (SELECT relacl FROM pg_class WHERE oid = 'public.v_encounters_read_model'::REGCLASS),
           acldefault('r', (SELECT relowner FROM pg_class WHERE oid = 'public.v_encounters_read_model'::REGCLASS))
         )) AS acl
        WHERE acl.grantee = 0
     ) THEN
    RAISE EXCEPTION 'v_encounters_read_model ACL is not authenticated SELECT-only';
  END IF;
END
$f1$;

INSERT INTO public.companies (id, name) VALUES
  ('e1111111-1111-4111-8111-111111111111', 'Encounters Tenant A'),
  ('e2222222-2222-4222-8222-222222222222', 'Encounters Tenant B');

INSERT INTO auth.users (id) VALUES
  ('e1111111-0000-4000-8000-000000000001'),
  ('e2222222-0000-4000-8000-000000000001'),
  ('e0000000-0000-4000-8000-000000000001');

INSERT INTO public.user_profiles (
  id, full_name, email, role_name, company_id
) VALUES
  ('e1111111-0000-4000-8000-000000000001', 'Encounter User A', 'a@encounters.test', 'admin', 'e1111111-1111-4111-8111-111111111111'),
  ('e2222222-0000-4000-8000-000000000001', 'Encounter User B', 'b@encounters.test', 'admin', 'e2222222-2222-4222-8222-222222222222'),
  ('e0000000-0000-4000-8000-000000000001', 'Encounter No Company', 'none@encounters.test', 'admin', NULL);

INSERT INTO public.patients (id, company_id, full_name)
OVERRIDING SYSTEM VALUE VALUES
  (981001, 'e1111111-1111-4111-8111-111111111111', 'Encounter Patient A'),
  (982001, 'e2222222-2222-4222-8222-222222222222', 'Encounter Patient B');

INSERT INTO public.appointments (
  id, company_id, patient_id, appointment_date, start_time, status
) OVERRIDING SYSTEM VALUE VALUES
  (981002, 'e1111111-1111-4111-8111-111111111111', 981001, DATE '2026-07-13', TIME '09:00', 'completed'),
  (982002, 'e2222222-2222-4222-8222-222222222222', 982001, DATE '2026-07-13', TIME '10:00', 'completed');

INSERT INTO public.medical_records (
  id, company_id, patient_id, appointment_id, record_date,
  chief_complaint, evolution, status, content_hash, signed_by
) OVERRIDING SYSTEM VALUE VALUES
  (981003, 'e1111111-1111-4111-8111-111111111111', 981001, 981002, DATE '2026-07-13',
   'Queixa A', 'Evolucao A', 'legacy_locked', repeat('a', 64), NULL),
  (982003, 'e2222222-2222-4222-8222-222222222222', 982001, 982002, DATE '2026-07-13',
   'Queixa B', 'Evolucao B', 'legacy_locked', repeat('b', 64), NULL),
  (980003, NULL, NULL, NULL, DATE '2026-07-13',
   'Legacy sem empresa', 'Nunca deve aparecer', 'legacy_locked', repeat('0', 64), NULL);

SET LOCAL ROLE authenticated;
SET LOCAL app.test_user_id = 'e1111111-0000-4000-8000-000000000001';

DO $f1$
DECLARE
  v_row RECORD;
  v_count INTEGER;
  v_denied BOOLEAN;
BEGIN
  SELECT count(*) INTO v_count FROM public.v_encounters_read_model;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Tenant A expected one encounter, found %', v_count;
  END IF;

  SELECT * INTO v_row FROM public.v_encounters_read_model;
  IF v_row.id <> 981003
     OR v_row.company_id <> 'e1111111-1111-4111-8111-111111111111'::UUID
     OR v_row.patient_name <> 'Encounter Patient A'
     OR v_row.signed_by_name IS NOT NULL
     OR v_row.status <> 'legacy_locked'
     OR v_row.summary <> 'Evolucao A' THEN
    RAISE EXCEPTION 'Tenant A encounter projection mismatch: %', row_to_json(v_row);
  END IF;

  v_denied := FALSE;
  BEGIN
    UPDATE public.v_encounters_read_model SET summary = 'DML proibido' WHERE id = 981003;
  EXCEPTION WHEN insufficient_privilege OR object_not_in_prerequisite_state THEN
    v_denied := TRUE;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'UPDATE through encounters read model was accepted'; END IF;

  v_denied := FALSE;
  BEGIN
    DELETE FROM public.v_encounters_read_model WHERE id = 981003;
  EXCEPTION WHEN insufficient_privilege OR object_not_in_prerequisite_state THEN
    v_denied := TRUE;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'DELETE through encounters read model was accepted'; END IF;

  v_denied := FALSE;
  BEGIN
    INSERT INTO public.v_encounters_read_model (id) VALUES (989999);
  EXCEPTION WHEN insufficient_privilege OR object_not_in_prerequisite_state THEN
    v_denied := TRUE;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'INSERT through encounters read model was accepted'; END IF;
END
$f1$;

SET LOCAL app.test_user_id = 'e2222222-0000-4000-8000-000000000001';
DO $f1$
DECLARE v_ids BIGINT[];
BEGIN
  SELECT array_agg(id ORDER BY id) INTO v_ids FROM public.v_encounters_read_model;
  IF v_ids IS DISTINCT FROM ARRAY[982003::BIGINT] THEN
    RAISE EXCEPTION 'Tenant B isolation failed: %', v_ids;
  END IF;
END
$f1$;

SET LOCAL app.test_user_id = 'e0000000-0000-4000-8000-000000000001';
DO $f1$
DECLARE v_count INTEGER;
BEGIN
  SELECT count(*) INTO v_count FROM public.v_encounters_read_model;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'User without company saw encounters: %', v_count;
  END IF;
END
$f1$;

RESET ROLE;
SET LOCAL ROLE anon;
DO $f1$
DECLARE v_denied BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM 1 FROM public.v_encounters_read_model LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := TRUE;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'anon read v_encounters_read_model'; END IF;
END
$f1$;
RESET ROLE;

ROLLBACK;
SELECT 'F1_RUNTIME_ENCOUNTERS_READ_MODEL_GATE=PASS' AS result;

