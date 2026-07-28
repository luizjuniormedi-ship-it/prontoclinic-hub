-- Módulo 12: fecha a superfície de escrita direta e impede filas sem unidade.
-- A migration não faz backfill: registros legados sem unidade devem ser
-- reconciliados explicitamente antes de qualquer carga, nunca inventados.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.triagem_fila') IS NULL
     OR to_regclass('public.triagem_fila_history') IS NULL
     OR to_regclass('public.reception_queue_tickets') IS NULL
     OR to_regclass('public.reception_admin_history') IS NULL THEN
    RAISE EXCEPTION 'M12 queue tables are missing';
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.triagem_fila WHERE unit_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.triagem_fila_history WHERE unit_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.reception_queue_tickets WHERE unit_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.reception_admin_history WHERE unit_id IS NULL) THEN
    RAISE EXCEPTION 'M12 queue rows without unit_id require explicit reconciliation';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'm12_triagem_fila_unit_required') THEN
    ALTER TABLE public.triagem_fila
      ADD CONSTRAINT m12_triagem_fila_unit_required CHECK (unit_id IS NOT NULL) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'm12_triagem_fila_history_unit_required') THEN
    ALTER TABLE public.triagem_fila_history
      ADD CONSTRAINT m12_triagem_fila_history_unit_required CHECK (unit_id IS NOT NULL) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'm12_reception_queue_unit_required') THEN
    ALTER TABLE public.reception_queue_tickets
      ADD CONSTRAINT m12_reception_queue_unit_required CHECK (unit_id IS NOT NULL) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'm12_reception_history_unit_required') THEN
    ALTER TABLE public.reception_admin_history
      ADD CONSTRAINT m12_reception_history_unit_required CHECK (unit_id IS NOT NULL) NOT VALID;
  END IF;
END
$$;

ALTER TABLE public.triagem_fila VALIDATE CONSTRAINT m12_triagem_fila_unit_required;
ALTER TABLE public.triagem_fila_history VALIDATE CONSTRAINT m12_triagem_fila_history_unit_required;
ALTER TABLE public.reception_queue_tickets VALIDATE CONSTRAINT m12_reception_queue_unit_required;
ALTER TABLE public.reception_admin_history VALIDATE CONSTRAINT m12_reception_history_unit_required;

DROP POLICY IF EXISTS m12_triagem_fila_read ON public.triagem_fila;
CREATE POLICY m12_triagem_fila_read ON public.triagem_fila
  FOR SELECT TO authenticated, app_prontomedic
  USING (
    company_id = public.current_company_id()
    AND unit_id IS NOT NULL
    AND public.org_can_access_unit(company_id, unit_id)
  );

DROP POLICY IF EXISTS m12_triagem_fila_history_read ON public.triagem_fila_history;
CREATE POLICY m12_triagem_fila_history_read ON public.triagem_fila_history
  FOR SELECT TO authenticated, app_prontomedic
  USING (
    company_id = public.current_company_id()
    AND unit_id IS NOT NULL
    AND public.org_can_access_unit(company_id, unit_id)
  );

DROP POLICY IF EXISTS reception_queue_read ON public.reception_queue_tickets;
CREATE POLICY reception_queue_read ON public.reception_queue_tickets
  FOR SELECT TO authenticated, app_prontomedic
  USING (
    company_id = public.current_company_id()
    AND unit_id IS NOT NULL
    AND public.org_can_access_unit(company_id, unit_id)
  );

DROP POLICY IF EXISTS reception_admin_history_read ON public.reception_admin_history;
CREATE POLICY reception_admin_history_read ON public.reception_admin_history
  FOR SELECT TO authenticated, app_prontomedic
  USING (
    company_id = public.current_company_id()
    AND unit_id IS NOT NULL
    AND public.org_can_access_unit(company_id, unit_id)
  );

REVOKE INSERT, UPDATE, DELETE ON public.triagem_fila,
  public.triagem_fila_history,
  public.reception_queue_tickets,
  public.reception_admin_history
  FROM PUBLIC, authenticated, app_prontomedic;
GRANT SELECT ON public.triagem_fila, public.triagem_fila_history,
  public.reception_queue_tickets, public.reception_admin_history
  TO authenticated, app_prontomedic;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated, app_prontomedic;

