-- Module 6: audit context, lifecycle events, alerts and retention controls.
-- Idempotent on top of the legacy audit_logs migration.

ALTER TABLE IF EXISTS public.audit_logs
  ADD COLUMN IF NOT EXISTS unit_id INTEGER,
  ADD COLUMN IF NOT EXISTS evento_tipo VARCHAR(30) NOT NULL DEFAULT 'operacao',
  ADD COLUMN IF NOT EXISTS motivo TEXT,
  ADD COLUMN IF NOT EXISTS contexto JSONB NOT NULL DEFAULT '{}'::JSONB;

DO $$
BEGIN
  IF to_regclass('public.units') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
        WHERE conname = 'audit_logs_unit_id_fkey'
          AND conrelid = 'public.audit_logs'::regclass
     ) THEN
    ALTER TABLE public.audit_logs
      ADD CONSTRAINT audit_logs_unit_id_fkey
      FOREIGN KEY (unit_id) REFERENCES public.units(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_audit_logs_scope_time
  ON public.audit_logs(company_id, unit_id, dt_evento DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_lifecycle
  ON public.audit_logs(company_id, evento_tipo, acao, dt_evento DESC);

CREATE OR REPLACE FUNCTION public.audit_sanitize_jsonb(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key TEXT;
  v_value JSONB;
  v_result JSONB := '{}'::JSONB;
BEGIN
  IF p_payload IS NULL THEN
    RETURN NULL;
  END IF;

  IF jsonb_typeof(p_payload) = 'object' THEN
    FOR v_key, v_value IN SELECT key, value FROM jsonb_each(p_payload) LOOP
      IF lower(v_key) ~ '(password|senha|token|secret|api[_-]?key|private[_-]?key)' THEN
        v_result := v_result || jsonb_build_object(v_key, '[REDACTED]');
      ELSE
        v_result := v_result || jsonb_build_object(v_key, public.audit_sanitize_jsonb(v_value));
      END IF;
    END LOOP;
    RETURN v_result;
  ELSIF jsonb_typeof(p_payload) = 'array' THEN
    RETURN (
      SELECT COALESCE(jsonb_agg(public.audit_sanitize_jsonb(value)), '[]'::JSONB)
        FROM jsonb_array_elements(p_payload)
    );
  END IF;

  RETURN p_payload;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_sanitize_jsonb(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.audit_sanitize_jsonb(JSONB) TO app_prontomedic, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     AND to_regprocedure('auth.uid()') IS NOT NULL THEN
    EXECUTE 'GRANT USAGE ON SCHEMA auth TO authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.audit_trigger_func()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old JSONB;
  v_new JSONB;
  v_acao VARCHAR(50);
  v_record_id TEXT;
  v_company_id UUID;
  v_unit_id INTEGER;
  v_user_id UUID := COALESCE(NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID, auth.uid());
  v_user_name TEXT;
  v_role TEXT;
BEGIN
  IF v_user_id IS NOT NULL THEN
    SELECT full_name, role_name
      INTO v_user_name, v_role
      FROM public.user_profiles
     WHERE id = v_user_id;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_new := public.audit_sanitize_jsonb(to_jsonb(NEW));
    v_acao := 'INSERT';
    v_record_id := v_new->>'id';
  ELSIF TG_OP = 'UPDATE' THEN
    v_old := public.audit_sanitize_jsonb(to_jsonb(OLD));
    v_new := public.audit_sanitize_jsonb(to_jsonb(NEW));
    v_acao := 'UPDATE';
    v_record_id := v_new->>'id';
  ELSE
    v_old := public.audit_sanitize_jsonb(to_jsonb(OLD));
    v_acao := 'DELETE';
    v_record_id := v_old->>'id';
  END IF;

  BEGIN
    v_company_id := COALESCE((v_new->>'company_id')::UUID, (v_old->>'company_id')::UUID);
  EXCEPTION WHEN OTHERS THEN
    v_company_id := NULL;
  END;
  BEGIN
    v_unit_id := COALESCE((v_new->>'unit_id')::INTEGER, (v_old->>'unit_id')::INTEGER);
  EXCEPTION WHEN OTHERS THEN
    v_unit_id := NULL;
  END;
  IF v_company_id IS NULL AND v_user_id IS NOT NULL THEN
    SELECT company_id INTO v_company_id
      FROM public.user_profiles
     WHERE id = v_user_id;
  END IF;

  INSERT INTO public.audit_logs (
    company_id, unit_id, cd_usuario, cd_usuario_nome, role_name,
    acao, evento_tipo, tabela, registro_id, operacao,
    dados_anteriores, dados_novos, contexto
  ) VALUES (
    v_company_id, v_unit_id, v_user_id, v_user_name, v_role,
    v_acao, 'operacao', TG_TABLE_NAME, v_record_id,
    TG_TABLE_NAME || ' ' || v_acao || ' por ' || COALESCE(v_user_name, 'system'),
    v_old, v_new, jsonb_build_object('source', 'trigger', 'operation', TG_OP)
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.audit_trigger_func() IS
  'Auditoria automatica com snapshots sanitizados e contexto de unidade.';

CREATE TABLE IF NOT EXISTS public.audit_alert_rules (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  unit_id INTEGER REFERENCES public.units(id) ON DELETE CASCADE,
  nome VARCHAR(120) NOT NULL,
  tabela VARCHAR(50),
  acao VARCHAR(50),
  limite INTEGER NOT NULL DEFAULT 1 CHECK (limite > 0),
  janela_minutos INTEGER NOT NULL DEFAULT 15 CHECK (janela_minutos BETWEEN 1 AND 10080),
  lg_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_audit_alert_rules_scope
  ON public.audit_alert_rules(company_id, unit_id, lg_ativo);

CREATE TABLE IF NOT EXISTS public.audit_alerts (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  unit_id INTEGER REFERENCES public.units(id) ON DELETE SET NULL,
  rule_id BIGINT REFERENCES public.audit_alert_rules(id) ON DELETE SET NULL,
  audit_log_id BIGINT,
  severidade VARCHAR(20) NOT NULL DEFAULT 'warning'
    CHECK (severidade IN ('info', 'warning', 'critical')),
  titulo VARCHAR(180) NOT NULL,
  descricao TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'acknowledged', 'resolved')),
  contexto JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES auth.users(id),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_audit_alerts_scope_status
  ON public.audit_alerts(company_id, unit_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.audit_retention_runs (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  executado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  executado_por TEXT NOT NULL DEFAULT CURRENT_USER,
  janela_ate DATE NOT NULL,
  registros_removidos INTEGER NOT NULL DEFAULT 0,
  detalhes JSONB NOT NULL DEFAULT '{}'::JSONB
);

ALTER TABLE public.audit_alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_retention_runs ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.audit_current_user_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
$$;

CREATE OR REPLACE FUNCTION public.audit_current_company_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.company_id', true), '')::UUID,
    (
      SELECT company_id
        FROM public.user_profiles
       WHERE id = public.audit_current_user_id()
       LIMIT 1
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.audit_has_role(p_roles TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
     FROM public.user_profiles
     WHERE id = public.audit_current_user_id()
       AND role_name = ANY(p_roles)
  );
$$;

REVOKE ALL ON FUNCTION public.audit_current_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.audit_current_company_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.audit_has_role(TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.audit_current_user_id() TO app_prontomedic, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_current_company_id() TO app_prontomedic, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_has_role(TEXT[]) TO app_prontomedic, authenticated;

DROP POLICY IF EXISTS audit_alert_rules_read ON public.audit_alert_rules;
DROP POLICY IF EXISTS audit_alert_rules_manage ON public.audit_alert_rules;
CREATE POLICY audit_alert_rules_read ON public.audit_alert_rules
  FOR SELECT TO app_prontomedic, authenticated
  USING (
    company_id = public.audit_current_company_id()
    AND (unit_id IS NULL OR public.org_can_access_unit(company_id, unit_id))
    AND public.audit_has_role(ARRAY['admin', 'dpo', 'gestor'])
  );
CREATE POLICY audit_alert_rules_manage ON public.audit_alert_rules
  FOR ALL TO app_prontomedic, authenticated
  USING (
    company_id = public.audit_current_company_id()
    AND (unit_id IS NULL OR public.org_can_access_unit(company_id, unit_id))
    AND public.audit_has_role(ARRAY['admin', 'dpo'])
  )
  WITH CHECK (
    company_id = public.audit_current_company_id()
    AND (unit_id IS NULL OR public.org_can_access_unit(company_id, unit_id))
  );

DROP POLICY IF EXISTS audit_alerts_read ON public.audit_alerts;
DROP POLICY IF EXISTS audit_alerts_manage ON public.audit_alerts;
CREATE POLICY audit_alerts_read ON public.audit_alerts
  FOR SELECT TO app_prontomedic, authenticated
  USING (
    company_id = public.audit_current_company_id()
    AND (unit_id IS NULL OR public.org_can_access_unit(company_id, unit_id))
    AND public.audit_has_role(ARRAY['admin', 'dpo', 'gestor'])
  );
CREATE POLICY audit_alerts_manage ON public.audit_alerts
  FOR UPDATE TO app_prontomedic, authenticated
  USING (
    company_id = public.audit_current_company_id()
    AND public.audit_has_role(ARRAY['admin', 'dpo', 'gestor'])
  )
  WITH CHECK (company_id = public.audit_current_company_id());

DROP POLICY IF EXISTS audit_retention_runs_read ON public.audit_retention_runs;
CREATE POLICY audit_retention_runs_read ON public.audit_retention_runs
  FOR SELECT TO app_prontomedic, authenticated
  USING (
    company_id IS NULL
    OR company_id = public.audit_current_company_id()
  );

DROP POLICY IF EXISTS "Admins can read audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Authenticated can append access logs" ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_select ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_insert ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_update ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_delete ON public.audit_logs;
CREATE POLICY "Admins can read audit logs" ON public.audit_logs
  FOR SELECT TO app_prontomedic, authenticated
  USING (
    company_id = public.audit_current_company_id()
    AND (unit_id IS NULL OR public.org_can_access_unit(company_id, unit_id))
    AND public.audit_has_role(ARRAY['admin', 'dpo'])
  );
CREATE POLICY "Authenticated can append access logs" ON public.audit_logs
  FOR INSERT TO app_prontomedic, authenticated
  WITH CHECK (
    cd_usuario = public.audit_current_user_id()
    AND company_id = public.audit_current_company_id()
    AND (unit_id IS NULL OR public.org_can_access_unit(company_id, unit_id))
    AND acao IN ('LOGIN', 'LOGOUT', 'VIEW_RECORD', 'PRINT', 'EXPORT', 'SIGN', 'REOPEN', 'EXCEPTION', 'INSERT', 'UPDATE', 'DELETE')
  );

DROP FUNCTION IF EXISTS public.log_data_access(TEXT, TEXT, TEXT, JSONB);

CREATE OR REPLACE FUNCTION public.log_data_access(
  p_tabela TEXT,
  p_registro_id TEXT,
  p_acao TEXT,
  p_contexto JSONB DEFAULT '{}'::JSONB
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company_id UUID;
  v_user_id UUID := public.audit_current_user_id();
  v_user_name TEXT;
  v_role TEXT;
  v_unit_id INTEGER;
  v_contexto JSONB := public.audit_sanitize_jsonb(COALESCE(p_contexto, '{}'::JSONB));
  v_evento_tipo VARCHAR(30);
  v_log_id BIGINT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Nao autenticado';
  END IF;
  IF p_tabela IS NULL OR p_tabela !~ '^[a-z][a-z0-9_]{0,49}$' THEN
    RAISE EXCEPTION 'Tabela de auditoria invalida';
  END IF;
  IF p_acao NOT IN ('LOGIN', 'LOGOUT', 'VIEW_RECORD', 'PRINT', 'EXPORT', 'SIGN', 'REOPEN', 'EXCEPTION', 'INSERT', 'UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'Acao de auditoria invalida';
  END IF;
  IF p_acao IN ('REOPEN', 'EXCEPTION') AND NULLIF(COALESCE(v_contexto->>'motivo', v_contexto->>'reason'), '') IS NULL THEN
    RAISE EXCEPTION 'Motivo obrigatorio para reabertura ou excecao';
  END IF;

  SELECT company_id, full_name, role_name
    INTO v_company_id, v_user_name, v_role
    FROM public.user_profiles
   WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Empresa do usuario nao identificada';
  END IF;

  BEGIN
    v_unit_id := NULLIF(COALESCE(v_contexto->>'unit_id', v_contexto->>'unitId'), '')::INTEGER;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Unidade de auditoria invalida';
  END;
  IF v_unit_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.units WHERE id = v_unit_id AND company_id = v_company_id
  ) THEN
    RAISE EXCEPTION 'Unidade fora do escopo da empresa';
  END IF;

  v_evento_tipo := CASE
    WHEN p_acao IN ('LOGIN', 'LOGOUT') THEN 'acesso'
    WHEN p_acao IN ('VIEW_RECORD') THEN 'leitura'
    WHEN p_acao IN ('PRINT', 'EXPORT') THEN 'saida'
    WHEN p_acao IN ('SIGN', 'REOPEN') THEN 'ciclo_documental'
    WHEN p_acao IN ('EXCEPTION') THEN 'excecao'
    ELSE 'operacao'
  END;

  INSERT INTO public.audit_logs (
    company_id, unit_id, cd_usuario, cd_usuario_nome, role_name,
    acao, evento_tipo, tabela, registro_id, operacao,
    motivo, contexto, dados_novos
  ) VALUES (
    v_company_id, v_unit_id, v_user_id, v_user_name, v_role,
    p_acao, v_evento_tipo, p_tabela, p_registro_id,
    p_tabela || ' ' || p_acao || ' via API',
    NULLIF(COALESCE(v_contexto->>'motivo', v_contexto->>'reason'), ''),
    v_contexto, v_contexto
  ) RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_data_access(TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_data_access(TEXT, TEXT, TEXT, JSONB) TO app_prontomedic, authenticated;

CREATE OR REPLACE FUNCTION public.evaluate_audit_alerts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r RECORD;
  v_total INTEGER;
BEGIN
  FOR r IN
    SELECT * FROM public.audit_alert_rules
     WHERE lg_ativo = TRUE
       AND company_id = NEW.company_id
       AND (unit_id IS NULL OR unit_id = NEW.unit_id)
       AND (tabela IS NULL OR tabela = NEW.tabela)
       AND (acao IS NULL OR acao = NEW.acao)
  LOOP
    SELECT COUNT(*) INTO v_total
      FROM public.audit_logs
     WHERE company_id = NEW.company_id
       AND (r.unit_id IS NULL OR unit_id = r.unit_id)
       AND (r.tabela IS NULL OR tabela = r.tabela)
       AND (r.acao IS NULL OR acao = r.acao)
       AND dt_evento >= NOW() - make_interval(mins => r.janela_minutos);
    IF v_total >= r.limite THEN
      INSERT INTO public.audit_alerts (
        company_id, unit_id, rule_id, audit_log_id, severidade,
        titulo, descricao, contexto
      ) VALUES (
        NEW.company_id, NEW.unit_id, r.id, NEW.id, 'warning',
        r.nome,
        format('Regra atingida: %s eventos em %s minutos.', v_total, r.janela_minutos),
        jsonb_build_object('total', v_total, 'limite', r.limite, 'acao', NEW.acao, 'tabela', NEW.tabela)
      );
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_alerts ON public.audit_logs;
CREATE TRIGGER trg_audit_alerts
  AFTER INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.evaluate_audit_alerts();

DROP FUNCTION IF EXISTS public.purge_expired_audit_logs();
CREATE OR REPLACE FUNCTION public.purge_expired_audit_logs()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF public.audit_current_user_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Rotina de retencao requer executor tecnico';
  END IF;
  WITH deleted AS (
    DELETE FROM public.audit_logs
     WHERE dt_retencao < CURRENT_DATE
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM deleted;

  INSERT INTO public.audit_retention_runs (janela_ate, registros_removidos, detalhes)
  VALUES (CURRENT_DATE, v_count, jsonb_build_object('policy', 'dt_retencao'));
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_audit_logs() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.purge_expired_audit_logs() TO service_role;
  END IF;
END $$;

GRANT SELECT ON public.audit_alert_rules, public.audit_alerts, public.audit_retention_runs TO app_prontomedic, authenticated;
GRANT SELECT ON public.audit_logs TO app_prontomedic, authenticated;
GRANT INSERT, UPDATE ON public.audit_alert_rules TO app_prontomedic, authenticated;
GRANT UPDATE ON public.audit_alerts TO app_prontomedic, authenticated;
