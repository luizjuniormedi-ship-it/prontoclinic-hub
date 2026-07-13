-- Canonical atomic nursing triage contract.
-- Preserves the legacy nursing tables while moving all browser mutations to
-- tenant-derived, RBAC-protected and idempotent RPCs.

DO $preflight$
BEGIN
  IF current_setting('server_version_num')::INTEGER < 180000 THEN
    RAISE EXCEPTION 'Nursing triage contract requires PostgreSQL 18';
  END IF;
  IF to_regprocedure('auth.uid()') IS NULL
     OR to_regprocedure('public.current_company_id()') IS NULL
     OR to_regprocedure('public.nursing_actor_context_secure(text)') IS NULL
     OR to_regclass('public.companies') IS NULL
     OR to_regclass('public.user_profiles') IS NULL
     OR to_regclass('public.patients') IS NULL
     OR to_regclass('public.appointments') IS NULL THEN
    RAISE EXCEPTION 'Nursing triage canonical dependencies are missing';
  END IF;
  IF (SELECT count(*) FROM pg_roles
       WHERE rolname IN ('nursing_data_owner', 'nursing_rpc_owner')) <> 2 THEN
    RAISE EXCEPTION 'Nursing triage secure owners are missing';
  END IF;
END
$preflight$;

-- Keep this migration replayable even when the legacy enfermagem migration is
-- absent from an empty-database gate. CREATE TABLE IF NOT EXISTS is a no-op on
-- installations that already hold production nursing data.
CREATE TABLE IF NOT EXISTS public.mnct_classificacao_risco (
  id SERIAL PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  ds_classificacao VARCHAR(50) NOT NULL UNIQUE,
  cd_cor_hex VARCHAR(7) NOT NULL,
  nr_tempo_max_atendimento_min INTEGER NOT NULL,
  ds_descricao TEXT,
  lg_ativo BOOLEAN DEFAULT TRUE,
  cd_origem_sigh INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mnct_fluxograma (
  id SERIAL PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  ds_discriminador VARCHAR(100) NOT NULL,
  ds_pergunta TEXT NOT NULL,
  cd_classificacao_se_sim VARCHAR(20) NOT NULL,
  cd_ordem SMALLINT NOT NULL,
  ds_categoria VARCHAR(50),
  lg_ativo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.triagens (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_paciente BIGINT NOT NULL REFERENCES public.patients(id),
  cd_appointment BIGINT REFERENCES public.appointments(id),
  dt_triagem TIMESTAMPTZ NOT NULL DEFAULT now(),
  cd_classificacao_id INTEGER REFERENCES public.mnct_classificacao_risco(id),
  cd_usuario_enfermeiro UUID,
  vl_pressao_sistolica SMALLINT CHECK (vl_pressao_sistolica BETWEEN 0 AND 300),
  vl_pressao_diastolica SMALLINT CHECK (vl_pressao_diastolica BETWEEN 0 AND 200),
  vl_frequencia_cardiaca SMALLINT CHECK (vl_frequencia_cardiaca BETWEEN 0 AND 250),
  vl_frequencia_respiratoria SMALLINT CHECK (vl_frequencia_respiratoria BETWEEN 0 AND 80),
  vl_temperatura NUMERIC(4,1) CHECK (vl_temperatura BETWEEN 20.0 AND 45.0),
  vl_saturacao_o2 SMALLINT CHECK (vl_saturacao_o2 BETWEEN 0 AND 100),
  vl_glicemia SMALLINT CHECK (vl_glicemia BETWEEN 0 AND 700),
  vl_escala_dor SMALLINT CHECK (vl_escala_dor BETWEEN 0 AND 10),
  vl_peso_kg NUMERIC(5,2) CHECK (vl_peso_kg BETWEEN 0 AND 500),
  vl_altura_cm NUMERIC(5,1) CHECK (vl_altura_cm BETWEEN 0 AND 250),
  vl_glasgow_ocular SMALLINT CHECK (vl_glasgow_ocular BETWEEN 1 AND 4),
  vl_glasgow_verbal SMALLINT CHECK (vl_glasgow_verbal BETWEEN 1 AND 5),
  vl_glasgow_motor SMALLINT CHECK (vl_glasgow_motor BETWEEN 1 AND 6),
  vl_glasgow_total SMALLINT GENERATED ALWAYS AS (
    COALESCE(vl_glasgow_ocular, 0) + COALESCE(vl_glasgow_verbal, 0) + COALESCE(vl_glasgow_motor, 0)
  ) STORED,
  ds_queixa_principal TEXT,
  ds_historia_doenca_atual TEXT,
  ds_medicamentos_uso TEXT,
  ds_alergias TEXT,
  ds_observacoes_enfermagem TEXT,
  tp_status VARCHAR(20) DEFAULT 'AGUARDANDO'
    CHECK (tp_status IN ('AGUARDANDO', 'EM_TRIAGEM', 'TRIADO', 'ENCAMINHADO', 'FINALIZADO')),
  dt_encaminhamento TIMESTAMPTZ,
  cd_destino VARCHAR(50),
  cd_origem_sigh INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.news2_avaliacoes (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_triagem BIGINT NOT NULL REFERENCES public.triagens(id) ON DELETE CASCADE,
  nr_frequencia_respiratoria SMALLINT CHECK (nr_frequencia_respiratoria BETWEEN 0 AND 3),
  nr_saturacao_o2 SMALLINT CHECK (nr_saturacao_o2 BETWEEN 0 AND 3),
  nr_temperatura SMALLINT CHECK (nr_temperatura BETWEEN 0 AND 3),
  nr_pressao_sistolica SMALLINT CHECK (nr_pressao_sistolica BETWEEN 0 AND 3),
  nr_frequencia_cardiaca SMALLINT CHECK (nr_frequencia_cardiaca BETWEEN 0 AND 3),
  nr_nivel_consciencia SMALLINT CHECK (nr_nivel_consciencia BETWEEN 0 AND 3),
  nr_score_total SMALLINT GENERATED ALWAYS AS (
    COALESCE(nr_frequencia_respiratoria, 0) + COALESCE(nr_saturacao_o2, 0) +
    COALESCE(nr_temperatura, 0) + COALESCE(nr_pressao_sistolica, 0) +
    COALESCE(nr_frequencia_cardiaca, 0) + COALESCE(nr_nivel_consciencia, 0)
  ) STORED,
  cd_classificacao_risco VARCHAR(20),
  dt_avaliacao TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.triagem_fila (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_paciente BIGINT NOT NULL REFERENCES public.patients(id),
  dt_chegada TIMESTAMPTZ NOT NULL DEFAULT now(),
  dt_chamada TIMESTAMPTZ,
  cd_senha VARCHAR(20) NOT NULL,
  cd_classificacao_id INTEGER REFERENCES public.mnct_classificacao_risco(id),
  tp_status VARCHAR(20) NOT NULL DEFAULT 'AGUARDANDO'
    CHECK (tp_status IN ('AGUARDANDO', 'CHAMADO', 'EM_TRIAGEM', 'TRIADO', 'DESISTIU')),
  ds_queixa_inicial TEXT,
  cd_cor_hex VARCHAR(7),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.triagem_fila
  ADD COLUMN IF NOT EXISTS dt_senha DATE,
  ADD COLUMN IF NOT EXISTS cd_appointment BIGINT REFERENCES public.appointments(id),
  ADD COLUMN IF NOT EXISTS cd_usuario_chamada UUID,
  ADD COLUMN IF NOT EXISTS enqueue_idempotency_key UUID,
  ADD COLUMN IF NOT EXISTS enqueue_request_hash TEXT,
  ADD COLUMN IF NOT EXISTS enqueue_response_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS call_idempotency_key UUID,
  ADD COLUMN IF NOT EXISTS call_request_hash TEXT,
  ADD COLUMN IF NOT EXISTS call_response_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp();

ALTER TABLE public.triagens
  ADD COLUMN IF NOT EXISTS cd_triagem_fila BIGINT REFERENCES public.triagem_fila(id),
  ADD COLUMN IF NOT EXISTS cd_nivel_consciencia VARCHAR(20),
  ADD COLUMN IF NOT EXISTS completion_idempotency_key UUID,
  ADD COLUMN IF NOT EXISTS completion_request_hash TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp();

ALTER TABLE public.news2_avaliacoes
  ADD COLUMN IF NOT EXISTS completion_idempotency_key UUID,
  ADD COLUMN IF NOT EXISTS request_hash TEXT;

CREATE TABLE IF NOT EXISTS public.nursing_triage_daily_counters (
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  ticket_date DATE NOT NULL,
  last_number INTEGER NOT NULL CHECK (last_number > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (company_id, ticket_date)
);

CREATE TABLE IF NOT EXISTS public.nursing_triage_audit_events (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  queue_id BIGINT NOT NULL REFERENCES public.triagem_fila(id),
  triage_id BIGINT REFERENCES public.triagens(id),
  actor_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('ENQUEUED', 'CALLED', 'COMPLETED')),
  idempotency_key UUID NOT NULL,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT nursing_triage_audit_idempotency_uq UNIQUE (company_id, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS triagem_fila_enqueue_idempotency_uq
  ON public.triagem_fila(company_id, enqueue_idempotency_key)
  WHERE enqueue_idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS triagem_fila_call_idempotency_uq
  ON public.triagem_fila(company_id, call_idempotency_key)
  WHERE call_idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS triagem_fila_daily_ticket_uq
  ON public.triagem_fila(company_id, dt_senha, cd_senha)
  WHERE dt_senha IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS triagens_queue_uq
  ON public.triagens(company_id, cd_triagem_fila)
  WHERE cd_triagem_fila IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS triagens_completion_idempotency_uq
  ON public.triagens(company_id, completion_idempotency_key)
  WHERE completion_idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS news2_completion_idempotency_uq
  ON public.news2_avaliacoes(company_id, completion_idempotency_key)
  WHERE completion_idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS appointments_company_id_triage_uq
  ON public.appointments(company_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS triagem_fila_company_id_uq
  ON public.triagem_fila(company_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS triagens_company_id_uq
  ON public.triagens(company_id, id);
CREATE INDEX IF NOT EXISTS triagem_fila_tenant_status_time_idx
  ON public.triagem_fila(company_id, tp_status, dt_chegada);
CREATE INDEX IF NOT EXISTS triagens_tenant_patient_time_idx
  ON public.triagens(company_id, cd_paciente, dt_triagem DESC);
CREATE INDEX IF NOT EXISTS news2_tenant_triage_idx
  ON public.news2_avaliacoes(company_id, cd_triagem);

-- Composite FKs enforce tenant integrity even for privileged/internal writers.
-- They start NOT VALID so legacy inconsistencies never make this additive
-- migration destructive. The validation block upgrades every clean constraint;
-- any remaining NOTICE names a legacy remediation item for a later data audit.
DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.triagem_fila'::REGCLASS AND conname='triagem_fila_tenant_patient_fkey') THEN
    ALTER TABLE public.triagem_fila ADD CONSTRAINT triagem_fila_tenant_patient_fkey
      FOREIGN KEY (company_id, cd_paciente) REFERENCES public.patients(company_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.triagem_fila'::REGCLASS AND conname='triagem_fila_tenant_appointment_fkey') THEN
    ALTER TABLE public.triagem_fila ADD CONSTRAINT triagem_fila_tenant_appointment_fkey
      FOREIGN KEY (company_id, cd_appointment) REFERENCES public.appointments(company_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.triagens'::REGCLASS AND conname='triagens_tenant_patient_fkey') THEN
    ALTER TABLE public.triagens ADD CONSTRAINT triagens_tenant_patient_fkey
      FOREIGN KEY (company_id, cd_paciente) REFERENCES public.patients(company_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.triagens'::REGCLASS AND conname='triagens_tenant_appointment_fkey') THEN
    ALTER TABLE public.triagens ADD CONSTRAINT triagens_tenant_appointment_fkey
      FOREIGN KEY (company_id, cd_appointment) REFERENCES public.appointments(company_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.triagens'::REGCLASS AND conname='triagens_tenant_queue_fkey') THEN
    ALTER TABLE public.triagens ADD CONSTRAINT triagens_tenant_queue_fkey
      FOREIGN KEY (company_id, cd_triagem_fila) REFERENCES public.triagem_fila(company_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.triagens'::REGCLASS AND conname='triagens_tenant_actor_fkey') THEN
    ALTER TABLE public.triagens ADD CONSTRAINT triagens_tenant_actor_fkey
      FOREIGN KEY (company_id, cd_usuario_enfermeiro) REFERENCES public.user_profiles(company_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.news2_avaliacoes'::REGCLASS AND conname='news2_tenant_triage_fkey') THEN
    ALTER TABLE public.news2_avaliacoes ADD CONSTRAINT news2_tenant_triage_fkey
      FOREIGN KEY (company_id, cd_triagem) REFERENCES public.triagens(company_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.nursing_triage_audit_events'::REGCLASS AND conname='nursing_triage_audit_tenant_queue_fkey') THEN
    ALTER TABLE public.nursing_triage_audit_events ADD CONSTRAINT nursing_triage_audit_tenant_queue_fkey
      FOREIGN KEY (company_id, queue_id) REFERENCES public.triagem_fila(company_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.nursing_triage_audit_events'::REGCLASS AND conname='nursing_triage_audit_tenant_triage_fkey') THEN
    ALTER TABLE public.nursing_triage_audit_events ADD CONSTRAINT nursing_triage_audit_tenant_triage_fkey
      FOREIGN KEY (company_id, triage_id) REFERENCES public.triagens(company_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.nursing_triage_audit_events'::REGCLASS AND conname='nursing_triage_audit_tenant_actor_fkey') THEN
    ALTER TABLE public.nursing_triage_audit_events ADD CONSTRAINT nursing_triage_audit_tenant_actor_fkey
      FOREIGN KEY (company_id, actor_id) REFERENCES public.user_profiles(company_id, id) NOT VALID;
  END IF;
END
$constraints$;

DO $validation$
DECLARE
  v_constraint RECORD;
BEGIN
  FOR v_constraint IN
    SELECT constraint_row.conrelid::REGCLASS AS relation_name, constraint_row.conname
      FROM pg_constraint AS constraint_row
     WHERE constraint_row.conname IN (
       'triagem_fila_tenant_patient_fkey', 'triagem_fila_tenant_appointment_fkey',
       'triagens_tenant_patient_fkey', 'triagens_tenant_appointment_fkey',
       'triagens_tenant_queue_fkey', 'triagens_tenant_actor_fkey',
       'news2_tenant_triage_fkey', 'nursing_triage_audit_tenant_queue_fkey',
       'nursing_triage_audit_tenant_triage_fkey', 'nursing_triage_audit_tenant_actor_fkey'
     ) AND NOT constraint_row.convalidated
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I',
                     v_constraint.relation_name, v_constraint.conname);
    EXCEPTION WHEN foreign_key_violation THEN
      RAISE NOTICE 'Legacy tenant FK remains NOT VALID pending data audit: %.%',
                   v_constraint.relation_name, v_constraint.conname;
    END;
  END LOOP;
END
$validation$;

ALTER TABLE public.mnct_classificacao_risco OWNER TO nursing_data_owner;
ALTER TABLE public.mnct_fluxograma OWNER TO nursing_data_owner;
ALTER TABLE public.triagem_fila OWNER TO nursing_data_owner;
ALTER TABLE public.triagens OWNER TO nursing_data_owner;
ALTER TABLE public.news2_avaliacoes OWNER TO nursing_data_owner;
ALTER TABLE public.nursing_triage_daily_counters OWNER TO nursing_data_owner;
ALTER TABLE public.nursing_triage_audit_events OWNER TO nursing_data_owner;

ALTER TABLE public.mnct_classificacao_risco ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mnct_classificacao_risco FORCE ROW LEVEL SECURITY;
ALTER TABLE public.mnct_fluxograma ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mnct_fluxograma FORCE ROW LEVEL SECURITY;
ALTER TABLE public.triagem_fila ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.triagem_fila FORCE ROW LEVEL SECURITY;
ALTER TABLE public.triagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.triagens FORCE ROW LEVEL SECURITY;
ALTER TABLE public.news2_avaliacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.news2_avaliacoes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.nursing_triage_daily_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nursing_triage_daily_counters FORCE ROW LEVEL SECURITY;
ALTER TABLE public.nursing_triage_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nursing_triage_audit_events FORCE ROW LEVEL SECURITY;

-- Legacy ALL policies are neutralized at both the policy and ACL layers.
DROP POLICY IF EXISTS "Nursing staff can manage triagens" ON public.triagens;
DROP POLICY IF EXISTS "Nursing staff can manage news2" ON public.news2_avaliacoes;
DROP POLICY IF EXISTS "Staff can manage fila" ON public.triagem_fila;
DROP POLICY IF EXISTS "Users can read triagens from their company" ON public.triagens;
DROP POLICY IF EXISTS "Users can read news2 from their company" ON public.news2_avaliacoes;
DROP POLICY IF EXISTS "Users can read fila from their company" ON public.triagem_fila;
DROP POLICY IF EXISTS "Authenticated can read nursing classifications" ON public.mnct_classificacao_risco;
DROP POLICY IF EXISTS "Authenticated can read flowcharts" ON public.mnct_fluxograma;

DO $legacy_rpc$
BEGIN
  IF to_regprocedure('public.gerar_senha_triagem(uuid)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.gerar_senha_triagem(UUID)
      FROM PUBLIC, anon, authenticated, service_role;
  END IF;
END
$legacy_rpc$;

DROP POLICY IF EXISTS nursing_triage_classification_select ON public.mnct_classificacao_risco;
CREATE POLICY nursing_triage_classification_select ON public.mnct_classificacao_risco
  FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (company_id IS NULL OR company_id = (SELECT public.current_company_id()))
    AND (SELECT public.nursing_has_permission_secure('view'))
  );
DROP POLICY IF EXISTS nursing_triage_flowchart_select ON public.mnct_fluxograma;
CREATE POLICY nursing_triage_flowchart_select ON public.mnct_fluxograma
  FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (company_id IS NULL OR company_id = (SELECT public.current_company_id()))
    AND (SELECT public.nursing_has_permission_secure('view'))
  );
DROP POLICY IF EXISTS nursing_triage_queue_select ON public.triagem_fila;
CREATE POLICY nursing_triage_queue_select ON public.triagem_fila
  FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND company_id = (SELECT public.current_company_id())
    AND (SELECT public.nursing_has_permission_secure('view'))
  );
DROP POLICY IF EXISTS nursing_triage_record_select ON public.triagens;
CREATE POLICY nursing_triage_record_select ON public.triagens
  FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND company_id = (SELECT public.current_company_id())
    AND (SELECT public.nursing_has_permission_secure('view'))
  );
DROP POLICY IF EXISTS nursing_triage_news2_select ON public.news2_avaliacoes;
CREATE POLICY nursing_triage_news2_select ON public.news2_avaliacoes
  FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND company_id = (SELECT public.current_company_id())
    AND (SELECT public.nursing_has_permission_secure('view'))
  );

DROP POLICY IF EXISTS nursing_triage_rpc_classification_lookup ON public.mnct_classificacao_risco;
CREATE POLICY nursing_triage_rpc_classification_lookup ON public.mnct_classificacao_risco
  FOR SELECT TO nursing_rpc_owner
  USING (lg_ativo AND (company_id IS NULL OR company_id = (SELECT public.current_company_id())));
DROP POLICY IF EXISTS nursing_triage_rpc_appointment_lookup ON public.appointments;
CREATE POLICY nursing_triage_rpc_appointment_lookup ON public.appointments
  FOR SELECT TO nursing_rpc_owner
  USING (company_id = (SELECT public.current_company_id()));
DROP POLICY IF EXISTS nursing_triage_rpc_queue_internal ON public.triagem_fila;
CREATE POLICY nursing_triage_rpc_queue_internal ON public.triagem_fila
  FOR ALL TO nursing_rpc_owner
  USING (company_id = (SELECT public.current_company_id()))
  WITH CHECK (company_id = (SELECT public.current_company_id()));
DROP POLICY IF EXISTS nursing_triage_rpc_record_internal ON public.triagens;
CREATE POLICY nursing_triage_rpc_record_internal ON public.triagens
  FOR ALL TO nursing_rpc_owner
  USING (company_id = (SELECT public.current_company_id()))
  WITH CHECK (company_id = (SELECT public.current_company_id()));
DROP POLICY IF EXISTS nursing_triage_rpc_news2_internal ON public.news2_avaliacoes;
CREATE POLICY nursing_triage_rpc_news2_internal ON public.news2_avaliacoes
  FOR ALL TO nursing_rpc_owner
  USING (company_id = (SELECT public.current_company_id()))
  WITH CHECK (company_id = (SELECT public.current_company_id()));
DROP POLICY IF EXISTS nursing_triage_rpc_counter_internal ON public.nursing_triage_daily_counters;
CREATE POLICY nursing_triage_rpc_counter_internal ON public.nursing_triage_daily_counters
  FOR ALL TO nursing_rpc_owner
  USING (company_id = (SELECT public.current_company_id()))
  WITH CHECK (company_id = (SELECT public.current_company_id()));
DROP POLICY IF EXISTS nursing_triage_rpc_audit_internal ON public.nursing_triage_audit_events;
CREATE POLICY nursing_triage_rpc_audit_internal ON public.nursing_triage_audit_events
  FOR ALL TO nursing_rpc_owner
  USING (company_id = (SELECT public.current_company_id()))
  WITH CHECK (company_id = (SELECT public.current_company_id()));

-- The NOLOGIN data owner gets only the read visibility required by integrity
-- triggers. FORCE RLS remains effective for every other access path.
DROP POLICY IF EXISTS nursing_data_classification_integrity ON public.mnct_classificacao_risco;
CREATE POLICY nursing_data_classification_integrity ON public.mnct_classificacao_risco
  FOR SELECT TO nursing_data_owner USING (TRUE);
DROP POLICY IF EXISTS nursing_data_queue_integrity ON public.triagem_fila;
CREATE POLICY nursing_data_queue_integrity ON public.triagem_fila
  FOR SELECT TO nursing_data_owner USING (TRUE);
DROP POLICY IF EXISTS nursing_data_triage_integrity ON public.triagens;
CREATE POLICY nursing_data_triage_integrity ON public.triagens
  FOR SELECT TO nursing_data_owner USING (TRUE);

CREATE OR REPLACE FUNCTION public.nursing_classification_tenant_ref_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_classification_id INTEGER := NEW.cd_classificacao_id;
BEGIN
  IF v_classification_id IS NULL THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'nursing-classification:' || v_classification_id::TEXT, 0
  ));
  IF NOT EXISTS (
    SELECT 1 FROM public.mnct_classificacao_risco AS classification
     WHERE classification.id = v_classification_id
       AND (classification.company_id IS NULL OR classification.company_id = NEW.company_id)
  ) THEN
    RAISE EXCEPTION 'Classificacao privada nao pertence ao tenant da linha'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.nursing_classification_tenant_update_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_classification_id INTEGER := NEW.id;
BEGIN
  IF NEW.company_id IS NOT DISTINCT FROM OLD.company_id THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'nursing-classification:' || v_classification_id::TEXT, 0
  ));
  IF NEW.company_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
       SELECT 1 FROM public.triagem_fila AS queue_row
        WHERE queue_row.cd_classificacao_id = v_classification_id
          AND queue_row.company_id <> NEW.company_id
     ) OR EXISTS (
       SELECT 1 FROM public.triagens AS triage_row
        WHERE triage_row.cd_classificacao_id = v_classification_id
          AND triage_row.company_id <> NEW.company_id
     ) THEN
    RAISE EXCEPTION 'Classificacao referenciada nao pode mudar para outro tenant'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.nursing_triage_snapshot_immutable_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  IF OLD.enqueue_response_snapshot IS NOT NULL
     AND NEW.enqueue_response_snapshot IS DISTINCT FROM OLD.enqueue_response_snapshot THEN
    RAISE EXCEPTION 'Snapshot idempotente de enqueue e imutavel'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.call_response_snapshot IS NOT NULL
     AND NEW.call_response_snapshot IS DISTINCT FROM OLD.call_response_snapshot THEN
    RAISE EXCEPTION 'Snapshot idempotente de chamada e imutavel'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.nursing_classification_tenant_ref_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.nursing_classification_tenant_update_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.nursing_triage_snapshot_immutable_guard() FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION public.nursing_classification_tenant_ref_guard() OWNER TO nursing_data_owner;
ALTER FUNCTION public.nursing_classification_tenant_update_guard() OWNER TO nursing_data_owner;
ALTER FUNCTION public.nursing_triage_snapshot_immutable_guard() OWNER TO nursing_data_owner;

DROP TRIGGER IF EXISTS triagem_fila_classification_tenant_guard ON public.triagem_fila;
CREATE TRIGGER triagem_fila_classification_tenant_guard
  BEFORE INSERT OR UPDATE ON public.triagem_fila
  FOR EACH ROW EXECUTE FUNCTION public.nursing_classification_tenant_ref_guard();
DROP TRIGGER IF EXISTS triagens_classification_tenant_guard ON public.triagens;
CREATE TRIGGER triagens_classification_tenant_guard
  BEFORE INSERT OR UPDATE ON public.triagens
  FOR EACH ROW EXECUTE FUNCTION public.nursing_classification_tenant_ref_guard();
DROP TRIGGER IF EXISTS classification_reference_tenant_guard ON public.mnct_classificacao_risco;
CREATE TRIGGER classification_reference_tenant_guard
  BEFORE UPDATE ON public.mnct_classificacao_risco
  FOR EACH ROW EXECUTE FUNCTION public.nursing_classification_tenant_update_guard();
DROP TRIGGER IF EXISTS triagem_fila_snapshot_immutable_guard ON public.triagem_fila;
CREATE TRIGGER triagem_fila_snapshot_immutable_guard
  BEFORE UPDATE ON public.triagem_fila
  FOR EACH ROW EXECUTE FUNCTION public.nursing_triage_snapshot_immutable_guard();

GRANT SELECT ON public.patients, public.appointments, public.mnct_classificacao_risco TO nursing_rpc_owner;
GRANT SELECT, INSERT, UPDATE ON public.triagem_fila, public.triagens,
  public.news2_avaliacoes, public.nursing_triage_daily_counters,
  public.nursing_triage_audit_events TO nursing_rpc_owner;
GRANT USAGE, SELECT ON SEQUENCE public.triagem_fila_id_seq,
  public.triagens_id_seq, public.news2_avaliacoes_id_seq,
  public.nursing_triage_audit_events_id_seq TO nursing_rpc_owner;

CREATE OR REPLACE FUNCTION public.enqueue_nursing_triage_secure(
  p_patient_id BIGINT,
  p_initial_complaint TEXT,
  p_classification_id INTEGER,
  p_idempotency_key UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_actor UUID;
  v_company UUID;
  v_hash TEXT;
  v_ticket_date DATE := (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::DATE;
  v_number INTEGER;
  v_existing public.triagem_fila;
  v_row public.triagem_fila;
  v_classification public.mnct_classificacao_risco;
  v_response JSONB;
BEGIN
  SELECT actor_id, company_id INTO v_actor, v_company
    FROM public.nursing_actor_context_secure('create');
  IF p_patient_id IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Paciente e chave idempotente sao obrigatorios';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.patients
     WHERE company_id = v_company AND id = p_patient_id AND lg_ativo
  ) THEN
    RAISE EXCEPTION 'Paciente inexistente ou fora do tenant do ator';
  END IF;
  IF p_classification_id IS NOT NULL THEN
    SELECT * INTO v_classification FROM public.mnct_classificacao_risco
     WHERE id = p_classification_id AND lg_ativo
       AND (company_id IS NULL OR company_id = v_company);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Classificacao inexistente, inativa ou fora do tenant do ator';
    END IF;
  END IF;

  v_hash := encode(public.digest(jsonb_build_object(
    'patient_id', p_patient_id,
    'classification_id', p_classification_id,
    'initial_complaint', NULLIF(btrim(COALESCE(p_initial_complaint, '')), '')
  )::TEXT, 'sha256'), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'nursing-triage-enqueue:' || v_company::TEXT || ':' || p_idempotency_key::TEXT, 0
  ));
  SELECT * INTO v_existing
    FROM public.triagem_fila
   WHERE company_id = v_company AND enqueue_idempotency_key = p_idempotency_key
   FOR UPDATE;
  IF FOUND THEN
    IF v_existing.enqueue_request_hash IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'Chave idempotente de triagem reutilizada com payload diferente';
    END IF;
    IF v_existing.enqueue_response_snapshot IS NULL THEN
      RAISE EXCEPTION 'Snapshot idempotente de enqueue ausente';
    END IF;
    RETURN v_existing.enqueue_response_snapshot;
  END IF;

  -- This tenant/day lock serializes both the legacy maximum lookup and the
  -- counter upsert. The partial unique index is the final collision barrier.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'nursing-triage-ticket:' || v_company::TEXT || ':' || v_ticket_date::TEXT, 0
  ));
  SELECT GREATEST(
           COALESCE((
             SELECT last_number FROM public.nursing_triage_daily_counters
              WHERE company_id = v_company AND ticket_date = v_ticket_date
           ), 0),
           COALESCE((
             SELECT max(substring(cd_senha FROM 2)::INTEGER)
               FROM public.triagem_fila
              WHERE company_id = v_company
                AND (dt_chegada AT TIME ZONE 'America/Sao_Paulo')::DATE = v_ticket_date
                AND cd_senha ~ '^T[0-9]+$'
           ), 0)
         ) + 1
    INTO v_number;
  INSERT INTO public.nursing_triage_daily_counters(company_id, ticket_date, last_number)
  VALUES (v_company, v_ticket_date, v_number)
  ON CONFLICT (company_id, ticket_date) DO UPDATE
    SET last_number = EXCLUDED.last_number, updated_at = clock_timestamp();

  INSERT INTO public.triagem_fila(
    company_id, cd_paciente, dt_chegada, dt_senha, cd_senha,
    cd_classificacao_id, cd_cor_hex, tp_status, ds_queixa_inicial,
    enqueue_idempotency_key, enqueue_request_hash, created_at, updated_at
  ) VALUES (
    v_company, p_patient_id, clock_timestamp(), v_ticket_date,
    'T' || lpad(v_number::TEXT, 3, '0'), p_classification_id,
    v_classification.cd_cor_hex, 'AGUARDANDO',
    NULLIF(btrim(COALESCE(p_initial_complaint, '')), ''), p_idempotency_key,
    v_hash, clock_timestamp(), clock_timestamp()
  ) RETURNING * INTO v_row;

  v_response := to_jsonb(v_row) - ARRAY[
    'enqueue_request_hash', 'call_request_hash',
    'enqueue_response_snapshot', 'call_response_snapshot'
  ];
  UPDATE public.triagem_fila
     SET enqueue_response_snapshot = v_response
   WHERE id = v_row.id;

  INSERT INTO public.nursing_triage_audit_events(
    company_id, queue_id, actor_id, action, idempotency_key, request_hash, details
  ) VALUES (
    v_company, v_row.id, v_actor, 'ENQUEUED', p_idempotency_key, v_hash,
    jsonb_build_object('patient_id', p_patient_id, 'classification_id', p_classification_id,
                       'ticket', v_row.cd_senha, 'ticket_date', v_ticket_date)
  );
  RETURN v_response;
END
$function$;

CREATE OR REPLACE FUNCTION public.call_nursing_triage_secure(
  p_queue_id BIGINT,
  p_idempotency_key UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_actor UUID;
  v_company UUID;
  v_hash TEXT;
  v_queue public.triagem_fila;
  v_response JSONB;
BEGIN
  SELECT actor_id, company_id INTO v_actor, v_company
    FROM public.nursing_actor_context_secure('edit');
  IF p_queue_id IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Fila e chave idempotente sao obrigatorias';
  END IF;
  v_hash := encode(public.digest(
    jsonb_build_object('queue_id', p_queue_id)::TEXT, 'sha256'
  ), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'nursing-triage-call:' || v_company::TEXT || ':' || p_idempotency_key::TEXT, 0
  ));
  IF EXISTS (
    SELECT 1 FROM public.triagem_fila
     WHERE company_id = v_company AND call_idempotency_key = p_idempotency_key
       AND id <> p_queue_id
  ) THEN
    RAISE EXCEPTION 'Chave idempotente de chamada ja usada em outra fila';
  END IF;
  SELECT * INTO v_queue FROM public.triagem_fila
   WHERE company_id = v_company AND id = p_queue_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fila de triagem inexistente ou fora do tenant do ator';
  END IF;
  IF v_queue.call_idempotency_key = p_idempotency_key THEN
    IF v_queue.call_request_hash IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'Chave idempotente de triagem reutilizada com payload diferente';
    END IF;
    IF v_queue.call_response_snapshot IS NULL THEN
      RAISE EXCEPTION 'Snapshot idempotente de chamada ausente';
    END IF;
    RETURN v_queue.call_response_snapshot;
  END IF;
  IF v_queue.tp_status <> 'AGUARDANDO' THEN
    RAISE EXCEPTION 'Transicao de chamada exige fila AGUARDANDO';
  END IF;
  UPDATE public.triagem_fila
     SET tp_status = 'CHAMADO', dt_chamada = clock_timestamp(),
         cd_usuario_chamada = v_actor, call_idempotency_key = p_idempotency_key,
         call_request_hash = v_hash, updated_at = clock_timestamp()
   WHERE id = v_queue.id RETURNING * INTO v_queue;
  v_response := to_jsonb(v_queue) - ARRAY[
    'enqueue_request_hash', 'call_request_hash',
    'enqueue_response_snapshot', 'call_response_snapshot'
  ];
  UPDATE public.triagem_fila
     SET call_response_snapshot = v_response
   WHERE id = v_queue.id;
  INSERT INTO public.nursing_triage_audit_events(
    company_id, queue_id, actor_id, action, idempotency_key, request_hash, details
  ) VALUES (
    v_company, v_queue.id, v_actor, 'CALLED', p_idempotency_key, v_hash,
    jsonb_build_object('ticket', v_queue.cd_senha, 'patient_id', v_queue.cd_paciente)
  );
  RETURN v_response;
END
$function$;

CREATE OR REPLACE FUNCTION public.complete_nursing_triage_secure(
  p_queue_id BIGINT,
  p_appointment_id BIGINT,
  p_classification_id INTEGER,
  p_triage JSONB,
  p_idempotency_key UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_actor UUID;
  v_company UUID;
  v_hash TEXT;
  v_systolic INTEGER;
  v_diastolic INTEGER;
  v_heart_rate INTEGER;
  v_respiratory_rate INTEGER;
  v_temperature NUMERIC;
  v_oxygen_saturation INTEGER;
  v_glucose INTEGER;
  v_pain_scale INTEGER;
  v_weight_kg NUMERIC;
  v_height_cm NUMERIC;
  v_glasgow_ocular INTEGER;
  v_glasgow_verbal INTEGER;
  v_glasgow_motor INTEGER;
  v_consciousness TEXT;
  v_queue public.triagem_fila;
  v_existing public.triagens;
  v_triage public.triagens;
  v_news public.news2_avaliacoes;
  v_classification public.mnct_classificacao_risco;
  v_rr SMALLINT;
  v_spo2 SMALLINT;
  v_temp SMALLINT;
  v_sbp SMALLINT;
  v_hr SMALLINT;
  v_cns SMALLINT;
  v_total SMALLINT;
  v_risk TEXT;
BEGIN
  SELECT actor_id, company_id INTO v_actor, v_company
    FROM public.nursing_actor_context_secure('edit');
  IF p_queue_id IS NULL OR p_classification_id IS NULL
     OR p_idempotency_key IS NULL OR p_triage IS NULL
     OR jsonb_typeof(p_triage) <> 'object'
     OR jsonb_typeof(p_triage->'sinais_vitais') <> 'object' THEN
    RAISE EXCEPTION 'Fila, classificacao, triagem e chave idempotente sao obrigatorios';
  END IF;
  IF COALESCE(p_triage->>'status', 'TRIADO') <> 'TRIADO' THEN
    RAISE EXCEPTION 'Conclusao segura aceita somente status TRIADO';
  END IF;

  BEGIN
    v_systolic := NULLIF(p_triage#>>'{sinais_vitais,pressaoSistolica}', '')::INTEGER;
    v_diastolic := NULLIF(p_triage#>>'{sinais_vitais,pressaoDiastolica}', '')::INTEGER;
    v_heart_rate := NULLIF(p_triage#>>'{sinais_vitais,frequenciaCardiaca}', '')::INTEGER;
    v_respiratory_rate := NULLIF(p_triage#>>'{sinais_vitais,frequenciaRespiratoria}', '')::INTEGER;
    v_temperature := NULLIF(p_triage#>>'{sinais_vitais,temperatura}', '')::NUMERIC;
    v_oxygen_saturation := NULLIF(p_triage#>>'{sinais_vitais,saturacaoO2}', '')::INTEGER;
    v_glucose := NULLIF(p_triage#>>'{sinais_vitais,glicemia}', '')::INTEGER;
    v_pain_scale := NULLIF(p_triage#>>'{sinais_vitais,escalaDor}', '')::INTEGER;
    v_weight_kg := NULLIF(p_triage#>>'{antropometria,pesoKg}', '')::NUMERIC;
    v_height_cm := NULLIF(p_triage#>>'{antropometria,alturaCm}', '')::NUMERIC;
    v_glasgow_ocular := NULLIF(p_triage#>>'{glasgow,ocular}', '')::INTEGER;
    v_glasgow_verbal := NULLIF(p_triage#>>'{glasgow,verbal}', '')::INTEGER;
    v_glasgow_motor := NULLIF(p_triage#>>'{glasgow,motor}', '')::INTEGER;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'Sinais vitais, antropometria ou Glasgow devem ser numericos';
  END;
  v_consciousness := upper(btrim(COALESCE(
    p_triage->>'nivel_consciencia',
    p_triage->>'nivelConsciencia',
    p_triage#>>'{sinais_vitais,nivelConsciencia}',
    ''
  )));
  IF v_consciousness = ''
     AND v_glasgow_ocular IS NOT NULL
     AND v_glasgow_verbal IS NOT NULL
     AND v_glasgow_motor IS NOT NULL THEN
    v_consciousness := CASE
      WHEN v_glasgow_ocular + v_glasgow_verbal + v_glasgow_motor = 15 THEN 'A'
      ELSE 'C'
    END;
  END IF;
  IF v_systolic IS NULL OR v_diastolic IS NULL OR v_heart_rate IS NULL
     OR v_respiratory_rate IS NULL OR v_temperature IS NULL
     OR v_oxygen_saturation IS NULL OR v_consciousness = '' THEN
    RAISE EXCEPTION 'Sinais obrigatorios do NEWS2 ausentes na triagem';
  END IF;
  IF v_systolic NOT BETWEEN 1 AND 300 OR v_diastolic NOT BETWEEN 1 AND 200
     OR v_diastolic >= v_systolic OR v_heart_rate NOT BETWEEN 1 AND 250
     OR v_respiratory_rate NOT BETWEEN 1 AND 80
     OR v_temperature NOT BETWEEN 20.0 AND 45.0
     OR v_oxygen_saturation NOT BETWEEN 1 AND 100
     OR v_consciousness NOT IN ('A', 'C', 'V', 'P', 'U')
     OR (v_glucose IS NOT NULL AND v_glucose NOT BETWEEN 0 AND 700)
     OR (v_pain_scale IS NOT NULL AND v_pain_scale NOT BETWEEN 0 AND 10)
     OR (v_weight_kg IS NOT NULL AND v_weight_kg NOT BETWEEN 0.01 AND 500)
     OR (v_height_cm IS NOT NULL AND v_height_cm NOT BETWEEN 1 AND 250)
     OR ((v_glasgow_ocular IS NOT NULL OR v_glasgow_verbal IS NOT NULL OR v_glasgow_motor IS NOT NULL)
         AND (v_glasgow_ocular IS NULL OR v_glasgow_verbal IS NULL OR v_glasgow_motor IS NULL))
     OR ((v_glasgow_ocular IS NOT NULL OR v_glasgow_verbal IS NOT NULL OR v_glasgow_motor IS NOT NULL)
         AND (v_glasgow_ocular NOT BETWEEN 1 AND 4
              OR v_glasgow_verbal NOT BETWEEN 1 AND 5
              OR v_glasgow_motor NOT BETWEEN 1 AND 6)) THEN
    RAISE EXCEPTION 'Sinais vitais ou antropometria invalidos para triagem';
  END IF;

  v_hash := encode(public.digest(jsonb_build_object(
    'queue_id', p_queue_id, 'appointment_id', p_appointment_id,
    'classification_id', p_classification_id, 'triage', p_triage
  )::TEXT, 'sha256'), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'nursing-triage-complete:' || v_company::TEXT || ':' || p_idempotency_key::TEXT, 0
  ));

  SELECT * INTO v_existing FROM public.triagens
   WHERE company_id = v_company AND completion_idempotency_key = p_idempotency_key
   FOR UPDATE;
  IF FOUND THEN
    IF v_existing.cd_triagem_fila IS DISTINCT FROM p_queue_id
       OR v_existing.completion_request_hash IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'Chave idempotente de triagem reutilizada com payload diferente';
    END IF;
    SELECT * INTO v_news FROM public.news2_avaliacoes
     WHERE company_id = v_company AND completion_idempotency_key = p_idempotency_key;
    SELECT * INTO v_queue FROM public.triagem_fila
     WHERE company_id = v_company AND id = p_queue_id;
    RETURN jsonb_build_object(
      'triage', to_jsonb(v_existing) - ARRAY['completion_request_hash'],
      'news2', to_jsonb(v_news) - ARRAY['request_hash'],
      'queue_item', to_jsonb(v_queue) - ARRAY[
        'enqueue_request_hash', 'call_request_hash',
        'enqueue_response_snapshot', 'call_response_snapshot'
      ]
    );
  END IF;

  SELECT * INTO v_queue FROM public.triagem_fila
   WHERE company_id = v_company AND id = p_queue_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fila de triagem inexistente ou fora do tenant do ator';
  END IF;
  IF v_queue.tp_status NOT IN ('CHAMADO', 'EM_TRIAGEM') THEN
    RAISE EXCEPTION 'Conclusao exige fila CHAMADO ou EM_TRIAGEM';
  END IF;
  IF v_queue.cd_classificacao_id IS NOT NULL
     AND v_queue.cd_classificacao_id <> p_classification_id THEN
    RAISE EXCEPTION 'Classificacao informada diverge da classificacao da fila';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.patients
     WHERE company_id = v_company AND id = v_queue.cd_paciente AND lg_ativo
  ) THEN
    RAISE EXCEPTION 'Paciente da fila inexistente, inativo ou fora do tenant do ator';
  END IF;
  IF p_appointment_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.appointments
       WHERE company_id = v_company AND id = p_appointment_id
         AND patient_id = v_queue.cd_paciente
    ) OR (v_queue.cd_appointment IS NOT NULL AND v_queue.cd_appointment <> p_appointment_id) THEN
      RAISE EXCEPTION 'Agendamento nao pertence ao paciente e tenant da fila';
    END IF;
  END IF;
  SELECT * INTO v_classification FROM public.mnct_classificacao_risco
   WHERE id = p_classification_id AND lg_ativo
     AND (company_id IS NULL OR company_id = v_company);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Classificacao inexistente, inativa ou fora do tenant do ator';
  END IF;

  v_rr := CASE WHEN v_respiratory_rate <= 8 THEN 3 WHEN v_respiratory_rate <= 11 THEN 1
               WHEN v_respiratory_rate <= 20 THEN 0 WHEN v_respiratory_rate <= 24 THEN 2 ELSE 3 END;
  v_spo2 := CASE WHEN v_oxygen_saturation <= 91 THEN 3 WHEN v_oxygen_saturation <= 93 THEN 2
                 WHEN v_oxygen_saturation <= 95 THEN 1 ELSE 0 END;
  v_temp := CASE WHEN v_temperature <= 35.0 THEN 3 WHEN v_temperature <= 36.0 THEN 1
                 WHEN v_temperature <= 38.0 THEN 0 WHEN v_temperature <= 39.0 THEN 1 ELSE 2 END;
  v_sbp := CASE WHEN v_systolic <= 90 THEN 3 WHEN v_systolic <= 100 THEN 2
                WHEN v_systolic <= 110 THEN 1 WHEN v_systolic <= 219 THEN 0 ELSE 3 END;
  v_hr := CASE WHEN v_heart_rate <= 40 THEN 3 WHEN v_heart_rate <= 50 THEN 1
               WHEN v_heart_rate <= 90 THEN 0 WHEN v_heart_rate <= 110 THEN 1
               WHEN v_heart_rate <= 130 THEN 2 ELSE 3 END;
  v_cns := CASE WHEN v_consciousness = 'A' THEN 0 ELSE 3 END;
  v_total := v_rr + v_spo2 + v_temp + v_sbp + v_hr + v_cns;
  v_risk := CASE WHEN v_total >= 7 THEN 'ALTO'
                 WHEN v_total >= 5 OR 3 IN (v_rr, v_spo2, v_temp, v_sbp, v_hr, v_cns) THEN 'MEDIO'
                 ELSE 'BAIXO' END;

  INSERT INTO public.triagens(
    company_id, cd_paciente, cd_appointment, cd_triagem_fila, dt_triagem,
    cd_classificacao_id, cd_usuario_enfermeiro, vl_pressao_sistolica,
    vl_pressao_diastolica, vl_frequencia_cardiaca, vl_frequencia_respiratoria,
    vl_temperatura, vl_saturacao_o2, vl_glicemia, vl_escala_dor, vl_peso_kg, vl_altura_cm,
    vl_glasgow_ocular, vl_glasgow_verbal, vl_glasgow_motor,
    cd_nivel_consciencia, ds_queixa_principal, ds_historia_doenca_atual,
    ds_medicamentos_uso, ds_alergias, ds_observacoes_enfermagem, tp_status,
    completion_idempotency_key, completion_request_hash, created_at, updated_at
  ) VALUES (
    v_company, v_queue.cd_paciente, p_appointment_id, v_queue.id, clock_timestamp(),
    p_classification_id, v_actor, v_systolic, v_diastolic, v_heart_rate,
    v_respiratory_rate, v_temperature, v_oxygen_saturation, v_glucose, v_pain_scale,
    v_weight_kg, v_height_cm, v_glasgow_ocular, v_glasgow_verbal, v_glasgow_motor,
    v_consciousness, COALESCE(NULLIF(btrim(COALESCE(p_triage->>'queixa_principal', '')), ''), v_queue.ds_queixa_inicial),
    NULLIF(btrim(COALESCE(p_triage->>'historia_doenca_atual', '')), ''),
    NULLIF(btrim(COALESCE(p_triage->>'medicamentos_uso', '')), ''),
    NULLIF(btrim(COALESCE(p_triage->>'alergias', '')), ''),
    NULLIF(btrim(COALESCE(p_triage->>'observacoes_enfermagem', '')), ''), 'TRIADO',
    p_idempotency_key, v_hash, clock_timestamp(), clock_timestamp()
  ) RETURNING * INTO v_triage;

  INSERT INTO public.news2_avaliacoes(
    company_id, cd_triagem, nr_frequencia_respiratoria, nr_saturacao_o2,
    nr_temperatura, nr_pressao_sistolica, nr_frequencia_cardiaca,
    nr_nivel_consciencia, cd_classificacao_risco, dt_avaliacao,
    completion_idempotency_key, request_hash
  ) VALUES (
    v_company, v_triage.id, v_rr, v_spo2, v_temp, v_sbp, v_hr, v_cns,
    v_risk, clock_timestamp(), p_idempotency_key, v_hash
  ) RETURNING * INTO v_news;

  UPDATE public.triagem_fila
     SET tp_status = 'TRIADO', cd_appointment = p_appointment_id,
         cd_classificacao_id = p_classification_id,
         cd_cor_hex = v_classification.cd_cor_hex, updated_at = clock_timestamp()
   WHERE id = v_queue.id RETURNING * INTO v_queue;
  INSERT INTO public.nursing_triage_audit_events(
    company_id, queue_id, triage_id, actor_id, action,
    idempotency_key, request_hash, details
  ) VALUES (
    v_company, v_queue.id, v_triage.id, v_actor, 'COMPLETED',
    p_idempotency_key, v_hash,
    jsonb_build_object('patient_id', v_queue.cd_paciente,
                       'appointment_id', p_appointment_id,
                       'classification_id', p_classification_id,
                       'news2_score', v_total, 'news2_risk', v_risk)
  );
  RETURN jsonb_build_object(
    'triage', to_jsonb(v_triage) - ARRAY['completion_request_hash'],
    'news2', to_jsonb(v_news) - ARRAY['request_hash'],
    'queue_item', to_jsonb(v_queue) - ARRAY[
      'enqueue_request_hash', 'call_request_hash',
      'enqueue_response_snapshot', 'call_response_snapshot'
    ]
  );
END
$function$;

REVOKE ALL ON FUNCTION public.enqueue_nursing_triage_secure(BIGINT,TEXT,INTEGER,UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.call_nursing_triage_secure(BIGINT,UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_nursing_triage_secure(BIGINT,BIGINT,INTEGER,JSONB,UUID)
  FROM PUBLIC, anon, authenticated, service_role;

ALTER FUNCTION public.enqueue_nursing_triage_secure(BIGINT,TEXT,INTEGER,UUID)
  OWNER TO nursing_rpc_owner;
ALTER FUNCTION public.call_nursing_triage_secure(BIGINT,UUID)
  OWNER TO nursing_rpc_owner;
ALTER FUNCTION public.complete_nursing_triage_secure(BIGINT,BIGINT,INTEGER,JSONB,UUID)
  OWNER TO nursing_rpc_owner;

GRANT EXECUTE ON FUNCTION public.enqueue_nursing_triage_secure(BIGINT,TEXT,INTEGER,UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.call_nursing_triage_secure(BIGINT,UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_nursing_triage_secure(BIGINT,BIGINT,INTEGER,JSONB,UUID)
  TO authenticated;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.mnct_classificacao_risco,
  public.mnct_fluxograma, public.triagem_fila, public.triagens, public.news2_avaliacoes,
  public.nursing_triage_daily_counters, public.nursing_triage_audit_events
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.nursing_triage_daily_counters, public.nursing_triage_audit_events
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.mnct_classificacao_risco, public.mnct_fluxograma, public.triagem_fila,
  public.triagens, public.news2_avaliacoes TO authenticated;

COMMENT ON FUNCTION public.enqueue_nursing_triage_secure(BIGINT,TEXT,INTEGER,UUID) IS
  'Derives tenant/actor, validates the tenant patient and issues a collision-safe daily T ticket.';
COMMENT ON FUNCTION public.call_nursing_triage_secure(BIGINT,UUID) IS
  'Performs the idempotent AGUARDANDO to CHAMADO nursing queue transition under row lock.';
COMMENT ON FUNCTION public.complete_nursing_triage_secure(BIGINT,BIGINT,INTEGER,JSONB,UUID) IS
  'Validates queue/patient/appointment/classification, derives NEWS2 from p_triage, stores triage/audit, and marks the queue TRIADO.';

