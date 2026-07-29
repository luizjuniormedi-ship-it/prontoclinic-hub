-- Call Center: make contact/task mutations atomic and remove direct browser writes.

BEGIN;

DO $requirements$
BEGIN
  IF to_regclass('public.scheduling_contact_logs') IS NULL
     OR to_regclass('public.scheduling_call_center_tasks') IS NULL
     OR to_regclass('public.patients') IS NULL
     OR to_regclass('public.appointments') IS NULL
     OR to_regprocedure('public.active_company_id()') IS NULL
     OR to_regprocedure('public.active_unit_id()') IS NULL
     OR to_regprocedure('public.can_access(text,text)') IS NULL
     OR to_regprocedure('auth.uid()') IS NULL
     OR to_regrole('prontomedic_reception_rpc_owner') IS NULL THEN
    RAISE EXCEPTION 'Call Center atomic command dependencies are missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'prontomedic_reception_rpc_owner'
      AND (
        rolcanlogin OR rolinherit OR rolbypassrls OR rolsuper
        OR rolcreatedb OR rolcreaterole OR rolreplication
      )
  ) THEN
    RAISE EXCEPTION 'Call Center requires the hardened reception RPC owner';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class relation
    JOIN pg_roles owner_role ON owner_role.oid = relation.relowner
    WHERE relation.oid IN (
      'public.scheduling_contact_logs'::REGCLASS,
      'public.scheduling_call_center_tasks'::REGCLASS
    )
      AND owner_role.rolname = 'prontomedic_reception_rpc_owner'
  ) THEN
    RAISE EXCEPTION 'Call Center RPC owner must not own command tables';
  END IF;
END
$requirements$;

ALTER TABLE public.scheduling_contact_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduling_contact_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.scheduling_call_center_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduling_call_center_tasks FORCE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public, auth TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION auth.uid() TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION public.active_company_id()
  TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION public.active_unit_id()
  TO prontomedic_reception_rpc_owner;
GRANT EXECUTE ON FUNCTION public.can_access(TEXT, TEXT)
  TO prontomedic_reception_rpc_owner;
GRANT SELECT ON TABLE public.patients, public.appointments
  TO prontomedic_reception_rpc_owner;
GRANT SELECT, INSERT ON TABLE public.scheduling_contact_logs
  TO prontomedic_reception_rpc_owner;
GRANT SELECT, INSERT, UPDATE ON TABLE public.scheduling_call_center_tasks
  TO prontomedic_reception_rpc_owner;
GRANT USAGE, SELECT ON SEQUENCE public.scheduling_contact_logs_id_seq
  TO prontomedic_reception_rpc_owner;
GRANT USAGE, SELECT ON SEQUENCE public.scheduling_call_center_tasks_id_seq
  TO prontomedic_reception_rpc_owner;

DROP POLICY IF EXISTS scheduling_contact_logs_command_select
  ON public.scheduling_contact_logs;
CREATE POLICY scheduling_contact_logs_command_select
  ON public.scheduling_contact_logs
  FOR SELECT TO prontomedic_reception_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND public.can_access('recepcao', 'create')
  );

DROP POLICY IF EXISTS scheduling_contact_logs_command_insert
  ON public.scheduling_contact_logs;
CREATE POLICY scheduling_contact_logs_command_insert
  ON public.scheduling_contact_logs
  FOR INSERT TO prontomedic_reception_rpc_owner
  WITH CHECK (
    company_id = public.active_company_id()
    AND operator_id = auth.uid()
    AND public.can_access('recepcao', 'create')
  );

DROP POLICY IF EXISTS scheduling_call_center_tasks_command_select
  ON public.scheduling_call_center_tasks;
CREATE POLICY scheduling_call_center_tasks_command_select
  ON public.scheduling_call_center_tasks
  FOR SELECT TO prontomedic_reception_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND (
      public.can_access('recepcao', 'create')
      OR public.can_access('recepcao', 'edit')
    )
  );

DROP POLICY IF EXISTS scheduling_call_center_tasks_command_insert
  ON public.scheduling_call_center_tasks;
CREATE POLICY scheduling_call_center_tasks_command_insert
  ON public.scheduling_call_center_tasks
  FOR INSERT TO prontomedic_reception_rpc_owner
  WITH CHECK (
    company_id = public.active_company_id()
    AND assigned_to = auth.uid()
    AND public.can_access('recepcao', 'create')
  );

