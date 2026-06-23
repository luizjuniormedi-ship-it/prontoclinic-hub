-- =============================================================================
-- pre-migration-patch.sql
-- Drops all migration-created objects (triggers, functions) to allow re-runs
-- Idempotent: safe to run multiple times
-- =============================================================================

-- Drop all custom triggers that migrations create
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tgname AS tname, c.relname AS tbl
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE NOT t.tgisinternal
      AND c.relnamespace = 'public'::regnamespace
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I CASCADE', r.tname, r.tbl);
  END LOOP;
END $$;

-- Drop all functions created by migrations
DROP FUNCTION IF EXISTS public.confirm_pre_cadastro(character varying) CASCADE;
DROP FUNCTION IF EXISTS public.cancel_pre_cadastro(character varying) CASCADE;
DROP FUNCTION IF EXISTS public.create_pre_cadastro(varchar, varchar, varchar, varchar, varchar, varchar) CASCADE;
DROP FUNCTION IF EXISTS public.promote_pre_cadastro(bigint) CASCADE;
DROP FUNCTION IF EXISTS public.anonymize_patient(bigint) CASCADE;
DROP FUNCTION IF EXISTS public.request_anonymize_patient(bigint, varchar) CASCADE;
DROP FUNCTION IF EXISTS public.export_patient_data(bigint) CASCADE;
DROP FUNCTION IF EXISTS public.bloquear_update_anonimizacao() CASCADE;
DROP FUNCTION IF EXISTS public.validate_anonimizacao_log() CASCADE;
DROP FUNCTION IF EXISTS public.validate_insurance_company() CASCADE;
DROP FUNCTION IF EXISTS public.find_price(bigint, bigint, varchar) CASCADE;
DROP FUNCTION IF EXISTS public.audit_trigger_func() CASCADE;
DROP FUNCTION IF EXISTS public.set_updated_at() CASCADE;
DROP FUNCTION IF EXISTS public.queue_notification(varchar, bigint, varchar, jsonb, varchar, bigint) CASCADE;
DROP FUNCTION IF EXISTS public.get_dicom_exam_by_appointment(bigint) CASCADE;
DROP FUNCTION IF EXISTS public.publish_dicom_report(bigint, varchar, varchar) CASCADE;
DROP FUNCTION IF EXISTS public.create_password_reset(varchar) CASCADE;
DROP FUNCTION IF EXISTS public.log_data_access(varchar, varchar, varchar, varchar, jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.purge_expired_audit_logs(integer) CASCADE;
DROP FUNCTION IF EXISTS public.tiss_get_stats(varchar, varchar) CASCADE;
DROP FUNCTION IF EXISTS public.get_my_company_id() CASCADE;

-- Drop all custom indexes (idempotent re-create)
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT indexname AS iname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname NOT LIKE '%_pkey'
      AND indexname NOT LIKE '%_unique'
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS public.%I', r.iname);
  END LOOP;
END $$;

-- Drop all custom RLS policies
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname AS pname, tablename AS tbl
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.pname, r.tbl);
  END LOOP;
END $$;

-- Drop all views
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT viewname AS vname
    FROM pg_views
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP VIEW IF EXISTS public.%I CASCADE', r.vname);
  END LOOP;
END $$;

SELECT 'Pre-migration patch applied - all custom objects dropped' AS status;
