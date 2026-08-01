-- Module 11: keep reception check-in independent from broad Agenda edit rights.
-- The fixed-purpose transition is private and executable only by the reception
-- RPC owner after the public check-in workflow has completed its own checks.

BEGIN;

CREATE OR REPLACE FUNCTION private.reception_mark_appointment_waiting(
  p_appointment_id BIGINT,
  p_reason TEXT
)
RETURNS public.appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
DECLARE
  v_company_id UUID := public.audit_current_company_id();
  v_actor_id UUID := public.audit_current_user_id();
  v_old public.appointments;
  v_row public.appointments;
BEGIN
  IF v_company_id IS NULL OR v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Reception appointment transition requires authenticated context';
  END IF;

  SELECT *
    INTO v_old
    FROM public.appointments appointment
   WHERE appointment.id = p_appointment_id
     AND appointment.company_id = v_company_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reception appointment not found in authenticated company';
  END IF;

  IF NOT public.can_transition_appointment_status(v_old.status, 'waiting') THEN
    RAISE EXCEPTION
      'Reception invalid status transition: % -> waiting',
      v_old.status;
  END IF;

  UPDATE public.appointments
     SET status = 'waiting',
         notes = COALESCE(
           NULLIF(trim(COALESCE(p_reason, '')), ''),
           notes
         ),
         updated_at = now()
   WHERE id = v_old.id
     AND company_id = v_company_id
  RETURNING * INTO v_row;

  INSERT INTO public.scheduling_status_history(
    company_id,
    appointment_id,
    from_status,
    to_status,
    reason,
    actor_user_id
  )
  VALUES (
    v_company_id,
    v_row.id,
    v_old.status,
    v_row.status,
    NULLIF(trim(COALESCE(p_reason, '')), ''),
    v_actor_id
  );

  RETURN v_row;
END;
$function$;

ALTER FUNCTION private.reception_mark_appointment_waiting(
  BIGINT, TEXT
) OWNER TO prontomedic_reception_rpc_owner;

REVOKE ALL ON FUNCTION private.reception_mark_appointment_waiting(
  BIGINT, TEXT
) FROM PUBLIC, anon, authenticated, app_prontomedic;

GRANT EXECUTE ON FUNCTION private.reception_mark_appointment_waiting(
  BIGINT, TEXT
) TO prontomedic_reception_rpc_owner;

GRANT UPDATE (status, notes, updated_at) ON public.appointments
  TO prontomedic_reception_rpc_owner;

GRANT EXECUTE ON FUNCTION public.audit_current_company_id(),
  public.audit_current_user_id()
  TO prontomedic_reception_rpc_owner;

DROP POLICY IF EXISTS appointments_reception_rpc_update
  ON public.appointments;
CREATE POLICY appointments_reception_rpc_update
  ON public.appointments
  FOR UPDATE TO prontomedic_reception_rpc_owner
  USING (
    company_id = public.current_company_id()
    AND (
      unit_id IS NULL
      OR private.reception_actor_can_access_unit(company_id, unit_id)
    )
  )
  WITH CHECK (
    company_id = public.current_company_id()
    AND (
      unit_id IS NULL
      OR private.reception_actor_can_access_unit(company_id, unit_id)
    )
  );

ALTER TABLE public.scheduling_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduling_status_history FORCE ROW LEVEL SECURITY;

GRANT INSERT (
  company_id,
  appointment_id,
  from_status,
  to_status,
  reason,
  actor_user_id
) ON public.scheduling_status_history
  TO prontomedic_reception_rpc_owner;

GRANT USAGE ON SEQUENCE public.scheduling_status_history_id_seq
  TO prontomedic_reception_rpc_owner;

DROP POLICY IF EXISTS scheduling_status_history_reception_rpc_insert
  ON public.scheduling_status_history;
CREATE POLICY scheduling_status_history_reception_rpc_insert
  ON public.scheduling_status_history
  FOR INSERT TO prontomedic_reception_rpc_owner
  WITH CHECK (
    company_id = public.current_company_id()
    AND actor_user_id = public.audit_current_user_id()
  );

