-- M12: converge the reception queue lifecycle with the secure triage model.
-- The public entry point is invoker; only the private helper owns the update.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.reception_queue_tickets') IS NULL
     OR to_regclass('public.reception_admin_history') IS NULL THEN
    RAISE EXCEPTION 'M12 reception queue foundation is missing';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION private.transition_reception_queue_ticket(
  p_ticket_id BIGINT,
  p_to_status TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ticket public.reception_queue_tickets;
  v_actor RECORD;
  v_from_status TEXT;
  v_reason TEXT := NULLIF(trim(COALESCE(p_reason, '')), '');
BEGIN
  IF NOT public.audit_has_role(ARRAY['admin','gestor','recepcao','enfermagem','enfermeiro','medico']::TEXT[]) THEN
    RAISE EXCEPTION 'Perfil sem permissao para alterar fila de recepcao';
  END IF;
  IF p_to_status NOT IN ('waiting','called','transferred','completed','cancelled','no_show') THEN
    RAISE EXCEPTION 'Status de fila invalido';
  END IF;

  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  SELECT * INTO v_ticket
    FROM public.reception_queue_tickets
   WHERE id = p_ticket_id
     AND company_id = public.current_company_id()
     AND (unit_id IS NULL OR public.org_can_access_unit(company_id, unit_id))
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Senha de recepcao fora do escopo';
  END IF;

  v_from_status := v_ticket.status;
  IF v_from_status = p_to_status THEN
    RETURN jsonb_build_object('ticket_id', v_ticket.id, 'from_status', v_from_status, 'to_status', p_to_status, 'idempotent', TRUE);
  END IF;

  IF NOT (
    (v_from_status = 'waiting' AND p_to_status IN ('called','cancelled','no_show')) OR
    (v_from_status = 'called' AND p_to_status IN ('waiting','transferred','completed','cancelled','no_show')) OR
    (v_from_status = 'transferred' AND p_to_status IN ('waiting','called','cancelled'))
  ) THEN
    RAISE EXCEPTION 'Transicao de fila invalida: % -> %', v_from_status, p_to_status;
  END IF;

  UPDATE public.reception_queue_tickets
     SET status = p_to_status,
         called_at = CASE WHEN p_to_status = 'called' AND called_at IS NULL THEN NOW() ELSE called_at END,
         completed_at = CASE WHEN p_to_status IN ('completed','cancelled','no_show') THEN COALESCE(completed_at, NOW()) ELSE completed_at END
   WHERE id = v_ticket.id;

  INSERT INTO public.reception_admin_history(
    company_id, unit_id, entity_type, entity_id, appointment_id,
    from_status, to_status, reason, details, actor_user_id
  )
  VALUES (
    v_ticket.company_id, v_ticket.unit_id, 'reception_queue_ticket', v_ticket.id::TEXT,
    v_ticket.appointment_id, v_from_status, p_to_status,
    COALESCE(v_reason, 'Transicao de fila'),
    jsonb_build_object('ticket', v_ticket.prefix || lpad(v_ticket.number::TEXT, 3, '0')),
    v_actor.user_id
  );

  RETURN jsonb_build_object(
    'ticket_id', v_ticket.id,
    'from_status', v_from_status,
    'to_status', p_to_status,
    'idempotent', FALSE
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_reception_queue_ticket_secure(
  p_ticket_id BIGINT,
  p_to_status TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN private.transition_reception_queue_ticket(p_ticket_id, p_to_status, p_reason);
END;
$$;

REVOKE ALL ON FUNCTION private.transition_reception_queue_ticket(BIGINT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transition_reception_queue_ticket_secure(BIGINT, TEXT, TEXT) FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION private.transition_reception_queue_ticket(BIGINT, TEXT, TEXT) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.transition_reception_queue_ticket_secure(BIGINT, TEXT, TEXT) TO authenticated, app_prontomedic;

DO $$
BEGIN
  IF to_regclass('public.prontomedic_deployment_migrations') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.prontomedic_deployment_migrations
        WHERE filename = '20260722020000_module12_reception_queue_lifecycle.sql'
     ) THEN
    INSERT INTO public.prontomedic_deployment_migrations(filename, applied_at)
    VALUES ('20260722020000_module12_reception_queue_lifecycle.sql', NOW());
  END IF;
END
$$;

COMMIT;
