-- Secure Call Center mutations with role, tenant and atomic contact/task handling.

CREATE OR REPLACE FUNCTION public.assert_call_center_permission()
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_actor RECORD;
BEGIN
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  IF v_actor.user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario autenticado sem perfil operacional';
  END IF;
  IF COALESCE(v_actor.role_name, '') NOT IN (
    'admin', 'administrador', 'gestor', 'recepcao', 'recepção',
    'reception', 'call_center', 'callcenter', 'supervisor_recepcao'
  ) THEN
    RAISE EXCEPTION 'Perfil sem permissao para call center';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_call_center_contact_secure(
  p_patient_id BIGINT DEFAULT NULL,
  p_appointment_id BIGINT DEFAULT NULL,
  p_channel TEXT DEFAULT 'telefone',
  p_direction TEXT DEFAULT 'inbound',
  p_contact_reason TEXT DEFAULT NULL,
  p_result TEXT DEFAULT 'retornar_depois',
  p_notes TEXT DEFAULT NULL,
  p_next_action TEXT DEFAULT NULL,
  p_next_action_at TIMESTAMPTZ DEFAULT NULL,
  p_create_task BOOLEAN DEFAULT FALSE
)
RETURNS public.scheduling_contact_logs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor RECORD;
  v_row public.scheduling_contact_logs;
  v_patient_company UUID;
  v_appointment_company UUID;
BEGIN
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  PERFORM public.assert_call_center_permission();

  IF NULLIF(trim(COALESCE(p_contact_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Motivo do contato e obrigatorio';
  END IF;

  IF p_patient_id IS NOT NULL THEN
    SELECT company_id INTO v_patient_company FROM public.patients WHERE id = p_patient_id;
    IF v_patient_company IS DISTINCT FROM v_actor.company_id THEN
      RAISE EXCEPTION 'Paciente fora da empresa do usuario';
    END IF;
  END IF;

  IF p_appointment_id IS NOT NULL THEN
    SELECT company_id INTO v_appointment_company FROM public.appointments WHERE id = p_appointment_id;
    IF v_appointment_company IS DISTINCT FROM v_actor.company_id THEN
      RAISE EXCEPTION 'Agendamento fora da empresa do usuario';
    END IF;
  END IF;

  INSERT INTO public.scheduling_contact_logs (
    company_id, patient_id, appointment_id, operator_id, channel, direction,
    contact_reason, result, notes, next_action, next_action_at
  )
  VALUES (
    v_actor.company_id, p_patient_id, p_appointment_id, v_actor.user_id, p_channel,
    p_direction, trim(p_contact_reason), p_result, p_notes, p_next_action, p_next_action_at
  )
  RETURNING * INTO v_row;

  IF p_create_task AND NULLIF(trim(COALESCE(p_next_action, '')), '') IS NOT NULL THEN
    INSERT INTO public.scheduling_call_center_tasks (
      company_id, patient_id, appointment_id, contact_log_id, assigned_to,
      task_type, priority, status, due_at, description
    )
    VALUES (
      v_actor.company_id, p_patient_id, p_appointment_id, v_row.id, v_actor.user_id,
      trim(p_next_action), 'normal', 'pending', p_next_action_at,
      COALESCE(NULLIF(trim(p_notes), ''), trim(p_contact_reason))
    );
  END IF;

  RETURN v_row;
END;
$$;

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
BEGIN
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  PERFORM public.assert_call_center_permission();

  IF NULLIF(trim(COALESCE(p_task_type, '')), '') IS NULL
     OR NULLIF(trim(COALESCE(p_description, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Tipo e descricao da tarefa sao obrigatorios';
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
    COALESCE(p_assigned_to, v_actor.user_id), trim(p_task_type), p_priority,
    'pending', p_due_at, trim(p_description)
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_call_center_task_secure(
  p_task_id BIGINT
)
RETURNS public.scheduling_call_center_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor RECORD;
  v_row public.scheduling_call_center_tasks;
BEGIN
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  PERFORM public.assert_call_center_permission();

  UPDATE public.scheduling_call_center_tasks
     SET status = 'done', completed_at = NOW(), updated_at = NOW()
   WHERE id = p_task_id
     AND company_id = v_actor.company_id
     AND status <> 'cancelled'
   RETURNING * INTO v_row;

  IF NOT FOUND THEN RAISE EXCEPTION 'Tarefa nao encontrada ou fora da empresa'; END IF;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_call_center_permission() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_call_center_contact_secure(BIGINT,BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_call_center_task_secure(BIGINT,BIGINT,BIGINT,UUID,TEXT,TEXT,TIMESTAMPTZ,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_call_center_task_secure(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_call_center_permission() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_call_center_contact_secure(BIGINT,BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_call_center_task_secure(BIGINT,BIGINT,BIGINT,UUID,TEXT,TEXT,TIMESTAMPTZ,TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_call_center_task_secure(BIGINT) TO authenticated, service_role;
