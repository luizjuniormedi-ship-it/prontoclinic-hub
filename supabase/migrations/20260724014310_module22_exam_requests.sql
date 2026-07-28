-- Module 22: central, tenant-aware exam requests.
-- LIS and DICOM remain the operational executors. This module coordinates,
-- signs, dispatches and audits requests without duplicating either domain.
BEGIN;

DO $owner$
DECLARE
  v_executor_is_superuser BOOLEAN;
BEGIN
  SELECT rolsuper INTO v_executor_is_superuser
  FROM pg_roles WHERE rolname = CURRENT_USER;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prontomedic_rpc_owner') THEN
    IF NOT COALESCE(v_executor_is_superuser, FALSE) THEN
      RAISE EXCEPTION 'M22 requires a superuser to create prontomedic_rpc_owner';
    END IF;
    EXECUTE
      'CREATE ROLE prontomedic_rpc_owner NOLOGIN BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION';
  ELSIF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'prontomedic_rpc_owner'
      AND (rolcanlogin OR NOT rolbypassrls OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication)
  ) THEN
    IF NOT COALESCE(v_executor_is_superuser, FALSE) THEN
      RAISE EXCEPTION 'M22 cannot harden prontomedic_rpc_owner without a superuser';
    END IF;
    EXECUTE
      'ALTER ROLE prontomedic_rpc_owner NOLOGIN BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION';
  END IF;
END
$owner$;

DO $dependencies$
BEGIN
  IF to_regclass('public.permissions') IS NULL
     OR to_regclass('public.role_permissions') IS NULL
     OR to_regclass('public.roles') IS NULL
     OR to_regclass('public.user_permissions') IS NULL
     OR to_regprocedure(
       'private.prontomedic_module_action_allowed(text,text,integer,boolean)'
     ) IS NULL THEN
    RAISE EXCEPTION 'M22 requires the canonical permission catalog and M19 authorization helper';
  END IF;
END
$dependencies$;

INSERT INTO public.permissions (module, action, label, description)
VALUES
  ('solicitacoes_exames', 'view', 'Visualizar solicitações de exames', 'Consultar solicitações no tenant e unidade autorizados'),
  ('solicitacoes_exames', 'create', 'Criar solicitações de exames', 'Criar e assinar solicitações autorizadas'),
  ('solicitacoes_exames', 'edit', 'Editar solicitações de exames', 'Cancelar e atualizar solicitações autorizadas'),
  ('execucao_exames', 'view', 'Visualizar execução de exames', 'Consultar filas e despachos de exames'),
  ('execucao_exames', 'create', 'Despachar exames', 'Criar despacho para LIS ou DICOM autorizado'),
  ('execucao_exames', 'edit', 'Atualizar execução de exames', 'Transicionar item e registrar resultado operacional')
ON CONFLICT (module, action) DO NOTHING;

INSERT INTO public.role_permissions (
  role_id, module, can_view, can_create, can_edit, can_delete, can_export
)
SELECT r.id, matrix.module, TRUE, TRUE, TRUE, FALSE, FALSE
FROM public.roles r
JOIN (
  VALUES
    ('admin', 'solicitacoes_exames'),
    ('medico', 'solicitacoes_exames'),
    ('enfermagem', 'solicitacoes_exames'),
    ('admin', 'execucao_exames'),
    ('medico', 'execucao_exames'),
    ('enfermagem', 'execucao_exames'),
    ('tecnico_enfermagem', 'execucao_exames'),
    ('laboratorio', 'execucao_exames'),
    ('diagnostico', 'execucao_exames')
) AS matrix(role_name, module)
  ON matrix.role_name = r.name
ON CONFLICT DO NOTHING;

UPDATE public.role_permissions rp
SET can_view = FALSE,
    can_create = FALSE,
    can_edit = FALSE,
    can_delete = FALSE,
    can_export = FALSE,
    updated_at = NOW()
FROM public.roles r
WHERE r.id = rp.role_id
  AND (
    (rp.module = 'solicitacoes_exames'
      AND r.name NOT IN ('admin', 'medico', 'enfermagem'))
    OR
    (rp.module = 'execucao_exames'
      AND r.name NOT IN (
        'admin', 'medico', 'enfermagem', 'tecnico_enfermagem',
        'laboratorio', 'diagnostico'
      ))
  )
  AND (rp.can_view OR rp.can_create OR rp.can_edit OR rp.can_delete OR rp.can_export);

CREATE TABLE IF NOT EXISTS public.exam_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  unit_id INTEGER NOT NULL REFERENCES public.units(id) ON DELETE RESTRICT,
  patient_id BIGINT NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  encounter_id UUID REFERENCES public.encounters(id) ON DELETE SET NULL,
  appointment_id BIGINT REFERENCES public.appointments(id) ON DELETE SET NULL,
  requester_professional_id BIGINT NOT NULL REFERENCES public.professionals(id) ON DELETE RESTRICT,
  clinical_indication TEXT NOT NULL,
  diagnosis_code TEXT,
  priority TEXT NOT NULL DEFAULT 'ROUTINE'
    CHECK (priority IN ('ROUTINE', 'URGENT', 'EMERGENCY')),
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN (
      'DRAFT', 'SIGNED', 'PARTIALLY_DISPATCHED', 'DISPATCHED',
      'COMPLETED', 'CANCELLED'
    )),
  idempotency_key TEXT,
  signed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  signed_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT exam_requests_company_id_id_uq UNIQUE (company_id, id),
  CONSTRAINT exam_requests_signature_chk CHECK (
    (signed_at IS NULL AND signed_by IS NULL)
    OR (signed_at IS NOT NULL AND signed_by IS NOT NULL)
  ),
  CONSTRAINT exam_requests_cancellation_chk CHECK (
    status <> 'CANCELLED'
    OR (
      cancelled_at IS NOT NULL
      AND cancelled_by IS NOT NULL
      AND NULLIF(BTRIM(cancellation_reason), '') IS NOT NULL
    )
  )
);