DROP POLICY IF EXISTS scheduling_call_center_tasks_command_update
  ON public.scheduling_call_center_tasks;
CREATE POLICY scheduling_call_center_tasks_command_update
  ON public.scheduling_call_center_tasks
  FOR UPDATE TO prontomedic_reception_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND public.can_access('recepcao', 'edit')
  )
  WITH CHECK (
    company_id = public.active_company_id()
    AND public.can_access('recepcao', 'edit')
  );

CREATE OR REPLACE FUNCTION public.record_call_center_contact_secure(
  p_patient_id BIGINT DEFAULT NULL,
  p_appointment_id BIGINT DEFAULT NULL,
  p_channel TEXT DEFAULT 'telefone',
  p_direction TEXT DEFAULT 'inbound',
  p_contact_reason TEXT DEFAULT NULL,
  p_result TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_next_action TEXT DEFAULT NULL,
  p_next_action_at TIMESTAMPTZ DEFAULT NULL,
  p_create_task BOOLEAN DEFAULT FALSE
)
RETURNS public.scheduling_contact_logs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = on
AS $function$
DECLARE
  v_company_id UUID;
  v_unit_id INTEGER;
  v_contact public.scheduling_contact_logs;
  v_patient_company_id UUID;
  v_appointment_company_id UUID;
  v_appointment_patient_id BIGINT;
  v_contact_reason TEXT := NULLIF(BTRIM(p_contact_reason), '');
  v_notes TEXT := NULLIF(BTRIM(p_notes), '');
  v_next_action TEXT := NULLIF(BTRIM(p_next_action), '');
BEGIN
  v_company_id := public.active_company_id();
  IF auth.uid() IS NULL
     OR v_company_id IS NULL
     OR NOT public.can_access('recepcao', 'create') THEN
    RAISE EXCEPTION 'Contexto ativo sem permissao para registrar contato'
      USING ERRCODE = '42501';
  END IF;

  IF v_contact_reason IS NULL THEN
    RAISE EXCEPTION 'Motivo do contato e obrigatorio'
      USING ERRCODE = '22023';
  END IF;
  IF CHAR_LENGTH(v_contact_reason) > 80 THEN
    RAISE EXCEPTION 'Motivo do contato excede 80 caracteres'
      USING ERRCODE = '22023';
  END IF;
  IF p_channel NOT IN (
    'telefone', 'whatsapp', 'email', 'portal', 'presencial', 'campanha',
    'instagram', 'google', 'site', 'convenio', 'indicacao'
  ) OR p_direction NOT IN ('inbound', 'outbound')
     OR p_result NOT IN (
       'agendado', 'confirmado', 'cancelado', 'remarcado', 'nao_atendeu',
       'recado', 'sem_interesse', 'numero_invalido', 'retornar_depois'
     ) THEN
    RAISE EXCEPTION 'Canal, direcao ou resultado invalido'
      USING ERRCODE = '22023';
  END IF;
  IF p_create_task AND v_next_action IS NULL THEN
    RAISE EXCEPTION 'Proxima acao e obrigatoria para criar tarefa'
      USING ERRCODE = '22023';
  END IF;
  IF v_next_action IS NOT NULL AND CHAR_LENGTH(v_next_action) > 60 THEN
    RAISE EXCEPTION 'Proxima acao excede 60 caracteres'
      USING ERRCODE = '22023';
  END IF;

  IF p_patient_id IS NOT NULL THEN
    SELECT patient.company_id
      INTO v_patient_company_id
    FROM public.patients AS patient
    WHERE patient.id = p_patient_id;

    IF v_patient_company_id IS DISTINCT FROM v_company_id THEN
      RAISE EXCEPTION 'Paciente indisponivel no contexto atual'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_appointment_id IS NOT NULL THEN
    v_unit_id := public.active_unit_id();
    IF v_unit_id IS NULL THEN
      RAISE EXCEPTION 'Unidade ativa obrigatoria para vincular agendamento'
        USING ERRCODE = '42501';
    END IF;

    PERFORM set_config(
      'app.reception.appointment_id',
      p_appointment_id::TEXT,
      TRUE
    );
    PERFORM set_config(
      'app.reception.company_id',
      v_company_id::TEXT,
      TRUE
    );
    PERFORM set_config(
      'app.reception.unit_id',
      v_unit_id::TEXT,
      TRUE
    );

    SELECT appointment.company_id, appointment.patient_id
      INTO v_appointment_company_id, v_appointment_patient_id
    FROM public.appointments AS appointment
    WHERE appointment.id = p_appointment_id;

    IF v_appointment_company_id IS DISTINCT FROM v_company_id THEN
      RAISE EXCEPTION 'Agendamento indisponivel no contexto atual'
        USING ERRCODE = '42501';
    END IF;
    IF p_patient_id IS NOT NULL
       AND v_appointment_patient_id IS DISTINCT FROM p_patient_id THEN
      RAISE EXCEPTION 'Agendamento nao pertence ao paciente informado'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.scheduling_contact_logs (
    company_id, patient_id, appointment_id, operator_id, channel, direction,
    contact_reason, result, notes, next_action, next_action_at
  )
  VALUES (
    v_company_id, p_patient_id, p_appointment_id, auth.uid(), p_channel,
    p_direction, v_contact_reason, p_result, v_notes, v_next_action,
    p_next_action_at
  )
  RETURNING * INTO v_contact;

  IF p_create_task THEN
    INSERT INTO public.scheduling_call_center_tasks (
      company_id, patient_id, appointment_id, contact_log_id, assigned_to,
      task_type, priority, status, due_at, description
    )
    VALUES (
      v_company_id, p_patient_id, p_appointment_id, v_contact.id, auth.uid(),
      v_next_action, 'normal', 'pending', p_next_action_at,
      COALESCE(v_notes, v_contact_reason)
    );
  END IF;

  RETURN v_contact;
