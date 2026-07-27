-- Migration: 20260727020432
-- Module 16 / TISS legacy runtime security closure.
-- Additive, fail-closed and safe to replay.
-- This migration never transmits XML and never accesses DataSIGH.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

DO $preflight$
DECLARE
  v_table TEXT;
  v_column TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RAISE EXCEPTION 'Module 16 requires role authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_prontomedic') THEN
    RAISE EXCEPTION 'Module 16 requires role app_prontomedic';
  END IF;
  IF to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'Module 16 requires auth.uid()';
  END IF;
  IF to_regprocedure('public.current_company_id()') IS NULL THEN
    RAISE EXCEPTION 'Module 16 requires public.current_company_id()';
  END IF;
  IF to_regprocedure('public.request_company_id()') IS NULL THEN
    RAISE EXCEPTION 'Module 16 requires public.request_company_id()';
  END IF;
  IF to_regprocedure('public.request_aal()') IS NULL THEN
    RAISE EXCEPTION 'Module 16 requires public.request_aal()';
  END IF;
  IF to_regprocedure('public.active_company_id()') IS NULL THEN
    RAISE EXCEPTION 'Module 16 requires public.active_company_id()';
  END IF;
  IF to_regprocedure('public.can_access(text,text)') IS NULL THEN
    RAISE EXCEPTION 'Module 16 requires public.can_access(text,text)';
  END IF;
  IF to_regprocedure('public.digest(text,text)') IS NULL
     AND to_regprocedure('public.digest(bytea,text)') IS NULL THEN
    RAISE EXCEPTION 'Module 16 requires pgcrypto digest()';
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'companies',
    'memberships',
    'membership_roles',
    'membership_units',
    'user_access_context',
    'role_permissions',
    'appointments',
    'insurance_companies',
    'insurance_plans',
    'billing_accounts',
    'tiss_xml',
    'tiss_glosas',
    'tiss_protocols',
    'tiss_guides',
    'tiss_guide_events'
  ] LOOP
    IF to_regclass('public.' || v_table) IS NULL THEN
      RAISE EXCEPTION 'Module 16 requires public.%', v_table;
    END IF;
  END LOOP;

  FOR v_table, v_column IN
    SELECT *
      FROM (VALUES
        ('memberships', 'id'),
        ('memberships', 'user_id'),
        ('memberships', 'company_id'),
        ('memberships', 'status'),
        ('user_access_context', 'user_id'),
        ('user_access_context', 'session_id'),
        ('user_access_context', 'membership_id'),
        ('user_access_context', 'role_id'),
        ('role_permissions', 'company_id'),
        ('role_permissions', 'role_id'),
        ('role_permissions', 'module'),
        ('role_permissions', 'can_view'),
        ('role_permissions', 'can_create'),
        ('role_permissions', 'can_edit'),
        ('role_permissions', 'can_export'),
        ('appointments', 'id'),
        ('appointments', 'company_id'),
        ('appointments', 'appointment_date'),
        ('appointments', 'insurance_plan_id'),
        ('appointments', 'insurance_company_id'),
        ('insurance_companies', 'id'),
        ('insurance_companies', 'company_id'),
        ('insurance_companies', 'name'),
        ('insurance_companies', 'lg_ativo'),
        ('insurance_plans', 'id'),
        ('insurance_plans', 'company_id'),
        ('insurance_plans', 'insurance_company_id'),
        ('billing_accounts', 'id'),
        ('billing_accounts', 'company_id'),
        ('tiss_xml', 'id'),
        ('tiss_xml', 'company_id'),
        ('tiss_xml', 'appointment_id'),
        ('tiss_xml', 'cd_convenio'),
        ('tiss_xml', 'guide_id'),
        ('tiss_xml', 'billing_account_id'),
        ('tiss_glosas', 'id'),
        ('tiss_glosas', 'company_id'),
        ('tiss_glosas', 'cd_tiss_xml'),
        ('tiss_protocols', 'id'),
        ('tiss_protocols', 'company_id'),
        ('tiss_protocols', 'cd_convenio'),
        ('tiss_guides', 'id'),
        ('tiss_guides', 'company_id'),
        ('tiss_guides', 'appointment_id'),
        ('tiss_guides', 'source_xml_id'),
        ('tiss_guides', 'billing_account_id'),
        ('tiss_guide_events', 'id'),
        ('tiss_guide_events', 'company_id'),
        ('tiss_guide_events', 'guide_id')
      ) AS required_columns(table_name, column_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = v_table
         AND column_name = v_column
    ) THEN
      RAISE EXCEPTION 'Module 16 requires public.%.%', v_table, v_column;
    END IF;
  END LOOP;
END
$preflight$;

-- Provision the canonical TISS permission matrix for existing active tenants.
-- Existing rows are never overwritten, so an explicit company denial remains
-- authoritative. New tenants must receive the same matrix during provisioning.
INSERT INTO public.role_permissions (
  company_id,
  role_id,
  module,
  can_view,
  can_create,
  can_edit,
  can_delete,
  can_export
)
SELECT
  company.id,
  role_record.id,
  'faturamento',
  TRUE,
  TRUE,
  TRUE,
  FALSE,
  TRUE
FROM public.companies company
JOIN public.roles role_record
  ON lower(role_record.name) IN (
    'admin',
    'administrador',
    'billing',
    'faturamento',
    'faturista',
    'financeiro',
    'gestor'
  )
 AND role_record.lg_ativo = TRUE
WHERE company.lg_ativo = TRUE
ON CONFLICT (company_id, role_id, module) DO NOTHING;

-- Required by m16_save_protocol_secure's deterministic upsert.
-- Existing duplicates must abort the migration instead of being merged.
CREATE UNIQUE INDEX IF NOT EXISTS
  tiss_protocols_company_insurance_environment_m16_uq
  ON public.tiss_protocols(company_id, cd_convenio, tp_ambiente);

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

DO $roles$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'prontomedic_tiss_rpc_owner'
  ) THEN
    CREATE ROLE prontomedic_tiss_rpc_owner;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'prontomedic_tiss_gateway'
  ) THEN
    CREATE ROLE prontomedic_tiss_gateway;
  END IF;
END
$roles$;

ALTER ROLE prontomedic_tiss_rpc_owner
  NOLOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER
  NOCREATEDB NOCREATEROLE NOREPLICATION;
ALTER ROLE prontomedic_tiss_gateway
  NOLOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER
  NOCREATEDB NOCREATEROLE NOREPLICATION;

DO $owner_membership_preflight$
DECLARE
  v_owner_oid OID;
  v_memberships TEXT;
BEGIN
  SELECT oid
    INTO v_owner_oid
    FROM pg_roles
   WHERE rolname = 'prontomedic_tiss_rpc_owner';

  IF EXISTS (
    SELECT 1
      FROM pg_roles
     WHERE oid = v_owner_oid
       AND (
         rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb
         OR rolcreaterole OR rolreplication OR rolbypassrls
       )
  ) THEN
    RAISE EXCEPTION 'prontomedic_tiss_rpc_owner has unsafe role attributes';
  END IF;

  SELECT string_agg(
           CASE
             WHEN membership.member = v_owner_oid
               THEN 'member-of:' || granted_role.rolname
             ELSE 'granted-to:' || member_role.rolname
           END,
           ', ' ORDER BY granted_role.rolname, member_role.rolname
         )
    INTO v_memberships
    FROM pg_auth_members membership
    JOIN pg_roles granted_role ON granted_role.oid = membership.roleid
    JOIN pg_roles member_role ON member_role.oid = membership.member
   WHERE membership.member = v_owner_oid
      OR membership.roleid = v_owner_oid;

  IF v_memberships IS NOT NULL THEN
    RAISE EXCEPTION
      'prontomedic_tiss_rpc_owner must have no role memberships: %',
      v_memberships;
  END IF;
END
$owner_membership_preflight$;

DO $tenant_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.tiss_xml xml
     WHERE xml.appointment_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public.appointments appointment
          WHERE appointment.id = xml.appointment_id
            AND appointment.company_id = xml.company_id
       )
  ) THEN
    RAISE EXCEPTION
      'Module 16 preflight failed: TISS XML has missing/cross-company appointment';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.tiss_xml xml
     WHERE xml.cd_convenio IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public.insurance_companies insurance
          WHERE insurance.id = xml.cd_convenio
            AND insurance.company_id = xml.company_id
       )
  ) THEN
    RAISE EXCEPTION
      'Module 16 preflight failed: TISS XML has missing/cross-company insurance company';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.tiss_glosas denial
     WHERE NOT EXISTS (
       SELECT 1
         FROM public.tiss_xml xml
        WHERE xml.id = denial.cd_tiss_xml
          AND xml.company_id = denial.company_id
     )
  ) THEN
    RAISE EXCEPTION
      'Module 16 preflight failed: TISS denial has missing/cross-company XML';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.tiss_protocols protocol
     WHERE NOT EXISTS (
       SELECT 1
         FROM public.insurance_companies insurance
        WHERE insurance.id = protocol.cd_convenio
          AND insurance.company_id = protocol.company_id
     )
  ) THEN
    RAISE EXCEPTION
      'Module 16 preflight failed: TISS protocol has missing/cross-company insurance company';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.tiss_guides guide
     WHERE (
       guide.appointment_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public.appointments appointment
          WHERE appointment.id = guide.appointment_id
            AND appointment.company_id = guide.company_id
       )
     ) OR (
       guide.source_xml_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public.tiss_xml xml
          WHERE xml.id = guide.source_xml_id
            AND xml.company_id = guide.company_id
       )
      ) OR (
        guide.billing_account_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
            FROM public.billing_accounts account
           WHERE account.id = guide.billing_account_id
             AND account.company_id = guide.company_id
        )
      ) OR (
        guide.substitution_of_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
            FROM public.tiss_guides original_guide
           WHERE original_guide.id = guide.substitution_of_id
             AND original_guide.company_id = guide.company_id
        )
      )
  ) THEN
    RAISE EXCEPTION
      'Module 16 preflight failed: TISS guide has missing/cross-company ancestry';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.tiss_guide_events event
     WHERE NOT EXISTS (
       SELECT 1
         FROM public.tiss_guides guide
        WHERE guide.id = event.guide_id
          AND guide.company_id = event.company_id
     )
  ) THEN
    RAISE EXCEPTION
      'Module 16 preflight failed: TISS guide event has missing/cross-company guide';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.tiss_xml xml
     WHERE (
       xml.guide_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public.tiss_guides guide
          WHERE guide.id = xml.guide_id
            AND guide.company_id = xml.company_id
       )
     ) OR (
       xml.billing_account_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public.billing_accounts account
          WHERE account.id = xml.billing_account_id
            AND account.company_id = xml.company_id
       )
     )
  ) THEN
    RAISE EXCEPTION
      'Module 16 preflight failed: TISS XML has missing/cross-company guide or billing account';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.tiss_xml xml
     WHERE xml.vl_informado = 'NaN'::NUMERIC
        OR xml.vl_processado = 'NaN'::NUMERIC
        OR xml.vl_liberado = 'NaN'::NUMERIC
        OR xml.vl_glosa = 'NaN'::NUMERIC
        OR COALESCE(xml.vl_informado, 0) < 0
        OR COALESCE(xml.vl_processado, 0) < 0
        OR COALESCE(xml.vl_liberado, 0) < 0
        OR COALESCE(xml.vl_glosa, 0) < 0
        OR (
          xml.vl_processado IS NOT NULL
          AND xml.vl_liberado IS NOT NULL
          AND xml.vl_liberado > xml.vl_processado
        )
  ) THEN
    RAISE EXCEPTION
      'Module 16 preflight failed: TISS XML has invalid financial values';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.tiss_xml xml
     WHERE (
       xml.ds_hash_envio IS NOT NULL
       AND lower(xml.ds_hash_envio) !~ '^[0-9a-f]{64}$'
     ) OR (
       xml.ds_hash_retorno IS NOT NULL
       AND lower(xml.ds_hash_retorno) !~ '^[0-9a-f]{64}$'
     )
  ) THEN
    RAISE EXCEPTION
      'Module 16 preflight failed: TISS XML has a non-SHA-256 hash';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.tiss_glosas denial
     WHERE denial.vl_glosa = 'NaN'::NUMERIC
        OR denial.vl_glosa <= 0
  ) THEN
    RAISE EXCEPTION
      'Module 16 preflight failed: TISS denial has invalid financial value';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.tiss_guides guide
     WHERE (
       guide.status IN ('DRAFT', 'VALIDATED')
       AND (
         guide.signed_by IS NOT NULL
         OR guide.signed_at IS NOT NULL
         OR guide.signature_sha256 IS NOT NULL
         OR guide.signature_reference IS NOT NULL
         OR guide.cancelled_by IS NOT NULL
         OR guide.cancelled_at IS NOT NULL
         OR guide.cancellation_reason IS NOT NULL
         OR guide.substitution_reason IS NOT NULL
       )
     ) OR (
       guide.status = 'SIGNED'
       AND (
         guide.signature_sha256 IS NULL
         OR guide.signature_sha256 !~ '^[0-9a-f]{64}$'
         OR guide.signed_at IS NULL
         OR guide.signed_by IS NULL
         OR guide.cancelled_by IS NOT NULL
         OR guide.cancelled_at IS NOT NULL
         OR guide.cancellation_reason IS NOT NULL
         OR guide.substitution_reason IS NOT NULL
       )
     ) OR (
       guide.status = 'CANCELLED'
       AND (
         guide.cancelled_at IS NULL
         OR NULLIF(trim(COALESCE(guide.cancellation_reason, '')), '') IS NULL
         OR (
           (guide.signature_sha256 IS NOT NULL
            OR guide.signed_at IS NOT NULL
            OR guide.signed_by IS NOT NULL)
           AND (
             guide.signature_sha256 IS NULL
             OR guide.signature_sha256 !~ '^[0-9a-f]{64}$'
             OR guide.signed_at IS NULL
             OR guide.signed_by IS NULL
           )
         )
       )
     ) OR (
       guide.status = 'SUBSTITUTED'
       AND (
         guide.signature_sha256 IS NULL
         OR guide.signature_sha256 !~ '^[0-9a-f]{64}$'
         OR guide.signed_at IS NULL
         OR guide.signed_by IS NULL
         OR NULLIF(trim(COALESCE(guide.substitution_reason, '')), '') IS NULL
       )
     )
  ) THEN
    RAISE EXCEPTION
      'Module 16 preflight failed: TISS guide lifecycle evidence is inconsistent';
  END IF;