CREATE TABLE IF NOT EXISTS public.exam_request_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  request_id UUID NOT NULL,
  domain TEXT NOT NULL
    CHECK (domain IN ('LABORATORY', 'IMAGING', 'CARDIOLOGY', 'ENDOSCOPY', 'PATHOLOGY')),
  code_system TEXT NOT NULL DEFAULT 'LOCAL'
    CHECK (code_system IN ('LOCAL', 'TUSS', 'LOINC')),
  catalog_code TEXT,
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 99),
  preparation_required BOOLEAN NOT NULL DEFAULT FALSE,
  preparation_instructions TEXT,
  authorization_required BOOLEAN NOT NULL DEFAULT FALSE,
  authorization_id UUID REFERENCES public.insurance_authorizations(id) ON DELETE SET NULL,
  tiss_guide_id UUID REFERENCES public.tiss_guides(id) ON DELETE SET NULL,
  details JSONB NOT NULL DEFAULT '{}'::JSONB
    CHECK (jsonb_typeof(details) = 'object'),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN (
      'PENDING', 'AUTHORIZATION_PENDING', 'READY', 'DISPATCHED',
      'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED'
    )),
  failure_reason TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT exam_request_items_company_request_id_uq
    UNIQUE (company_id, request_id, id),
  CONSTRAINT exam_request_items_request_fk
    FOREIGN KEY (company_id, request_id)
    REFERENCES public.exam_requests(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT exam_request_items_preparation_chk CHECK (
    NOT preparation_required
    OR NULLIF(BTRIM(preparation_instructions), '') IS NOT NULL
  )
);

