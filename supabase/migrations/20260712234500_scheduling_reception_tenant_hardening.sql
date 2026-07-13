-- Tenant-safe read surfaces for scheduling operations and reception insurance projections.
-- Direct mutations remain RPC-only; this migration never targets DataSIGH.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = public, pg_temp;

DO $preflight$
DECLARE
  v_relation TEXT;
BEGIN
  FOREACH v_relation IN ARRAY ARRAY[
    'scheduling_waitlist', 'scheduling_blocks',
    'insurance_authorizations', 'insurance_eligibility_checks',
    'reception_authorizations', 'reception_eligibility_checks'
  ] LOOP
    IF to_regclass('public.' || v_relation) IS NULL THEN
      RAISE EXCEPTION 'scheduling/reception hardening preflight: public.% is missing', v_relation;
    END IF;
  END LOOP;

  IF to_regprocedure('public.get_my_company_id()') IS NULL THEN
    RAISE EXCEPTION 'scheduling/reception hardening preflight: public.get_my_company_id() is missing';
  END IF;
END
$preflight$;

DO $rls$
DECLARE
  v_table TEXT;
  v_policy RECORD;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'scheduling_waitlist', 'scheduling_blocks',
    'insurance_authorizations', 'insurance_eligibility_checks'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', v_table);

    FOR v_policy IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = v_table
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', v_policy.policyname, v_table);
    END LOOP;
  END LOOP;
END
$rls$;

CREATE POLICY scheduling_waitlist_tenant_select
  ON public.scheduling_waitlist FOR SELECT TO authenticated
  USING (company_id = (SELECT public.get_my_company_id()));
CREATE POLICY scheduling_blocks_tenant_select
  ON public.scheduling_blocks FOR SELECT TO authenticated
  USING (company_id = (SELECT public.get_my_company_id()));
CREATE POLICY insurance_authorizations_tenant_select
  ON public.insurance_authorizations FOR SELECT TO authenticated
  USING (company_id = (SELECT public.get_my_company_id()));
CREATE POLICY insurance_eligibility_checks_tenant_select
  ON public.insurance_eligibility_checks FOR SELECT TO authenticated
  USING (company_id = (SELECT public.get_my_company_id()));

CREATE OR REPLACE FUNCTION public.enforce_operational_tenant_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $integrity$
DECLARE
  v_actor_company UUID;
BEGIN
  -- Migration/maintenance statements run without an application subject. Every
  -- authenticated request must resolve to one company and may only touch it.
  IF auth.uid() IS NOT NULL THEN
    v_actor_company := public.get_my_company_id();
    IF v_actor_company IS NULL OR NEW.company_id IS DISTINCT FROM v_actor_company THEN
      RAISE EXCEPTION 'operational tenant boundary violation';
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'scheduling_waitlist' THEN
    IF NOT EXISTS (SELECT 1 FROM public.patients p WHERE p.id = NEW.patient_id AND p.company_id = NEW.company_id) THEN
      RAISE EXCEPTION 'waitlist patient does not belong to company';
    END IF;
    IF NEW.professional_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.professionals p WHERE p.id = NEW.professional_id AND p.company_id = NEW.company_id
    ) THEN
      RAISE EXCEPTION 'waitlist professional does not belong to company';
    END IF;
    IF NEW.unit_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.units u WHERE u.id = NEW.unit_id AND u.company_id = NEW.company_id
    ) THEN
      RAISE EXCEPTION 'waitlist unit does not belong to company';
    END IF;
    IF NEW.appointment_type_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.appointment_types t WHERE t.id = NEW.appointment_type_id AND t.company_id = NEW.company_id
    ) THEN
      RAISE EXCEPTION 'waitlist appointment type does not belong to company';
    END IF;
  ELSIF TG_TABLE_NAME = 'scheduling_blocks' THEN
    IF NEW.professional_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.professionals p WHERE p.id = NEW.professional_id AND p.company_id = NEW.company_id
    ) THEN
      RAISE EXCEPTION 'schedule block professional does not belong to company';
    END IF;
    IF NEW.unit_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.units u WHERE u.id = NEW.unit_id AND u.company_id = NEW.company_id
    ) THEN
      RAISE EXCEPTION 'schedule block unit does not belong to company';
    END IF;
  ELSE
    IF NEW.patient_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.patients p WHERE p.id = NEW.patient_id AND p.company_id = NEW.company_id
    ) THEN
      RAISE EXCEPTION 'insurance patient does not belong to company';
    END IF;
    IF NEW.appointment_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.appointments a WHERE a.id = NEW.appointment_id AND a.company_id = NEW.company_id
    ) THEN
      RAISE EXCEPTION 'insurance appointment does not belong to company';
    END IF;
  END IF;

  RETURN NEW;
