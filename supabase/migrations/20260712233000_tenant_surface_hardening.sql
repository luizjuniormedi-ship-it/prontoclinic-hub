-- Tenant-safe browser surface for scheduling and reception.
-- This migration is repository/ephemeral-runtime only; it never targets DataSIGH.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = public, pg_temp;

DO $preflight$
DECLARE
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'patients', 'professionals', 'appointments', 'appointment_types',
    'services_catalog', 'units', 'payment_sources', 'insurance_companies',
    'specialties'
  ] LOOP
    IF to_regclass('public.' || v_table) IS NULL THEN
      RAISE EXCEPTION 'tenant surface preflight: public.% is missing', v_table;
    END IF;
  END LOOP;

  IF to_regprocedure('public.get_my_company_id()') IS NULL THEN
    RAISE EXCEPTION 'tenant surface preflight: public.get_my_company_id() is missing';
  END IF;
  IF to_regprocedure('public.assert_scheduling_permission()') IS NULL THEN
    RAISE EXCEPTION 'tenant surface preflight: public.assert_scheduling_permission() is missing';
  END IF;
END
$preflight$;

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS insurance_plan_id INTEGER,
  ADD COLUMN IF NOT EXISTS allergies TEXT,
  ADD COLUMN IF NOT EXISTS clinical_alerts TEXT;

DO $units_name$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'units' AND column_name = 'name'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'units' AND column_name = 'ds_nome'
    ) THEN
      RAISE EXCEPTION 'tenant surface compatibility: units.name and units.ds_nome are both missing';
    END IF;
    ALTER TABLE public.units
      ADD COLUMN name VARCHAR(100) GENERATED ALWAYS AS (ds_nome) STORED;
  END IF;
END
$units_name$;

CREATE OR REPLACE FUNCTION public.assert_scheduling_permission()
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticacao obrigatoria para operar agenda'
      USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_actor FROM public.get_scheduling_actor();

  IF v_actor.user_id IS NULL OR v_actor.company_id IS NULL THEN
    RAISE EXCEPTION 'Usuario autenticado sem perfil operacional e empresa';
  END IF;

  IF COALESCE(v_actor.role_name, '') NOT IN (
    'admin', 'administrador', 'recepcao', 'recepção', 'reception',
    'gestor', 'medico', 'médico'
  ) THEN
    RAISE EXCEPTION 'Usuario sem permissao para operar agenda';
  END IF;
END;
$function$;

-- Exact definitions preserved from 20260708090000_scheduling_phase1.sql.
-- Only actor-company predicates were added to these SECURITY DEFINER RPCs.
CREATE OR REPLACE FUNCTION public.create_appointment_secure(
  p_patient_id BIGINT,
  p_professional_id BIGINT,
  p_appointment_date DATE,
  p_start_time TIME,
  p_end_time TIME DEFAULT NULL,
  p_company_id UUID DEFAULT NULL,
  p_unit_id INTEGER DEFAULT NULL,
  p_specialty_id INTEGER DEFAULT NULL,
  p_service_id BIGINT DEFAULT NULL,
  p_appointment_type_id BIGINT DEFAULT NULL,
  p_status TEXT DEFAULT 'scheduled',
  p_is_return BOOLEAN DEFAULT FALSE,
  p_is_walkin BOOLEAN DEFAULT FALSE,
  p_notes TEXT DEFAULT NULL
)
RETURNS public.appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor RECORD;
  v_company_id UUID;
  v_end_time TIME := COALESCE(p_end_time, p_start_time + INTERVAL '30 minutes');
  v_row public.appointments;
