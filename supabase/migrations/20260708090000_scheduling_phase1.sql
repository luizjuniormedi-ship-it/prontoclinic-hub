-- =============================================================================
-- Scheduling phase 1: transactional appointment lifecycle
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.scheduling_status_history (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  appointment_id BIGINT NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  from_status VARCHAR(30),
  to_status VARCHAR(30) NOT NULL,
  reason TEXT,
  actor_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.scheduling_cancellations (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  appointment_id BIGINT NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  cancelled_by UUID,
  cancelled_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.scheduling_reschedules (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  appointment_id BIGINT NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  old_appointment_date DATE NOT NULL,
  old_start_time TIME NOT NULL,
  old_end_time TIME,
  new_appointment_date DATE NOT NULL,
  new_start_time TIME NOT NULL,
  new_end_time TIME,
  reason TEXT NOT NULL,
  rescheduled_by UUID,
  rescheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS unit_id INTEGER;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS service_id BIGINT;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS is_return BOOLEAN DEFAULT FALSE;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS is_walkin BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_sched_status_history_appt
  ON public.scheduling_status_history(appointment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sched_status_history_company
  ON public.scheduling_status_history(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sched_cancellations_appt
  ON public.scheduling_cancellations(appointment_id);
CREATE INDEX IF NOT EXISTS idx_sched_reschedules_appt
  ON public.scheduling_reschedules(appointment_id, rescheduled_at DESC);
CREATE INDEX IF NOT EXISTS idx_appointments_prof_date_time_active
  ON public.appointments(professional_id, appointment_date, start_time, end_time)
  WHERE status NOT IN ('cancelled', 'no_show');

CREATE OR REPLACE FUNCTION public.get_scheduling_actor()
RETURNS TABLE(user_id UUID, company_id UUID, role_name TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT up.id, up.company_id, lower(coalesce(up.role_name, ''))
  FROM public.user_profiles up
  WHERE up.id = auth.uid() OR up.user_id = auth.uid()
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.can_transition_appointment_status(
  p_from_status TEXT,
  p_to_status TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE p_from_status
    WHEN 'scheduled' THEN p_to_status IN ('confirmed', 'waiting', 'cancelled', 'no_show')
    WHEN 'confirmed' THEN p_to_status IN ('waiting', 'cancelled', 'no_show')
    WHEN 'waiting' THEN p_to_status IN ('in_progress', 'cancelled', 'no_show')
    WHEN 'in_progress' THEN p_to_status IN ('completed', 'cancelled')
    WHEN 'completed' THEN FALSE
    WHEN 'no_show' THEN p_to_status = 'scheduled'
    WHEN 'cancelled' THEN p_to_status = 'scheduled'
    ELSE FALSE
  END
$$;

CREATE OR REPLACE FUNCTION public.assert_scheduling_permission()
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_actor FROM public.get_scheduling_actor();

  IF v_actor.user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario autenticado sem perfil operacional';
  END IF;

  IF COALESCE(v_actor.role_name, '') NOT IN (
    'admin',
    'administrador',
    'recepcao',
    'recepção',
    'reception',
    'gestor',
    'medico',
    'médico'
  ) THEN
    RAISE EXCEPTION 'Usuario sem permissao para operar agenda';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_appointment_slot_available(
  p_professional_id BIGINT,
  p_appointment_date DATE,
  p_start_time TIME,
  p_end_time TIME,
  p_exclude_appointment_id BIGINT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conflict_id BIGINT;
  v_end_time TIME := COALESCE(p_end_time, p_start_time + INTERVAL '30 minutes');
BEGIN
  IF p_professional_id IS NULL THEN
    RAISE EXCEPTION 'Profissional e obrigatorio';
  END IF;

  IF p_appointment_date IS NULL OR p_start_time IS NULL THEN
    RAISE EXCEPTION 'Data e horario inicial sao obrigatorios';
  END IF;

  IF v_end_time <= p_start_time THEN
    RAISE EXCEPTION 'Horario final deve ser posterior ao horario inicial';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_professional_id::TEXT), hashtext(p_appointment_date::TEXT));

  SELECT a.id
    INTO v_conflict_id
    FROM public.appointments a
   WHERE a.professional_id = p_professional_id
     AND a.appointment_date = p_appointment_date
     AND a.status NOT IN ('cancelled', 'no_show')
     AND (p_exclude_appointment_id IS NULL OR a.id <> p_exclude_appointment_id)
     AND p_start_time < COALESCE(a.end_time, a.start_time + INTERVAL '30 minutes')
     AND v_end_time > a.start_time
   LIMIT 1;

  IF v_conflict_id IS NOT NULL THEN
    RAISE EXCEPTION 'Conflito de horario com o agendamento %', v_conflict_id
      USING ERRCODE = '23P01';
  END IF;
END;
$$;

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
AS $$
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
    p_professional_id,
    p_appointment_date,
    p_start_time,
    v_end_time,
    NULL
  );

  INSERT INTO public.appointments (
    company_id,
    unit_id,
    patient_id,
    professional_id,
    specialty_id,
    service_id,
    appointment_type_id,
    appointment_date,
    start_time,
    end_time,
    status,
    is_return,
    is_walkin,
    notes
  )
  VALUES (
    v_company_id,
    p_unit_id,
    p_patient_id,
    p_professional_id,
    p_specialty_id,
    p_service_id,
    p_appointment_type_id,
    p_appointment_date,
    p_start_time,
    v_end_time,
    p_status,
    p_is_return,
    p_is_walkin,
    NULLIF(trim(COALESCE(p_notes, '')), '')
  )
  RETURNING * INTO v_row;

  INSERT INTO public.scheduling_status_history (
    company_id,
    appointment_id,
    from_status,
    to_status,
    reason,
    actor_user_id
  )
  VALUES (
    v_row.company_id,
    v_row.id,
    NULL,
    v_row.status,
    CASE WHEN p_is_walkin THEN 'Criacao de encaixe' ELSE 'Criacao de agendamento' END,
    v_actor.user_id
  );

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_appointment_status_secure(
  p_appointment_id BIGINT,
  p_new_status TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS public.appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor RECORD;
  v_old public.appointments;
  v_row public.appointments;
BEGIN
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  PERFORM public.assert_scheduling_permission();

  SELECT * INTO v_old
    FROM public.appointments
   WHERE id = p_appointment_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento nao encontrado';
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
    company_id,
    appointment_id,
    from_status,
    to_status,
    reason,
    actor_user_id
  )
  VALUES (
    v_row.company_id,
    v_row.id,
    v_old.status,
    v_row.status,
    NULLIF(trim(COALESCE(p_reason, '')), ''),
    v_actor.user_id
  );

  IF p_new_status = 'cancelled' THEN
    INSERT INTO public.scheduling_cancellations (
      company_id,
      appointment_id,
      reason,
      cancelled_by
    )
    VALUES (
      v_row.company_id,
      v_row.id,
      NULLIF(trim(COALESCE(p_reason, '')), ''),
      v_actor.user_id
    );
  END IF;

  RETURN v_row;
END;
$$;

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
AS $$
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

  SELECT * INTO v_old
    FROM public.appointments
   WHERE id = p_appointment_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento nao encontrado';
  END IF;

  IF v_old.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Agendamento % nao pode ser remarcado no status %', p_appointment_id, v_old.status;
  END IF;

  PERFORM public.assert_appointment_slot_available(
    v_old.professional_id,
    p_new_appointment_date,
    p_new_start_time,
    v_new_end_time,
    p_appointment_id
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
    company_id,
    appointment_id,
    old_appointment_date,
    old_start_time,
    old_end_time,
    new_appointment_date,
    new_start_time,
    new_end_time,
    reason,
    rescheduled_by
  )
  VALUES (
    v_row.company_id,
    v_row.id,
    v_old.appointment_date,
    v_old.start_time,
    v_old.end_time,
    v_row.appointment_date,
    v_row.start_time,
    v_row.end_time,
    p_reason,
    v_actor.user_id
  );

  INSERT INTO public.scheduling_status_history (
    company_id,
    appointment_id,
    from_status,
    to_status,
    reason,
    actor_user_id
  )
  VALUES (
    v_row.company_id,
    v_row.id,
    v_old.status,
    v_row.status,
    'Remarcacao: ' || p_reason,
    v_actor.user_id
  );

  RETURN v_row;
END;
$$;

ALTER TABLE public.scheduling_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduling_cancellations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduling_reschedules ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    DROP POLICY IF EXISTS "scheduling_status_history_select_company" ON public.scheduling_status_history;
    DROP POLICY IF EXISTS "scheduling_cancellations_select_company" ON public.scheduling_cancellations;
    DROP POLICY IF EXISTS "scheduling_reschedules_select_company" ON public.scheduling_reschedules;

    CREATE POLICY "scheduling_status_history_select_company"
      ON public.scheduling_status_history
      FOR SELECT
      TO authenticated
      USING (company_id = (SELECT company_id FROM public.get_scheduling_actor()));

    CREATE POLICY "scheduling_cancellations_select_company"
      ON public.scheduling_cancellations
      FOR SELECT
      TO authenticated
      USING (company_id = (SELECT company_id FROM public.get_scheduling_actor()));

    CREATE POLICY "scheduling_reschedules_select_company"
      ON public.scheduling_reschedules
      FOR SELECT
      TO authenticated
      USING (company_id = (SELECT company_id FROM public.get_scheduling_actor()));

    GRANT EXECUTE ON FUNCTION public.create_appointment_secure(
      BIGINT, BIGINT, DATE, TIME, TIME, UUID, INTEGER, INTEGER, BIGINT, BIGINT, TEXT, BOOLEAN, BOOLEAN, TEXT
    ) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.update_appointment_status_secure(BIGINT, TEXT, TEXT) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.reschedule_appointment_secure(BIGINT, DATE, TIME, TIME, TEXT) TO authenticated;
    GRANT SELECT ON public.scheduling_status_history TO authenticated;
    GRANT SELECT ON public.scheduling_cancellations TO authenticated;
    GRANT SELECT ON public.scheduling_reschedules TO authenticated;
  END IF;
END $$;
