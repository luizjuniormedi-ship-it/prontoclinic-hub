-- =============================================================================
-- fix-migration-types.sql
-- =============================================================================

-- Mudar IDs para BIGINT
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY['professionals', 'patients', 'appointments', 'services_catalog', 'appointment_types', 'medical_records', 'billings', 'user_profiles'])
  LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN id DROP DEFAULT', t);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN id TYPE BIGINT USING 1', t);
  END LOOP;
END $$;

ALTER TABLE public.companies ALTER COLUMN id DROP DEFAULT;
ALTER TABLE public.companies ALTER COLUMN id TYPE BIGINT USING 1;

-- Re-criar sequences para IDs
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY['professionals', 'patients', 'appointments', 'services_catalog', 'appointment_types', 'medical_records', 'billings', 'companies'])
  LOOP
    EXECUTE format('CREATE SEQUENCE IF NOT EXISTS public.%I_id_seq', t);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN id SET DEFAULT nextval(''public.%I_id_seq'')', t, t);
    EXECUTE format('SELECT setval(''public.%I_id_seq'', 1)', t);
  END LOOP;
END $$;

SELECT 'IDs convertidos para BIGINT' AS status;