CREATE OR REPLACE FUNCTION public.perform_reception_checkin_secure(
  p_workflow_id UUID,
  p_appointment_id BIGINT,
  p_priority TEXT DEFAULT 'normal',
  p_exception_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
DECLARE
  v_actor RECORD;
  v_workflow public.reception_checkin_workflows;
  v_appointment public.appointments;
  v_readiness JSONB;
  v_precheck JSONB;
  v_issues JSONB := '[]'::JSONB;
  v_ready BOOLEAN;
  v_checkin public.reception_checkins;
  v_ticket public.reception_queue_tickets;
  v_number INTEGER;
  v_exception_reason TEXT;
  v_requested_exception_reason TEXT;
  v_priority TEXT := lower(trim(COALESCE(p_priority, '')));
  v_requested_priority TEXT;
BEGIN
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  IF v_actor.user_id IS NULL OR v_actor.company_id IS NULL THEN
    RAISE EXCEPTION 'Usuario autenticado sem perfil operacional';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_workflow_id::TEXT, 0)
  );
  SELECT * INTO v_workflow
    FROM public.reception_checkin_workflows workflow
   WHERE workflow.id = p_workflow_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workflow de check-in nao encontrado ou fora do escopo';
  END IF;
  IF v_workflow.company_id <> v_actor.company_id
     OR v_workflow.appointment_id <> p_appointment_id THEN
    RAISE EXCEPTION 'Workflow de check-in fora do escopo do usuario';
  END IF;
  v_requested_priority := lower(trim(COALESCE(
    v_workflow.request_payload->>'priority',
    'normal'
  )));
  v_requested_exception_reason := NULLIF(
    trim(COALESCE(v_workflow.request_payload->>'exception_reason', '')),
    ''
  );
  v_exception_reason := NULLIF(trim(COALESCE(p_exception_reason, '')), '');
  IF v_priority IS DISTINCT FROM v_requested_priority
     OR v_exception_reason IS DISTINCT FROM v_requested_exception_reason THEN
    RAISE EXCEPTION
      'Retry do check-in possui parametros divergentes do workflow';
  END IF;
  IF v_workflow.status <> 'in_progress'
     OR v_workflow.current_step <> 'checkin' THEN
    RAISE EXCEPTION 'Workflow nao esta pronto para o check-in';
  END IF;
  IF v_workflow.billing_account_id IS NULL THEN
    RAISE EXCEPTION 'Pre-conta obrigatoria antes do check-in';
  END IF;
  IF v_workflow.requires_tiss AND v_workflow.tiss_guide_id IS NULL THEN
    RAISE EXCEPTION 'Guia TISS obrigatoria antes do check-in';
  END IF;
  IF v_workflow.requires_financial
     AND v_workflow.financial_transaction_id IS NULL THEN
    RAISE EXCEPTION 'Titulo financeiro obrigatorio antes do check-in';
  END IF;

  SELECT * INTO v_appointment
    FROM public.appointments appointment
   WHERE appointment.id = p_appointment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento nao encontrado ou fora do escopo';
  END IF;
  IF v_appointment.company_id <> v_actor.company_id
     OR v_appointment.company_id <> v_workflow.company_id
     OR v_appointment.unit_id IS DISTINCT FROM v_workflow.unit_id THEN
    RAISE EXCEPTION 'Agendamento fora do escopo do workflow';
  END IF;
  IF v_priority NOT IN ('normal', 'legal', 'urgent') THEN
    RAISE EXCEPTION 'Prioridade invalida';
  END IF;
  IF NOT private.reception_can_checkin(
    v_actor.user_id,
    v_actor.company_id,
    v_appointment.unit_id,
    v_actor.role_name
  ) THEN
    RAISE EXCEPTION 'Usuario sem permissao reception.checkin';
  END IF;

  v_readiness := public.get_reception_checkin_readiness(p_appointment_id);
  v_precheck := public.get_reception_precheckin_context(p_appointment_id);
  v_issues := COALESCE(v_readiness->'issues', '[]'::JSONB)
    || COALESCE(v_precheck->'issues', '[]'::JSONB);
  v_ready := (v_readiness->>'ready')::BOOLEAN
    AND (v_precheck->>'ready')::BOOLEAN;

  IF NOT v_ready THEN
    IF NOT private.reception_can_release_exception(
      v_actor.user_id,
      v_actor.company_id,
      v_appointment.unit_id,
      v_actor.role_name
    ) THEN
      RAISE EXCEPTION 'Usuario sem permissao reception.release_exception';
    END IF;
    IF v_exception_reason IS NULL OR length(v_exception_reason) < 20 THEN
      RAISE EXCEPTION 'Justificativa da excecao deve ter pelo menos 20 caracteres';
    END IF;
  END IF;

  SELECT * INTO v_checkin
    FROM public.reception_checkins checkin
   WHERE checkin.appointment_id = v_appointment.id;

  IF FOUND THEN
    IF v_workflow.checkin_id IS NOT NULL
       AND v_workflow.checkin_id <> v_checkin.id THEN
      RAISE EXCEPTION 'Workflow vinculado a outro check-in';
    END IF;

    SELECT * INTO v_ticket
      FROM public.reception_queue_tickets ticket
     WHERE ticket.company_id = v_actor.company_id
       AND ticket.checkin_id = v_checkin.id
     ORDER BY ticket.id
     LIMIT 1;

    IF FOUND THEN
      IF v_ticket.unit_id IS NOT NULL
         AND NOT private.reception_actor_can_access_unit(
           v_ticket.company_id,
           v_ticket.unit_id
         ) THEN
        RAISE EXCEPTION 'Senha transferida para unidade fora do escopo';
      END IF;
      RETURN jsonb_build_object(
        'checkin_id', v_checkin.id,
        'ticket_id', v_ticket.id,
        'ticket', v_ticket.prefix || lpad(v_ticket.number::TEXT, 3, '0'),
        'released_by_exception', v_checkin.released_by_exception,
        'issues', v_issues,
        'idempotent', TRUE
      );
    END IF;
  ELSE
    INSERT INTO public.reception_checkins(
      company_id,
      unit_id,
      patient_id,
      appointment_id,
      status,
      priority,
      released_by_exception,
      created_by
    )
    VALUES (
      v_appointment.company_id,
      v_appointment.unit_id,
      v_appointment.patient_id,
      v_appointment.id,
      'checked_in',
      v_priority,
      NOT v_ready,
      v_actor.user_id
    )
    RETURNING * INTO v_checkin;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(v_appointment.company_id::TEXT),
    hashtext(
      COALESCE(v_appointment.unit_id::TEXT, 'global')
      || ':' || CURRENT_DATE::TEXT || ':C'
    )
  );
  SELECT COALESCE(max(ticket.number), 0) + 1
    INTO v_number
    FROM public.reception_queue_tickets ticket
   WHERE ticket.company_id = v_appointment.company_id
     AND ticket.issued_unit_id IS NOT DISTINCT FROM v_appointment.unit_id
     AND ticket.ticket_date = CURRENT_DATE
     AND ticket.prefix = 'C';

  INSERT INTO public.reception_queue_tickets(
    company_id,
    unit_id,
    issued_unit_id,
    checkin_id,
    patient_id,
    appointment_id,
    number,
    priority
  )
  VALUES (
    v_appointment.company_id,
    v_appointment.unit_id,
    v_appointment.unit_id,
    v_checkin.id,
    v_appointment.patient_id,
    v_appointment.id,
    v_number,
    v_priority
  )
  RETURNING * INTO v_ticket;

  INSERT INTO public.reception_admin_history(
    company_id,
    unit_id,
    entity_type,
    entity_id,
    appointment_id,
    from_status,
    to_status,
    reason,
    details,
    actor_user_id
  )
  VALUES (
    v_appointment.company_id,
    v_appointment.unit_id,
    'checkin',
    v_checkin.id::TEXT,
    v_appointment.id,
    NULL,
    'checked_in',
    CASE WHEN v_ready THEN 'Check-in realizado' ELSE v_exception_reason END,
    jsonb_build_object(
      'workflow_id', v_workflow.id,
      'ticket', v_ticket.prefix || lpad(v_ticket.number::TEXT, 3, '0'),
      'issues', v_issues,
      'exception_authorized', NOT v_ready,
      'exception_authorized_by_role',
        CASE WHEN v_ready THEN NULL ELSE v_actor.role_name END
    ),
    v_actor.user_id
  );

  PERFORM private.reception_mark_appointment_waiting(
    v_appointment.id,
    CASE
      WHEN v_ready THEN 'Check-in realizado'
      ELSE 'Check-in liberado por excecao autorizada'
    END
  );

  RETURN jsonb_build_object(
    'checkin_id', v_checkin.id,
    'ticket_id', v_ticket.id,
    'ticket', v_ticket.prefix || lpad(v_ticket.number::TEXT, 3, '0'),
    'released_by_exception', NOT v_ready,
    'issues', v_issues,
    'idempotent', FALSE
  );
END;
$function$;

ALTER FUNCTION public.perform_reception_checkin_secure(
  UUID, BIGINT, TEXT, TEXT
) OWNER TO prontomedic_reception_rpc_owner;

REVOKE ALL ON FUNCTION public.perform_reception_checkin_secure(
  UUID, BIGINT, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.perform_reception_checkin_secure(
  UUID, BIGINT, TEXT, TEXT
) TO authenticated, app_prontomedic;

COMMENT ON FUNCTION private.reception_mark_appointment_waiting(
  BIGINT, TEXT
) IS
  'Internal fixed-purpose transition used only after the reception check-in authorization gate.';

INSERT INTO public.prontomedic_deployment_migrations(filename)
VALUES ('20260726190000_module11_reception_checkin_schedule_boundary.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