END
$integrity$;

DO $integrity_triggers$
DECLARE
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'scheduling_waitlist', 'scheduling_blocks',
    'insurance_authorizations', 'insurance_eligibility_checks'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS enforce_operational_tenant_integrity ON public.%I', v_table);
    EXECUTE format(
      'CREATE TRIGGER enforce_operational_tenant_integrity BEFORE INSERT OR UPDATE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.enforce_operational_tenant_integrity()',
      v_table
    );
  END LOOP;
END
$integrity_triggers$;

REVOKE EXECUTE ON FUNCTION public.enforce_operational_tenant_integrity() FROM PUBLIC, anon, authenticated;

-- Availability is read-only and must execute as the caller so FORCE RLS on
-- schedules, appointments and blocks remains effective.
ALTER FUNCTION public.get_professional_available_slots(BIGINT, DATE, INTEGER, INTEGER)
  SECURITY INVOKER;

ALTER VIEW public.reception_authorizations SET (security_invoker = true);
ALTER VIEW public.reception_eligibility_checks SET (security_invoker = true);

REVOKE ALL ON TABLE
  public.scheduling_waitlist, public.scheduling_blocks,
  public.insurance_authorizations, public.insurance_eligibility_checks,
  public.reception_authorizations, public.reception_eligibility_checks
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE
  public.scheduling_waitlist, public.scheduling_blocks,
  public.insurance_authorizations, public.insurance_eligibility_checks,
  public.reception_authorizations, public.reception_eligibility_checks
TO authenticated;

REVOKE ALL ON SEQUENCE
  public.scheduling_waitlist_id_seq, public.scheduling_blocks_id_seq
FROM PUBLIC, anon, authenticated;

DO $legacy_role_acl$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_prontomedic') THEN
    REVOKE ALL ON TABLE
      public.scheduling_waitlist, public.scheduling_blocks,
      public.insurance_authorizations, public.insurance_eligibility_checks,
      public.reception_authorizations, public.reception_eligibility_checks
    FROM app_prontomedic;
    GRANT SELECT ON TABLE
      public.scheduling_waitlist, public.scheduling_blocks,
      public.insurance_authorizations, public.insurance_eligibility_checks,
      public.reception_authorizations, public.reception_eligibility_checks
    TO app_prontomedic;
    REVOKE ALL ON SEQUENCE
      public.scheduling_waitlist_id_seq, public.scheduling_blocks_id_seq
    FROM app_prontomedic;
  END IF;
END
$legacy_role_acl$;

DO $rpc_acl$
DECLARE
  v_proc RECORD;
  v_identity TEXT;
  -- Mutating RPCs are constrained by the canonical tenant-integrity triggers;
  -- availability runs as SECURITY INVOKER and therefore remains under RLS.
  v_operational_rpc_names CONSTANT TEXT[] := ARRAY[
    'create_waitlist_entry_secure', 'close_waitlist_entry_secure',
    'convert_waitlist_to_appointment_secure', 'create_schedule_block_secure',
    'cancel_schedule_block_secure', 'get_professional_available_slots',
    'update_reception_authorization_secure', 'update_reception_eligibility_secure'
  ];
BEGIN
  FOR v_proc IN
    SELECT n.nspname, p.proname,
           pg_get_function_identity_arguments(p.oid) AS identity_arguments
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY(v_operational_rpc_names)
  LOOP
    v_identity := format('%I.%I(%s)', v_proc.nspname, v_proc.proname, v_proc.identity_arguments);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_identity);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_identity);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_prontomedic') THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM app_prontomedic', v_identity);
    END IF;
  END LOOP;
END
$rpc_acl$;

COMMIT;

