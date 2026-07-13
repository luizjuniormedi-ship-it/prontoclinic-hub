-- Tenant-safe canonical references for TISS metadata only.
-- This migration does not generate or transmit TISS payloads and performs no backfill.

ALTER TABLE public.tiss_xml
  ADD COLUMN IF NOT EXISTS billing_id BIGINT,
  ADD COLUMN IF NOT EXISTS appointment_id BIGINT,
  ADD COLUMN IF NOT EXISTS patient_id BIGINT,
  ADD COLUMN IF NOT EXISTS insurance_plan_id INTEGER,
  ADD COLUMN IF NOT EXISTS insurance_authorization_id UUID;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tiss_xml WHERE company_id IS NULL) THEN
    RAISE EXCEPTION
      'tiss_xml possui company_id NULL; saneamento controlado obrigatorio antes desta migracao';
  END IF;
END
$$;

ALTER TABLE public.tiss_xml
  ALTER COLUMN company_id SET NOT NULL;

-- Composite foreign keys require a tenant-qualified unique key on each target.
DO $$
DECLARE
  v_target REGCLASS;
  v_index_name TEXT;
  v_has_equivalent BOOLEAN;
  v_existing_definition TEXT;
  v_item RECORD;
BEGIN
  FOR v_item IN
    SELECT * FROM (VALUES
      ('public.billings', 'billings_company_id_id_key'),
      ('public.appointments', 'appointments_company_id_id_key'),
      ('public.patients', 'patients_company_id_id_key'),
      ('public.insurance_plans', 'insurance_plans_company_id_id_key'),
      ('public.insurance_authorizations', 'insurance_authorizations_company_id_id_key')
    ) AS keys(target_name, index_name)
  LOOP
    v_target := to_regclass(v_item.target_name);
    IF v_target IS NULL THEN
      RAISE EXCEPTION 'Tabela canonica obrigatoria ausente: %', v_item.target_name;
    END IF;

    SELECT EXISTS (
      SELECT 1
        FROM pg_index i
       WHERE i.indrelid = v_target
         AND i.indisunique
         AND i.indisvalid
         AND i.indpred IS NULL
         AND i.indexprs IS NULL
         AND i.indnatts = 2
         AND i.indnkeyatts = 2
         AND i.indkey[0] = (
           SELECT attnum FROM pg_attribute WHERE attrelid = v_target AND attname = 'company_id'
         )
         AND i.indkey[1] = (
           SELECT attnum FROM pg_attribute WHERE attrelid = v_target AND attname = 'id'
         )
    ) INTO v_has_equivalent;

    IF NOT v_has_equivalent THEN
      v_index_name := v_item.index_name;
      SELECT pg_get_indexdef(c.oid)
        INTO v_existing_definition
        FROM pg_class c
       WHERE c.relkind = 'i'
         AND c.relnamespace = 'public'::REGNAMESPACE
         AND c.relname = v_index_name;

      IF v_existing_definition IS NOT NULL THEN
        RAISE EXCEPTION 'Indice % existe com definicao incompativel: %',
          v_index_name, v_existing_definition;
      END IF;

      EXECUTE format(
        'CREATE UNIQUE INDEX %I ON %s (company_id, id)',
        v_index_name,
        v_target
      );
    END IF;
  END LOOP;
END
$$;

-- One future TISS metadata row per canonical billing; legacy NULLs remain allowed.
DO $$
DECLARE
  v_has_equivalent BOOLEAN;
  v_existing_definition TEXT;
BEGIN
  SELECT EXISTS (
    SELECT 1
      FROM pg_index i
     WHERE i.indrelid = 'public.tiss_xml'::REGCLASS
       AND i.indisunique
       AND i.indisvalid
       AND i.indexprs IS NULL
       AND i.indnatts = 2
       AND i.indnkeyatts = 2
       AND i.indkey[0] = (
         SELECT attnum FROM pg_attribute
          WHERE attrelid = 'public.tiss_xml'::REGCLASS AND attname = 'company_id'
       )
       AND i.indkey[1] = (
         SELECT attnum FROM pg_attribute
          WHERE attrelid = 'public.tiss_xml'::REGCLASS AND attname = 'billing_id'
       )
       AND pg_get_expr(i.indpred, i.indrelid) IN (
         '(billing_id IS NOT NULL)',
         'billing_id IS NOT NULL'
       )
  ) INTO v_has_equivalent;

  IF NOT v_has_equivalent THEN
    SELECT pg_get_indexdef(c.oid)
      INTO v_existing_definition
      FROM pg_class c
     WHERE c.relkind = 'i'
       AND c.relnamespace = 'public'::REGNAMESPACE
       AND c.relname = 'tiss_xml_company_billing_uq';

    IF v_existing_definition IS NOT NULL THEN
      RAISE EXCEPTION 'Indice tiss_xml_company_billing_uq existe com definicao incompativel: %',
        v_existing_definition;
    END IF;

    CREATE UNIQUE INDEX tiss_xml_company_billing_uq
      ON public.tiss_xml(company_id, billing_id)
      WHERE billing_id IS NOT NULL;
  END IF;
