-- M12: controlled transfer and explicit SLA timestamps for reception tickets.
BEGIN;

ALTER TABLE public.reception_queue_tickets
  ADD COLUMN IF NOT EXISTS transferred_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS transferred_to_unit_id INTEGER REFERENCES public.units(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS sla_minutes INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS sla_due_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 minutes');

ALTER TABLE public.reception_queue_tickets
  DROP CONSTRAINT IF EXISTS reception_queue_sla_minutes_chk;
ALTER TABLE public.reception_queue_tickets
  ADD CONSTRAINT reception_queue_sla_minutes_chk CHECK (sla_minutes BETWEEN 1 AND 1440);

CREATE INDEX IF NOT EXISTS idx_reception_queue_sla
  ON public.reception_queue_tickets(company_id, unit_id, status, sla_due_at);

DROP FUNCTION IF EXISTS public.transition_reception_queue_ticket_secure(BIGINT, TEXT, TEXT);
DROP FUNCTION IF EXISTS private.transition_reception_queue_ticket(BIGINT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION private.transition_reception_queue_ticket(
  p_ticket_id BIGINT,
  p_to_status TEXT,
  p_reason TEXT,
  p_destination_unit_id INTEGER
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
  v_company UUID := public.current_company_id();
BEGIN
  IF NOT public.audit_has_role(ARRAY['admin','gestor','recepcao','enfermagem','enfermeiro','medico']::TEXT[]) THEN
    RAISE EXCEPTION 'Perfil sem permissao para alterar fila de recepcao';
  END IF;
  IF p_to_status NOT IN ('waiting','called','transferred','completed','cancelled','no_show') THEN
    RAISE EXCEPTION 'Status de fila invalido';
  END IF;
  IF p_to_status = 'transferred' AND p_destination_unit_id IS NULL THEN
    RAISE EXCEPTION 'Unidade de destino obrigatoria para transferencia';
  END IF;
  IF p_to_status <> 'transferred' AND p_destination_unit_id IS NOT NULL THEN
    RAISE EXCEPTION 'Unidade de destino so pode ser usada em transferencia';
  END IF;

  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  SELECT * INTO v_ticket
    FROM public.reception_queue_tickets
   WHERE id = p_ticket_id
     AND company_id = v_company
     AND (unit_id IS NULL OR public.org_can_access_unit(company_id, unit_id))
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Senha de recepcao fora do escopo';
  END IF;

  v_from_status := v_ticket.status;
  IF v_from_status = p_to_status AND p_to_status <> 'transferred' THEN
    RETURN jsonb_build_object('ticket_id', v_ticket.id, 'from_status', v_from_status, 'to_status', p_to_status, 'idempotent', TRUE);
  END IF;

  IF NOT (
    (v_from_status = 'waiting' AND p_to_status IN ('called','cancelled','no_show','transferred')) OR
    (v_from_status = 'called' AND p_to_status IN ('waiting','transferred','completed','cancelled','no_show')) OR
    (v_from_status = 'transferred' AND p_to_status IN ('waiting','called','cancelled'))
  ) THEN
    RAISE EXCEPTION 'Transicao de fila invalida: % -> %', v_from_status, p_to_status;
  END IF;

  IF p_to_status = 'transferred'
     AND NOT EXISTS (
       SELECT 1 FROM public.units u
        WHERE u.id = p_destination_unit_id
          AND u.company_id = v_company
          AND u.lg_ativo = TRUE
          AND public.org_can_access_unit(v_company, p_destination_unit_id)
     ) THEN
    RAISE EXCEPTION 'Unidade de destino fora do escopo';
  END IF;

  UPDATE public.reception_queue_tickets
     SET status = p_to_status,
         unit_id = CASE WHEN p_to_status = 'transferred' THEN p_destination_unit_id ELSE unit_id END,
         transferred_to_unit_id = CASE WHEN p_to_status = 'transferred' THEN p_destination_unit_id ELSE transferred_to_unit_id END,
         transferred_at = CASE WHEN p_to_status = 'transferred' THEN NOW() ELSE transferred_at END,
         called_at = CASE WHEN p_to_status = 'called' AND called_at IS NULL THEN NOW() ELSE called_at END,
         completed_at = CASE WHEN p_to_status IN ('completed','cancelled','no_show') THEN COALESCE(completed_at, NOW()) ELSE completed_at END,
         sla_due_at = CASE WHEN p_to_status IN ('waiting','transferred') THEN NOW() + make_interval(mins => sla_minutes) ELSE sla_due_at END
   WHERE id = v_ticket.id;

  INSERT INTO public.reception_admin_history(
    company_id, unit_id, entity_type, entity_id, appointment_id,
    from_status, to_status, reason, details, actor_user_id
  )
  VALUES (
    v_company, p_destination_unit_id, 'reception_queue_ticket', v_ticket.id::TEXT,
    v_ticket.appointment_id, v_from_status, p_to_status,
    COALESCE(v_reason, 'Transicao de fila'),
    jsonb_build_object(
      'ticket', v_ticket.prefix || lpad(v_ticket.number::TEXT, 3, '0'),
      'source_unit_id', v_ticket.unit_id,
      'destination_unit_id', p_destination_unit_id,
      'sla_minutes', v_ticket.sla_minutes
    ),
    v_actor.user_id
  );

  RETURN jsonb_build_object(
    'ticket_id', v_ticket.id,
    'from_status', v_from_status,
    'to_status', p_to_status,
    'destination_unit_id', p_destination_unit_id,
    'sla_due_at', CASE WHEN p_to_status IN ('waiting','transferred') THEN NOW() + make_interval(mins => v_ticket.sla_minutes) ELSE v_ticket.sla_due_at END,
    'idempotent', FALSE
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_reception_queue_ticket_secure(
  p_ticket_id BIGINT,
  p_to_status TEXT,
  p_reason TEXT,
  p_destination_unit_id INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN private.transition_reception_queue_ticket(p_ticket_id, p_to_status, p_reason, p_destination_unit_id);
END;
$$;

REVOKE ALL ON FUNCTION private.transition_reception_queue_ticket(BIGINT, TEXT, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transition_reception_queue_ticket_secure(BIGINT, TEXT, TEXT, INTEGER) FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION private.transition_reception_queue_ticket(BIGINT, TEXT, TEXT, INTEGER) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.transition_reception_queue_ticket_secure(BIGINT, TEXT, TEXT, INTEGER) TO authenticated, app_prontomedic;

DO $$
BEGIN
  IF to_regclass('public.prontomedic_deployment_migrations') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.prontomedic_deployment_migrations
        WHERE filename = '20260722030000_module12_queue_transfer_sla.sql'
     ) THEN
    INSERT INTO public.prontomedic_deployment_migrations(filename, applied_at)
    VALUES ('20260722030000_module12_queue_transfer_sla.sql', NOW());
  END IF;
END
$$;

COMMIT;
