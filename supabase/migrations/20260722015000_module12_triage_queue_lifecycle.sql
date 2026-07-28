-- Module 12: canonical unit-scoped triage queue lifecycle.
-- Additive migration. DataSIGH is not referenced.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.triagem_fila') IS NULL
     OR to_regclass('public.units') IS NULL
     OR to_regclass('public.patients') IS NULL THEN
    RAISE EXCEPTION 'Module 12 triage queue foundation is missing';
  END IF;
END
$$;

ALTER TABLE public.triagem_fila
  ADD COLUMN IF NOT EXISTS unit_id INTEGER,
  ADD COLUMN IF NOT EXISTS dt_inicio_triagem TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dt_finalizacao TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dt_desistencia TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'triagem_fila_unit_id_fkey'
      AND conrelid = 'public.triagem_fila'::regclass
  ) THEN
    ALTER TABLE public.triagem_fila
      ADD CONSTRAINT triagem_fila_unit_id_fkey
      FOREIGN KEY (unit_id) REFERENCES public.units(id) ON DELETE RESTRICT;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_triagem_fila_unit_status
  ON public.triagem_fila(company_id, unit_id, tp_status, dt_chegada);

CREATE TABLE IF NOT EXISTS public.triagem_fila_history (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  unit_id INTEGER REFERENCES public.units(id) ON DELETE RESTRICT,
  triagem_fila_id BIGINT NOT NULL REFERENCES public.triagem_fila(id) ON DELETE CASCADE,
  from_status VARCHAR(20),
  to_status VARCHAR(20) NOT NULL,
  reason TEXT,
  actor_user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.triagem_fila_history ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_triagem_fila_history_scope
  ON public.triagem_fila_history(company_id, unit_id, created_at DESC);

DO $$
DECLARE
  v_policy RECORD;
BEGIN
  FOR v_policy IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'triagem_fila'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.triagem_fila', v_policy.policyname);
  END LOOP;
  FOR v_policy IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'triagem_fila_history'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.triagem_fila_history', v_policy.policyname);
  END LOOP;
END
$$;

CREATE POLICY m12_triagem_fila_read ON public.triagem_fila
  FOR SELECT TO authenticated, app_prontomedic
  USING (
    company_id = public.current_company_id()
    AND (unit_id IS NULL OR public.org_can_access_unit(company_id, unit_id))
  );

CREATE POLICY m12_triagem_fila_insert ON public.triagem_fila
  FOR INSERT TO authenticated, app_prontomedic
  WITH CHECK (
    company_id = public.current_company_id()
    AND unit_id IS NOT NULL
    AND public.org_can_access_unit(company_id, unit_id)
    AND public.audit_has_role(ARRAY['admin','gestor','enfermagem','enfermeiro','medico','recepcao']::TEXT[])
  );

CREATE POLICY m12_triagem_fila_update ON public.triagem_fila
  FOR UPDATE TO authenticated, app_prontomedic
  USING (
    company_id = public.current_company_id()
    AND unit_id IS NOT NULL
    AND public.org_can_access_unit(company_id, unit_id)
    AND public.audit_has_role(ARRAY['admin','gestor','enfermagem','enfermeiro','medico','recepcao']::TEXT[])
  )
  WITH CHECK (
    company_id = public.current_company_id()
    AND unit_id IS NOT NULL
    AND public.org_can_access_unit(company_id, unit_id)
  );

DROP POLICY IF EXISTS m12_triagem_fila_history_read ON public.triagem_fila_history;
CREATE POLICY m12_triagem_fila_history_read ON public.triagem_fila_history
  FOR SELECT TO authenticated, app_prontomedic
  USING (
    company_id = public.current_company_id()
    AND (unit_id IS NULL OR public.org_can_access_unit(company_id, unit_id))
  );

REVOKE INSERT, UPDATE, DELETE ON public.triagem_fila_history FROM authenticated, app_prontomedic;
REVOKE INSERT, UPDATE, DELETE ON public.triagem_fila FROM authenticated, app_prontomedic;
GRANT INSERT (company_id, unit_id, cd_paciente, cd_senha, tp_status, ds_queixa_inicial, cd_classificacao_id)
  ON public.triagem_fila TO authenticated, app_prontomedic;
GRANT UPDATE (tp_status, dt_chamada, dt_inicio_triagem, dt_finalizacao, dt_desistencia)
  ON public.triagem_fila TO authenticated, app_prontomedic;
GRANT SELECT ON public.triagem_fila, public.triagem_fila_history
  TO authenticated, app_prontomedic;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated, app_prontomedic;

CREATE OR REPLACE FUNCTION private.triagem_fila_history_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor UUID := NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.triagem_fila_history(company_id, unit_id, triagem_fila_id, from_status, to_status, reason, actor_user_id)
    VALUES (NEW.company_id, NEW.unit_id, NEW.id, NULL, NEW.tp_status, 'Senha emitida', v_actor);
  ELSIF TG_OP = 'UPDATE' AND OLD.tp_status IS DISTINCT FROM NEW.tp_status THEN
    INSERT INTO public.triagem_fila_history(company_id, unit_id, triagem_fila_id, from_status, to_status, reason, actor_user_id)
    VALUES (
      NEW.company_id,
      NEW.unit_id,
      NEW.id,
      OLD.tp_status,
      NEW.tp_status,
      NULLIF(current_setting('prontomedic.triagem_reason', true), ''),
      v_actor
    );
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.triagem_fila_history_trigger() FROM PUBLIC, authenticated, app_prontomedic;
DROP TRIGGER IF EXISTS trg_m12_triagem_fila_history ON public.triagem_fila;
CREATE TRIGGER trg_m12_triagem_fila_history
  AFTER INSERT OR UPDATE OF tp_status ON public.triagem_fila
  FOR EACH ROW EXECUTE FUNCTION private.triagem_fila_history_trigger();

CREATE OR REPLACE FUNCTION public.issue_triage_queue_ticket_secure(
  p_unit_id INTEGER,
  p_patient_id BIGINT,
  p_complaint TEXT DEFAULT NULL,
  p_classification_id INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_company UUID := public.current_company_id();
  v_actor UUID := NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
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
REVOKE ALL ON FUNCTION public.issue_triage_queue_ticket_secure(INTEGER, BIGINT, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_triage_queue_ticket_secure(INTEGER, BIGINT, TEXT, INTEGER)
  TO authenticated, app_prontomedic;

CREATE OR REPLACE FUNCTION public.transition_triage_queue_secure(
  p_queue_id BIGINT,
  p_to_status TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_company UUID := public.current_company_id();
  v_actor UUID := NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
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
  IF NOT FOUND OR v_row.company_id <> v_company THEN RAISE EXCEPTION 'Senha fora do tenant'; END IF;
  IF v_row.unit_id IS NOT NULL AND NOT public.org_can_access_unit(v_company, v_row.unit_id) THEN
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

  PERFORM set_config(
    'prontomedic.triagem_reason',
    COALESCE(NULLIF(BTRIM(p_reason), ''), 'Transicao de fila'),
    true
  );

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
REVOKE ALL ON FUNCTION public.transition_triage_queue_secure(BIGINT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transition_triage_queue_secure(BIGINT, TEXT, TEXT)
  TO authenticated, app_prontomedic;

DO $$
BEGIN
  IF to_regclass('public.prontomedic_deployment_migrations') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.prontomedic_deployment_migrations WHERE filename = '20260722015000_module12_triage_queue_lifecycle.sql') THEN
    INSERT INTO public.prontomedic_deployment_migrations(filename, applied_at)
    VALUES ('20260722015000_module12_triage_queue_lifecycle.sql', NOW());
  END IF;
END
$$;

COMMIT;