END
$$;

-- Add equivalent tenant-aware references only once, even if another valid name was used.
DO $$
DECLARE
  v_item RECORD;
  v_target REGCLASS;
  v_local_columns SMALLINT[];
  v_target_columns SMALLINT[];
  v_name_definition TEXT;
BEGIN
  FOR v_item IN
    SELECT * FROM (VALUES
      ('tiss_xml_company_billing_fkey', 'billing_id', 'public.billings'),
      ('tiss_xml_company_appointment_fkey', 'appointment_id', 'public.appointments'),
      ('tiss_xml_company_patient_fkey', 'patient_id', 'public.patients'),
      ('tiss_xml_company_insurance_plan_fkey', 'insurance_plan_id', 'public.insurance_plans'),
      ('tiss_xml_company_insurance_authorization_fkey', 'insurance_authorization_id', 'public.insurance_authorizations')
    ) AS refs(constraint_name, local_id_column, target_name)
  LOOP
    v_target := to_regclass(v_item.target_name);
    IF v_target IS NULL THEN
      RAISE EXCEPTION 'Tabela canonica obrigatoria ausente: %', v_item.target_name;
    END IF;

    v_local_columns := ARRAY[
      (SELECT attnum FROM pg_attribute
        WHERE attrelid = 'public.tiss_xml'::REGCLASS AND attname = 'company_id'),
      (SELECT attnum FROM pg_attribute
        WHERE attrelid = 'public.tiss_xml'::REGCLASS AND attname = v_item.local_id_column)
    ]::SMALLINT[];
    v_target_columns := ARRAY[
      (SELECT attnum FROM pg_attribute
        WHERE attrelid = v_target AND attname = 'company_id'),
      (SELECT attnum FROM pg_attribute
        WHERE attrelid = v_target AND attname = 'id')
    ]::SMALLINT[];

    IF NOT EXISTS (
      SELECT 1
        FROM pg_constraint c
       WHERE c.conrelid = 'public.tiss_xml'::REGCLASS
         AND c.contype = 'f'
         AND c.confrelid = v_target
         AND c.conkey = v_local_columns
         AND c.confkey = v_target_columns
         AND c.confmatchtype = 's'
         AND c.confupdtype = 'a'
         AND c.confdeltype = 'r'
         AND NOT c.condeferrable
    ) THEN
      SELECT pg_get_constraintdef(c.oid, TRUE)
        INTO v_name_definition
        FROM pg_constraint c
       WHERE c.conrelid = 'public.tiss_xml'::REGCLASS
         AND c.conname = v_item.constraint_name;

      IF v_name_definition IS NOT NULL THEN
        RAISE EXCEPTION 'Constraint % existe com definicao incompativel: %',
          v_item.constraint_name, v_name_definition;
      END IF;

      EXECUTE format(
        'ALTER TABLE public.tiss_xml ADD CONSTRAINT %I '
        'FOREIGN KEY (company_id, %I) REFERENCES %s (company_id, id) '
        'ON DELETE RESTRICT NOT VALID',
        v_item.constraint_name,
        v_item.local_id_column,
        v_target
      );
    END IF;
  END LOOP;
END
$$;

ALTER TABLE public.tiss_xml ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tiss_xml FORCE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.tiss_xml FROM PUBLIC, anon, authenticated;

-- Remove legacy write policies. Recreate read access only when the established
-- tenant helper and the authenticated role are both available.
DO $$
DECLARE
  v_policy RECORD;
BEGIN
  FOR v_policy IN
    SELECT policyname
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'tiss_xml'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.tiss_xml', v_policy.policyname);
  END LOOP;

  IF to_regprocedure('public.get_my_company_id()') IS NOT NULL
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    IF (SELECT prorettype = 'uuid'::REGTYPE
          FROM pg_proc
         WHERE oid = to_regprocedure('public.get_my_company_id()'))
       AND has_function_privilege(
         'authenticated',
         to_regprocedure('public.get_my_company_id()'),
         'EXECUTE'
       ) THEN
      CREATE POLICY tiss_xml_tenant_select
        ON public.tiss_xml
        FOR SELECT
        TO authenticated
        USING (company_id = public.get_my_company_id());
    END IF;
  END IF;
END
$$;