CREATE OR REPLACE FUNCTION private.issue_triage_queue_ticket(
  p_unit_id INTEGER,
  p_patient_id BIGINT,
  p_complaint TEXT DEFAULT NULL,
  p_classification_id INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company UUID := public.current_company_id();
  v_number INTEGER;
  v_row public.triagem_fila;
BEGIN
  IF v_company IS NULL OR p_unit_id IS NULL OR p_patient_id IS NULL THEN
    RAISE EXCEPTION 'Empresa, unidade e paciente sao obrigatorios';
  END IF;
  IF NOT public.audit_has_role(ARRAY['admin','gestor','enfermagem','enfermeiro','medico','recepcao']::TEXT[]) THEN
    RAISE EXCEPTION 'Perfil sem permissao para emitir senha de triagem';
  END IF;
  IF NOT public.org_can_access_unit(v_company, p_unit_id) THEN
    RAISE EXCEPTION 'Unidade fora do escopo autorizado';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.patients WHERE id = p_patient_id AND company_id = v_company) THEN
    RAISE EXCEPTION 'Paciente fora do tenant';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(format('%s:%s:%s', v_company, p_unit_id, CURRENT_DATE), 0));
  SELECT COUNT(*) + 1 INTO v_number
    FROM public.triagem_fila
   WHERE company_id = v_company
     AND unit_id = p_unit_id
     AND (dt_chegada AT TIME ZONE 'America/Sao_Paulo')::DATE = CURRENT_DATE;

  INSERT INTO public.triagem_fila(company_id, unit_id, cd_paciente, cd_senha, tp_status, ds_queixa_inicial, cd_classificacao_id)
  VALUES (v_company, p_unit_id, p_patient_id, 'T' || LPAD(v_number::TEXT, 3, '0'), 'AGUARDANDO', NULLIF(BTRIM(p_complaint), ''), p_classification_id)
  RETURNING * INTO v_row;
  RETURN TO_JSONB(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_triage_queue_ticket_secure(
  p_unit_id INTEGER,
  p_patient_id BIGINT,
  p_complaint TEXT DEFAULT NULL,
  p_classification_id INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN private.issue_triage_queue_ticket(p_unit_id, p_patient_id, p_complaint, p_classification_id);
END;
$$;

CREATE OR REPLACE FUNCTION private.transition_triage_queue(
  p_queue_id BIGINT,
  p_to_status TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company UUID := public.current_company_id();
  v_row public.triagem_fila;
  v_from TEXT;
BEGIN
  IF p_queue_id IS NULL OR p_to_status IS NULL OR p_to_status NOT IN ('CHAMADO','EM_TRIAGEM','TRIADO','DESISTIU') THEN
    RAISE EXCEPTION 'Transicao de fila invalida';
  END IF;
  IF NOT public.audit_has_role(ARRAY['admin','gestor','enfermagem','enfermeiro','medico','recepcao']::TEXT[]) THEN
    RAISE EXCEPTION 'Perfil sem permissao para alterar fila de triagem';
  END IF;

  SELECT * INTO v_row FROM public.triagem_fila WHERE id = p_queue_id FOR UPDATE;
  IF NOT FOUND OR v_row.company_id <> v_company OR v_row.unit_id IS NULL THEN
    RAISE EXCEPTION 'Senha fora do tenant ou sem unidade';
  END IF;
  IF NOT public.org_can_access_unit(v_company, v_row.unit_id) THEN
    RAISE EXCEPTION 'Senha fora da unidade autorizada';
  END IF;
  v_from := v_row.tp_status;
  IF NOT (
    (v_from = 'AGUARDANDO' AND p_to_status IN ('CHAMADO','DESISTIU')) OR
    (v_from = 'CHAMADO' AND p_to_status IN ('EM_TRIAGEM','TRIADO','DESISTIU')) OR
    (v_from = 'EM_TRIAGEM' AND p_to_status IN ('TRIADO','DESISTIU'))
  ) THEN
    RAISE EXCEPTION 'Transicao % -> % nao permitida', v_from, p_to_status;
  END IF;

  PERFORM set_config('prontomedic.triagem_reason', COALESCE(NULLIF(BTRIM(p_reason), ''), 'Transicao de fila'), true);
  UPDATE public.triagem_fila
     SET tp_status = p_to_status,
         dt_chamada = CASE WHEN p_to_status = 'CHAMADO' THEN COALESCE(dt_chamada, NOW()) ELSE dt_chamada END,
         dt_inicio_triagem = CASE WHEN p_to_status = 'EM_TRIAGEM' THEN COALESCE(dt_inicio_triagem, NOW()) ELSE dt_inicio_triagem END,
         dt_finalizacao = CASE WHEN p_to_status = 'TRIADO' THEN NOW() ELSE dt_finalizacao END,
         dt_desistencia = CASE WHEN p_to_status = 'DESISTIU' THEN NOW() ELSE dt_desistencia END
   WHERE id = p_queue_id
   RETURNING * INTO v_row;
  RETURN TO_JSONB(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_triage_queue_secure(
  p_queue_id BIGINT,
  p_to_status TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN private.transition_triage_queue(p_queue_id, p_to_status, p_reason);
END;
$$;

CREATE OR REPLACE FUNCTION private.transition_reception_queue_ticket(
  p_ticket_id BIGINT,
  p_to_status TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
  SELECT * INTO v_ticket FROM public.reception_queue_tickets
   WHERE id = p_ticket_id AND company_id = public.current_company_id()
     AND unit_id IS NOT NULL AND public.org_can_access_unit(company_id, unit_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Senha de recepcao fora do escopo'; END IF;
  v_from_status := v_ticket.status;
  IF v_from_status = p_to_status THEN
    RETURN jsonb_build_object('ticket_id', v_ticket.id, 'from_status', v_from_status, 'to_status', p_to_status, 'idempotent', TRUE);
  END IF;
  IF NOT ((v_from_status = 'waiting' AND p_to_status IN ('called','cancelled','no_show')) OR
          (v_from_status = 'called' AND p_to_status IN ('waiting','transferred','completed','cancelled','no_show')) OR
          (v_from_status = 'transferred' AND p_to_status IN ('waiting','called','cancelled'))) THEN
    RAISE EXCEPTION 'Transicao de fila invalida: % -> %', v_from_status, p_to_status;
  END IF;
  UPDATE public.reception_queue_tickets SET status = p_to_status,
    called_at = CASE WHEN p_to_status = 'called' AND called_at IS NULL THEN NOW() ELSE called_at END,
    completed_at = CASE WHEN p_to_status IN ('completed','cancelled','no_show') THEN COALESCE(completed_at, NOW()) ELSE completed_at END
   WHERE id = v_ticket.id;
  INSERT INTO public.reception_admin_history(company_id, unit_id, entity_type, entity_id, appointment_id, from_status, to_status, reason, details, actor_user_id)
  VALUES (v_ticket.company_id, v_ticket.unit_id, 'reception_queue_ticket', v_ticket.id::TEXT, v_ticket.appointment_id,
    v_from_status, p_to_status, COALESCE(v_reason, 'Transicao de fila'),
    jsonb_build_object('ticket', v_ticket.prefix || lpad(v_ticket.number::TEXT, 3, '0')), v_actor.user_id);
  RETURN jsonb_build_object('ticket_id', v_ticket.id, 'from_status', v_from_status, 'to_status', p_to_status, 'idempotent', FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_reception_queue_ticket_secure(
  p_ticket_id BIGINT,
  p_to_status TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN private.transition_reception_queue_ticket(p_ticket_id, p_to_status, p_reason);
END;
$$;

CREATE OR REPLACE FUNCTION private.transition_reception_queue_ticket(
  p_ticket_id BIGINT,
  p_to_status TEXT,
  p_reason TEXT,
  p_destination_unit_id INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ticket public.reception_queue_tickets;
  v_actor RECORD;
  v_from_status TEXT;
  v_reason TEXT := NULLIF(trim(COALESCE(p_reason, '')), '');
  v_company UUID := public.current_company_id();
  v_history_unit_id INTEGER;
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
  SELECT * INTO v_ticket FROM public.reception_queue_tickets
   WHERE id = p_ticket_id AND company_id = v_company AND unit_id IS NOT NULL
     AND public.org_can_access_unit(company_id, unit_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Senha de recepcao fora do escopo'; END IF;
  v_from_status := v_ticket.status;
  IF v_from_status = p_to_status AND p_to_status <> 'transferred' THEN
    RETURN jsonb_build_object('ticket_id', v_ticket.id, 'from_status', v_from_status, 'to_status', p_to_status, 'idempotent', TRUE);
  END IF;
  IF NOT ((v_from_status = 'waiting' AND p_to_status IN ('called','cancelled','no_show','transferred')) OR
          (v_from_status = 'called' AND p_to_status IN ('waiting','transferred','completed','cancelled','no_show')) OR
          (v_from_status = 'transferred' AND p_to_status IN ('waiting','called','cancelled'))) THEN
    RAISE EXCEPTION 'Transicao de fila invalida: % -> %', v_from_status, p_to_status;
  END IF;
  IF p_to_status = 'transferred' AND NOT EXISTS (
    SELECT 1 FROM public.units u WHERE u.id = p_destination_unit_id AND u.company_id = v_company
      AND u.lg_ativo = TRUE AND public.org_can_access_unit(v_company, p_destination_unit_id)
  ) THEN RAISE EXCEPTION 'Unidade de destino fora do escopo'; END IF;
  v_history_unit_id := CASE WHEN p_to_status = 'transferred' THEN p_destination_unit_id ELSE v_ticket.unit_id END;
  UPDATE public.reception_queue_tickets SET status = p_to_status,
    unit_id = CASE WHEN p_to_status = 'transferred' THEN p_destination_unit_id ELSE unit_id END,
    transferred_to_unit_id = CASE WHEN p_to_status = 'transferred' THEN p_destination_unit_id ELSE transferred_to_unit_id END,
    transferred_at = CASE WHEN p_to_status = 'transferred' THEN NOW() ELSE transferred_at END,
    called_at = CASE WHEN p_to_status = 'called' AND called_at IS NULL THEN NOW() ELSE called_at END,
    completed_at = CASE WHEN p_to_status IN ('completed','cancelled','no_show') THEN COALESCE(completed_at, NOW()) ELSE completed_at END,
    sla_due_at = CASE WHEN p_to_status IN ('waiting','transferred') THEN NOW() + make_interval(mins => sla_minutes) ELSE sla_due_at END
   WHERE id = v_ticket.id;
  INSERT INTO public.reception_admin_history(company_id, unit_id, entity_type, entity_id, appointment_id, from_status, to_status, reason, details, actor_user_id)
  VALUES (v_company, v_history_unit_id, 'reception_queue_ticket', v_ticket.id::TEXT, v_ticket.appointment_id, v_from_status, p_to_status,
    COALESCE(v_reason, 'Transicao de fila'), jsonb_build_object('ticket', v_ticket.prefix || lpad(v_ticket.number::TEXT, 3, '0'),
      'source_unit_id', v_ticket.unit_id, 'destination_unit_id', p_destination_unit_id, 'sla_minutes', v_ticket.sla_minutes), v_actor.user_id);
  RETURN jsonb_build_object('ticket_id', v_ticket.id, 'from_status', v_from_status, 'to_status', p_to_status,
    'destination_unit_id', p_destination_unit_id, 'sla_due_at', CASE WHEN p_to_status IN ('waiting','transferred') THEN NOW() + make_interval(mins => v_ticket.sla_minutes) ELSE v_ticket.sla_due_at END, 'idempotent', FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_reception_queue_ticket_secure(
  p_ticket_id BIGINT,
  p_to_status TEXT,
  p_reason TEXT,
  p_destination_unit_id INTEGER
)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN private.transition_reception_queue_ticket(p_ticket_id, p_to_status, p_reason, p_destination_unit_id);
END;
$$;

REVOKE ALL ON FUNCTION public.issue_triage_queue_ticket_secure(INTEGER, BIGINT, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transition_triage_queue_secure(BIGINT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transition_reception_queue_ticket_secure(BIGINT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transition_reception_queue_ticket_secure(BIGINT, TEXT, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_triage_queue_ticket_secure(INTEGER, BIGINT, TEXT, INTEGER),
  public.transition_triage_queue_secure(BIGINT, TEXT, TEXT),
  public.transition_reception_queue_ticket_secure(BIGINT, TEXT, TEXT),
  public.transition_reception_queue_ticket_secure(BIGINT, TEXT, TEXT, INTEGER)
  TO authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION private.issue_triage_queue_ticket(INTEGER, BIGINT, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.transition_triage_queue(BIGINT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.transition_reception_queue_ticket(BIGINT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.transition_reception_queue_ticket(BIGINT, TEXT, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.issue_triage_queue_ticket(INTEGER, BIGINT, TEXT, INTEGER),
  private.transition_triage_queue(BIGINT, TEXT, TEXT),
  private.transition_reception_queue_ticket(BIGINT, TEXT, TEXT),
  private.transition_reception_queue_ticket(BIGINT, TEXT, TEXT, INTEGER)
  TO authenticated, app_prontomedic;

DO $$
BEGIN
  IF to_regclass('public.prontomedic_deployment_migrations') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.prontomedic_deployment_migrations WHERE filename = '20260722110000_module12_queue_acl_hardening.sql') THEN
    INSERT INTO public.prontomedic_deployment_migrations(filename, applied_at)
    VALUES ('20260722110000_module12_queue_acl_hardening.sql', NOW());
  END IF;
END
$$;

COMMIT;