CREATE TABLE IF NOT EXISTS public.exam_request_dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  request_id UUID NOT NULL,
  request_item_id UUID NOT NULL,
  executor_kind TEXT NOT NULL CHECK (executor_kind IN ('LIS', 'DICOM', 'SPECIALTY')),
  status TEXT NOT NULL CHECK (status IN ('QUEUED', 'ACCEPTED', 'FAILED')),
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  lab_order_id BIGINT REFERENCES public.exames_lab_pedido(id) ON DELETE RESTRICT,
  lab_order_item_id BIGINT REFERENCES public.exames_lab_pedido_itens(id) ON DELETE RESTRICT,
  imaging_order_id UUID REFERENCES public.imaging_orders(id) ON DELETE RESTRICT,
  imaging_order_item_id UUID REFERENCES public.imaging_order_items(id) ON DELETE RESTRICT,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB
    CHECK (jsonb_typeof(metadata) = 'object'),
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT exam_request_dispatches_item_fk
    FOREIGN KEY (company_id, request_id, request_item_id)
    REFERENCES public.exam_request_items(company_id, request_id, id) ON DELETE RESTRICT,
  CONSTRAINT exam_request_dispatches_executor_chk CHECK (
    (executor_kind = 'LIS'
      AND lab_order_id IS NOT NULL
      AND lab_order_item_id IS NOT NULL
      AND imaging_order_id IS NULL
      AND imaging_order_item_id IS NULL)
    OR
    (executor_kind = 'DICOM'
      AND imaging_order_id IS NOT NULL
      AND imaging_order_item_id IS NOT NULL
      AND lab_order_id IS NULL
      AND lab_order_item_id IS NULL)
    OR
    (executor_kind = 'SPECIALTY'
      AND lab_order_id IS NULL
      AND lab_order_item_id IS NULL
      AND imaging_order_id IS NULL
      AND imaging_order_item_id IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.exam_request_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  request_id UUID NOT NULL,
  request_item_id UUID,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'CREATED', 'SIGNED', 'DISPATCHED', 'ITEM_TRANSITIONED',
    'REQUEST_STATUS_CHANGED', 'CANCELLED'
  )),
  from_status TEXT,
  to_status TEXT,
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB
    CHECK (jsonb_typeof(metadata) = 'object'),
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT exam_request_events_request_fk
    FOREIGN KEY (company_id, request_id)
    REFERENCES public.exam_requests(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT exam_request_events_item_fk
    FOREIGN KEY (company_id, request_id, request_item_id)
    REFERENCES public.exam_request_items(company_id, request_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS exam_requests_idempotency_uq
  ON public.exam_requests(company_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS exam_requests_patient_idx
  ON public.exam_requests(company_id, patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS exam_requests_unit_status_idx
  ON public.exam_requests(company_id, unit_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS exam_requests_encounter_idx
  ON public.exam_requests(company_id, encounter_id)
  WHERE encounter_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS exam_request_items_request_idx
  ON public.exam_request_items(company_id, request_id, status);
CREATE INDEX IF NOT EXISTS exam_request_items_authorization_idx
  ON public.exam_request_items(company_id, authorization_id)
  WHERE authorization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS exam_request_items_tiss_idx
  ON public.exam_request_items(company_id, tiss_guide_id)
  WHERE tiss_guide_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS exam_request_dispatches_item_idx
  ON public.exam_request_dispatches(company_id, request_item_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS exam_request_dispatches_attempt_uq
  ON public.exam_request_dispatches(company_id, request_item_id, attempt_number);
CREATE INDEX IF NOT EXISTS exam_request_events_request_idx
  ON public.exam_request_events(company_id, request_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.m22_company_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.company_id', true), '')::UUID,
    public.current_company_id()
  )
$fn$;

CREATE OR REPLACE FUNCTION public.m22_can_create_requests()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $fn$
  SELECT private.prontomedic_module_action_allowed(
    'solicitacoes_exames', 'create', NULL, FALSE
  )
$fn$;

CREATE OR REPLACE FUNCTION public.m22_can_dispatch_requests()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $fn$
  SELECT private.prontomedic_module_action_allowed(
    'execucao_exames', 'edit', NULL, FALSE
  )
$fn$;

CREATE OR REPLACE FUNCTION private.exam_unit_access_runtime(
  p_company_id UUID,
  p_unit_id INTEGER
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $fn$
  SELECT p_company_id = COALESCE(
      NULLIF(current_setting('request.jwt.claim.company_id', TRUE), '')::UUID,
      private.current_company_id()
    )
    AND EXISTS (
      SELECT 1
        FROM public.units u
       WHERE u.id = p_unit_id
         AND u.company_id = p_company_id
         AND u.lg_ativo = TRUE
    )
    AND private.org_can_access_unit_runtime(p_company_id, p_unit_id)
$fn$;

ALTER FUNCTION private.exam_unit_access_runtime(UUID, INTEGER)
  OWNER TO prontomedic_rpc_owner;
REVOKE ALL ON FUNCTION private.exam_unit_access_runtime(UUID, INTEGER)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.exam_unit_access_runtime(UUID, INTEGER)
  TO authenticated, app_prontomedic, prontomedic_rpc_owner;

CREATE OR REPLACE FUNCTION public.m22_unit_access(
  p_company_id UUID,
  p_unit_id INTEGER
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, private
AS $fn$
  SELECT private.exam_unit_access_runtime(p_company_id, p_unit_id)
$fn$;

REVOKE ALL ON FUNCTION public.m22_unit_access(UUID, INTEGER)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m22_unit_access(UUID, INTEGER)
  TO authenticated, app_prontomedic, prontomedic_rpc_owner;

CREATE OR REPLACE FUNCTION public.m22_guard_immutable_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  RAISE EXCEPTION 'Registros de despacho e evento do Módulo 22 são imutáveis';
END;
$fn$;

CREATE OR REPLACE FUNCTION public.m22_guard_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF OLD.status IN ('COMPLETED', 'CANCELLED')
     AND (TO_JSONB(NEW) - 'updated_at') IS DISTINCT FROM
         (TO_JSONB(OLD) - 'updated_at') THEN
    RAISE EXCEPTION 'Requisição concluída ou cancelada é imutável';
  END IF;

  IF OLD.status <> 'DRAFT'
     AND (
       TO_JSONB(NEW) - ARRAY[
         'status', 'signed_by', 'signed_at', 'cancelled_by',
         'cancelled_at', 'cancellation_reason', 'updated_at'
       ]
     ) IS DISTINCT FROM (
       TO_JSONB(OLD) - ARRAY[
         'status', 'signed_by', 'signed_at', 'cancelled_by',
         'cancelled_at', 'cancellation_reason', 'updated_at'
       ]
     ) THEN
    RAISE EXCEPTION 'Conteúdo clínico assinado não pode ser alterado';
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.m22_guard_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_request_status TEXT;
BEGIN
  SELECT status INTO v_request_status
  FROM public.exam_requests
  WHERE id = OLD.request_id AND company_id = OLD.company_id;

  IF v_request_status <> 'DRAFT'
     AND (
       TO_JSONB(NEW) - ARRAY['status', 'failure_reason', 'completed_at', 'updated_at']
     ) IS DISTINCT FROM (
       TO_JSONB(OLD) - ARRAY['status', 'failure_reason', 'completed_at', 'updated_at']
     ) THEN
    RAISE EXCEPTION 'Item de requisição assinada não pode ser alterado';
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_m22_guard_request ON public.exam_requests;
CREATE TRIGGER trg_m22_guard_request
  BEFORE UPDATE ON public.exam_requests
  FOR EACH ROW EXECUTE FUNCTION public.m22_guard_request();

DROP TRIGGER IF EXISTS trg_m22_guard_item ON public.exam_request_items;
CREATE TRIGGER trg_m22_guard_item
  BEFORE UPDATE ON public.exam_request_items
  FOR EACH ROW EXECUTE FUNCTION public.m22_guard_item();

DROP TRIGGER IF EXISTS trg_m22_dispatches_immutable ON public.exam_request_dispatches;
CREATE TRIGGER trg_m22_dispatches_immutable
  BEFORE UPDATE OR DELETE ON public.exam_request_dispatches
  FOR EACH ROW EXECUTE FUNCTION public.m22_guard_immutable_log();

DROP TRIGGER IF EXISTS trg_m22_events_immutable ON public.exam_request_events;
CREATE TRIGGER trg_m22_events_immutable
  BEFORE UPDATE OR DELETE ON public.exam_request_events
  FOR EACH ROW EXECUTE FUNCTION public.m22_guard_immutable_log();

ALTER TABLE public.exam_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE public.exam_request_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_request_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.exam_request_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_request_dispatches FORCE ROW LEVEL SECURITY;
ALTER TABLE public.exam_request_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_request_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS m22_exam_requests_select ON public.exam_requests;
CREATE POLICY m22_exam_requests_select
  ON public.exam_requests FOR SELECT TO authenticated, app_prontomedic
  USING (
    company_id = public.m22_company_id()
    AND public.m22_unit_access(company_id, unit_id)
  );

DROP POLICY IF EXISTS m22_exam_request_items_select ON public.exam_request_items;
CREATE POLICY m22_exam_request_items_select
  ON public.exam_request_items FOR SELECT TO authenticated, app_prontomedic
  USING (
    company_id = public.m22_company_id()
    AND EXISTS (
      SELECT 1
      FROM public.exam_requests er
      WHERE er.id = request_id
        AND er.company_id = exam_request_items.company_id
        AND public.m22_unit_access(er.company_id, er.unit_id)
    )
  );

DROP POLICY IF EXISTS m22_exam_request_dispatches_select ON public.exam_request_dispatches;
CREATE POLICY m22_exam_request_dispatches_select
  ON public.exam_request_dispatches FOR SELECT TO authenticated, app_prontomedic
  USING (
    company_id = public.m22_company_id()
    AND EXISTS (
      SELECT 1
      FROM public.exam_requests er
      WHERE er.id = request_id
        AND er.company_id = exam_request_dispatches.company_id
        AND public.m22_unit_access(er.company_id, er.unit_id)
    )
  );

DROP POLICY IF EXISTS m22_exam_request_events_select ON public.exam_request_events;
CREATE POLICY m22_exam_request_events_select
  ON public.exam_request_events FOR SELECT TO authenticated, app_prontomedic
  USING (
    company_id = public.m22_company_id()
    AND EXISTS (
      SELECT 1
      FROM public.exam_requests er
      WHERE er.id = request_id
        AND er.company_id = exam_request_events.company_id
        AND public.m22_unit_access(er.company_id, er.unit_id)
    )
  );

REVOKE ALL ON
  public.exam_requests,
  public.exam_request_items,
  public.exam_request_dispatches,
  public.exam_request_events
FROM PUBLIC, anon, authenticated, app_prontomedic;

GRANT SELECT ON
  public.exam_requests,
  public.exam_request_items,
  public.exam_request_dispatches,
  public.exam_request_events
TO authenticated, app_prontomedic;

CREATE SCHEMA IF NOT EXISTS m22_private;
REVOKE ALL ON SCHEMA m22_private
  FROM PUBLIC, anon, authenticated, app_prontomedic;
GRANT USAGE ON SCHEMA m22_private TO prontomedic_rpc_owner;

CREATE OR REPLACE FUNCTION m22_private.m22_append_event(
  p_company_id UUID,
  p_request_id UUID,
  p_request_item_id UUID,
  p_event_type TEXT,
  p_from_status TEXT,
  p_to_status TEXT,
  p_reason TEXT,
  p_metadata JSONB,
  p_actor_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF p_company_id IS NULL
     OR p_company_id IS DISTINCT FROM public.m22_company_id()
     OR p_actor_user_id IS NULL
     OR p_actor_user_id IS DISTINCT FROM auth.uid()
     OR p_event_type NOT IN (
       'CREATED', 'SIGNED', 'DISPATCHED', 'ITEM_TRANSITIONED',
       'REQUEST_STATUS_CHANGED', 'CANCELLED'
     ) THEN
    RAISE EXCEPTION 'Evento M22 não autorizado';
  END IF;

  INSERT INTO public.exam_request_events(
    company_id, request_id, request_item_id, event_type,
    from_status, to_status, reason, metadata, actor_user_id
  ) VALUES (
    p_company_id, p_request_id, p_request_item_id, p_event_type,
    p_from_status, p_to_status, NULLIF(BTRIM(p_reason), ''),
    COALESCE(p_metadata, '{}'::JSONB), p_actor_user_id
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION m22_private.m22_recompute_request(
  p_company_id UUID,
  p_request_id UUID,
  p_actor_user_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_request public.exam_requests;
  v_new_status TEXT;
  v_total INTEGER;
  v_completed INTEGER;
  v_post_dispatch INTEGER;
  v_pre_dispatch INTEGER;
BEGIN
  IF p_company_id IS NULL
     OR p_company_id IS DISTINCT FROM public.m22_company_id()
     OR p_actor_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Recomputação M22 não autorizada';
  END IF;

  SELECT * INTO v_request
  FROM public.exam_requests
  WHERE id = p_request_id AND company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND OR v_request.status = 'CANCELLED' THEN
    RETURN COALESCE(v_request.status, 'CANCELLED');
  END IF;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'COMPLETED'),
    COUNT(*) FILTER (WHERE status IN ('DISPATCHED', 'IN_PROGRESS', 'COMPLETED', 'FAILED')),
    COUNT(*) FILTER (WHERE status IN ('PENDING', 'AUTHORIZATION_PENDING', 'READY'))
  INTO v_total, v_completed, v_post_dispatch, v_pre_dispatch
  FROM public.exam_request_items
  WHERE request_id = p_request_id AND company_id = p_company_id;

  v_new_status := CASE
    WHEN v_total > 0 AND v_completed = v_total THEN 'COMPLETED'
    WHEN v_post_dispatch > 0 AND v_pre_dispatch = 0 THEN 'DISPATCHED'
    WHEN v_post_dispatch > 0 THEN 'PARTIALLY_DISPATCHED'
    ELSE v_request.status
  END;

  IF v_new_status IS DISTINCT FROM v_request.status THEN
    UPDATE public.exam_requests
    SET status = v_new_status, updated_at = NOW()
    WHERE id = p_request_id AND company_id = p_company_id;

    PERFORM m22_private.m22_append_event(
      p_company_id, p_request_id, NULL, 'REQUEST_STATUS_CHANGED',
      v_request.status, v_new_status, NULL, '{}'::JSONB, p_actor_user_id
    );
  END IF;

  RETURN v_new_status;
END;
$fn$;

CREATE OR REPLACE FUNCTION m22_private.m22_create_exam_request(
  p_unit_id INTEGER,
  p_patient_id BIGINT,
  p_encounter_id UUID,
  p_appointment_id BIGINT,
  p_requester_professional_id BIGINT,
  p_clinical_indication TEXT,
  p_diagnosis_code TEXT,
  p_priority TEXT,
  p_items JSONB,
  p_idempotency_key TEXT
)
RETURNS public.exam_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_company UUID := public.m22_company_id();
  v_actor UUID := auth.uid();
  v_request public.exam_requests;
  v_item JSONB;
  v_domain TEXT;
  v_description TEXT;
  v_authorization_id UUID;
  v_tiss_guide_id UUID;
  v_quantity INTEGER;
  v_priority TEXT := UPPER(COALESCE(NULLIF(BTRIM(p_priority), ''), 'ROUTINE'));
BEGIN
  IF v_company IS NULL OR v_actor IS NULL
     OR NOT public.m22_can_create_requests()
     OR NOT public.m22_unit_access(v_company, p_unit_id) THEN
    RAISE EXCEPTION 'Usuário sem permissão para criar requisição de exames';
  END IF;

  IF NULLIF(BTRIM(COALESCE(p_clinical_indication, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Indicação clínica é obrigatória';
  END IF;
  IF v_priority NOT IN ('ROUTINE', 'URGENT', 'EMERGENCY') THEN
    RAISE EXCEPTION 'Prioridade inválida';
  END IF;
  IF JSONB_TYPEOF(COALESCE(p_items, 'null'::JSONB)) <> 'array' THEN
    RAISE EXCEPTION 'Itens de exame devem ser um array';
  END IF;
  IF JSONB_ARRAY_LENGTH(p_items) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'Informe entre 1 e 50 itens de exame';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.patients p
    WHERE p.id = p_patient_id AND p.company_id = v_company AND p.lg_ativo = TRUE
  ) THEN
    RAISE EXCEPTION 'Paciente não encontrado no tenant atual';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.professionals p
    WHERE p.id = p_requester_professional_id
      AND p.company_id = v_company
      AND p.lg_ativo = TRUE
  ) THEN
    RAISE EXCEPTION 'Profissional solicitante não encontrado no tenant atual';
  END IF;

  IF p_encounter_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.encounters e
    WHERE e.id = p_encounter_id
      AND e.company_id = v_company
      AND e.patient_id = p_patient_id
      AND (e.unit_id IS NULL OR e.unit_id = p_unit_id)
  ) THEN
    RAISE EXCEPTION 'Atendimento incompatível com empresa, unidade ou paciente';
  END IF;

  IF p_appointment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.appointments a
    WHERE a.id = p_appointment_id
      AND a.company_id = v_company
      AND a.patient_id = p_patient_id
      AND a.unit_id = p_unit_id
  ) THEN
    RAISE EXCEPTION 'Agendamento incompatível com empresa ou paciente';
  END IF;

  IF NULLIF(BTRIM(COALESCE(p_idempotency_key, '')), '') IS NOT NULL THEN
    SELECT * INTO v_request
    FROM public.exam_requests
    WHERE company_id = v_company
      AND idempotency_key = BTRIM(p_idempotency_key)
    FOR UPDATE;
    IF FOUND THEN
      RETURN v_request;
    END IF;
  END IF;

  INSERT INTO public.exam_requests(
    company_id, unit_id, patient_id, encounter_id, appointment_id,
    requester_professional_id, clinical_indication, diagnosis_code,
    priority, idempotency_key, created_by
  ) VALUES (
    v_company, p_unit_id, p_patient_id, p_encounter_id, p_appointment_id,
    p_requester_professional_id, BTRIM(p_clinical_indication),
    NULLIF(BTRIM(p_diagnosis_code), ''), v_priority,
    NULLIF(BTRIM(p_idempotency_key), ''), v_actor
  )
  RETURNING * INTO v_request;

  FOR v_item IN SELECT value FROM JSONB_ARRAY_ELEMENTS(p_items)
  LOOP
    IF JSONB_TYPEOF(v_item) <> 'object' THEN
      RAISE EXCEPTION 'Item de exame inválido';
    END IF;

    v_domain := UPPER(COALESCE(v_item->>'domain', ''));
    v_description := NULLIF(BTRIM(v_item->>'description'), '');
    v_quantity := COALESCE((v_item->>'quantity')::INTEGER, 1);
    v_authorization_id := NULLIF(v_item->>'authorization_id', '')::UUID;
    v_tiss_guide_id := NULLIF(v_item->>'tiss_guide_id', '')::UUID;

    IF v_domain NOT IN ('LABORATORY', 'IMAGING', 'CARDIOLOGY', 'ENDOSCOPY', 'PATHOLOGY')
       OR v_description IS NULL
       OR v_quantity NOT BETWEEN 1 AND 99 THEN
      RAISE EXCEPTION 'Domínio, descrição ou quantidade do item é inválido';
    END IF;

    IF COALESCE((v_item->>'preparation_required')::BOOLEAN, FALSE)
       AND NULLIF(BTRIM(v_item->>'preparation_instructions'), '') IS NULL THEN
      RAISE EXCEPTION 'Instruções de preparo são obrigatórias para o item';
    END IF;

    IF v_authorization_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.insurance_authorizations ia
      WHERE ia.id = v_authorization_id
        AND ia.company_id = v_company
        AND (ia.patient_id IS NULL OR ia.patient_id = p_patient_id)
        AND (
          p_appointment_id IS NULL
          OR ia.appointment_id IS NULL
          OR ia.appointment_id = p_appointment_id
        )
    ) THEN
      RAISE EXCEPTION 'Autorização incompatível com requisição';
    END IF;

    IF v_tiss_guide_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.tiss_guides tg
      WHERE tg.id = v_tiss_guide_id
        AND tg.company_id = v_company
        AND (tg.unit_id IS NULL OR tg.unit_id = p_unit_id)
        AND (
          p_appointment_id IS NULL
          OR tg.appointment_id IS NULL
          OR tg.appointment_id = p_appointment_id
        )
    ) THEN
      RAISE EXCEPTION 'Guia TISS incompatível com requisição';
    END IF;

    INSERT INTO public.exam_request_items(
      company_id, request_id, domain, code_system, catalog_code,
      description, quantity, preparation_required, preparation_instructions,
      authorization_required, authorization_id, tiss_guide_id, details
    ) VALUES (
      v_company, v_request.id, v_domain,
      UPPER(COALESCE(NULLIF(BTRIM(v_item->>'code_system'), ''), 'LOCAL')),
      NULLIF(BTRIM(v_item->>'catalog_code'), ''), v_description, v_quantity,
      COALESCE((v_item->>'preparation_required')::BOOLEAN, FALSE),
      NULLIF(BTRIM(v_item->>'preparation_instructions'), ''),
      COALESCE((v_item->>'authorization_required')::BOOLEAN, FALSE),
      v_authorization_id, v_tiss_guide_id,
      CASE
        WHEN JSONB_TYPEOF(COALESCE(v_item->'details', '{}'::JSONB)) = 'object'
          THEN COALESCE(v_item->'details', '{}'::JSONB)
        ELSE '{}'::JSONB
      END
    );
  END LOOP;

  PERFORM m22_private.m22_append_event(
    v_company, v_request.id, NULL, 'CREATED',
    NULL, 'DRAFT', NULL, JSONB_BUILD_OBJECT('item_count', JSONB_ARRAY_LENGTH(p_items)), v_actor
  );

  RETURN v_request;
END;
$fn$;

CREATE OR REPLACE FUNCTION m22_private.m22_sign_exam_request(
  p_request_id UUID
)
RETURNS public.exam_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_company UUID := public.m22_company_id();
  v_actor UUID := auth.uid();
  v_request public.exam_requests;
BEGIN
  IF v_company IS NULL OR v_actor IS NULL OR NOT public.m22_can_create_requests() THEN
    RAISE EXCEPTION 'Usuário sem permissão para assinar requisição';
  END IF;

  SELECT * INTO v_request
  FROM public.exam_requests
  WHERE id = p_request_id AND company_id = v_company
  FOR UPDATE;

  IF NOT FOUND
     OR v_request.status <> 'DRAFT'
     OR NOT public.m22_unit_access(v_company, v_request.unit_id) THEN
    RAISE EXCEPTION 'Requisição não encontrada, sem acesso ou já assinada';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.exam_request_items
    WHERE request_id = p_request_id AND company_id = v_company
  ) THEN
    RAISE EXCEPTION 'Requisição sem itens';
  END IF;

  UPDATE public.exam_request_items eri
  SET status = CASE
      WHEN eri.authorization_required
        AND NOT EXISTS (
          SELECT 1 FROM public.insurance_authorizations ia
          WHERE ia.id = eri.authorization_id
            AND ia.company_id = v_company
            AND ia.status IN ('autorizada', 'parcialmente_autorizada', 'liberada_excecao', 'nao_necessaria')
            AND (ia.valid_until IS NULL OR ia.valid_until >= CURRENT_DATE)
            AND (
              ia.status IN ('liberada_excecao', 'nao_necessaria')
              OR ia.quantity_used < ia.quantity_authorized
            )
        )
      THEN 'AUTHORIZATION_PENDING'
      ELSE 'READY'
    END,
    updated_at = NOW()
  WHERE eri.request_id = p_request_id
    AND eri.company_id = v_company
    AND eri.status = 'PENDING';

  UPDATE public.exam_requests
  SET status = 'SIGNED', signed_by = v_actor, signed_at = NOW(), updated_at = NOW()
  WHERE id = p_request_id AND company_id = v_company
  RETURNING * INTO v_request;

  PERFORM m22_private.m22_append_event(
    v_company, p_request_id, NULL, 'SIGNED',
    'DRAFT', 'SIGNED', NULL, '{}'::JSONB, v_actor
  );

  RETURN v_request;
END;
$fn$;

CREATE OR REPLACE FUNCTION m22_private.m22_dispatch_exam_request_item(
  p_request_item_id UUID,
  p_executor_kind TEXT,
  p_lab_order_id BIGINT,
  p_lab_order_item_id BIGINT,
  p_imaging_order_id UUID,
  p_imaging_order_item_id UUID,
  p_metadata JSONB
)
RETURNS public.exam_request_dispatches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_company UUID := public.m22_company_id();
  v_actor UUID := auth.uid();
  v_item public.exam_request_items;
  v_request public.exam_requests;
  v_dispatch public.exam_request_dispatches;
  v_executor TEXT := UPPER(COALESCE(p_executor_kind, ''));
  v_attempt INTEGER;
BEGIN
  IF v_company IS NULL OR v_actor IS NULL OR NOT public.m22_can_dispatch_requests() THEN
    RAISE EXCEPTION 'Usuário sem permissão para despachar requisição';
  END IF;

  SELECT * INTO v_item
  FROM public.exam_request_items
  WHERE id = p_request_item_id AND company_id = v_company
  FOR UPDATE;
  IF NOT FOUND OR v_item.status NOT IN ('READY', 'FAILED') THEN
    RAISE EXCEPTION 'Item não encontrado ou não está pronto para despacho';
  END IF;

  SELECT * INTO v_request
  FROM public.exam_requests
  WHERE id = v_item.request_id AND company_id = v_company
  FOR UPDATE;
  IF NOT FOUND
     OR v_request.status NOT IN ('SIGNED', 'PARTIALLY_DISPATCHED', 'DISPATCHED')
     OR NOT public.m22_unit_access(v_company, v_request.unit_id) THEN
    RAISE EXCEPTION 'Requisição não assinada ou fora da unidade autorizada';
  END IF;

  IF v_item.authorization_required AND NOT EXISTS (
    SELECT 1 FROM public.insurance_authorizations ia
    WHERE ia.id = v_item.authorization_id
      AND ia.company_id = v_company
      AND ia.status IN ('autorizada', 'parcialmente_autorizada', 'liberada_excecao', 'nao_necessaria')
      AND (ia.valid_until IS NULL OR ia.valid_until >= CURRENT_DATE)
      AND (
        ia.status IN ('liberada_excecao', 'nao_necessaria')
        OR ia.quantity_used < ia.quantity_authorized
      )
  ) THEN
    RAISE EXCEPTION 'Item depende de autorização válida';
  END IF;

  IF v_executor = 'LIS' THEN
    IF v_item.domain <> 'LABORATORY' OR NOT EXISTS (
      SELECT 1
      FROM public.exames_lab_pedido_itens li
      JOIN public.exames_lab_pedido lh ON lh.id = li.cd_pedido
      WHERE lh.id = p_lab_order_id
        AND li.id = p_lab_order_item_id
        AND lh.company_id = v_company
        AND lh.cd_paciente = v_request.patient_id
        AND lh.cd_medico = v_request.requester_professional_id
        AND lh.cd_appointment IS NOT DISTINCT FROM v_request.appointment_id
    ) THEN
      RAISE EXCEPTION 'Pedido LIS incompatível com o item central';
    END IF;
  ELSIF v_executor = 'DICOM' THEN
    IF v_item.domain NOT IN ('IMAGING', 'CARDIOLOGY') OR NOT EXISTS (
      SELECT 1
      FROM public.imaging_order_items ii
      JOIN public.imaging_orders ih ON ih.id = ii.imaging_order_id
      WHERE ih.id = p_imaging_order_id
        AND ii.id = p_imaging_order_item_id
        AND ih.company_id = v_company
        AND ih.patient_id = v_request.patient_id
        AND ih.unit_id = v_request.unit_id
        AND ih.requesting_physician_id = v_request.requester_professional_id
        AND ih.scheduling_id IS NOT DISTINCT FROM v_request.appointment_id
    ) THEN
      RAISE EXCEPTION 'Pedido DICOM incompatível com o item central';
    END IF;
  ELSIF v_executor = 'SPECIALTY' THEN
    IF v_item.domain NOT IN ('CARDIOLOGY', 'ENDOSCOPY', 'PATHOLOGY')
       OR p_lab_order_id IS NOT NULL
       OR p_lab_order_item_id IS NOT NULL
       OR p_imaging_order_id IS NOT NULL
       OR p_imaging_order_item_id IS NOT NULL THEN
      RAISE EXCEPTION 'Despacho especializado incompatível com o item';
    END IF;
  ELSE
    RAISE EXCEPTION 'Executor inválido';
  END IF;

  SELECT COALESCE(MAX(attempt_number), 0) + 1 INTO v_attempt
  FROM public.exam_request_dispatches
  WHERE company_id = v_company AND request_item_id = v_item.id;

  INSERT INTO public.exam_request_dispatches(
    company_id, request_id, request_item_id, executor_kind, status,
    attempt_number, lab_order_id, lab_order_item_id,
    imaging_order_id, imaging_order_item_id, metadata, actor_user_id
  ) VALUES (
    v_company, v_item.request_id, v_item.id, v_executor,
    CASE WHEN v_executor = 'SPECIALTY' THEN 'QUEUED' ELSE 'ACCEPTED' END,
    v_attempt, p_lab_order_id, p_lab_order_item_id,
    p_imaging_order_id, p_imaging_order_item_id,
    COALESCE(p_metadata, '{}'::JSONB), v_actor
  )
  RETURNING * INTO v_dispatch;

  UPDATE public.exam_request_items
  SET status = 'DISPATCHED', failure_reason = NULL, updated_at = NOW()
  WHERE id = v_item.id AND company_id = v_company;

  PERFORM m22_private.m22_append_event(
    v_company, v_item.request_id, v_item.id, 'DISPATCHED',
    v_item.status, 'DISPATCHED', NULL,
    JSONB_BUILD_OBJECT(
      'dispatch_id', v_dispatch.id,
      'executor_kind', v_executor,
      'attempt_number', v_attempt
    ),
    v_actor
  );
  PERFORM m22_private.m22_recompute_request(v_company, v_item.request_id, v_actor);

  RETURN v_dispatch;
END;
$fn$;

CREATE OR REPLACE FUNCTION m22_private.m22_transition_exam_request_item(
  p_request_item_id UUID,
  p_to_status TEXT,
  p_reason TEXT
)
RETURNS public.exam_request_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_company UUID := public.m22_company_id();
  v_actor UUID := auth.uid();
  v_item public.exam_request_items;
  v_request public.exam_requests;
  v_to_status TEXT := UPPER(COALESCE(p_to_status, ''));
  v_from_status TEXT;
BEGIN
  IF v_company IS NULL OR v_actor IS NULL OR NOT public.m22_can_dispatch_requests() THEN
    RAISE EXCEPTION 'Usuário sem permissão para transicionar item';
  END IF;

  SELECT * INTO v_item
  FROM public.exam_request_items
  WHERE id = p_request_item_id AND company_id = v_company
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item não encontrado no tenant atual';
  END IF;

  SELECT * INTO v_request
  FROM public.exam_requests
  WHERE id = v_item.request_id AND company_id = v_company
  FOR UPDATE;
  IF NOT FOUND OR v_request.status IN ('DRAFT', 'COMPLETED', 'CANCELLED')
     OR NOT public.m22_unit_access(v_company, v_request.unit_id) THEN
    RAISE EXCEPTION 'Requisição não permite transição';
  END IF;

  IF NOT (
    (v_item.status = 'AUTHORIZATION_PENDING' AND v_to_status IN ('READY', 'CANCELLED'))
    OR (v_item.status = 'READY' AND v_to_status = 'CANCELLED')
    OR (v_item.status = 'DISPATCHED' AND v_to_status IN ('IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED'))
    OR (v_item.status = 'IN_PROGRESS' AND v_to_status IN ('COMPLETED', 'FAILED', 'CANCELLED'))
    OR (v_item.status = 'FAILED' AND v_to_status IN ('READY', 'CANCELLED'))
  ) THEN
    RAISE EXCEPTION 'Transição de item inválida';
  END IF;

  IF v_to_status = 'READY' AND v_item.authorization_required AND NOT EXISTS (
    SELECT 1 FROM public.insurance_authorizations ia
    WHERE ia.id = v_item.authorization_id
      AND ia.company_id = v_company
      AND ia.status IN ('autorizada', 'parcialmente_autorizada', 'liberada_excecao', 'nao_necessaria')
      AND (ia.valid_until IS NULL OR ia.valid_until >= CURRENT_DATE)
  ) THEN
    RAISE EXCEPTION 'Autorização válida é obrigatória para liberar o item';
  END IF;

  IF v_to_status IN ('FAILED', 'CANCELLED')
     AND NULLIF(BTRIM(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Motivo é obrigatório para falha ou cancelamento';
  END IF;

  v_from_status := v_item.status;
  UPDATE public.exam_request_items
  SET status = v_to_status,
      failure_reason = CASE WHEN v_to_status = 'FAILED' THEN BTRIM(p_reason) ELSE NULL END,
      completed_at = CASE WHEN v_to_status = 'COMPLETED' THEN NOW() ELSE completed_at END,
      updated_at = NOW()
  WHERE id = v_item.id AND company_id = v_company
  RETURNING * INTO v_item;

  PERFORM m22_private.m22_append_event(
    v_company, v_item.request_id, v_item.id, 'ITEM_TRANSITIONED',
    v_from_status, v_to_status, p_reason, '{}'::JSONB, v_actor
  );
  PERFORM m22_private.m22_recompute_request(v_company, v_item.request_id, v_actor);

  RETURN v_item;
END;
$fn$;

CREATE OR REPLACE FUNCTION m22_private.m22_cancel_exam_request(
  p_request_id UUID,
  p_reason TEXT
)
RETURNS public.exam_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_company UUID := public.m22_company_id();
  v_actor UUID := auth.uid();
  v_request public.exam_requests;
  v_from_status TEXT;
BEGIN
  IF v_company IS NULL OR v_actor IS NULL OR NOT public.m22_can_create_requests() THEN
    RAISE EXCEPTION 'Usuário sem permissão para cancelar requisição';
  END IF;
  IF NULLIF(BTRIM(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Motivo do cancelamento é obrigatório';
  END IF;

  SELECT * INTO v_request
  FROM public.exam_requests
  WHERE id = p_request_id AND company_id = v_company
  FOR UPDATE;
  IF NOT FOUND
     OR v_request.status NOT IN ('DRAFT', 'SIGNED', 'PARTIALLY_DISPATCHED', 'DISPATCHED')
     OR NOT public.m22_unit_access(v_company, v_request.unit_id) THEN
    RAISE EXCEPTION 'Requisição não encontrada, sem acesso ou não cancelável';
  END IF;

  v_from_status := v_request.status;
  UPDATE public.exam_requests
  SET status = 'CANCELLED',
      cancelled_by = v_actor,
      cancelled_at = NOW(),
      cancellation_reason = BTRIM(p_reason),
      updated_at = NOW()
  WHERE id = p_request_id AND company_id = v_company
  RETURNING * INTO v_request;

  UPDATE public.exam_request_items
  SET status = 'CANCELLED', updated_at = NOW()
  WHERE request_id = p_request_id
    AND company_id = v_company
    AND status <> 'COMPLETED';

  PERFORM m22_private.m22_append_event(
    v_company, p_request_id, NULL, 'CANCELLED',
    v_from_status, 'CANCELLED', p_reason, '{}'::JSONB, v_actor
  );

  RETURN v_request;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.m22_create_exam_request_secure(
  p_unit_id INTEGER,
  p_patient_id BIGINT,
  p_encounter_id UUID DEFAULT NULL,
  p_appointment_id BIGINT DEFAULT NULL,
  p_requester_professional_id BIGINT DEFAULT NULL,
  p_clinical_indication TEXT DEFAULT NULL,
  p_diagnosis_code TEXT DEFAULT NULL,
  p_priority TEXT DEFAULT 'ROUTINE',
  p_items JSONB DEFAULT '[]'::JSONB,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS public.exam_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NOT public.m22_can_create_requests() THEN
    RAISE EXCEPTION 'Usuário sem permissão para criar requisição';
  END IF;
  RETURN m22_private.m22_create_exam_request(
    p_unit_id, p_patient_id, p_encounter_id, p_appointment_id,
    p_requester_professional_id, p_clinical_indication, p_diagnosis_code,
    p_priority, p_items, p_idempotency_key
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.m22_sign_exam_request_secure(
  p_request_id UUID
)
RETURNS public.exam_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NOT public.m22_can_create_requests() THEN
    RAISE EXCEPTION 'Usuário sem permissão para assinar requisição';
  END IF;
  RETURN m22_private.m22_sign_exam_request(p_request_id);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.m22_dispatch_exam_request_item_secure(
  p_request_item_id UUID,
  p_executor_kind TEXT,
  p_lab_order_id BIGINT DEFAULT NULL,
  p_lab_order_item_id BIGINT DEFAULT NULL,
  p_imaging_order_id UUID DEFAULT NULL,
  p_imaging_order_item_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS public.exam_request_dispatches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NOT public.m22_can_dispatch_requests() THEN
    RAISE EXCEPTION 'Usuário sem permissão para despachar item';
  END IF;
  RETURN m22_private.m22_dispatch_exam_request_item(
    p_request_item_id, p_executor_kind, p_lab_order_id, p_lab_order_item_id,
    p_imaging_order_id, p_imaging_order_item_id, p_metadata
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.m22_transition_exam_request_item_secure(
  p_request_item_id UUID,
  p_to_status TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS public.exam_request_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NOT public.m22_can_dispatch_requests() THEN
    RAISE EXCEPTION 'Usuário sem permissão para transicionar item';
  END IF;
  RETURN m22_private.m22_transition_exam_request_item(
    p_request_item_id, p_to_status, p_reason
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.m22_cancel_exam_request_secure(
  p_request_id UUID,
  p_reason TEXT
)
RETURNS public.exam_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NOT public.m22_can_create_requests() THEN
    RAISE EXCEPTION 'Usuário sem permissão para cancelar requisição';
  END IF;
  RETURN m22_private.m22_cancel_exam_request(p_request_id, p_reason);
END;
$fn$;

REVOKE ALL ON FUNCTION public.m22_company_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.m22_can_create_requests() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.m22_can_dispatch_requests() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.m22_unit_access(UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.m22_create_exam_request_secure(
  INTEGER, BIGINT, UUID, BIGINT, BIGINT, TEXT, TEXT, TEXT, JSONB, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.m22_sign_exam_request_secure(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.m22_dispatch_exam_request_item_secure(
  UUID, TEXT, BIGINT, BIGINT, UUID, UUID, JSONB
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.m22_transition_exam_request_item_secure(
  UUID, TEXT, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.m22_cancel_exam_request_secure(UUID, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.m22_company_id() TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m22_can_create_requests() TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m22_can_dispatch_requests() TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m22_unit_access(UUID, INTEGER) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m22_create_exam_request_secure(
  INTEGER, BIGINT, UUID, BIGINT, BIGINT, TEXT, TEXT, TEXT, JSONB, TEXT
) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m22_sign_exam_request_secure(UUID) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m22_dispatch_exam_request_item_secure(
  UUID, TEXT, BIGINT, BIGINT, UUID, UUID, JSONB
) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m22_transition_exam_request_item_secure(
  UUID, TEXT, TEXT
) TO authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m22_cancel_exam_request_secure(UUID, TEXT)
  TO authenticated, app_prontomedic;

REVOKE ALL ON FUNCTION m22_private.m22_append_event(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSONB, UUID
) FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION m22_private.m22_recompute_request(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION m22_private.m22_create_exam_request(
  INTEGER, BIGINT, UUID, BIGINT, BIGINT, TEXT, TEXT, TEXT, JSONB, TEXT
) FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION m22_private.m22_sign_exam_request(UUID)
  FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION m22_private.m22_dispatch_exam_request_item(
  UUID, TEXT, BIGINT, BIGINT, UUID, UUID, JSONB
) FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION m22_private.m22_transition_exam_request_item(
  UUID, TEXT, TEXT
) FROM PUBLIC, anon, authenticated, app_prontomedic;
REVOKE ALL ON FUNCTION m22_private.m22_cancel_exam_request(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, app_prontomedic;

GRANT EXECUTE ON FUNCTION m22_private.m22_append_event(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSONB, UUID
) TO prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION m22_private.m22_recompute_request(UUID, UUID, UUID)
  TO prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION m22_private.m22_create_exam_request(
  INTEGER, BIGINT, UUID, BIGINT, BIGINT, TEXT, TEXT, TEXT, JSONB, TEXT
) TO prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION m22_private.m22_sign_exam_request(UUID)
  TO prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION m22_private.m22_dispatch_exam_request_item(
  UUID, TEXT, BIGINT, BIGINT, UUID, UUID, JSONB
) TO prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION m22_private.m22_transition_exam_request_item(
  UUID, TEXT, TEXT
) TO prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION m22_private.m22_cancel_exam_request(UUID, TEXT)
  TO prontomedic_rpc_owner;

GRANT USAGE ON SCHEMA public, private, auth TO prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION public.m22_company_id()
  TO prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION public.m22_unit_access(UUID, INTEGER)
  TO prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION public.current_company_id()
  TO prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION public.org_can_access_unit(UUID, INTEGER)
  TO prontomedic_rpc_owner;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.exam_requests,
  public.exam_request_items,
  public.exam_request_dispatches,
  public.exam_request_events
TO prontomedic_rpc_owner;
GRANT SELECT ON TABLE
  public.companies,
  public.units,
  public.user_profiles,
  public.patients,
  public.professionals,
  public.encounters,
  public.appointments,
  public.insurance_authorizations,
  public.tiss_guides,
  public.exames_lab_pedido,
  public.exames_lab_pedido_itens,
  public.imaging_orders,
  public.imaging_order_items,
  public.permissions,
  public.user_permissions,
  public.roles,
  public.role_permissions
TO prontomedic_rpc_owner;

DO $ownership$
DECLARE
  v_function REGPROCEDURE;
BEGIN
  FOR v_function IN
    SELECT p.oid::REGPROCEDURE
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'm22_private')
      AND p.proname LIKE 'm22_%'
      AND p.prosecdef
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO prontomedic_rpc_owner', v_function);
  END LOOP;
END
$ownership$;

DO $fn$
BEGIN
  IF to_regclass('public.prontomedic_deployment_migrations') IS NOT NULL THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE
      ON public.prontomedic_deployment_migrations
      FROM authenticated, app_prontomedic;
    INSERT INTO public.prontomedic_deployment_migrations(filename, applied_at)
    VALUES ('20260724014310_module22_exam_requests.sql', NOW())
    ON CONFLICT (filename) DO NOTHING;
  END IF;
END;
$fn$;

COMMIT;