END
$function$;

CREATE OR REPLACE FUNCTION public.complete_call_center_task_secure(
  p_task_id BIGINT
)
RETURNS public.scheduling_call_center_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = on
AS $function$
DECLARE
  v_company_id UUID;
  v_task public.scheduling_call_center_tasks;
BEGIN
  v_company_id := public.active_company_id();
  IF auth.uid() IS NULL
     OR v_company_id IS NULL
     OR NOT public.can_access('recepcao', 'edit') THEN
    RAISE EXCEPTION 'Contexto ativo sem permissao para concluir tarefa'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_task
  FROM public.scheduling_call_center_tasks
  WHERE id = p_task_id
    AND company_id = v_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tarefa indisponivel no contexto atual'
      USING ERRCODE = '42501';
  END IF;
  IF v_task.status = 'done' THEN
    RETURN v_task;
  END IF;
  IF v_task.status = 'cancelled' THEN
    RAISE EXCEPTION 'Tarefa cancelada nao pode ser concluida'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.scheduling_call_center_tasks
  SET status = 'done',
      completed_at = NOW()
  WHERE id = v_task.id
    AND company_id = v_company_id
  RETURNING * INTO v_task;

  RETURN v_task;
END
$function$;

ALTER FUNCTION public.record_call_center_contact_secure(
  BIGINT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN
) OWNER TO prontomedic_reception_rpc_owner;
ALTER FUNCTION public.complete_call_center_task_secure(BIGINT)
  OWNER TO prontomedic_reception_rpc_owner;

REVOKE ALL ON FUNCTION public.record_call_center_contact_secure(
  BIGINT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_call_center_task_secure(BIGINT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_call_center_contact_secure(
  BIGINT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN
) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.complete_call_center_task_secure(BIGINT)
  TO authenticated, app_prontomedic;

DROP POLICY IF EXISTS scheduling_contact_logs_insert_company
  ON public.scheduling_contact_logs;
DROP POLICY IF EXISTS scheduling_call_center_tasks_insert_company
  ON public.scheduling_call_center_tasks;
DROP POLICY IF EXISTS scheduling_call_center_tasks_update_company
  ON public.scheduling_call_center_tasks;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON TABLE public.scheduling_contact_logs
  FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON TABLE public.scheduling_call_center_tasks
  FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE USAGE, SELECT, UPDATE
  ON SEQUENCE public.scheduling_contact_logs_id_seq
  FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE USAGE, SELECT, UPDATE
  ON SEQUENCE public.scheduling_call_center_tasks_id_seq
  FROM PUBLIC, anon, authenticated, app_prontomedic;

INSERT INTO public.prontomedic_deployment_migrations(filename)
VALUES ('20260729225000_call_center_atomic_commands.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