BEGIN
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  PERFORM public.assert_scheduling_permission();

  v_company_id := COALESCE(
    p_company_id,
    v_actor.company_id,
    (SELECT company_id FROM public.patients WHERE id = p_patient_id),
    (SELECT company_id FROM public.professionals WHERE id = p_professional_id)
  );

  IF v_company_id IS DISTINCT FROM v_actor.company_id THEN
    RAISE EXCEPTION 'Empresa do agendamento difere da empresa do usuario';
  END IF;
  IF EXISTS (SELECT 1 FROM public.patients WHERE id = p_patient_id AND company_id IS DISTINCT FROM v_actor.company_id) THEN
    RAISE EXCEPTION 'Paciente fora da empresa do usuario';
  END IF;
  IF EXISTS (SELECT 1 FROM public.professionals WHERE id = p_professional_id AND company_id IS DISTINCT FROM v_actor.company_id) THEN
    RAISE EXCEPTION 'Profissional fora da empresa do usuario';
  END IF;
  IF p_unit_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.units WHERE id = p_unit_id AND company_id IS DISTINCT FROM v_actor.company_id) THEN
    RAISE EXCEPTION 'Unidade fora da empresa do usuario';
  END IF;
  IF p_service_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.services_catalog WHERE id = p_service_id AND company_id IS DISTINCT FROM v_actor.company_id) THEN
    RAISE EXCEPTION 'Servico fora da empresa do usuario';
  END IF;
  IF p_appointment_type_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.appointment_types WHERE id = p_appointment_type_id AND company_id IS DISTINCT FROM v_actor.company_id) THEN
    RAISE EXCEPTION 'Tipo de agendamento fora da empresa do usuario';
  END IF;

  IF p_patient_id IS NULL THEN
    RAISE EXCEPTION 'Paciente e obrigatorio';
  END IF;
  IF p_status NOT IN ('scheduled', 'confirmed', 'waiting', 'in_progress', 'completed', 'no_show', 'cancelled') THEN
    RAISE EXCEPTION 'Status de agendamento invalido: %', p_status;
  END IF;
  IF p_is_walkin AND NULLIF(trim(COALESCE(p_notes, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Justificativa do encaixe e obrigatoria';
  END IF;
  IF p_status IN ('cancelled', 'no_show') THEN
    RAISE EXCEPTION 'Crie agendamento ativo e use a transicao de status para cancelar ou registrar falta';
  END IF;

  PERFORM public.assert_appointment_slot_available(
    p_professional_id, p_appointment_date, p_start_time, v_end_time, NULL
  );

  INSERT INTO public.appointments (
    company_id, unit_id, patient_id, professional_id, specialty_id, service_id,
    appointment_type_id, appointment_date, start_time, end_time, status,
    is_return, is_walkin, notes
  ) VALUES (
    v_company_id, p_unit_id, p_patient_id, p_professional_id, p_specialty_id,
    p_service_id, p_appointment_type_id, p_appointment_date, p_start_time,
    v_end_time, p_status, p_is_return, p_is_walkin,
    NULLIF(trim(COALESCE(p_notes, '')), '')
  ) RETURNING * INTO v_row;

  INSERT INTO public.scheduling_status_history (
    company_id, appointment_id, from_status, to_status, reason, actor_user_id
  ) VALUES (
    v_row.company_id, v_row.id, NULL, v_row.status,
    CASE WHEN p_is_walkin THEN 'Criacao de encaixe' ELSE 'Criacao de agendamento' END,
    v_actor.user_id
  );

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_appointment_status_secure(
  p_appointment_id BIGINT,
  p_new_status TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS public.appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor RECORD;
  v_old public.appointments;
  v_row public.appointments;
BEGIN
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  PERFORM public.assert_scheduling_permission();

  SELECT * INTO v_old FROM public.appointments
   WHERE id = p_appointment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento nao encontrado';
  END IF;
  IF v_old.company_id IS DISTINCT FROM v_actor.company_id THEN
    RAISE EXCEPTION 'Agendamento fora da empresa do usuario';
  END IF;
  IF NOT public.can_transition_appointment_status(v_old.status, p_new_status) THEN
    RAISE EXCEPTION 'Transicao invalida: % para %', v_old.status, p_new_status;
  END IF;
  IF p_new_status IN ('cancelled', 'no_show') AND NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Motivo e obrigatorio para cancelar ou registrar falta';
  END IF;

  UPDATE public.appointments
     SET status = p_new_status,
         notes = COALESCE(NULLIF(trim(COALESCE(p_reason, '')), ''), notes),
         updated_at = NOW()
   WHERE id = p_appointment_id
   RETURNING * INTO v_row;

  INSERT INTO public.scheduling_status_history (
    company_id, appointment_id, from_status, to_status, reason, actor_user_id
  ) VALUES (
    v_row.company_id, v_row.id, v_old.status, v_row.status,
    NULLIF(trim(COALESCE(p_reason, '')), ''), v_actor.user_id
  );

  IF p_new_status = 'cancelled' THEN
    INSERT INTO public.scheduling_cancellations (
      company_id, appointment_id, reason, cancelled_by
    ) VALUES (
      v_row.company_id, v_row.id, NULLIF(trim(COALESCE(p_reason, '')), ''),
      v_actor.user_id
    );
  END IF;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reschedule_appointment_secure(
  p_appointment_id BIGINT,
  p_new_appointment_date DATE,
  p_new_start_time TIME,
  p_new_end_time TIME DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS public.appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor RECORD;
  v_old public.appointments;
  v_row public.appointments;
  v_new_end_time TIME := COALESCE(p_new_end_time, p_new_start_time + INTERVAL '30 minutes');
BEGIN
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  PERFORM public.assert_scheduling_permission();

  IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Motivo da remarcacao e obrigatorio';
  END IF;
  SELECT * INTO v_old FROM public.appointments
   WHERE id = p_appointment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento nao encontrado';
  END IF;
  IF v_old.company_id IS DISTINCT FROM v_actor.company_id THEN
    RAISE EXCEPTION 'Agendamento fora da empresa do usuario';
  END IF;
  IF v_old.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Agendamento % nao pode ser remarcado no status %', p_appointment_id, v_old.status;
  END IF;

  PERFORM public.assert_appointment_slot_available(
    v_old.professional_id, p_new_appointment_date, p_new_start_time,
    v_new_end_time, p_appointment_id
  );

  UPDATE public.appointments
     SET appointment_date = p_new_appointment_date,
         start_time = p_new_start_time,
         end_time = v_new_end_time,
         status = 'scheduled',
         notes = p_reason,
         updated_at = NOW()
   WHERE id = p_appointment_id
   RETURNING * INTO v_row;

  INSERT INTO public.scheduling_reschedules (
    company_id, appointment_id, old_appointment_date, old_start_time,
    old_end_time, new_appointment_date, new_start_time, new_end_time,
    reason, rescheduled_by
  ) VALUES (
    v_row.company_id, v_row.id, v_old.appointment_date, v_old.start_time,
    v_old.end_time, v_row.appointment_date, v_row.start_time, v_row.end_time,
    p_reason, v_actor.user_id
  );

  INSERT INTO public.scheduling_status_history (
    company_id, appointment_id, from_status, to_status, reason, actor_user_id
  ) VALUES (
    v_row.company_id, v_row.id, v_old.status, v_row.status,
    'Remarcacao: ' || p_reason, v_actor.user_id
  );

  RETURN v_row;
END;
$function$;

DO $rls$
DECLARE
  v_table TEXT;
  v_policy RECORD;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'patients', 'professionals', 'appointments', 'appointment_types',
    'services_catalog', 'units', 'payment_sources', 'insurance_companies',
    'specialties'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', v_table);
    FOR v_policy IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = v_table
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', v_policy.policyname, v_table);
    END LOOP;
  END LOOP;
END
$rls$;

CREATE POLICY tenant_surface_patients_select ON public.patients
  FOR SELECT TO authenticated USING (company_id = (SELECT public.get_my_company_id()));
CREATE POLICY tenant_surface_professionals_select ON public.professionals
  FOR SELECT TO authenticated USING (company_id = (SELECT public.get_my_company_id()));
CREATE POLICY tenant_surface_appointments_select ON public.appointments
  FOR SELECT TO authenticated USING (company_id = (SELECT public.get_my_company_id()));
CREATE POLICY tenant_surface_appointment_types_select ON public.appointment_types
  FOR SELECT TO authenticated USING (company_id = (SELECT public.get_my_company_id()));
CREATE POLICY tenant_surface_services_catalog_select ON public.services_catalog
  FOR SELECT TO authenticated USING (company_id = (SELECT public.get_my_company_id()));
CREATE POLICY tenant_surface_units_select ON public.units
  FOR SELECT TO authenticated USING (company_id = (SELECT public.get_my_company_id()));
CREATE POLICY tenant_surface_payment_sources_select ON public.payment_sources
  FOR SELECT TO authenticated USING (company_id = (SELECT public.get_my_company_id()));
CREATE POLICY tenant_surface_insurance_companies_select ON public.insurance_companies
  FOR SELECT TO authenticated USING (company_id = (SELECT public.get_my_company_id()));
CREATE POLICY tenant_surface_specialties_shared_select ON public.specialties
  FOR SELECT TO authenticated USING (TRUE);

REVOKE ALL ON TABLE
  public.patients, public.professionals, public.appointments,
  public.appointment_types, public.services_catalog, public.units,
  public.payment_sources, public.insurance_companies, public.specialties
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE
  public.patients, public.professionals, public.appointments,
  public.appointment_types, public.services_catalog, public.units,
  public.payment_sources, public.insurance_companies, public.specialties
TO authenticated;

-- Direct appointment mutations are RPC-only.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.appointments FROM PUBLIC, anon, authenticated;

-- Signatures have varied across baselines. Protect every existing overload by
-- catalog identity instead of guessing argument lists.
DO $rpc_acl$
DECLARE
  v_proc RECORD;
  v_identity TEXT;
  v_rpc_names CONSTANT TEXT[] := ARRAY[
    'get_scheduling_actor', 'assert_scheduling_permission',
    'assert_appointment_slot_available', 'create_appointment_secure',
    'update_appointment_status_secure', 'reschedule_appointment_secure',
    'get_scheduling_requirements', 'create_appointment_with_requirements_secure',
    'convert_waitlist_to_appointment_secure', 'create_schedule_block_secure',
    'cancel_schedule_block_secure', 'get_professional_available_slots',
    'mark_overdue_appointments_no_show_secure',
    'get_reception_checkin_readiness', 'perform_reception_checkin_secure',
    'update_reception_authorization_secure', 'update_reception_eligibility_secure',
    'update_appointment_secure', 'update_patient_secure'
  ];
BEGIN
  FOR v_proc IN
    SELECT p.oid, n.nspname, p.proname,
           pg_get_function_identity_arguments(p.oid) AS identity_arguments
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY(v_rpc_names)
  LOOP
    v_identity := format('%I.%I(%s)', v_proc.nspname, v_proc.proname, v_proc.identity_arguments);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', v_identity);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_identity);
  END LOOP;
END
$rpc_acl$;

COMMIT;
