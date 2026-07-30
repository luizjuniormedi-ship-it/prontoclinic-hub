\set ON_ERROR_STOP on

DO $contract$
DECLARE
  v_policy RECORD;
BEGIN
  IF NOT (
    SELECT relrowsecurity
      FROM pg_class
     WHERE oid = 'public.patients'::regclass
  ) THEN
    RAISE EXCEPTION 'patients precisa manter RLS habilitada';
  END IF;

  FOR v_policy IN
    SELECT *
      FROM (
        VALUES
          ('patients_access_select', 'SELECT', true),
          ('patients_access_insert', 'INSERT', false),
          ('patients_access_update', 'UPDATE', false),
          ('patients_access_delete', 'DELETE', false)
      ) AS expected(policy_name, command_name, shared_read)
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_policies policy
       WHERE policy.schemaname = 'public'
         AND policy.tablename = 'patients'
         AND policy.policyname = v_policy.policy_name
         AND policy.cmd = v_policy.command_name
         AND policy.roles = ARRAY['authenticated']::name[]
    ) THEN
      RAISE EXCEPTION 'Policy obrigatoria ausente ou com papel incorreto: %',
        v_policy.policy_name;
    END IF;
  END LOOP;

  IF (
    SELECT position('active_company_id' IN coalesce(qual, '')) = 0
        OR position('active_unit_id' IN coalesce(qual, '')) = 0
        OR position('org_can_access_unit' IN coalesce(qual, '')) = 0
        OR position('unit_id = active_unit_id' IN replace(coalesce(qual, ''), 'public.', '')) > 0
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'patients'
       AND policyname = 'patients_access_select'
  ) THEN
    RAISE EXCEPTION
      'SELECT deve compartilhar por empresa e exigir unidade ativa autorizada sem filtrar pela unidade de origem';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'patients'
       AND policyname IN (
         'patients_access_insert',
         'patients_access_update',
         'patients_access_delete'
       )
       AND position(
         'unit_id = active_unit_id'
         IN replace(coalesce(qual, with_check, ''), 'public.', '')
       ) = 0
  ) THEN
    RAISE EXCEPTION
      'Toda escrita em patients deve exigir unidade de origem igual a unidade ativa';
  END IF;

  IF (
    SELECT position(
      'unit_id = active_unit_id'
      IN replace(coalesce(with_check, ''), 'public.', '')
    ) = 0
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'patients'
       AND policyname = 'patients_access_update'
  ) THEN
    RAISE EXCEPTION
      'WITH CHECK de UPDATE deve impedir troca implicita da unidade de origem';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'patients'
       AND policyname LIKE 'patients_access_%'
       AND (
         coalesce(qual, '') ~ '(^|[^[:alnum:]_])true([^[:alnum:]_]|$)'
         OR coalesce(with_check, '') ~ '(^|[^[:alnum:]_])true([^[:alnum:]_]|$)'
       )
  ) THEN
    RAISE EXCEPTION 'Policies de patients nao podem conter acesso global USING/WITH CHECK true';
  END IF;
END
$contract$;

\echo PATIENTS_DEFINITIVE_UNIT_SHARING_CONTRACT_PASS
