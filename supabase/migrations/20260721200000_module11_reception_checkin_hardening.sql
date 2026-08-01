-- Module 11: reception check-in hardening.
-- Additive only: preserves the existing reception/insurance foundation.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.reception_checkins') IS NULL
     OR to_regclass('public.reception_queue_tickets') IS NULL
     OR to_regclass('public.reception_admin_history') IS NULL THEN
    RAISE EXCEPTION 'Module 11 foundation is missing; apply the canonical reception migration first';
  END IF;
END
$$;

ALTER TABLE public.reception_checkins
  ADD COLUMN IF NOT EXISTS unit_id INTEGER REFERENCES public.units(id) ON DELETE RESTRICT;
ALTER TABLE public.reception_checkins
  ADD COLUMN IF NOT EXISTS priority VARCHAR(20) NOT NULL DEFAULT 'normal';
ALTER TABLE public.reception_queue_tickets
  ADD COLUMN IF NOT EXISTS unit_id INTEGER REFERENCES public.units(id) ON DELETE RESTRICT;
ALTER TABLE public.reception_admin_history
  ADD COLUMN IF NOT EXISTS unit_id INTEGER REFERENCES public.units(id) ON DELETE RESTRICT;

UPDATE public.reception_checkins c
   SET unit_id = a.unit_id
  FROM public.appointments a
 WHERE a.id = c.appointment_id
   AND c.unit_id IS NULL
   AND a.unit_id IS NOT NULL;

UPDATE public.reception_queue_tickets q
   SET unit_id = c.unit_id
  FROM public.reception_checkins c
 WHERE c.id = q.checkin_id
   AND q.unit_id IS NULL
   AND c.unit_id IS NOT NULL;

UPDATE public.reception_admin_history h
   SET unit_id = a.unit_id
  FROM public.appointments a
 WHERE a.id = h.appointment_id
   AND h.unit_id IS NULL
   AND a.unit_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reception_checkins_scope
  ON public.reception_checkins(company_id, unit_id, checked_in_at DESC);
CREATE INDEX IF NOT EXISTS idx_reception_queue_scope
  ON public.reception_queue_tickets(company_id, unit_id, ticket_date, status);
CREATE INDEX IF NOT EXISTS idx_reception_history_scope
  ON public.reception_admin_history(company_id, unit_id, created_at DESC);

-- Direct writes are prohibited. Mutations go through the audited RPC below.
DROP POLICY IF EXISTS reception_checkins_tenant ON public.reception_checkins;
DROP POLICY IF EXISTS reception_checkins_read ON public.reception_checkins;
CREATE POLICY reception_checkins_read ON public.reception_checkins
  FOR SELECT TO authenticated, app_prontomedic
  USING (
    company_id = public.current_company_id()
    AND (unit_id IS NULL OR public.org_can_access_unit(company_id, unit_id))
  );

DROP POLICY IF EXISTS reception_queue_tenant ON public.reception_queue_tickets;
DROP POLICY IF EXISTS reception_queue_read ON public.reception_queue_tickets;
CREATE POLICY reception_queue_read ON public.reception_queue_tickets
  FOR SELECT TO authenticated, app_prontomedic
  USING (
    company_id = public.current_company_id()
    AND (unit_id IS NULL OR public.org_can_access_unit(company_id, unit_id))
  );

DROP POLICY IF EXISTS reception_admin_history_tenant ON public.reception_admin_history;
DROP POLICY IF EXISTS reception_admin_history_read ON public.reception_admin_history;
CREATE POLICY reception_admin_history_read ON public.reception_admin_history
  FOR SELECT TO authenticated, app_prontomedic
  USING (
    company_id = public.current_company_id()
    AND (unit_id IS NULL OR public.org_can_access_unit(company_id, unit_id))
  );

REVOKE INSERT, UPDATE, DELETE ON public.reception_checkins,
  public.reception_queue_tickets, public.reception_admin_history
  FROM authenticated, app_prontomedic;
GRANT SELECT ON public.reception_checkins,
  public.reception_queue_tickets, public.reception_admin_history
  TO authenticated, app_prontomedic;