END
$tenant_preflight$;

ALTER TABLE public.tiss_glosas
  ADD COLUMN IF NOT EXISTS operation_id UUID,
  ADD COLUMN IF NOT EXISTS operation_item_index INTEGER;

CREATE TABLE IF NOT EXISTS public.tiss_operation_requests (
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  operation_id UUID NOT NULL,
  operation_type TEXT NOT NULL CHECK (operation_type IN (
    'persist_xml',
    'record_transmission',
    'process_return',
    'manual_denial',
    'monthly_batch',
    'save_protocol'
  )),
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  request_payload JSONB NOT NULL CHECK (jsonb_typeof(request_payload) = 'object'),
  response_payload JSONB,
  actor_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  PRIMARY KEY (company_id, operation_id),
  CHECK (response_payload IS NULL OR jsonb_typeof(response_payload) = 'object')
);

CREATE SEQUENCE IF NOT EXISTS public.tiss_batch_number_seq
  AS INTEGER
  MINVALUE 1
  MAXVALUE 2147483647
  CYCLE;

CREATE UNIQUE INDEX IF NOT EXISTS tiss_xml_company_id_uq
  ON public.tiss_xml(company_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS tiss_guides_company_id_uq
  ON public.tiss_guides(company_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS billing_accounts_company_id_uq
  ON public.billing_accounts(company_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS tiss_glosas_operation_item_uq
  ON public.tiss_glosas(company_id, operation_id, operation_item_index)
  WHERE operation_id IS NOT NULL;

DO $constraints$
BEGIN
  ALTER TABLE public.tiss_xml
    DROP CONSTRAINT IF EXISTS tiss_xml_financial_values_chk;
  ALTER TABLE public.tiss_xml
    ADD CONSTRAINT tiss_xml_financial_values_chk CHECK (
      (vl_informado IS NULL OR (
        vl_informado >= 0 AND vl_informado <> 'NaN'::NUMERIC
      ))
      AND (vl_processado IS NULL OR (
        vl_processado >= 0 AND vl_processado <> 'NaN'::NUMERIC
      ))
      AND (vl_liberado IS NULL OR (
        vl_liberado >= 0 AND vl_liberado <> 'NaN'::NUMERIC
      ))
      AND (vl_glosa IS NULL OR (
        vl_glosa >= 0 AND vl_glosa <> 'NaN'::NUMERIC
      ))
      AND (
        vl_processado IS NULL
        OR vl_liberado IS NULL
        OR vl_liberado <= vl_processado
      )
    );

  ALTER TABLE public.tiss_xml
    DROP CONSTRAINT IF EXISTS tiss_xml_hash_sha256_chk;
  ALTER TABLE public.tiss_xml
    ADD CONSTRAINT tiss_xml_hash_sha256_chk CHECK (
      (
        ds_hash_envio IS NULL
        OR ds_hash_envio ~ '^[0-9a-f]{64}$'
      )
      AND (
        ds_hash_retorno IS NULL
        OR ds_hash_retorno ~ '^[0-9a-f]{64}$'
      )
    );

  ALTER TABLE public.tiss_glosas
    DROP CONSTRAINT IF EXISTS tiss_glosas_positive_value_chk;
  ALTER TABLE public.tiss_glosas
    ADD CONSTRAINT tiss_glosas_positive_value_chk CHECK (
      vl_glosa > 0 AND vl_glosa <> 'NaN'::NUMERIC
    );

  ALTER TABLE public.tiss_guides
    DROP CONSTRAINT IF EXISTS tiss_guides_signature_sha256_chk;
  ALTER TABLE public.tiss_guides
    ADD CONSTRAINT tiss_guides_signature_sha256_chk CHECK (
      (
        status IN ('DRAFT', 'VALIDATED')
        AND signed_by IS NULL
        AND signed_at IS NULL
        AND signature_sha256 IS NULL
        AND signature_reference IS NULL
        AND cancelled_by IS NULL
        AND cancelled_at IS NULL
        AND cancellation_reason IS NULL
        AND substitution_reason IS NULL
      ) OR (
        status = 'SIGNED'
        AND signed_by IS NOT NULL
        AND signed_at IS NOT NULL
        AND signature_sha256 ~ '^[0-9a-f]{64}$'
        AND cancelled_by IS NULL
        AND cancelled_at IS NULL
        AND cancellation_reason IS NULL
        AND substitution_reason IS NULL
      ) OR (
        status = 'CANCELLED'
        AND cancelled_at IS NOT NULL
        AND NULLIF(trim(COALESCE(cancellation_reason, '')), '') IS NOT NULL
        AND (
          (
            signed_by IS NULL
            AND signed_at IS NULL
            AND signature_sha256 IS NULL
            AND signature_reference IS NULL
          ) OR (
            signed_by IS NOT NULL
            AND signed_at IS NOT NULL
            AND signature_sha256 ~ '^[0-9a-f]{64}$'
          )
        )
      ) OR (
        status = 'SUBSTITUTED'
        AND signed_by IS NOT NULL
        AND signed_at IS NOT NULL
        AND signature_sha256 ~ '^[0-9a-f]{64}$'
        AND NULLIF(trim(COALESCE(substitution_reason, '')), '') IS NOT NULL
      )
    );

  ALTER TABLE public.tiss_xml
    DROP CONSTRAINT IF EXISTS tiss_xml_company_appointment_fkey;
  ALTER TABLE public.tiss_xml
    ADD CONSTRAINT tiss_xml_company_appointment_fkey
    FOREIGN KEY (company_id, appointment_id)
    REFERENCES public.appointments(company_id, id)
    ON DELETE RESTRICT;

  ALTER TABLE public.tiss_glosas
    DROP CONSTRAINT IF EXISTS tiss_glosas_cd_tiss_xml_fkey;
  ALTER TABLE public.tiss_glosas
    DROP CONSTRAINT IF EXISTS tiss_glosas_company_xml_fkey;
  ALTER TABLE public.tiss_glosas
    ADD CONSTRAINT tiss_glosas_company_xml_fkey
    FOREIGN KEY (company_id, cd_tiss_xml)
    REFERENCES public.tiss_xml(company_id, id)
    ON DELETE CASCADE;

  ALTER TABLE public.tiss_protocols
    DROP CONSTRAINT IF EXISTS tiss_protocols_cd_convenio_fkey;
  ALTER TABLE public.tiss_protocols
    DROP CONSTRAINT IF EXISTS tiss_protocols_company_insurance_fkey;
  ALTER TABLE public.tiss_protocols
    ADD CONSTRAINT tiss_protocols_company_insurance_fkey
    FOREIGN KEY (company_id, cd_convenio)
    REFERENCES public.insurance_companies(company_id, id)
    ON DELETE RESTRICT;

  ALTER TABLE public.tiss_guides
    DROP CONSTRAINT IF EXISTS tiss_guides_company_appointment_fkey;
  ALTER TABLE public.tiss_guides
    ADD CONSTRAINT tiss_guides_company_appointment_fkey
    FOREIGN KEY (company_id, appointment_id)
    REFERENCES public.appointments(company_id, id)
    ON DELETE RESTRICT;

  ALTER TABLE public.tiss_guides
    DROP CONSTRAINT IF EXISTS tiss_guides_company_source_xml_fkey;
  ALTER TABLE public.tiss_guides
    ADD CONSTRAINT tiss_guides_company_source_xml_fkey
    FOREIGN KEY (company_id, source_xml_id)
    REFERENCES public.tiss_xml(company_id, id)
    ON DELETE RESTRICT;

  ALTER TABLE public.tiss_guides
    DROP CONSTRAINT IF EXISTS tiss_guides_company_billing_account_fkey;
  ALTER TABLE public.tiss_guides
    ADD CONSTRAINT tiss_guides_company_billing_account_fkey
    FOREIGN KEY (company_id, billing_account_id)
    REFERENCES public.billing_accounts(company_id, id)
    ON DELETE RESTRICT;

  ALTER TABLE public.tiss_guides
    DROP CONSTRAINT IF EXISTS tiss_guides_substitution_of_id_fkey;
  ALTER TABLE public.tiss_guides
    DROP CONSTRAINT IF EXISTS tiss_guides_company_substitution_fkey;
  ALTER TABLE public.tiss_guides
    ADD CONSTRAINT tiss_guides_company_substitution_fkey
    FOREIGN KEY (company_id, substitution_of_id)
    REFERENCES public.tiss_guides(company_id, id)
    ON DELETE RESTRICT;

  ALTER TABLE public.tiss_guide_events
    DROP CONSTRAINT IF EXISTS tiss_guide_events_guide_id_fkey;
  ALTER TABLE public.tiss_guide_events
    DROP CONSTRAINT IF EXISTS tiss_guide_events_company_guide_fkey;
  ALTER TABLE public.tiss_guide_events
    ADD CONSTRAINT tiss_guide_events_company_guide_fkey
    FOREIGN KEY (company_id, guide_id)
    REFERENCES public.tiss_guides(company_id, id)
    ON DELETE CASCADE;

  ALTER TABLE public.tiss_xml
    DROP CONSTRAINT IF EXISTS tiss_xml_company_guide_fkey;
  ALTER TABLE public.tiss_xml
    ADD CONSTRAINT tiss_xml_company_guide_fkey
    FOREIGN KEY (company_id, guide_id)
    REFERENCES public.tiss_guides(company_id, id)
    ON DELETE RESTRICT;

  ALTER TABLE public.tiss_xml
    DROP CONSTRAINT IF EXISTS tiss_xml_company_billing_account_fkey;
  ALTER TABLE public.tiss_xml
    ADD CONSTRAINT tiss_xml_company_billing_account_fkey
    FOREIGN KEY (company_id, billing_account_id)
    REFERENCES public.billing_accounts(company_id, id)
    ON DELETE RESTRICT;
END
$constraints$;

CREATE OR REPLACE FUNCTION private.m16_normalize_role(p_role TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT translate(
    lower(trim(COALESCE(p_role, ''))),
    'áàâãäéèêëíìîïóòôõöúùûüç',
    'aaaaaeeeeiiiiooooouuuuc'
  )
$function$;

CREATE OR REPLACE FUNCTION private.m16_tenant_id()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_active_company UUID := public.active_company_id();
  v_claim_company UUID := public.request_company_id();
  v_claim_role TEXT;
BEGIN
  v_claim_role := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', TRUE), ''),
    NULLIF(current_setting('request.jwt.claims', TRUE), '')::JSONB ->> 'role'
  );

  IF v_claim_role = 'prontomedic_tiss_gateway' THEN
    RETURN v_claim_company;
  END IF;

  IF v_active_company IS NOT NULL
     AND v_claim_company IS NOT NULL
     AND v_active_company IS DISTINCT FROM v_claim_company THEN
    RAISE EXCEPTION 'JWT and active access context belong to different companies'
      USING ERRCODE = '42501';
  END IF;

  RETURN v_active_company;
END;
$function$;

CREATE OR REPLACE FUNCTION private.m16_require_actor(
  p_allowed_roles TEXT[],
  p_allow_app_role BOOLEAN DEFAULT FALSE,
  p_required_action TEXT DEFAULT 'view'
)
RETURNS TABLE(user_id UUID, company_id UUID, role_name TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_company UUID;
  v_action TEXT := lower(trim(COALESCE(p_required_action, '')));
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Valid JWT is required'
      USING ERRCODE = '28000';
  END IF;

  IF public.request_aal() IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'AAL2 is required for TISS operations'
      USING ERRCODE = '42501';
  END IF;

  IF v_action NOT IN ('view', 'create', 'edit', 'export') THEN
    RAISE EXCEPTION 'Unsupported TISS permission action'
      USING ERRCODE = '22023';
  END IF;

  v_company := public.active_company_id();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Active canonical access context is required'
      USING ERRCODE = '42501';
  END IF;

  IF public.request_company_id() IS NOT NULL
     AND public.request_company_id() IS DISTINCT FROM v_company THEN
    RAISE EXCEPTION 'JWT and active access context belong to different companies'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_access('faturamento', v_action) THEN
    RAISE EXCEPTION 'Canonical faturamento permission is required'
      USING ERRCODE = '42501';
  END IF;

  user_id := v_user_id;
  company_id := v_company;
  role_name := 'canonical';
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION private.m16_require_gateway()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_claim_role TEXT;
  v_company UUID;
BEGIN
  v_claim_role := NULLIF(
    current_setting('request.jwt.claim.role', TRUE),
    ''
  );
  IF v_claim_role IS NULL THEN
    BEGIN
      v_claim_role :=
        NULLIF(current_setting('request.jwt.claims', TRUE), '')::JSONB
        ->> 'role';
    EXCEPTION WHEN OTHERS THEN
      v_claim_role := NULL;
    END;
  END IF;

  IF v_claim_role IS DISTINCT FROM 'prontomedic_tiss_gateway' THEN
    RAISE EXCEPTION 'Explicit TISS gateway authorization is required'
      USING ERRCODE = '42501';
  END IF;

  v_company := private.m16_tenant_id();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Gateway company claim is required'
      USING ERRCODE = '42501';
  END IF;
  RETURN v_company;
END;
$function$;

CREATE OR REPLACE FUNCTION private.m16_claim_operation(
  p_company_id UUID,
  p_operation_id UUID,
  p_operation_type TEXT,
  p_payload JSONB,
  p_actor_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_hash TEXT;
  v_existing public.tiss_operation_requests;
BEGIN
  IF p_company_id IS NULL OR p_operation_id IS NULL THEN
    RAISE EXCEPTION 'Company and operation id are required';
  END IF;
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Operation payload must be a JSON object';
  END IF;

  v_hash := encode(
    public.digest(convert_to(p_payload::TEXT, 'UTF8'), 'sha256'),
    'hex'
  );

  INSERT INTO public.tiss_operation_requests (
    company_id,
    operation_id,
    operation_type,
    request_hash,
    request_payload,
    actor_id
  ) VALUES (
    p_company_id,
    p_operation_id,
    p_operation_type,
    v_hash,
    p_payload,
    p_actor_id
  )
  ON CONFLICT (company_id, operation_id) DO NOTHING;

  SELECT *
    INTO v_existing
    FROM public.tiss_operation_requests
   WHERE company_id = p_company_id
     AND operation_id = p_operation_id
   FOR UPDATE;

  IF v_existing.operation_type IS DISTINCT FROM p_operation_type
     OR v_existing.request_hash IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'TISS operation id reused with different payload'
      USING ERRCODE = '22023';
  END IF;

  RETURN v_existing.response_payload;
END;
$function$;

CREATE OR REPLACE FUNCTION private.m16_finish_operation(
  p_company_id UUID,
  p_operation_id UUID,
  p_response JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF jsonb_typeof(p_response) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Operation response must be a JSON object';
  END IF;

  UPDATE public.tiss_operation_requests
     SET response_payload = p_response,
         completed_at = NOW()
   WHERE company_id = p_company_id
     AND operation_id = p_operation_id
     AND response_payload IS NULL;

  IF NOT FOUND THEN
    SELECT response_payload
      INTO p_response
      FROM public.tiss_operation_requests
     WHERE company_id = p_company_id
       AND operation_id = p_operation_id;
  END IF;

  RETURN p_response;
END;
$function$;

ALTER FUNCTION private.m16_normalize_role(TEXT)
  OWNER TO prontomedic_tiss_rpc_owner;
ALTER FUNCTION private.m16_tenant_id()
  OWNER TO prontomedic_tiss_rpc_owner;
ALTER FUNCTION private.m16_require_actor(TEXT[], BOOLEAN, TEXT)
  OWNER TO prontomedic_tiss_rpc_owner;
ALTER FUNCTION private.m16_require_gateway()
  OWNER TO prontomedic_tiss_rpc_owner;
ALTER FUNCTION private.m16_claim_operation(UUID, UUID, TEXT, JSONB, UUID)
  OWNER TO prontomedic_tiss_rpc_owner;
ALTER FUNCTION private.m16_finish_operation(UUID, UUID, JSONB)
  OWNER TO prontomedic_tiss_rpc_owner;

GRANT USAGE ON SCHEMA public, private, auth
  TO prontomedic_tiss_rpc_owner;
GRANT SELECT ON
  public.appointments,
  public.insurance_companies,
  public.insurance_plans,
  public.billing_accounts
  TO prontomedic_tiss_rpc_owner;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.tiss_xml,
  public.tiss_glosas,
  public.tiss_protocols,
  public.tiss_guides,
  public.tiss_guide_events,
  public.tiss_operation_requests
  TO prontomedic_tiss_rpc_owner;
GRANT USAGE, SELECT ON
  public.tiss_xml_id_seq,
  public.tiss_glosas_id_seq,
  public.tiss_protocols_id_seq,
  public.tiss_guide_number_seq,
  public.tiss_batch_number_seq
  TO prontomedic_tiss_rpc_owner;
GRANT EXECUTE ON FUNCTION auth.uid()
  TO prontomedic_tiss_rpc_owner;
GRANT EXECUTE ON FUNCTION public.current_company_id()
  TO prontomedic_tiss_rpc_owner;
GRANT EXECUTE ON FUNCTION public.request_company_id()
  TO prontomedic_tiss_rpc_owner;
GRANT EXECUTE ON FUNCTION public.request_aal()
  TO prontomedic_tiss_rpc_owner;
GRANT EXECUTE ON FUNCTION public.active_company_id()
  TO prontomedic_tiss_rpc_owner;
GRANT EXECUTE ON FUNCTION public.can_access(TEXT, TEXT)
  TO prontomedic_tiss_rpc_owner;
GRANT EXECUTE ON FUNCTION public.digest(BYTEA, TEXT)
  TO prontomedic_tiss_rpc_owner;
GRANT EXECUTE ON FUNCTION private.m16_normalize_role(TEXT)
  TO prontomedic_tiss_rpc_owner;
GRANT EXECUTE ON FUNCTION private.m16_tenant_id()
  TO prontomedic_tiss_rpc_owner;
GRANT EXECUTE ON FUNCTION private.m16_require_actor(TEXT[], BOOLEAN, TEXT)
  TO prontomedic_tiss_rpc_owner;
GRANT EXECUTE ON FUNCTION private.m16_require_gateway()
  TO prontomedic_tiss_rpc_owner;
GRANT EXECUTE ON FUNCTION private.m16_claim_operation(
  UUID, UUID, TEXT, JSONB, UUID
) TO prontomedic_tiss_rpc_owner;
GRANT EXECUTE ON FUNCTION private.m16_finish_operation(
  UUID, UUID, JSONB
) TO prontomedic_tiss_rpc_owner;

DO $drop_tiss_policies$
DECLARE
  v_policy RECORD;
BEGIN
  FOR v_policy IN
    SELECT schemaname, tablename, policyname
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = ANY(ARRAY[
         'tiss_xml',
         'tiss_glosas',
         'tiss_protocols',
         'tiss_guides',
         'tiss_guide_events',
         'tiss_operation_requests'
       ])
  LOOP
    EXECUTE format(
      'DROP POLICY %I ON %I.%I',
      v_policy.policyname,
      v_policy.schemaname,
      v_policy.tablename
    );
  END LOOP;
END
$drop_tiss_policies$;

ALTER TABLE public.tiss_xml ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tiss_xml FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tiss_glosas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tiss_glosas FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tiss_protocols ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tiss_protocols FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tiss_guides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tiss_guides FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tiss_guide_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tiss_guide_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tiss_operation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tiss_operation_requests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS m16_tiss_owner_read
  ON public.appointments;
CREATE POLICY m16_tiss_owner_read
  ON public.appointments FOR SELECT TO prontomedic_tiss_rpc_owner
  USING (company_id = private.m16_tenant_id());

DROP POLICY IF EXISTS m16_tiss_owner_read
  ON public.insurance_companies;
CREATE POLICY m16_tiss_owner_read
  ON public.insurance_companies FOR SELECT TO prontomedic_tiss_rpc_owner
  USING (company_id = private.m16_tenant_id());

DROP POLICY IF EXISTS m16_tiss_owner_read
  ON public.insurance_plans;
CREATE POLICY m16_tiss_owner_read
  ON public.insurance_plans FOR SELECT TO prontomedic_tiss_rpc_owner
  USING (company_id = private.m16_tenant_id());

DROP POLICY IF EXISTS m16_tiss_owner_read
  ON public.billing_accounts;
CREATE POLICY m16_tiss_owner_read
  ON public.billing_accounts FOR SELECT TO prontomedic_tiss_rpc_owner
  USING (company_id = private.m16_tenant_id());

CREATE POLICY m16_xml_owner_all
  ON public.tiss_xml FOR ALL TO prontomedic_tiss_rpc_owner
  USING (company_id = private.m16_tenant_id())
  WITH CHECK (company_id = private.m16_tenant_id());

CREATE POLICY m16_denial_owner_all
  ON public.tiss_glosas FOR ALL TO prontomedic_tiss_rpc_owner
  USING (company_id = private.m16_tenant_id())
  WITH CHECK (company_id = private.m16_tenant_id());

CREATE POLICY m16_protocol_owner_all
  ON public.tiss_protocols FOR ALL TO prontomedic_tiss_rpc_owner
  USING (company_id = private.m16_tenant_id())
  WITH CHECK (company_id = private.m16_tenant_id());

CREATE POLICY m16_guide_owner_all
  ON public.tiss_guides FOR ALL TO prontomedic_tiss_rpc_owner
  USING (company_id = private.m16_tenant_id())
  WITH CHECK (company_id = private.m16_tenant_id());

CREATE POLICY m16_guide_event_owner_all
  ON public.tiss_guide_events FOR ALL TO prontomedic_tiss_rpc_owner
  USING (company_id = private.m16_tenant_id())
  WITH CHECK (company_id = private.m16_tenant_id());

CREATE POLICY m16_operation_owner_all
  ON public.tiss_operation_requests FOR ALL TO prontomedic_tiss_rpc_owner
  USING (company_id = private.m16_tenant_id())
  WITH CHECK (company_id = private.m16_tenant_id());

REVOKE ALL ON
  public.tiss_xml,
  public.tiss_glosas,
  public.tiss_protocols,
  public.tiss_guides,
  public.tiss_guide_events,
  public.tiss_operation_requests
  FROM PUBLIC, anon, authenticated, app_prontomedic,
       prontomedic_tiss_gateway;

REVOKE ALL ON SEQUENCE
  public.tiss_xml_id_seq,
  public.tiss_glosas_id_seq,
  public.tiss_protocols_id_seq,
  public.tiss_guide_number_seq,
  public.tiss_batch_number_seq
  FROM PUBLIC, anon, authenticated, app_prontomedic,
       prontomedic_tiss_gateway;

ALTER VIEW public.vw_tiss_glosas_pendentes
  SET (security_invoker = TRUE);
REVOKE ALL ON public.vw_tiss_glosas_pendentes FROM PUBLIC, anon;
REVOKE ALL ON public.vw_tiss_glosas_pendentes
  FROM authenticated, app_prontomedic, prontomedic_tiss_gateway;

CREATE OR REPLACE FUNCTION public.m16_company_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT private.m16_tenant_id()
$function$;

CREATE OR REPLACE FUNCTION public.m16_can_operate_guides()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $function$
BEGIN
  PERFORM *
    FROM private.m16_require_actor(
      ARRAY[
        'admin',
        'administrador',
        'financeiro',
        'faturamento',
        'faturista',
        'billing',
        'gestor'
      ],
      FALSE,
      'edit'
    );
  RETURN TRUE;
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$function$;

ALTER FUNCTION public.m16_company_id()
  OWNER TO prontomedic_tiss_rpc_owner;
ALTER FUNCTION public.m16_can_operate_guides()
  OWNER TO prontomedic_tiss_rpc_owner;

CREATE OR REPLACE FUNCTION public.create_tiss_guide_secure(
  p_guide_type TEXT,
  p_appointment_id BIGINT DEFAULT NULL,
  p_unit_id INTEGER DEFAULT NULL,
  p_billing_account_id UUID DEFAULT NULL,
  p_source_xml_id BIGINT DEFAULT NULL,
  p_environment TEXT DEFAULT 'HOMOLOGACAO'
)
RETURNS public.tiss_guides
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor RECORD;
  v_row public.tiss_guides;
BEGIN
  SELECT *
    INTO v_actor
    FROM private.m16_require_actor(
      ARRAY[]::TEXT[],
      FALSE,
      'create'
    );
  IF p_guide_type NOT IN (
    'CONSULTA',
    'SP/SADT',
    'INTERNACAO',
    'RESUMO_INTERNACAO',
    'HONORARIO',
    'OUTRAS_DESPESAS',
    'RECURSO_GLOSA'
  ) THEN
    RAISE EXCEPTION 'Invalid TISS guide type';
  END IF;
  IF p_environment NOT IN ('HOMOLOGACAO', 'PRODUCAO') THEN
    RAISE EXCEPTION 'Invalid TISS environment';
  END IF;

  INSERT INTO public.tiss_guides (
    company_id,
    appointment_id,
    unit_id,
    billing_account_id,
    source_xml_id,
    guide_type,
    environment,
    created_by
  ) VALUES (
    v_actor.company_id,
    p_appointment_id,
    p_unit_id,
    p_billing_account_id,
    p_source_xml_id,
    p_guide_type,
    p_environment,
    v_actor.user_id
  )
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;
ALTER FUNCTION public.create_tiss_guide_secure(
  TEXT, BIGINT, INTEGER, UUID, BIGINT, TEXT
) OWNER TO prontomedic_tiss_rpc_owner;

CREATE OR REPLACE FUNCTION public.m16_guard_tiss_guide()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'DRAFT'
       OR NEW.signed_by IS NOT NULL
       OR NEW.signed_at IS NOT NULL
       OR NEW.signature_sha256 IS NOT NULL
       OR NEW.cancelled_by IS NOT NULL
       OR NEW.cancelled_at IS NOT NULL THEN
      RAISE EXCEPTION 'A new TISS guide must start as DRAFT without lifecycle evidence';
    END IF;
    NEW.updated_at := NOW();
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.guide_number IS DISTINCT FROM OLD.guide_number
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'TISS guide identity is immutable';
  END IF;

  IF OLD.status IN ('CANCELLED', 'SUBSTITUTED') THEN
    IF (to_jsonb(NEW) - 'updated_at')
       IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
      RAISE EXCEPTION 'Closed TISS guide is immutable';
    END IF;
  ELSIF OLD.status = 'SIGNED' AND NEW.status = 'SIGNED' THEN
    IF (to_jsonb(NEW) - 'updated_at')
       IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
      RAISE EXCEPTION 'Signed TISS guide is immutable';
    END IF;
  ELSIF OLD.status = 'SIGNED' AND NEW.status = 'CANCELLED' THEN
    IF (
      to_jsonb(NEW)
      - ARRAY[
        'status',
        'cancelled_by',
        'cancelled_at',
        'cancellation_reason',
        'updated_at'
      ]
    ) IS DISTINCT FROM (
      to_jsonb(OLD)
      - ARRAY[
        'status',
        'cancelled_by',
        'cancelled_at',
        'cancellation_reason',
        'updated_at'
      ]
    ) THEN
      RAISE EXCEPTION 'Cancellation cannot mutate signed guide content';
    END IF;
  ELSIF OLD.status = 'SIGNED' AND NEW.status = 'SUBSTITUTED' THEN
    IF (
      to_jsonb(NEW)
      - ARRAY['status', 'substitution_reason', 'updated_at']
    ) IS DISTINCT FROM (
      to_jsonb(OLD)
      - ARRAY['status', 'substitution_reason', 'updated_at']
    ) THEN
      RAISE EXCEPTION 'Substitution cannot mutate signed guide content';
    END IF;
  ELSIF OLD.status IN ('DRAFT', 'VALIDATED')
        AND NEW.status = 'CANCELLED' THEN
    IF (
      to_jsonb(NEW)
      - ARRAY[
        'status',
        'cancelled_by',
        'cancelled_at',
        'cancellation_reason',
        'updated_at'
      ]
    ) IS DISTINCT FROM (
      to_jsonb(OLD)
      - ARRAY[
        'status',
        'cancelled_by',
        'cancelled_at',
        'cancellation_reason',
        'updated_at'
      ]
    ) THEN
      RAISE EXCEPTION 'Cancellation cannot mutate guide content';
    END IF;
  ELSIF OLD.status = 'VALIDATED' AND NEW.status = 'SIGNED' THEN
    IF (
      to_jsonb(NEW)
      - ARRAY[
        'status',
        'signed_by',
        'signed_at',
        'signature_sha256',
        'signature_reference',
        'updated_at'
      ]
    ) IS DISTINCT FROM (
      to_jsonb(OLD)
      - ARRAY[
        'status',
        'signed_by',
        'signed_at',
        'signature_sha256',
        'signature_reference',
        'updated_at'
      ]
    ) THEN
      RAISE EXCEPTION 'Signing cannot mutate validated guide content';
    END IF;
  ELSIF OLD.status = 'DRAFT' AND NEW.status = 'VALIDATED' THEN
    IF (
      to_jsonb(NEW)
      - ARRAY['status', 'validation_errors', 'updated_at']
    ) IS DISTINCT FROM (
      to_jsonb(OLD)
      - ARRAY['status', 'validation_errors', 'updated_at']
    ) THEN
      RAISE EXCEPTION 'Validation cannot mutate draft guide content';
    END IF;
  ELSIF OLD.status = NEW.status
        AND (to_jsonb(NEW) - 'updated_at')
            IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
    RAISE EXCEPTION 'TISS guide content cannot be edited outside a lifecycle transition';
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status AND NOT (
    (OLD.status = 'DRAFT' AND NEW.status = 'VALIDATED')
    OR (OLD.status = 'VALIDATED' AND NEW.status = 'SIGNED')
    OR (
      OLD.status IN ('DRAFT', 'VALIDATED')
      AND NEW.status = 'CANCELLED'
    )
    OR (
      OLD.status = 'SIGNED'
      AND NEW.status IN ('CANCELLED', 'SUBSTITUTED')
    )
  ) THEN
    RAISE EXCEPTION 'Invalid TISS guide lifecycle transition';
  END IF;

  IF NEW.status = 'SIGNED' AND (
    NEW.signature_sha256 IS NULL
    OR NEW.signature_sha256 !~ '^[0-9a-f]{64}$'
    OR NEW.signed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Signed TISS guide requires a 64-hex SHA-256 and timestamp';
  END IF;
  IF NEW.status = 'CANCELLED' AND (
    NEW.cancelled_at IS NULL
    OR NULLIF(trim(COALESCE(NEW.cancellation_reason, '')), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'Cancelled TISS guide requires timestamp and reason';
  END IF;
  IF NEW.status = 'SUBSTITUTED'
     AND NULLIF(trim(COALESCE(NEW.substitution_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Substituted TISS guide requires a reason';
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_m16_guard_tiss_guide
  ON public.tiss_guides;
CREATE TRIGGER trg_m16_guard_tiss_guide
  BEFORE INSERT OR UPDATE ON public.tiss_guides
  FOR EACH ROW EXECUTE FUNCTION public.m16_guard_tiss_guide();

ALTER FUNCTION public.m16_guard_tiss_guide()
  OWNER TO prontomedic_tiss_rpc_owner;
REVOKE ALL ON FUNCTION public.m16_guard_tiss_guide()
  FROM PUBLIC, anon, authenticated, app_prontomedic,
       prontomedic_tiss_gateway;
GRANT EXECUTE ON FUNCTION public.m16_guard_tiss_guide()
  TO prontomedic_tiss_rpc_owner;

ALTER FUNCTION private.m16_record_tiss_guide_event()
  OWNER TO prontomedic_tiss_rpc_owner;
ALTER FUNCTION private.m16_record_tiss_guide_event()
  SECURITY DEFINER;
ALTER FUNCTION private.m16_record_tiss_guide_event()
  SET search_path = pg_catalog, public;
REVOKE ALL ON FUNCTION private.m16_record_tiss_guide_event()
  FROM PUBLIC, anon, authenticated, app_prontomedic,
       prontomedic_tiss_gateway;

ALTER FUNCTION public.create_tiss_guide_secure(
  TEXT, BIGINT, INTEGER, UUID, BIGINT, TEXT
) OWNER TO prontomedic_tiss_rpc_owner;
ALTER FUNCTION public.create_tiss_guide_secure(
  TEXT, BIGINT, INTEGER, UUID, BIGINT, TEXT
) SECURITY DEFINER;
ALTER FUNCTION public.create_tiss_guide_secure(
  TEXT, BIGINT, INTEGER, UUID, BIGINT, TEXT
) SET search_path = pg_catalog, public;

ALTER FUNCTION public.validate_tiss_guide_secure(UUID, JSONB)
  OWNER TO prontomedic_tiss_rpc_owner;
ALTER FUNCTION public.validate_tiss_guide_secure(UUID, JSONB)
  SECURITY DEFINER;
ALTER FUNCTION public.validate_tiss_guide_secure(UUID, JSONB)
  SET search_path = pg_catalog, public;

ALTER FUNCTION public.sign_tiss_guide_secure(UUID, TEXT, TEXT)
  OWNER TO prontomedic_tiss_rpc_owner;
ALTER FUNCTION public.sign_tiss_guide_secure(UUID, TEXT, TEXT)
  SECURITY DEFINER;
ALTER FUNCTION public.sign_tiss_guide_secure(UUID, TEXT, TEXT)
  SET search_path = pg_catalog, public;

ALTER FUNCTION public.cancel_tiss_guide_secure(UUID, TEXT)
  OWNER TO prontomedic_tiss_rpc_owner;
ALTER FUNCTION public.cancel_tiss_guide_secure(UUID, TEXT)
  SECURITY DEFINER;
ALTER FUNCTION public.cancel_tiss_guide_secure(UUID, TEXT)
  SET search_path = pg_catalog, public;

ALTER FUNCTION public.substitute_tiss_guide_secure(UUID, TEXT)
  OWNER TO prontomedic_tiss_rpc_owner;
ALTER FUNCTION public.substitute_tiss_guide_secure(UUID, TEXT)
  SECURITY DEFINER;
ALTER FUNCTION public.substitute_tiss_guide_secure(UUID, TEXT)
  SET search_path = pg_catalog, public;

ALTER FUNCTION public.link_tiss_xml_guide_secure(UUID, BIGINT)
  OWNER TO prontomedic_tiss_rpc_owner;
ALTER FUNCTION public.link_tiss_xml_guide_secure(UUID, BIGINT)
  SECURITY DEFINER;
ALTER FUNCTION public.link_tiss_xml_guide_secure(UUID, BIGINT)
  SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION public.m16_persist_xml_secure(
  p_operation_id UUID,
  p_appointment_id BIGINT,
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor RECORD;
  v_existing JSONB;
  v_company UUID;
  v_insurance_id INTEGER;
  v_xml TEXT;
  v_hash TEXT;
  v_computed_hash TEXT;
  v_xml_id BIGINT;
  v_response JSONB;
  v_canonical JSONB;
BEGIN
  SELECT *
    INTO v_actor
    FROM private.m16_require_actor(
      ARRAY[
        'admin',
        'administrador',
        'financeiro',
        'faturamento',
        'faturista',
        'billing',
        'gestor'
      ],
      FALSE,
      'create'
    );
  v_company := v_actor.company_id;

  IF p_operation_id IS NULL OR p_appointment_id IS NULL THEN
    RAISE EXCEPTION 'Operation id and appointment id are required';
  END IF;
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'TISS XML payload must be an object';
  END IF;
  IF (p_payload - ARRAY[
    'cd_convenio',
    'ds_descricao',
    'ds_filename',
    'dt_fatura',
    'ds_tipo_guia',
    'vl_informado',
    'bl_xml_enviado',
    'ds_hash_envio',
    'ds_versao_tiss',
    'tp_ambiente',
    'guide_id',
    'billing_account_id'
  ]) <> '{}'::JSONB THEN
    RAISE EXCEPTION 'TISS XML payload contains unsupported fields';
  END IF;

  SELECT COALESCE(
           appointment.insurance_company_id,
           plan.insurance_company_id
         )
    INTO v_insurance_id
    FROM public.appointments appointment
    LEFT JOIN public.insurance_plans plan
      ON plan.id = appointment.insurance_plan_id
     AND plan.company_id = appointment.company_id
   WHERE appointment.id = p_appointment_id
     AND appointment.company_id = v_company;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Appointment not found in active company'
      USING ERRCODE = '23503';
  END IF;

  IF p_payload ? 'cd_convenio' THEN
    v_insurance_id := (p_payload->>'cd_convenio')::INTEGER;
  END IF;
  IF v_insurance_id IS NULL OR NOT EXISTS (
    SELECT 1
      FROM public.insurance_companies insurance
     WHERE insurance.id = v_insurance_id
       AND insurance.company_id = v_company
       AND COALESCE(insurance.lg_ativo, TRUE)
  ) THEN
    RAISE EXCEPTION 'Insurance company not found in active company'
      USING ERRCODE = '23503';
  END IF;

  v_xml := p_payload->>'bl_xml_enviado';
  v_hash := lower(trim(COALESCE(p_payload->>'ds_hash_envio', '')));
  IF NULLIF(trim(COALESCE(v_xml, '')), '') IS NULL
     OR length(v_xml) > 10485760
     OR v_xml ~* '<!DOCTYPE' THEN
    RAISE EXCEPTION 'TISS XML is absent, too large or unsafe';
  END IF;
  v_computed_hash := encode(
    public.digest(convert_to(v_xml, 'UTF8'), 'sha256'),
    'hex'
  );
  IF v_hash !~ '^[0-9a-f]{64}$'
     OR v_hash IS DISTINCT FROM v_computed_hash THEN
    RAISE EXCEPTION 'TISS XML SHA-256 contract is invalid';
  END IF;
  IF COALESCE(p_payload->>'ds_versao_tiss', '4.03.00')
     IS DISTINCT FROM '4.03.00' THEN
    RAISE EXCEPTION 'Only TISS communication version 4.03.00 is accepted';
  END IF;
  IF COALESCE(p_payload->>'tp_ambiente', 'HOMOLOGACAO')
     NOT IN ('HOMOLOGACAO', 'PRODUCAO') THEN
    RAISE EXCEPTION 'Invalid TISS environment';
  END IF;
  IF (p_payload->>'vl_informado')::NUMERIC < 0
     OR (p_payload->>'vl_informado')::NUMERIC::TEXT = 'NaN' THEN
    RAISE EXCEPTION 'TISS amount must be a finite non-negative number';
  END IF;

  IF p_payload ? 'guide_id' AND NOT EXISTS (
    SELECT 1 FROM public.tiss_guides guide
     WHERE guide.id = (p_payload->>'guide_id')::UUID
       AND guide.company_id = v_company
  ) THEN
    RAISE EXCEPTION 'TISS guide not found in active company'
      USING ERRCODE = '23503';
  END IF;
  IF p_payload ? 'billing_account_id' AND NOT EXISTS (
    SELECT 1 FROM public.billing_accounts account
     WHERE account.id = (p_payload->>'billing_account_id')::UUID
       AND account.company_id = v_company
  ) THEN
    RAISE EXCEPTION 'Billing account not found in active company'
      USING ERRCODE = '23503';
  END IF;

  v_canonical := jsonb_build_object(
    'appointment_id', p_appointment_id,
    'insurance_id', v_insurance_id,
    'description', NULLIF(trim(COALESCE(p_payload->>'ds_descricao', '')), ''),
    'filename', NULLIF(trim(COALESCE(p_payload->>'ds_filename', '')), ''),
    'billing_date', COALESCE(
      NULLIF(p_payload->>'dt_fatura', '')::DATE,
      CURRENT_DATE
    ),
    'guide_type', p_payload->>'ds_tipo_guia',
    'amount', (p_payload->>'vl_informado')::NUMERIC,
    'xml_sha256', encode(
      public.digest(convert_to(v_xml, 'UTF8'), 'sha256'),
      'hex'
    ),
    'md5', v_hash,
    'version', COALESCE(p_payload->>'ds_versao_tiss', '4.03.00'),
    'environment', COALESCE(p_payload->>'tp_ambiente', 'HOMOLOGACAO'),
    'guide_id', p_payload->'guide_id',
    'billing_account_id', p_payload->'billing_account_id'
  );

  v_existing := private.m16_claim_operation(
    v_company,
    p_operation_id,
    'persist_xml',
    v_canonical,
    v_actor.user_id
  );
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  INSERT INTO public.tiss_xml (
    company_id,
    appointment_id,
    cd_convenio,
    ds_descricao,
    ds_filename,
    dt_fatura,
    ds_tipo_guia,
    vl_informado,
    vl_processado,
    vl_liberado,
    vl_glosa,
    bl_xml_enviado,
    ds_hash_envio,
    ds_versao_tiss,
    tp_ambiente,
    status,
    guide_id,
    billing_account_id,
    cd_user_envio
  ) VALUES (
    v_company,
    p_appointment_id,
    v_insurance_id,
    NULLIF(trim(COALESCE(p_payload->>'ds_descricao', '')), ''),
    NULLIF(trim(COALESCE(p_payload->>'ds_filename', '')), ''),
    COALESCE(NULLIF(p_payload->>'dt_fatura', '')::DATE, CURRENT_DATE),
    NULLIF(p_payload->>'ds_tipo_guia', ''),
    (p_payload->>'vl_informado')::NUMERIC,
    0,
    0,
    0,
    v_xml,
    v_hash,
    COALESCE(p_payload->>'ds_versao_tiss', '4.03.00'),
    COALESCE(p_payload->>'tp_ambiente', 'HOMOLOGACAO'),
    'PENDENTE',
    NULLIF(p_payload->>'guide_id', '')::UUID,
    NULLIF(p_payload->>'billing_account_id', '')::UUID,
    NULL
  )
  RETURNING id INTO v_xml_id;

  v_response := jsonb_build_object(
    'id', v_xml_id,
    'status', 'PENDENTE',
    'ds_hash_envio', v_hash,
    'ds_versao_tiss', '4.03.00',
    'tp_ambiente', COALESCE(
      p_payload->>'tp_ambiente',
      'HOMOLOGACAO'
    )
  );
  RETURN private.m16_finish_operation(
    v_company,
    p_operation_id,
    v_response
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.m16_record_transmission_result_gateway(
  p_operation_id UUID,
  p_tiss_xml_id BIGINT,
  p_sent BOOLEAN,
  p_http_status INTEGER,
  p_protocol TEXT DEFAULT NULL,
  p_response_xml TEXT DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_sent_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_company UUID := private.m16_require_gateway();
  v_existing JSONB;
  v_row public.tiss_xml;
  v_response JSONB;
  v_payload JSONB;
BEGIN
  IF p_operation_id IS NULL OR p_tiss_xml_id IS NULL THEN
    RAISE EXCEPTION 'Operation id and TISS XML id are required';
  END IF;
  IF p_http_status IS NULL OR p_http_status < 100 OR p_http_status > 599 THEN
    RAISE EXCEPTION 'Valid HTTP status is required';
  END IF;
  IF p_sent AND (p_http_status < 200 OR p_http_status >= 300) THEN
    RAISE EXCEPTION 'Successful transmission requires a 2xx status';
  END IF;
  IF NOT p_sent AND p_http_status >= 200 AND p_http_status < 300 THEN
    RAISE EXCEPTION 'Rejected transmission cannot use a 2xx status';
  END IF;
  IF p_response_xml IS NOT NULL
     AND (
       length(p_response_xml) > 10485760
       OR p_response_xml ~* '<!DOCTYPE'
     ) THEN
    RAISE EXCEPTION 'Gateway response is too large or unsafe';
  END IF;

  v_payload := jsonb_build_object(
    'tiss_xml_id', p_tiss_xml_id,
    'sent', p_sent,
    'http_status', p_http_status,
    'protocol', NULLIF(trim(COALESCE(p_protocol, '')), ''),
    'response_sha256', CASE
      WHEN p_response_xml IS NULL THEN NULL
      ELSE encode(
        public.digest(convert_to(p_response_xml, 'UTF8'), 'sha256'),
        'hex'
      )
    END,
    'reason', NULLIF(trim(COALESCE(p_reason, '')), ''),
    'sent_at', p_sent_at
  );
  v_existing := private.m16_claim_operation(
    v_company,
    p_operation_id,
    'record_transmission',
    v_payload,
    NULL
  );
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT *
    INTO v_row
    FROM public.tiss_xml
   WHERE id = p_tiss_xml_id
     AND company_id = v_company
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TISS XML not found in gateway company'
      USING ERRCODE = '23503';
  END IF;
  IF v_row.status NOT IN ('PENDENTE', 'REJEITADO') THEN
    RAISE EXCEPTION 'TISS XML is not eligible for transmission result';
  END IF;

  UPDATE public.tiss_xml
     SET status = CASE WHEN p_sent THEN 'ENVIADO' ELSE 'REJEITADO' END,
         dt_envio = COALESCE(p_sent_at, NOW()),
         ds_protocolo = NULLIF(trim(COALESCE(p_protocol, '')), ''),
         bl_xml_retorno = p_response_xml,
         ds_motivo_rejeicao = CASE
           WHEN p_sent THEN NULL
           ELSE NULLIF(trim(COALESCE(p_reason, '')), '')
         END,
         updated_at = NOW()
   WHERE id = p_tiss_xml_id
     AND company_id = v_company;

  v_response := jsonb_build_object(
    'id', p_tiss_xml_id,
    'status', CASE WHEN p_sent THEN 'ENVIADO' ELSE 'REJEITADO' END,
    'http_status', p_http_status,
    'protocol', NULLIF(trim(COALESCE(p_protocol, '')), '')
  );
  RETURN private.m16_finish_operation(
    v_company,
    p_operation_id,
    v_response
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.m16_process_return_secure(
  p_operation_id UUID,
  p_tiss_xml_id BIGINT,
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor RECORD;
  v_company UUID;
  v_existing JSONB;
  v_row public.tiss_xml;
  v_return_xml TEXT;
  v_return_hash TEXT;
  v_computed_return_hash TEXT;
  v_processed NUMERIC(10,2);
  v_released NUMERIC(10,2);
  v_denied NUMERIC(10,2);
  v_denial_sum NUMERIC(10,2) := 0;
  v_item JSONB;
  v_index INTEGER := 0;
  v_response JSONB;
  v_canonical JSONB;
BEGIN
  SELECT *
    INTO v_actor
    FROM private.m16_require_actor(
      ARRAY[
        'admin',
        'administrador',
        'financeiro',
        'faturamento',
        'faturista',
        'billing',
        'gestor'
      ],
      FALSE,
      'edit'
    );
  v_company := v_actor.company_id;

  IF p_operation_id IS NULL OR p_tiss_xml_id IS NULL THEN
    RAISE EXCEPTION 'Operation id and TISS XML id are required';
  END IF;
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
     OR jsonb_typeof(COALESCE(p_payload->'glosas', '[]'::JSONB))
        IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Return payload/glosas contract is invalid';
  END IF;
  IF (p_payload - ARRAY[
    'protocol',
    'return_xml',
    'return_hash',
    'processed_amount',
    'released_amount',
    'glosas',
    'returned_at'
  ]) <> '{}'::JSONB THEN
    RAISE EXCEPTION 'Return payload contains unsupported fields';
  END IF;

  v_return_xml := p_payload->>'return_xml';
  IF NULLIF(trim(COALESCE(v_return_xml, '')), '') IS NULL
     OR length(v_return_xml) > 10485760
     OR v_return_xml ~* '<!DOCTYPE' THEN
    RAISE EXCEPTION 'Return XML is absent, too large or unsafe';
  END IF;
  v_return_hash := lower(trim(COALESCE(p_payload->>'return_hash', '')));
  v_computed_return_hash := encode(
    public.digest(convert_to(v_return_xml, 'UTF8'), 'sha256'),
    'hex'
  );
  IF v_return_hash !~ '^[0-9a-f]{64}$'
     OR v_return_hash IS DISTINCT FROM v_computed_return_hash THEN
    RAISE EXCEPTION 'TISS return XML SHA-256 contract is invalid';
  END IF;

  v_processed := (p_payload->>'processed_amount')::NUMERIC;
  v_released := (p_payload->>'released_amount')::NUMERIC;
  IF v_processed::TEXT = 'NaN'
     OR v_released::TEXT = 'NaN'
     OR v_processed < 0
     OR v_released < 0
     OR v_released > v_processed THEN
    RAISE EXCEPTION 'Return amounts are invalid';
  END IF;
  v_denied := v_processed - v_released;

  FOR v_item IN
    SELECT value
      FROM jsonb_array_elements(
        COALESCE(p_payload->'glosas', '[]'::JSONB)
      )
  LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object'
       OR (v_item - ARRAY['code', 'reason', 'amount', 'tuss_code'])
          <> '{}'::JSONB
       OR NULLIF(trim(COALESCE(v_item->>'reason', '')), '') IS NULL
       OR (v_item->>'amount')::NUMERIC <= 0
       OR (v_item->>'amount')::NUMERIC::TEXT = 'NaN' THEN
      RAISE EXCEPTION 'Return denial item is invalid';
    END IF;
    v_denial_sum := v_denial_sum + (v_item->>'amount')::NUMERIC;
  END LOOP;

  IF jsonb_array_length(COALESCE(p_payload->'glosas', '[]'::JSONB)) > 0
     AND abs(v_denial_sum - v_denied) > 0.01 THEN
    RAISE EXCEPTION 'Return denial items do not match total denied amount';
  END IF;

  v_canonical := jsonb_build_object(
    'tiss_xml_id', p_tiss_xml_id,
    'protocol', NULLIF(trim(COALESCE(p_payload->>'protocol', '')), ''),
    'return_sha256', v_computed_return_hash,
    'processed_amount', v_processed,
    'released_amount', v_released,
    'glosas', COALESCE(p_payload->'glosas', '[]'::JSONB),
    'returned_at', COALESCE(
      NULLIF(p_payload->>'returned_at', '')::TIMESTAMPTZ,
      NOW()
    )
  );
  v_existing := private.m16_claim_operation(
    v_company,
    p_operation_id,
    'process_return',
    v_canonical,
    v_actor.user_id
  );
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT *
    INTO v_row
    FROM public.tiss_xml
   WHERE id = p_tiss_xml_id
     AND company_id = v_company
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TISS XML not found in active company'
      USING ERRCODE = '23503';
  END IF;
  IF v_row.status IS DISTINCT FROM 'ENVIADO' THEN
    RAISE EXCEPTION 'Only an ENVIADO TISS XML can receive a return';
  END IF;

  v_index := 0;
  FOR v_item IN
    SELECT value
      FROM jsonb_array_elements(
        COALESCE(p_payload->'glosas', '[]'::JSONB)
      )
  LOOP
    INSERT INTO public.tiss_glosas (
      cd_tiss_xml,
      company_id,
      cd_glosa_code,
      ds_motivo,
      vl_glosa,
      dt_glosa,
      ds_status_recurso,
      cd_procedimento_tuss,
      cd_user_registro,
      operation_id,
      operation_item_index
    ) VALUES (
      p_tiss_xml_id,
      v_company,
      NULLIF(trim(COALESCE(v_item->>'code', '')), ''),
      trim(v_item->>'reason'),
      (v_item->>'amount')::NUMERIC,
      CURRENT_DATE,
      'PENDENTE',
      NULLIF(trim(COALESCE(v_item->>'tuss_code', '')), ''),
      v_actor.user_id,
      p_operation_id,
      v_index
    );
    v_index := v_index + 1;
  END LOOP;

  UPDATE public.tiss_xml
     SET status = CASE
           WHEN v_denied > 0 THEN 'GLOSADO'
           ELSE 'PROCESSADO'
         END,
         dt_retorno = COALESCE(
           NULLIF(p_payload->>'returned_at', '')::TIMESTAMPTZ,
           NOW()
         ),
         bl_xml_retorno = v_return_xml,
         ds_hash_retorno = v_computed_return_hash,
         ds_protocolo = COALESCE(
           NULLIF(trim(COALESCE(p_payload->>'protocol', '')), ''),
           ds_protocolo
         ),
         vl_processado = v_processed,
         vl_liberado = v_released,
         vl_glosa = v_denied,
         cd_user_recebimento = v_actor.user_id,
         updated_at = NOW()
   WHERE id = p_tiss_xml_id
     AND company_id = v_company;

  v_response := jsonb_build_object(
    'id', p_tiss_xml_id,
    'status', CASE WHEN v_denied > 0 THEN 'GLOSADO' ELSE 'PROCESSADO' END,
    'vl_processado', v_processed,
    'vl_liberado', v_released,
    'vl_glosa', v_denied,
    'glosas_registradas', v_index
  );
  RETURN private.m16_finish_operation(
    v_company,
    p_operation_id,
    v_response
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.m16_record_manual_denial_secure(
  p_operation_id UUID,
  p_tiss_xml_id BIGINT,
  p_reason TEXT,
  p_amount NUMERIC,
  p_code TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor RECORD;
  v_company UUID;
  v_existing JSONB;
  v_denial_id BIGINT;
  v_total NUMERIC(10,2);
  v_response JSONB;
  v_payload JSONB;
BEGIN
  SELECT *
    INTO v_actor
    FROM private.m16_require_actor(
      ARRAY[
        'admin',
        'administrador',
        'financeiro',
        'faturamento',
        'faturista',
        'billing',
        'gestor'
      ],
      FALSE,
      'edit'
    );
  v_company := v_actor.company_id;

  IF p_operation_id IS NULL OR p_tiss_xml_id IS NULL
     OR NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL
     OR p_amount IS NULL OR p_amount <= 0 OR p_amount::TEXT = 'NaN' THEN
    RAISE EXCEPTION 'Operation, XML, reason and finite positive amount are required';
  END IF;

  v_payload := jsonb_build_object(
    'tiss_xml_id', p_tiss_xml_id,
    'reason', trim(p_reason),
    'amount', p_amount,
    'code', NULLIF(trim(COALESCE(p_code, '')), '')
  );
  v_existing := private.m16_claim_operation(
    v_company,
    p_operation_id,
    'manual_denial',
    v_payload,
    v_actor.user_id
  );
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  PERFORM 1
    FROM public.tiss_xml
   WHERE id = p_tiss_xml_id
     AND company_id = v_company
     AND status IN ('PROCESSADO', 'GLOSADO')
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TISS XML not found or not eligible for a manual denial';
  END IF;

  INSERT INTO public.tiss_glosas (
    cd_tiss_xml,
    company_id,
    cd_glosa_code,
    ds_motivo,
    vl_glosa,
    dt_glosa,
    ds_status_recurso,
    cd_user_registro,
    operation_id,
    operation_item_index
  ) VALUES (
    p_tiss_xml_id,
    v_company,
    NULLIF(trim(COALESCE(p_code, '')), ''),
    trim(p_reason),
    p_amount,
    CURRENT_DATE,
    'PENDENTE',
    v_actor.user_id,
    p_operation_id,
    0
  )
  RETURNING id INTO v_denial_id;

  SELECT COALESCE(SUM(denial.vl_glosa), 0)::NUMERIC(10,2)
    INTO v_total
    FROM public.tiss_glosas denial
   WHERE denial.company_id = v_company
     AND denial.cd_tiss_xml = p_tiss_xml_id;

  UPDATE public.tiss_xml
     SET vl_glosa = v_total,
         status = 'GLOSADO',
         updated_at = NOW()
   WHERE id = p_tiss_xml_id
     AND company_id = v_company;

  v_response := jsonb_build_object(
    'id', v_denial_id,
    'tiss_xml_id', p_tiss_xml_id,
    'vl_glosa', p_amount,
    'vl_glosa_total', v_total,
    'status', 'GLOSADO'
  );
  RETURN private.m16_finish_operation(
    v_company,
    p_operation_id,
    v_response
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.m16_generate_monthly_batch_secure(
  p_operation_id UUID,
  p_competence DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor RECORD;
  v_company UUID;
  v_existing JSONB;
  v_month DATE;
  v_batch INTEGER;
  v_count INTEGER;
  v_total NUMERIC(14,2);
  v_ids JSONB;
  v_response JSONB;
  v_payload JSONB;
BEGIN
  SELECT *
    INTO v_actor
    FROM private.m16_require_actor(
      ARRAY[
        'admin',
        'administrador',
        'financeiro',
        'faturamento',
        'faturista',
        'billing',
        'gestor'
      ],
      FALSE,
      'create'
    );
  v_company := v_actor.company_id;
  v_month := date_trunc('month', p_competence)::DATE;
  IF p_operation_id IS NULL OR p_competence IS NULL THEN
    RAISE EXCEPTION 'Operation id and competence are required';
  END IF;

  v_payload := jsonb_build_object('competence', v_month);
  v_existing := private.m16_claim_operation(
    v_company,
    p_operation_id,
    'monthly_batch',
    v_payload,
    v_actor.user_id
  );
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  v_batch := nextval('public.tiss_batch_number_seq')::INTEGER;
  WITH candidates AS (
    SELECT xml.id
      FROM public.tiss_xml xml
     WHERE xml.company_id = v_company
       AND xml.status = 'PENDENTE'
       AND COALESCE(xml.lg_deletado, FALSE) = FALSE
       AND xml.bl_xml_enviado IS NOT NULL
       AND xml.cd_lote IS NULL
       AND xml.dt_fatura >= v_month
       AND xml.dt_fatura < (v_month + INTERVAL '1 month')::DATE
     ORDER BY xml.id
     FOR UPDATE
  ),
  updated AS (
    UPDATE public.tiss_xml xml
       SET cd_lote = v_batch,
           updated_at = NOW()
      FROM candidates
     WHERE xml.id = candidates.id
       AND xml.company_id = v_company
    RETURNING xml.id, COALESCE(xml.vl_informado, 0) AS amount
  )
  SELECT
    count(*)::INTEGER,
    COALESCE(SUM(amount), 0)::NUMERIC(14,2),
    COALESCE(jsonb_agg(id ORDER BY id), '[]'::JSONB)
    INTO v_count, v_total, v_ids
    FROM updated;

  v_response := jsonb_build_object(
    'lote', v_batch,
    'competence', v_month,
    'total_xmls', v_count,
    'vl_total', v_total,
    'xml_ids', v_ids
  );
  RETURN private.m16_finish_operation(
    v_company,
    p_operation_id,
    v_response
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.m16_save_protocol_secure(
  p_operation_id UUID,
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor RECORD;
  v_company UUID;
  v_existing JSONB;
  v_protocol public.tiss_protocols;
  v_insurance_id INTEGER;
  v_endpoint TEXT;
  v_environment TEXT;
  v_response JSONB;
  v_canonical JSONB;
BEGIN
  SELECT *
    INTO v_actor
    FROM private.m16_require_actor(
      ARRAY[
        'admin',
        'administrador',
        'financeiro',
        'faturamento',
        'faturista',
        'billing',
        'gestor'
      ],
      FALSE,
      'edit'
    );
  v_company := v_actor.company_id;

  IF p_operation_id IS NULL
     OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
     OR (p_payload - ARRAY[
       'cd_convenio',
       'ds_endpoint',
       'ds_versao_tiss',
       'tp_ambiente',
       'lg_active',
       'ds_observacao'
     ]) <> '{}'::JSONB THEN
    RAISE EXCEPTION 'Safe TISS protocol payload is invalid';
  END IF;

  v_insurance_id := (p_payload->>'cd_convenio')::INTEGER;
  v_endpoint := trim(COALESCE(p_payload->>'ds_endpoint', ''));
  v_environment := COALESCE(
    NULLIF(p_payload->>'tp_ambiente', ''),
    'HOMOLOGACAO'
  );
  IF NOT EXISTS (
    SELECT 1
      FROM public.insurance_companies insurance
     WHERE insurance.id = v_insurance_id
       AND insurance.company_id = v_company
       AND COALESCE(insurance.lg_ativo, TRUE)
  ) THEN
    RAISE EXCEPTION 'Insurance company not found in active company'
      USING ERRCODE = '23503';
  END IF;
  IF v_environment NOT IN ('HOMOLOGACAO', 'PRODUCAO')
     OR COALESCE(p_payload->>'ds_versao_tiss', '4.03.00')
        IS DISTINCT FROM '4.03.00'
     OR v_endpoint !~* '^https?://'
     OR v_endpoint ~* '://[^/@]+@'
     OR (v_environment = 'PRODUCAO' AND v_endpoint !~* '^https://') THEN
    RAISE EXCEPTION 'TISS protocol endpoint/version/environment is invalid';
  END IF;

  v_canonical := jsonb_build_object(
    'cd_convenio', v_insurance_id,
    'ds_endpoint', v_endpoint,
    'ds_versao_tiss', '4.03.00',
    'tp_ambiente', v_environment,
    'lg_active', COALESCE((p_payload->>'lg_active')::BOOLEAN, TRUE),
    'ds_observacao', NULLIF(
      trim(COALESCE(p_payload->>'ds_observacao', '')),
      ''
    )
  );
  v_existing := private.m16_claim_operation(
    v_company,
    p_operation_id,
    'save_protocol',
    v_canonical,
    v_actor.user_id
  );
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  INSERT INTO public.tiss_protocols (
    company_id,
    cd_convenio,
    ds_endpoint,
    ds_versao_tiss,
    tp_ambiente,
    lg_active,
    ds_observacao
  ) VALUES (
    v_company,
    v_insurance_id,
    v_endpoint,
    '4.03.00',
    v_environment,
    COALESCE((p_payload->>'lg_active')::BOOLEAN, TRUE),
    NULLIF(trim(COALESCE(p_payload->>'ds_observacao', '')), '')
  )
  ON CONFLICT (company_id, cd_convenio, tp_ambiente)
  DO UPDATE SET
    ds_endpoint = EXCLUDED.ds_endpoint,
    ds_versao_tiss = EXCLUDED.ds_versao_tiss,
    lg_active = EXCLUDED.lg_active,
    ds_observacao = EXCLUDED.ds_observacao,
    updated_at = NOW()
  RETURNING * INTO v_protocol;

  v_response := jsonb_build_object(
    'id', v_protocol.id,
    'company_id', v_protocol.company_id,
    'cd_convenio', v_protocol.cd_convenio,
    'ds_endpoint', v_protocol.ds_endpoint,
    'ds_versao_tiss', v_protocol.ds_versao_tiss,
    'tp_ambiente', v_protocol.tp_ambiente,
    'lg_active', v_protocol.lg_active,
    'ds_observacao', v_protocol.ds_observacao
  );
  RETURN private.m16_finish_operation(
    v_company,
    p_operation_id,
    v_response
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.m16_list_xml_secure(
  p_year INTEGER DEFAULT NULL,
  p_limit INTEGER DEFAULT 500
)
RETURNS TABLE (
  id BIGINT,
  appointment_id BIGINT,
  cd_convenio INTEGER,
  ds_descricao VARCHAR,
  ds_filename VARCHAR,
  dt_fatura DATE,
  ds_tipo_guia VARCHAR,
  cd_lote INTEGER,
  ds_protocolo VARCHAR,
  vl_informado NUMERIC,
  vl_processado NUMERIC,
  vl_liberado NUMERIC,
  vl_glosa NUMERIC,
  ds_hash_envio VARCHAR,
  ds_hash_retorno VARCHAR,
  ds_versao_tiss VARCHAR,
  tp_ambiente VARCHAR,
  status VARCHAR,
  ds_motivo_rejeicao TEXT,
  dt_envio TIMESTAMPTZ,
  dt_retorno TIMESTAMPTZ,
  dt_pagamento DATE,
  guide_id UUID,
  billing_account_id UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor RECORD;
BEGIN
  SELECT *
    INTO v_actor
    FROM private.m16_require_actor(ARRAY[]::TEXT[], FALSE, 'view');
  IF p_year IS NOT NULL AND (p_year < 2000 OR p_year > 2200) THEN
    RAISE EXCEPTION 'TISS list year is invalid';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'TISS list limit must be between 1 and 1000';
  END IF;

  RETURN QUERY
  SELECT
    xml.id,
    xml.appointment_id,
    xml.cd_convenio,
    xml.ds_descricao,
    xml.ds_filename,
    xml.dt_fatura,
    xml.ds_tipo_guia,
    xml.cd_lote,
    xml.ds_protocolo,
    xml.vl_informado,
    xml.vl_processado,
    xml.vl_liberado,
    xml.vl_glosa,
    xml.ds_hash_envio,
    xml.ds_hash_retorno,
    xml.ds_versao_tiss,
    xml.tp_ambiente,
    xml.status,
    xml.ds_motivo_rejeicao,
    xml.dt_envio,
    xml.dt_retorno,
    xml.dt_pagamento,
    xml.guide_id,
    xml.billing_account_id,
    xml.created_at,
    xml.updated_at
  FROM public.tiss_xml xml
  WHERE xml.company_id = v_actor.company_id
    AND COALESCE(xml.lg_deletado, FALSE) = FALSE
    AND (
      p_year IS NULL
      OR EXTRACT(YEAR FROM xml.dt_fatura)::INTEGER = p_year
    )
  ORDER BY xml.created_at DESC, xml.id DESC
  LIMIT p_limit;
END;
$function$;

CREATE OR REPLACE FUNCTION public.m16_list_denials_secure(
  p_tiss_xml_id BIGINT DEFAULT NULL,
  p_limit INTEGER DEFAULT 500
)
RETURNS TABLE (
  id BIGINT,
  tiss_xml_id BIGINT,
  cd_glosa_code VARCHAR,
  ds_motivo TEXT,
  vl_glosa NUMERIC,
  dt_glosa DATE,
  lg_recurso_enviado BOOLEAN,
  dt_recurso DATE,
  ds_protocolo_recurso VARCHAR,
  ds_status_recurso VARCHAR,
  cd_procedimento_tuss VARCHAR,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor RECORD;
BEGIN
  SELECT *
    INTO v_actor
    FROM private.m16_require_actor(ARRAY[]::TEXT[], FALSE, 'view');
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'TISS denial list limit must be between 1 and 1000';
  END IF;

  RETURN QUERY
  SELECT
    denial.id,
    denial.cd_tiss_xml,
    denial.cd_glosa_code,
    denial.ds_motivo,
    denial.vl_glosa,
    denial.dt_glosa,
    denial.lg_recurso_enviado,
    denial.dt_recurso,
    denial.ds_protocolo_recurso,
    denial.ds_status_recurso,
    denial.cd_procedimento_tuss,
    denial.created_at,
    denial.updated_at
  FROM public.tiss_glosas denial
  WHERE denial.company_id = v_actor.company_id
    AND (
      p_tiss_xml_id IS NULL
      OR denial.cd_tiss_xml = p_tiss_xml_id
    )
  ORDER BY denial.created_at DESC, denial.id DESC
  LIMIT p_limit;
END;
$function$;

CREATE OR REPLACE FUNCTION public.m16_list_protocols_secure()
RETURNS TABLE (
  id INTEGER,
  cd_convenio INTEGER,
  ds_endpoint VARCHAR,
  ds_versao_tiss VARCHAR,
  tp_ambiente VARCHAR,
  lg_active BOOLEAN,
  dt_ultimo_teste TIMESTAMPTZ,
  ds_status_teste VARCHAR,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor RECORD;
BEGIN
  SELECT *
    INTO v_actor
    FROM private.m16_require_actor(ARRAY[]::TEXT[], FALSE, 'view');

  RETURN QUERY
  SELECT
    protocol.id,
    protocol.cd_convenio,
    protocol.ds_endpoint,
    protocol.ds_versao_tiss,
    protocol.tp_ambiente,
    protocol.lg_active,
    protocol.dt_ultimo_teste,
    protocol.ds_status_teste,
    protocol.created_at,
    protocol.updated_at
  FROM public.tiss_protocols protocol
  WHERE protocol.company_id = v_actor.company_id
  ORDER BY protocol.cd_convenio, protocol.tp_ambiente;
END;
$function$;

CREATE OR REPLACE FUNCTION public.m16_list_guides_secure(
  p_status TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 500
)
RETURNS TABLE (
  id UUID,
  unit_id INTEGER,
  appointment_id BIGINT,
  billing_account_id UUID,
  source_xml_id BIGINT,
  substitution_of_id UUID,
  guide_number BIGINT,
  guide_type TEXT,
  status TEXT,
  tiss_version TEXT,
  environment TEXT,
  signed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor RECORD;
BEGIN
  SELECT *
    INTO v_actor
    FROM private.m16_require_actor(ARRAY[]::TEXT[], FALSE, 'view');
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'TISS guide list limit must be between 1 and 1000';
  END IF;

  RETURN QUERY
  SELECT
    guide.id,
    guide.unit_id,
    guide.appointment_id,
    guide.billing_account_id,
    guide.source_xml_id,
    guide.substitution_of_id,
    guide.guide_number,
    guide.guide_type,
    guide.status,
    guide.tiss_version,
    guide.environment,
    guide.signed_at,
    guide.cancelled_at,
    guide.created_at,
    guide.updated_at
  FROM public.tiss_guides guide
  WHERE guide.company_id = v_actor.company_id
    AND (p_status IS NULL OR guide.status = upper(trim(p_status)))
  ORDER BY guide.created_at DESC, guide.guide_number DESC
  LIMIT p_limit;
END;
$function$;

CREATE OR REPLACE FUNCTION public.m16_list_guide_events_secure(
  p_guide_id UUID
)
RETURNS TABLE (
  id UUID,
  guide_id UUID,
  event_type TEXT,
  from_status TEXT,
  to_status TEXT,
  reason TEXT,
  actor_user_id UUID,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor RECORD;
BEGIN
  SELECT *
    INTO v_actor
    FROM private.m16_require_actor(ARRAY[]::TEXT[], FALSE, 'view');
  IF p_guide_id IS NULL THEN
    RAISE EXCEPTION 'TISS guide id is required';
  END IF;

  RETURN QUERY
  SELECT
    event.id,
    event.guide_id,
    event.event_type,
    event.from_status,
    event.to_status,
    event.reason,
    event.actor_user_id,
    event.created_at
  FROM public.tiss_guide_events event
  WHERE event.company_id = v_actor.company_id
    AND event.guide_id = p_guide_id
  ORDER BY event.created_at, event.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.m16_get_xml_document_secure(
  p_tiss_xml_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor RECORD;
  v_document JSONB;
BEGIN
  SELECT *
    INTO v_actor
    FROM private.m16_require_actor(ARRAY[]::TEXT[], FALSE, 'export');
  IF p_tiss_xml_id IS NULL THEN
    RAISE EXCEPTION 'TISS XML id is required';
  END IF;

  SELECT jsonb_build_object(
    'id', xml.id,
    'appointment_id', xml.appointment_id,
    'ds_filename', xml.ds_filename,
    'ds_versao_tiss', xml.ds_versao_tiss,
    'tp_ambiente', xml.tp_ambiente,
    'status', xml.status,
    'ds_hash_envio', xml.ds_hash_envio,
    'ds_hash_retorno', xml.ds_hash_retorno,
    'bl_xml_enviado', xml.bl_xml_enviado,
    'bl_xml_retorno', xml.bl_xml_retorno,
    'bl_xml_recurso', xml.bl_xml_recurso
  )
    INTO v_document
    FROM public.tiss_xml xml
   WHERE xml.id = p_tiss_xml_id
     AND xml.company_id = v_actor.company_id
     AND COALESCE(xml.lg_deletado, FALSE) = FALSE;
  IF v_document IS NULL THEN
    RAISE EXCEPTION 'TISS XML not found in active company'
      USING ERRCODE = 'P0002';
  END IF;
  RETURN v_document;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tiss_get_stats(
  p_company_id UUID,
  p_year INTEGER DEFAULT EXTRACT(YEAR FROM NOW())::INTEGER
)
RETURNS TABLE (
  cd_convenio INTEGER,
  convenio_name VARCHAR,
  total_guias BIGINT,
  total_enviado NUMERIC,
  total_processado NUMERIC,
  total_liberado NUMERIC,
  total_glosado NUMERIC,
  total_pago NUMERIC,
  taxa_glosa_percent NUMERIC,
  taxa_recebimento_percent NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor RECORD;
BEGIN
  SELECT *
    INTO v_actor
    FROM private.m16_require_actor(ARRAY[]::TEXT[], FALSE, 'view');
  IF p_company_id IS NULL
     OR p_company_id IS DISTINCT FROM v_actor.company_id THEN
    RAISE EXCEPTION 'TISS statistics company must match the active tenant'
      USING ERRCODE = '42501';
  END IF;
  IF p_year IS NULL OR p_year < 2000 OR p_year > 2200 THEN
    RAISE EXCEPTION 'TISS statistics year is invalid';
  END IF;

  RETURN QUERY
  SELECT
    insurance.id,
    insurance.name,
    count(xml.id)::BIGINT,
    COALESCE(sum(xml.vl_informado), 0)::NUMERIC,
    COALESCE(sum(xml.vl_processado), 0)::NUMERIC,
    COALESCE(sum(xml.vl_liberado), 0)::NUMERIC,
    COALESCE(sum(xml.vl_glosa), 0)::NUMERIC,
    COALESCE(sum(
      CASE WHEN xml.status = 'PAGO' THEN xml.vl_liberado ELSE 0 END
    ), 0)::NUMERIC,
    CASE
      WHEN COALESCE(sum(xml.vl_informado), 0) > 0
      THEN round(
        (
          COALESCE(sum(xml.vl_glosa), 0)
          / NULLIF(sum(xml.vl_informado), 0)
        ) * 100,
        2
      )
      ELSE 0
    END::NUMERIC,
    CASE
      WHEN COALESCE(sum(xml.vl_liberado), 0) > 0
      THEN round(
        (
          COALESCE(sum(
            CASE WHEN xml.status = 'PAGO' THEN xml.vl_liberado ELSE 0 END
          ), 0)
          / NULLIF(sum(xml.vl_liberado), 0)
        ) * 100,
        2
      )
      ELSE 0
    END::NUMERIC
  FROM public.insurance_companies insurance
  LEFT JOIN public.tiss_xml xml
    ON xml.company_id = insurance.company_id
   AND xml.cd_convenio = insurance.id
   AND EXTRACT(YEAR FROM xml.dt_fatura) = p_year
   AND COALESCE(xml.lg_deletado, FALSE) = FALSE
  WHERE insurance.company_id = v_actor.company_id
    AND COALESCE(insurance.lg_ativo, TRUE)
  GROUP BY insurance.id, insurance.name
  ORDER BY COALESCE(sum(xml.vl_liberado), 0) DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.recalc_tiss_total_glosa(p_id BIGINT)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor RECORD;
  v_total NUMERIC(10,2);
BEGIN
  SELECT *
    INTO v_actor
    FROM private.m16_require_actor(
      ARRAY[
        'admin',
        'administrador',
        'financeiro',
        'faturamento',
        'faturista',
        'billing',
        'gestor'
      ],
      FALSE,
      'edit'
    );

  PERFORM 1
    FROM public.tiss_xml
   WHERE id = p_id
     AND company_id = v_actor.company_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TISS XML not found in active company';
  END IF;

  SELECT COALESCE(sum(denial.vl_glosa), 0)::NUMERIC(10,2)
    INTO v_total
    FROM public.tiss_glosas denial
   WHERE denial.cd_tiss_xml = p_id
     AND denial.company_id = v_actor.company_id;

  UPDATE public.tiss_xml
     SET vl_glosa = v_total,
         status = CASE WHEN v_total > 0 THEN 'GLOSADO' ELSE status END,
         updated_at = NOW()
   WHERE id = p_id
     AND company_id = v_actor.company_id;
  RETURN v_total;
END;
$function$;

ALTER FUNCTION public.m16_persist_xml_secure(UUID, BIGINT, JSONB)
  OWNER TO prontomedic_tiss_rpc_owner;
ALTER FUNCTION public.m16_record_transmission_result_gateway(
  UUID, BIGINT, BOOLEAN, INTEGER, TEXT, TEXT, TEXT, TIMESTAMPTZ
) OWNER TO prontomedic_tiss_rpc_owner;
ALTER FUNCTION public.m16_process_return_secure(UUID, BIGINT, JSONB)
  OWNER TO prontomedic_tiss_rpc_owner;
ALTER FUNCTION public.m16_record_manual_denial_secure(
  UUID, BIGINT, TEXT, NUMERIC, TEXT
) OWNER TO prontomedic_tiss_rpc_owner;
ALTER FUNCTION public.m16_generate_monthly_batch_secure(UUID, DATE)
  OWNER TO prontomedic_tiss_rpc_owner;
ALTER FUNCTION public.m16_save_protocol_secure(UUID, JSONB)
  OWNER TO prontomedic_tiss_rpc_owner;
ALTER FUNCTION public.m16_list_xml_secure(INTEGER, INTEGER)
  OWNER TO prontomedic_tiss_rpc_owner;
ALTER FUNCTION public.m16_list_denials_secure(BIGINT, INTEGER)
  OWNER TO prontomedic_tiss_rpc_owner;
ALTER FUNCTION public.m16_list_protocols_secure()
  OWNER TO prontomedic_tiss_rpc_owner;
ALTER FUNCTION public.m16_list_guides_secure(TEXT, INTEGER)
  OWNER TO prontomedic_tiss_rpc_owner;
ALTER FUNCTION public.m16_list_guide_events_secure(UUID)
  OWNER TO prontomedic_tiss_rpc_owner;
ALTER FUNCTION public.m16_get_xml_document_secure(BIGINT)
  OWNER TO prontomedic_tiss_rpc_owner;
ALTER FUNCTION public.tiss_get_stats(UUID, INTEGER)
  OWNER TO prontomedic_tiss_rpc_owner;
ALTER FUNCTION public.recalc_tiss_total_glosa(BIGINT)
  OWNER TO prontomedic_tiss_rpc_owner;

REVOKE ALL ON FUNCTION public.m16_company_id()
  FROM PUBLIC, anon, authenticated, app_prontomedic,
       prontomedic_tiss_gateway;
REVOKE ALL ON FUNCTION public.m16_can_operate_guides()
  FROM PUBLIC, anon, authenticated, app_prontomedic,
       prontomedic_tiss_gateway;
GRANT EXECUTE ON FUNCTION public.m16_company_id()
  TO prontomedic_tiss_rpc_owner;
GRANT EXECUTE ON FUNCTION public.m16_can_operate_guides()
  TO prontomedic_tiss_rpc_owner;

REVOKE ALL ON FUNCTION public.m16_persist_xml_secure(
  UUID, BIGINT, JSONB
) FROM PUBLIC, anon, authenticated, app_prontomedic,
       prontomedic_tiss_gateway;
REVOKE ALL ON FUNCTION public.m16_process_return_secure(
  UUID, BIGINT, JSONB
) FROM PUBLIC, anon, authenticated, app_prontomedic,
       prontomedic_tiss_gateway;
REVOKE ALL ON FUNCTION public.m16_record_manual_denial_secure(
  UUID, BIGINT, TEXT, NUMERIC, TEXT
) FROM PUBLIC, anon, authenticated, app_prontomedic,
       prontomedic_tiss_gateway;
REVOKE ALL ON FUNCTION public.m16_generate_monthly_batch_secure(
  UUID, DATE
) FROM PUBLIC, anon, authenticated, app_prontomedic,
       prontomedic_tiss_gateway;
REVOKE ALL ON FUNCTION public.m16_save_protocol_secure(
  UUID, JSONB
) FROM PUBLIC, anon, authenticated, app_prontomedic,
       prontomedic_tiss_gateway;
REVOKE ALL ON FUNCTION public.m16_record_transmission_result_gateway(
  UUID, BIGINT, BOOLEAN, INTEGER, TEXT, TEXT, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated, app_prontomedic,
       prontomedic_tiss_gateway;

GRANT EXECUTE ON FUNCTION public.m16_persist_xml_secure(
  UUID, BIGINT, JSONB
) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m16_process_return_secure(
  UUID, BIGINT, JSONB
) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m16_record_manual_denial_secure(
  UUID, BIGINT, TEXT, NUMERIC, TEXT
) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m16_generate_monthly_batch_secure(
  UUID, DATE
) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m16_save_protocol_secure(
  UUID, JSONB
) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m16_record_transmission_result_gateway(
  UUID, BIGINT, BOOLEAN, INTEGER, TEXT, TEXT, TEXT, TIMESTAMPTZ
) TO prontomedic_tiss_gateway;

REVOKE ALL ON FUNCTION public.m16_list_xml_secure(INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated, app_prontomedic,
       prontomedic_tiss_gateway;
REVOKE ALL ON FUNCTION public.m16_list_denials_secure(BIGINT, INTEGER)
  FROM PUBLIC, anon, authenticated, app_prontomedic,
       prontomedic_tiss_gateway;
REVOKE ALL ON FUNCTION public.m16_list_protocols_secure()
  FROM PUBLIC, anon, authenticated, app_prontomedic,
       prontomedic_tiss_gateway;
REVOKE ALL ON FUNCTION public.m16_list_guides_secure(TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated, app_prontomedic,
       prontomedic_tiss_gateway;
REVOKE ALL ON FUNCTION public.m16_list_guide_events_secure(UUID)
  FROM PUBLIC, anon, authenticated, app_prontomedic,
       prontomedic_tiss_gateway;
REVOKE ALL ON FUNCTION public.m16_get_xml_document_secure(BIGINT)
  FROM PUBLIC, anon, authenticated, app_prontomedic,
       prontomedic_tiss_gateway;
GRANT EXECUTE ON FUNCTION public.m16_list_xml_secure(INTEGER, INTEGER)
  TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m16_list_denials_secure(BIGINT, INTEGER)
  TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m16_list_protocols_secure()
  TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m16_list_guides_secure(TEXT, INTEGER)
  TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m16_list_guide_events_secure(UUID)
  TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m16_get_xml_document_secure(BIGINT)
  TO authenticated, app_prontomedic;

REVOKE ALL ON FUNCTION public.tiss_get_stats(UUID, INTEGER)
  FROM PUBLIC, anon, authenticated, app_prontomedic,
       prontomedic_tiss_gateway;
GRANT EXECUTE ON FUNCTION public.tiss_get_stats(UUID, INTEGER)
  TO authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION public.recalc_tiss_total_glosa(BIGINT)
  FROM PUBLIC, anon, authenticated, app_prontomedic,
       prontomedic_tiss_gateway;
GRANT EXECUTE ON FUNCTION public.recalc_tiss_total_glosa(BIGINT)
  TO authenticated, app_prontomedic;

REVOKE ALL ON FUNCTION public.create_tiss_guide_secure(
  TEXT, BIGINT, INTEGER, UUID, BIGINT, TEXT
) FROM PUBLIC, anon, authenticated, app_prontomedic,
       prontomedic_tiss_gateway;
REVOKE ALL ON FUNCTION public.validate_tiss_guide_secure(UUID, JSONB)
  FROM PUBLIC, anon, authenticated, app_prontomedic,
       prontomedic_tiss_gateway;
REVOKE ALL ON FUNCTION public.sign_tiss_guide_secure(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, app_prontomedic,
       prontomedic_tiss_gateway;
REVOKE ALL ON FUNCTION public.cancel_tiss_guide_secure(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, app_prontomedic,
       prontomedic_tiss_gateway;
REVOKE ALL ON FUNCTION public.substitute_tiss_guide_secure(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, app_prontomedic,
       prontomedic_tiss_gateway;
REVOKE ALL ON FUNCTION public.link_tiss_xml_guide_secure(UUID, BIGINT)
  FROM PUBLIC, anon, authenticated, app_prontomedic,
       prontomedic_tiss_gateway;
GRANT EXECUTE ON FUNCTION public.create_tiss_guide_secure(
  TEXT, BIGINT, INTEGER, UUID, BIGINT, TEXT
) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.validate_tiss_guide_secure(UUID, JSONB)
  TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.sign_tiss_guide_secure(UUID, TEXT, TEXT)
  TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.cancel_tiss_guide_secure(UUID, TEXT)
  TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.substitute_tiss_guide_secure(UUID, TEXT)
  TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.link_tiss_xml_guide_secure(UUID, BIGINT)
  TO authenticated, app_prontomedic;

DO $private_m16_acl$
DECLARE
  v_function RECORD;
BEGIN
  FOR v_function IN
    SELECT procedure_row.oid::REGPROCEDURE::TEXT AS signature
      FROM pg_proc procedure_row
      JOIN pg_namespace namespace_row
        ON namespace_row.oid = procedure_row.pronamespace
     WHERE namespace_row.nspname = 'private'
       AND procedure_row.proname LIKE 'm16_%'
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, app_prontomedic, prontomedic_tiss_gateway',
      v_function.signature
    );
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %s TO prontomedic_tiss_rpc_owner',
      v_function.signature
    );
  END LOOP;
END
$private_m16_acl$;

DROP FUNCTION IF EXISTS private.m16_require_actor(TEXT[], BOOLEAN);

COMMENT ON TABLE public.tiss_operation_requests IS
  'Internal tenant/payload-bound TISS idempotency ledger; no client table access.';
COMMENT ON FUNCTION public.m16_persist_xml_secure(UUID, BIGINT, JSONB) IS
  'Persist a generated TISS 4.03.00 XML atomically and idempotently without transmission.';
COMMENT ON FUNCTION public.m16_record_transmission_result_gateway(
  UUID, BIGINT, BOOLEAN, INTEGER, TEXT, TEXT, TEXT, TIMESTAMPTZ
) IS
  'Record a gateway result only. This function performs no external network call.';
COMMENT ON FUNCTION public.m16_process_return_secure(UUID, BIGINT, JSONB) IS
  'Process one insurer return and its denials atomically and idempotently.';
COMMENT ON FUNCTION public.m16_generate_monthly_batch_secure(UUID, DATE) IS
  'Assign a monthly batch atomically to already generated pending XML rows.';
COMMENT ON FUNCTION public.m16_save_protocol_secure(UUID, JSONB) IS
  'Persist only non-secret TISS protocol metadata; certificate and password columns are not accepted.';
COMMENT ON FUNCTION public.m16_get_xml_document_secure(BIGINT) IS
  'Return complete stored TISS XML only to canonical AAL2 actors with faturamento export permission.';

DO $deployment_ledger$
BEGIN
  IF to_regclass('public.prontomedic_deployment_migrations') IS NOT NULL THEN
    INSERT INTO public.prontomedic_deployment_migrations(filename, applied_at)
    VALUES ('20260727020432_module16_tiss_runtime_closure.sql', NOW())
    ON CONFLICT (filename) DO NOTHING;
  END IF;
END
$deployment_ledger$;

COMMIT;
