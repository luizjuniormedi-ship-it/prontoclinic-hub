-- Enforce call-center operator identity integrity by tenant.
-- Existing bad rows are rejected before constraints are created.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.scheduling_contact_logs c
      LEFT JOIN public.user_profiles p
        ON p.id = c.operator_id AND p.company_id = c.company_id
     WHERE c.operator_id IS NOT NULL AND p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Call center has operator profiles outside their tenant';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.scheduling_call_center_tasks t
      LEFT JOIN public.user_profiles p
        ON p.id = t.assigned_to AND p.company_id = t.company_id
     WHERE t.assigned_to IS NOT NULL AND p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Call center has assigned operators outside their tenant';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_company_id_id_uq
  ON public.user_profiles(company_id, id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'scheduling_contact_logs_operator_profile_fk'
  ) THEN
    ALTER TABLE public.scheduling_contact_logs
      ADD CONSTRAINT scheduling_contact_logs_operator_profile_fk
      FOREIGN KEY (company_id, operator_id)
      REFERENCES public.user_profiles(company_id, id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'scheduling_call_center_tasks_assigned_profile_fk'
  ) THEN
    ALTER TABLE public.scheduling_call_center_tasks
      ADD CONSTRAINT scheduling_call_center_tasks_assigned_profile_fk
      FOREIGN KEY (company_id, assigned_to)
      REFERENCES public.user_profiles(company_id, id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.create_call_center_task_secure(
  p_patient_id BIGINT DEFAULT NULL,
  p_appointment_id BIGINT DEFAULT NULL,
  p_contact_log_id BIGINT DEFAULT NULL,
  p_assigned_to UUID DEFAULT NULL,
  p_task_type TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_due_at TIMESTAMPTZ DEFAULT NULL,
  p_priority TEXT DEFAULT 'normal'
)
RETURNS public.scheduling_call_center_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor RECORD;
  v_row public.scheduling_call_center_tasks;
  v_assigned_to UUID;
BEGIN
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  PERFORM public.assert_call_center_permission();

  IF NULLIF(trim(COALESCE(p_task_type, '')), '') IS NULL
     OR NULLIF(trim(COALESCE(p_description, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Tipo e descricao da tarefa sao obrigatorios';
  END IF;

  v_assigned_to := COALESCE(p_assigned_to, v_actor.user_id);

  IF NOT EXISTS (
    SELECT 1
      FROM public.user_profiles
     WHERE id = v_assigned_to
       AND company_id = v_actor.company_id
       AND COALESCE(lg_ativo, true) = true
  ) THEN
    RAISE EXCEPTION 'Operador fora da empresa ou inativo';
  END IF;

  IF p_patient_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.patients WHERE id = p_patient_id AND company_id = v_actor.company_id
  ) THEN RAISE EXCEPTION 'Paciente fora da empresa do usuario'; END IF;

  IF p_appointment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.appointments WHERE id = p_appointment_id AND company_id = v_actor.company_id
  ) THEN RAISE EXCEPTION 'Agendamento fora da empresa do usuario'; END IF;

  IF p_contact_log_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.scheduling_contact_logs WHERE id = p_contact_log_id AND company_id = v_actor.company_id
  ) THEN RAISE EXCEPTION 'Contato fora da empresa do usuario'; END IF;

  INSERT INTO public.scheduling_call_center_tasks (
    company_id, patient_id, appointment_id, contact_log_id, assigned_to,
    task_type, priority, status, due_at, description
  )
  VALUES (
    v_actor.company_id, p_patient_id, p_appointment_id, p_contact_log_id,
    v_assigned_to, trim(p_task_type), p_priority,
    'pending', p_due_at, trim(p_description)
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.create_call_center_task_secure(BIGINT,BIGINT,BIGINT,UUID,TEXT,TEXT,TIMESTAMPTZ,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_call_center_task_secure(BIGINT,BIGINT,BIGINT,UUID,TEXT,TEXT,TIMESTAMPTZ,TEXT) TO authenticated, service_role;