CREATE OR REPLACE FUNCTION public.perform_reception_checkin_secure(
  p_appointment_id BIGINT,
  p_priority TEXT DEFAULT 'normal',
  p_exception_reason TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_appointment public.appointments;
  v_readiness JSONB;
  v_checkin public.reception_checkins;
  v_ticket public.reception_queue_tickets;
  v_number INTEGER;
  v_actor RECORD;
BEGIN
  PERFORM public.assert_scheduling_permission();
  SELECT * INTO v_actor FROM public.get_scheduling_actor();
  IF v_actor.user_id IS NULL OR v_actor.company_id IS NULL THEN
    RAISE EXCEPTION 'Usuario autenticado sem perfil operacional';
  END IF;

  SELECT * INTO v_appointment
    FROM public.appointments
   WHERE id = p_appointment_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento nao encontrado'; END IF;
  IF v_appointment.company_id <> v_actor.company_id THEN
    RAISE EXCEPTION 'Agendamento fora do escopo do usuario';
  END IF;
  IF v_appointment.unit_id IS NOT NULL
     AND NOT public.org_can_access_unit(v_appointment.company_id, v_appointment.unit_id) THEN
    RAISE EXCEPTION 'Agendamento fora da unidade autorizada';
  END IF;
  IF p_priority NOT IN ('normal','legal','urgent') THEN
    RAISE EXCEPTION 'Prioridade invalida';
  END IF;

  -- Idempotency: retrying the same action returns the original ticket.
  SELECT * INTO v_checkin
    FROM public.reception_checkins
   WHERE appointment_id = v_appointment.id
   FOR UPDATE;
  IF FOUND THEN
    SELECT * INTO v_ticket
      FROM public.reception_queue_tickets
     WHERE checkin_id = v_checkin.id
     LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'checkin_id', v_checkin.id,
        'ticket_id', v_ticket.id,
        'ticket', v_ticket.prefix || lpad(v_ticket.number::TEXT, 3, '0'),
        'released_by_exception', v_checkin.released_by_exception,
        'issues', '[]'::JSONB,
        'idempotent', TRUE
      );
    END IF;
  END IF;

  v_readiness := public.get_reception_checkin_readiness(p_appointment_id);
  IF NOT (v_readiness->>'ready')::BOOLEAN
     AND NULLIF(trim(COALESCE(p_exception_reason,'')), '') IS NULL THEN
    RAISE EXCEPTION 'Check-in bloqueado por pendencias';
  END IF;

  IF v_checkin.id IS NULL THEN
    INSERT INTO public.reception_checkins(
      company_id, unit_id, patient_id, appointment_id, status, priority,
      released_by_exception, created_by
    )
    VALUES (
      v_appointment.company_id, v_appointment.unit_id, v_appointment.patient_id,
      v_appointment.id, 'checked_in', p_priority,
      NOT (v_readiness->>'ready')::BOOLEAN, v_actor.user_id
    )
    RETURNING * INTO v_checkin;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(CURRENT_DATE::TEXT), hashtext('reception-C'));
  SELECT COALESCE(max(number), 0) + 1 INTO v_number
    FROM public.reception_queue_tickets
   WHERE ticket_date = CURRENT_DATE AND prefix = 'C';

  INSERT INTO public.reception_queue_tickets(
    company_id, unit_id, checkin_id, patient_id, appointment_id, number, priority
  )
  VALUES (
    v_appointment.company_id, v_appointment.unit_id, v_checkin.id,
    v_appointment.patient_id, v_appointment.id, v_number, p_priority
  )
  RETURNING * INTO v_ticket;

  INSERT INTO public.reception_admin_history(
    company_id, unit_id, entity_type, entity_id, appointment_id,
    from_status, to_status, reason, details, actor_user_id
  )
  VALUES (
    v_appointment.company_id, v_appointment.unit_id, 'checkin',
    v_checkin.id::TEXT, v_appointment.id, NULL, 'checked_in',
    COALESCE(NULLIF(trim(p_exception_reason), ''), 'Check-in realizado'),
    jsonb_build_object('ticket', v_ticket.prefix || lpad(v_ticket.number::TEXT, 3, '0')),
    v_actor.user_id
  );

  IF to_regprocedure('public.update_appointment_status_secure(bigint,text,text)') IS NOT NULL THEN
    PERFORM public.update_appointment_status_secure(v_appointment.id, 'waiting', 'Check-in realizado');
  END IF;

  RETURN jsonb_build_object(
    'checkin_id', v_checkin.id,
    'ticket_id', v_ticket.id,
    'ticket', v_ticket.prefix || lpad(v_ticket.number::TEXT, 3, '0'),
    'released_by_exception', v_checkin.released_by_exception,
    'issues', v_readiness->'issues',
    'idempotent', FALSE
  );
END;
$$;

REVOKE ALL ON FUNCTION public.perform_reception_checkin_secure(BIGINT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.perform_reception_checkin_secure(BIGINT, TEXT, TEXT)
  TO authenticated, app_prontomedic;

DO $$
BEGIN
  IF to_regclass('public.prontomedic_deployment_migrations') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.prontomedic_deployment_migrations
        WHERE filename = '20260721200000_module11_reception_checkin_hardening.sql'
     ) THEN
    INSERT INTO public.prontomedic_deployment_migrations(filename, applied_at)
    VALUES ('20260721200000_module11_reception_checkin_hardening.sql', NOW());
  END IF;
END
$$;

COMMIT;
