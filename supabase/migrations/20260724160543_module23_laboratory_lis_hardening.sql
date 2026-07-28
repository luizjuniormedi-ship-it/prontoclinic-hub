-- Module 23: Laboratory / LIS hardening and end-to-end specimen workflow.
-- This migration preserves the legacy LIS tables, closes their broad policies,
-- and adds tenant/unit-aware, auditable operations for the operational flow.
BEGIN;

DO $dependencies$
BEGIN
  IF to_regclass('public.exames_lab_catalogo') IS NULL
     OR to_regclass('public.exames_lab_pedido') IS NULL
     OR to_regclass('public.exames_lab_pedido_itens') IS NULL
     OR to_regclass('public.exames_lab_resultado') IS NULL
     OR to_regclass('public.exames_lab_alerta_critico') IS NULL
     OR to_regprocedure(
       'private.prontomedic_module_action_allowed(text,text,integer,boolean)'
     ) IS NULL
     OR to_regprocedure('private.org_can_access_unit_runtime(uuid,integer)') IS NULL THEN
    RAISE EXCEPTION 'M23 requires the legacy LIS schema and canonical authorization helpers';
  END IF;
END
$dependencies$;

INSERT INTO public.permissions (module, action, label, description)
VALUES
  ('laboratorio', 'view', 'Visualizar laboratorio', 'Consultar pedidos, amostras, resultados e qualidade no escopo autorizado'),
  ('laboratorio', 'create', 'Executar laboratorio', 'Criar pedidos, coletar amostras e registrar resultados'),
  ('laboratorio', 'edit', 'Validar laboratorio', 'Triar amostras, validar, liberar, comunicar criticos e entregar resultados'),
  ('laboratorio', 'export', 'Exportar laboratorio', 'Exportar resultados liberados no escopo autorizado')
ON CONFLICT (module, action) DO NOTHING;

INSERT INTO public.role_permissions (
  role_id, module, can_view, can_create, can_edit, can_delete, can_export
)
SELECT
  r.id,
  'laboratorio',
  TRUE,
  r.name IN ('admin', 'laboratorio', 'diagnostico'),
  r.name IN ('admin', 'laboratorio', 'diagnostico'),
  FALSE,
  r.name IN ('admin', 'laboratorio', 'medico', 'gestor')
FROM public.roles r
WHERE r.name IN ('admin', 'laboratorio', 'diagnostico', 'medico', 'gestor')
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
  AND rp.module = 'laboratorio'
  AND r.name NOT IN ('admin', 'laboratorio', 'diagnostico', 'medico', 'gestor')
  AND (rp.can_view OR rp.can_create OR rp.can_edit OR rp.can_delete OR rp.can_export);

ALTER TABLE public.exames_lab_catalogo
  ADD COLUMN IF NOT EXISTS tp_tubo TEXT,
  ADD COLUMN IF NOT EXISTS vl_critico_minimo NUMERIC(15,6),
  ADD COLUMN IF NOT EXISTS vl_critico_maximo NUMERIC(15,6),
  ADD COLUMN IF NOT EXISTS preparo_instrucoes TEXT;

ALTER TABLE public.exames_lab_pedido
  ADD COLUMN IF NOT EXISTS unit_id INTEGER REFERENCES public.units(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.exames_lab_pedido_itens
  ADD COLUMN IF NOT EXISTS source_exam_request_item_id UUID
    REFERENCES public.exam_request_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.exames_lab_resultado
  ADD COLUMN IF NOT EXISTS version_no INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_current BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS supersedes_result_id BIGINT
    REFERENCES public.exames_lab_resultado(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS recorded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS exames_lab_item_source_request_uq
  ON public.exames_lab_pedido_itens(source_exam_request_item_id)
  WHERE source_exam_request_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS exames_lab_pedido_unit_status_idx
  ON public.exames_lab_pedido(company_id, unit_id, tp_status, dt_pedido DESC);
CREATE INDEX IF NOT EXISTS exames_lab_resultado_current_idx
  ON public.exames_lab_resultado(cd_item_pedido, is_current, ds_parametro);

CREATE TABLE IF NOT EXISTS public.lab_equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  unit_id INTEGER NOT NULL REFERENCES public.units(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  integration_kind TEXT NOT NULL DEFAULT 'MANUAL'
    CHECK (integration_kind IN ('MANUAL', 'HL7', 'ASTM', 'API')),
  status TEXT NOT NULL DEFAULT 'INACTIVE'
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'MAINTENANCE', 'ERROR')),
  last_seen_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB
    CHECK (jsonb_typeof(metadata) = 'object'),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lab_equipment_company_code_uq UNIQUE (company_id, code),
  CONSTRAINT lab_equipment_company_id_id_uq UNIQUE (company_id, id)
);

CREATE TABLE IF NOT EXISTS public.lab_specimens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  unit_id INTEGER NOT NULL REFERENCES public.units(id) ON DELETE RESTRICT,
  order_id BIGINT NOT NULL REFERENCES public.exames_lab_pedido(id) ON DELETE RESTRICT,
  accession_number TEXT NOT NULL,
  barcode TEXT NOT NULL,
  specimen_type TEXT NOT NULL,
  container_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'LABELLED'
    CHECK (status IN (
      'LABELLED', 'COLLECTED', 'RECEIVED', 'REJECTED', 'PROCESSING',
      'STORED', 'DISCARDED', 'RECOLLECTION_REQUIRED'
    )),
  collected_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  collected_at TIMESTAMPTZ,
  received_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  received_at TIMESTAMPTZ,
  rejection_reason TEXT,
  parent_specimen_id UUID REFERENCES public.lab_specimens(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lab_specimens_company_accession_uq UNIQUE (company_id, accession_number),
  CONSTRAINT lab_specimens_company_barcode_uq UNIQUE (company_id, barcode),
  CONSTRAINT lab_specimens_company_id_id_uq UNIQUE (company_id, id),
  CONSTRAINT lab_specimens_rejection_reason_chk CHECK (
    status NOT IN ('REJECTED', 'RECOLLECTION_REQUIRED')
    OR NULLIF(BTRIM(rejection_reason), '') IS NOT NULL
  )
);

CREATE TABLE IF NOT EXISTS public.lab_specimen_items (
  company_id UUID NOT NULL,
  specimen_id UUID NOT NULL,
  order_item_id BIGINT NOT NULL REFERENCES public.exames_lab_pedido_itens(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (specimen_id, order_item_id),
  CONSTRAINT lab_specimen_items_specimen_fk
    FOREIGN KEY (company_id, specimen_id)
    REFERENCES public.lab_specimens(company_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.lab_specimen_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  specimen_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB
    CHECK (jsonb_typeof(metadata) = 'object'),
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lab_specimen_events_specimen_fk
    FOREIGN KEY (company_id, specimen_id)
    REFERENCES public.lab_specimens(company_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.lab_quality_control_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  unit_id INTEGER NOT NULL REFERENCES public.units(id) ON DELETE RESTRICT,
  equipment_id UUID NOT NULL,
  control_name TEXT NOT NULL,
  control_lot TEXT NOT NULL,
  control_level TEXT NOT NULL,
  measured_value NUMERIC(18,6) NOT NULL,
  target_value NUMERIC(18,6) NOT NULL,
  minimum_value NUMERIC(18,6) NOT NULL,
  maximum_value NUMERIC(18,6) NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('IN_CONTROL', 'WARNING', 'OUT_OF_CONTROL')),
  blocks_release BOOLEAN NOT NULL DEFAULT FALSE,
  performed_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lab_qc_equipment_fk
    FOREIGN KEY (company_id, equipment_id)
    REFERENCES public.lab_equipment(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT lab_qc_limits_chk CHECK (minimum_value <= target_value AND target_value <= maximum_value)
);

CREATE TABLE IF NOT EXISTS public.lab_result_validations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  unit_id INTEGER NOT NULL REFERENCES public.units(id) ON DELETE RESTRICT,
  order_item_id BIGINT NOT NULL REFERENCES public.exames_lab_pedido_itens(id) ON DELETE RESTRICT,
  validation_type TEXT NOT NULL
    CHECK (validation_type IN ('TECHNICAL', 'MEDICAL', 'RELEASE', 'RECTIFICATION')),
  actor_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  actor_role TEXT NOT NULL,
  note TEXT,
  signature_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lab_result_validation_step_uq
    UNIQUE (company_id, order_item_id, validation_type, created_at)
);

CREATE TABLE IF NOT EXISTS public.lab_delivery_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  unit_id INTEGER NOT NULL REFERENCES public.units(id) ON DELETE RESTRICT,
  order_id BIGINT NOT NULL REFERENCES public.exames_lab_pedido(id) ON DELETE RESTRICT,
  delivery_method TEXT NOT NULL
    CHECK (delivery_method IN ('PORTAL', 'PRINTED', 'EMAIL_PENDING', 'PICKUP')),
  recipient TEXT,
  delivered_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE TABLE IF NOT EXISTS public.lab_integration_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  unit_id INTEGER NOT NULL REFERENCES public.units(id) ON DELETE RESTRICT,
  equipment_id UUID NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('INBOUND', 'OUTBOUND')),
  message_type TEXT NOT NULL,
  external_message_id TEXT,
  payload_sha256 TEXT NOT NULL,
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  status TEXT NOT NULL DEFAULT 'RECEIVED'
    CHECK (status IN ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'DEAD_LETTER')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  error_message TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  CONSTRAINT lab_integration_equipment_fk
    FOREIGN KEY (company_id, equipment_id)
    REFERENCES public.lab_equipment(company_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS lab_integration_message_idempotency_uq
  ON public.lab_integration_messages(company_id, equipment_id, external_message_id)
  WHERE external_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS lab_specimens_order_idx
  ON public.lab_specimens(company_id, unit_id, order_id, status);
CREATE INDEX IF NOT EXISTS lab_specimen_events_timeline_idx
  ON public.lab_specimen_events(company_id, specimen_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lab_qc_equipment_time_idx
  ON public.lab_quality_control_runs(company_id, equipment_id, performed_at DESC);
CREATE INDEX IF NOT EXISTS lab_validation_item_idx
  ON public.lab_result_validations(company_id, order_item_id, created_at);
CREATE INDEX IF NOT EXISTS lab_delivery_order_idx
  ON public.lab_delivery_events(company_id, order_id, delivered_at DESC);
CREATE INDEX IF NOT EXISTS lab_integration_pending_idx
  ON public.lab_integration_messages(company_id, unit_id, status, received_at)
  WHERE status IN ('RECEIVED', 'PROCESSING', 'FAILED');

DO $drop_legacy_policies$
DECLARE
  v_policy RECORD;
  v_allowed_policy_names CONSTANT TEXT[] := ARRAY[
    'Authenticated can read lab catalog',
    'Lab can manage exam catalog',
    'Authenticated can read lab ref values',
    'Lab can manage ref values',
    'Authenticated can read lab orders',
    'Lab can manage lab orders',
    'Authenticated can read lab order items',
    'Lab can manage lab order items',
    'Authenticated can read lab results',
    'Lab can manage lab results',
    'Authenticated can read lab alerts',
    'Lab can manage lab alerts',
    'app_prontomedic_lis_catalogo_tenant',
    'app_prontomedic_lis_valor_tenant',
    'app_prontomedic_lis_pedido_tenant',
    'app_prontomedic_lis_itens_tenant',
    'app_prontomedic_lis_resultado_tenant',
    'app_prontomedic_lis_alerta_tenant',
    'm23_catalog_select',
    'm23_reference_select',
    'm23_order_select',
    'm23_order_item_select',
    'm23_result_select',
    'm23_critical_alert_select',
    'm23_equipment_select',
    'm23_specimen_select',
    'm23_specimen_item_select',
    'm23_specimen_event_select',
    'm23_qc_select',
    'm23_validation_select',
    'm23_delivery_select',
    'm23_integration_select'
  ];
BEGIN
  SELECT policyname, tablename
    INTO v_policy
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN (
       'exames_lab_catalogo', 'exames_lab_valor_referencia',
       'exames_lab_pedido', 'exames_lab_pedido_itens',
       'exames_lab_resultado', 'exames_lab_alerta_critico',
       'lab_equipment', 'lab_specimens', 'lab_specimen_items',
       'lab_specimen_events', 'lab_quality_control_runs',
       'lab_result_validations', 'lab_delivery_events',
       'lab_integration_messages'
     )
     AND NOT (
       policyname = ANY (v_allowed_policy_names)
       OR (
         policyname = tablename || '_' || lower(cmd)
         AND permissive = 'PERMISSIVE'
         AND roles = ARRAY['public']::NAME[]
         AND (
           (cmd IN ('SELECT', 'DELETE') AND qual = 'true' AND with_check IS NULL)
           OR (cmd = 'INSERT' AND qual IS NULL AND with_check = 'true')
           OR (cmd = 'UPDATE' AND qual = 'true' AND with_check = 'true')
         )
       )
     )
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'M23 refuses to remove unknown policy %.% without an explicit review',
      v_policy.tablename,
      v_policy.policyname;
  END IF;

  FOR v_policy IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'exames_lab_catalogo', 'exames_lab_valor_referencia',
        'exames_lab_pedido', 'exames_lab_pedido_itens',
        'exames_lab_resultado', 'exames_lab_alerta_critico',
        'lab_equipment', 'lab_specimens', 'lab_specimen_items',
        'lab_specimen_events', 'lab_quality_control_runs',
        'lab_result_validations', 'lab_delivery_events',
        'lab_integration_messages'
      )
      AND (
        policyname = ANY (v_allowed_policy_names)
        OR (
          policyname = tablename || '_' || lower(cmd)
          AND permissive = 'PERMISSIVE'
          AND roles = ARRAY['public']::NAME[]
          AND (
            (cmd IN ('SELECT', 'DELETE') AND qual = 'true' AND with_check IS NULL)
            OR (cmd = 'INSERT' AND qual IS NULL AND with_check = 'true')
            OR (cmd = 'UPDATE' AND qual = 'true' AND with_check = 'true')
          )
        )
      )
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      v_policy.policyname,
      v_policy.tablename
    );
  END LOOP;
END
$drop_legacy_policies$;

ALTER TABLE public.exames_lab_catalogo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exames_lab_catalogo FORCE ROW LEVEL SECURITY;
ALTER TABLE public.exames_lab_valor_referencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exames_lab_valor_referencia FORCE ROW LEVEL SECURITY;
ALTER TABLE public.exames_lab_pedido ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exames_lab_pedido FORCE ROW LEVEL SECURITY;
ALTER TABLE public.exames_lab_pedido_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exames_lab_pedido_itens FORCE ROW LEVEL SECURITY;
ALTER TABLE public.exames_lab_resultado ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exames_lab_resultado FORCE ROW LEVEL SECURITY;
ALTER TABLE public.exames_lab_alerta_critico ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exames_lab_alerta_critico FORCE ROW LEVEL SECURITY;
ALTER TABLE public.lab_equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_equipment FORCE ROW LEVEL SECURITY;
ALTER TABLE public.lab_specimens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_specimens FORCE ROW LEVEL SECURITY;
ALTER TABLE public.lab_specimen_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_specimen_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.lab_specimen_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_specimen_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.lab_quality_control_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_quality_control_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.lab_result_validations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_result_validations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.lab_delivery_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_delivery_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.lab_integration_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_integration_messages FORCE ROW LEVEL SECURITY;

CREATE POLICY m23_catalog_select ON public.exames_lab_catalogo
  FOR SELECT TO authenticated, app_prontomedic
  USING (company_id = public.audit_current_company_id());

CREATE POLICY m23_reference_select ON public.exames_lab_valor_referencia
  FOR SELECT TO authenticated, app_prontomedic
  USING (EXISTS (
    SELECT 1 FROM public.exames_lab_catalogo c
    WHERE c.id = cd_exame
      AND c.company_id = public.audit_current_company_id()
  ));

CREATE POLICY m23_order_select ON public.exames_lab_pedido
  FOR SELECT TO authenticated, app_prontomedic
  USING (
    company_id = public.audit_current_company_id()
    AND (unit_id IS NULL OR public.org_can_access_unit(company_id, unit_id))
  );

CREATE POLICY m23_order_item_select ON public.exames_lab_pedido_itens
  FOR SELECT TO authenticated, app_prontomedic
  USING (EXISTS (
    SELECT 1 FROM public.exames_lab_pedido p
    WHERE p.id = cd_pedido
      AND p.company_id = public.audit_current_company_id()
      AND (p.unit_id IS NULL OR public.org_can_access_unit(p.company_id, p.unit_id))
  ));

CREATE POLICY m23_result_select ON public.exames_lab_resultado
  FOR SELECT TO authenticated, app_prontomedic
  USING (EXISTS (
    SELECT 1
    FROM public.exames_lab_pedido_itens i
    JOIN public.exames_lab_pedido p ON p.id = i.cd_pedido
    WHERE i.id = cd_item_pedido
      AND p.company_id = public.audit_current_company_id()
      AND (p.unit_id IS NULL OR public.org_can_access_unit(p.company_id, p.unit_id))
  ));

CREATE POLICY m23_critical_alert_select ON public.exames_lab_alerta_critico
  FOR SELECT TO authenticated, app_prontomedic
  USING (EXISTS (
    SELECT 1
    FROM public.exames_lab_resultado r
    JOIN public.exames_lab_pedido_itens i ON i.id = r.cd_item_pedido
    JOIN public.exames_lab_pedido p ON p.id = i.cd_pedido
    WHERE r.id = cd_resultado
      AND p.company_id = public.audit_current_company_id()
      AND (p.unit_id IS NULL OR public.org_can_access_unit(p.company_id, p.unit_id))
  ));

CREATE POLICY m23_equipment_select ON public.lab_equipment
  FOR SELECT TO authenticated, app_prontomedic
  USING (
    company_id = public.audit_current_company_id()
    AND public.org_can_access_unit(company_id, unit_id)
  );

CREATE POLICY m23_specimen_select ON public.lab_specimens
  FOR SELECT TO authenticated, app_prontomedic
  USING (
    company_id = public.audit_current_company_id()
    AND public.org_can_access_unit(company_id, unit_id)
  );

CREATE POLICY m23_specimen_item_select ON public.lab_specimen_items
  FOR SELECT TO authenticated, app_prontomedic
  USING (EXISTS (
    SELECT 1 FROM public.lab_specimens s
    WHERE s.id = specimen_id
      AND s.company_id = public.audit_current_company_id()
      AND public.org_can_access_unit(s.company_id, s.unit_id)
  ));

CREATE POLICY m23_specimen_event_select ON public.lab_specimen_events
  FOR SELECT TO authenticated, app_prontomedic
  USING (EXISTS (
    SELECT 1 FROM public.lab_specimens s
    WHERE s.id = specimen_id
      AND s.company_id = public.audit_current_company_id()
      AND public.org_can_access_unit(s.company_id, s.unit_id)
  ));

CREATE POLICY m23_qc_select ON public.lab_quality_control_runs
  FOR SELECT TO authenticated, app_prontomedic
  USING (
    company_id = public.audit_current_company_id()
    AND public.org_can_access_unit(company_id, unit_id)
  );

CREATE POLICY m23_validation_select ON public.lab_result_validations
  FOR SELECT TO authenticated, app_prontomedic
  USING (
    company_id = public.audit_current_company_id()
    AND public.org_can_access_unit(company_id, unit_id)
  );

CREATE POLICY m23_delivery_select ON public.lab_delivery_events
  FOR SELECT TO authenticated, app_prontomedic
  USING (
    company_id = public.audit_current_company_id()
    AND public.org_can_access_unit(company_id, unit_id)
  );

CREATE POLICY m23_integration_select ON public.lab_integration_messages
  FOR SELECT TO app_prontomedic
  USING (
    company_id = public.audit_current_company_id()
    AND public.org_can_access_unit(company_id, unit_id)
  );

REVOKE ALL ON TABLE
  public.exames_lab_catalogo,
  public.exames_lab_valor_referencia,
  public.exames_lab_pedido,
  public.exames_lab_pedido_itens,
  public.exames_lab_resultado,
  public.exames_lab_alerta_critico,
  public.lab_equipment,
  public.lab_specimens,
  public.lab_specimen_items,
  public.lab_specimen_events,
  public.lab_quality_control_runs,
  public.lab_result_validations,
  public.lab_delivery_events,
  public.lab_integration_messages
FROM PUBLIC, anon, authenticated, app_prontomedic;

GRANT SELECT ON TABLE
  public.exames_lab_catalogo,
  public.exames_lab_valor_referencia,
  public.exames_lab_pedido,
  public.exames_lab_pedido_itens,
  public.exames_lab_resultado,
  public.exames_lab_alerta_critico,
  public.lab_equipment,
  public.lab_specimens,
  public.lab_specimen_items,
  public.lab_specimen_events,
  public.lab_quality_control_runs,
  public.lab_result_validations,
  public.lab_delivery_events
TO authenticated, app_prontomedic;
GRANT SELECT ON TABLE public.lab_integration_messages TO app_prontomedic;

CREATE SCHEMA IF NOT EXISTS m23_private;
REVOKE ALL ON SCHEMA m23_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA m23_private
  TO app_prontomedic, prontomedic_rpc_owner;

CREATE OR REPLACE FUNCTION m23_private.can(
  p_action TEXT,
  p_unit_id INTEGER,
  p_default BOOLEAN DEFAULT FALSE
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public, private
AS $fn$
  SELECT private.prontomedic_module_action_allowed(
    'laboratorio',
    p_action,
    p_unit_id,
    p_default
  )
$fn$;

CREATE OR REPLACE FUNCTION m23_private.actor_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $fn$
  SELECT lower(coalesce(up.role_name, ''))
  FROM public.user_profiles up
  WHERE (up.id = private.current_user_id() OR up.user_id = private.current_user_id())
    AND up.company_id = private.current_company_id()
    AND up.lg_ativo = TRUE
  LIMIT 1
$fn$;

CREATE OR REPLACE FUNCTION m23_private.append_specimen_event(
  p_company_id UUID,
  p_specimen_id UUID,
  p_event_type TEXT,
  p_from_status TEXT,
  p_to_status TEXT,
  p_reason TEXT,
  p_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, m23_private
AS $fn$
  INSERT INTO public.lab_specimen_events (
    company_id, specimen_id, event_type, from_status, to_status,
    reason, metadata, actor_user_id
  )
  VALUES (
    p_company_id, p_specimen_id, p_event_type, p_from_status, p_to_status,
    p_reason, coalesce(p_metadata, '{}'::JSONB), private.current_user_id()
  )
$fn$;

CREATE OR REPLACE FUNCTION m23_private.upsert_exam_catalog(
  p_exam_id BIGINT,
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, m23_private
AS $fn$
DECLARE
  v_company UUID := private.current_company_id();
  v_id BIGINT;
BEGIN
  IF v_company IS NULL OR NOT m23_private.can('edit', NULL, FALSE) THEN
    RAISE EXCEPTION 'M23 catalog access denied';
  END IF;
  IF NULLIF(BTRIM(p_payload->>'ds_exame'), '') IS NULL
     OR NULLIF(BTRIM(p_payload->>'ds_sigla'), '') IS NULL THEN
    RAISE EXCEPTION 'Exam name and abbreviation are required';
  END IF;

  IF p_exam_id IS NULL THEN
    INSERT INTO public.exames_lab_catalogo (
      company_id, ds_exame, ds_sigla, cd_tuss, cd_loinc, ds_categoria,
      ds_metodo, ds_material, tp_tubo, nr_prazo_dias, vl_particular,
      vl_convenio, vl_critico_minimo, vl_critico_maximo,
      preparo_instrucoes, lg_ativo
    )
    VALUES (
      v_company, BTRIM(p_payload->>'ds_exame'), BTRIM(p_payload->>'ds_sigla'),
      NULLIF(BTRIM(p_payload->>'cd_tuss'), ''),
      NULLIF(BTRIM(p_payload->>'cd_loinc'), ''),
      NULLIF(BTRIM(p_payload->>'ds_categoria'), ''),
      NULLIF(BTRIM(p_payload->>'ds_metodo'), ''),
      NULLIF(BTRIM(p_payload->>'ds_material'), ''),
      NULLIF(BTRIM(p_payload->>'tp_tubo'), ''),
      coalesce((p_payload->>'nr_prazo_dias')::SMALLINT, 3),
      (p_payload->>'vl_particular')::NUMERIC,
      (p_payload->>'vl_convenio')::NUMERIC,
      (p_payload->>'vl_critico_minimo')::NUMERIC,
      (p_payload->>'vl_critico_maximo')::NUMERIC,
      NULLIF(BTRIM(p_payload->>'preparo_instrucoes'), ''),
      coalesce((p_payload->>'lg_ativo')::BOOLEAN, TRUE)
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.exames_lab_catalogo
    SET ds_exame = BTRIM(p_payload->>'ds_exame'),
        ds_sigla = BTRIM(p_payload->>'ds_sigla'),
        cd_tuss = NULLIF(BTRIM(p_payload->>'cd_tuss'), ''),
        cd_loinc = NULLIF(BTRIM(p_payload->>'cd_loinc'), ''),
        ds_categoria = NULLIF(BTRIM(p_payload->>'ds_categoria'), ''),
        ds_metodo = NULLIF(BTRIM(p_payload->>'ds_metodo'), ''),
        ds_material = NULLIF(BTRIM(p_payload->>'ds_material'), ''),
        tp_tubo = NULLIF(BTRIM(p_payload->>'tp_tubo'), ''),
        nr_prazo_dias = coalesce((p_payload->>'nr_prazo_dias')::SMALLINT, nr_prazo_dias),
        vl_particular = (p_payload->>'vl_particular')::NUMERIC,
        vl_convenio = (p_payload->>'vl_convenio')::NUMERIC,
        vl_critico_minimo = (p_payload->>'vl_critico_minimo')::NUMERIC,
        vl_critico_maximo = (p_payload->>'vl_critico_maximo')::NUMERIC,
        preparo_instrucoes = NULLIF(BTRIM(p_payload->>'preparo_instrucoes'), ''),
        lg_ativo = coalesce((p_payload->>'lg_ativo')::BOOLEAN, lg_ativo),
        updated_at = NOW()
    WHERE id = p_exam_id AND company_id = v_company
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Exam not found in current company';
    END IF;
  END IF;

  RETURN jsonb_build_object('exam_id', v_id);
END
$fn$;

CREATE OR REPLACE FUNCTION m23_private.upsert_equipment(
  p_equipment_id UUID,
  p_unit_id INTEGER,
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, m23_private
AS $fn$
DECLARE
  v_company UUID := private.current_company_id();
  v_id UUID;
BEGIN
  IF v_company IS NULL
     OR NOT private.org_can_access_unit_runtime(v_company, p_unit_id)
     OR NOT m23_private.can('edit', p_unit_id, FALSE) THEN
    RAISE EXCEPTION 'M23 equipment access denied';
  END IF;
  IF NULLIF(BTRIM(p_payload->>'code'), '') IS NULL
     OR NULLIF(BTRIM(p_payload->>'name'), '') IS NULL THEN
    RAISE EXCEPTION 'Equipment code and name are required';
  END IF;
  IF coalesce(NULLIF(p_payload->>'integration_kind', ''), 'MANUAL')
     NOT IN ('MANUAL', 'HL7', 'ASTM', 'API') THEN
    RAISE EXCEPTION 'Invalid equipment integration kind';
  END IF;

  IF p_equipment_id IS NULL THEN
    INSERT INTO public.lab_equipment (
      company_id, unit_id, code, name, integration_kind,
      status, metadata, active, created_by
    )
    VALUES (
      v_company, p_unit_id, BTRIM(p_payload->>'code'),
      BTRIM(p_payload->>'name'),
      coalesce(NULLIF(p_payload->>'integration_kind', ''), 'MANUAL'),
      coalesce(NULLIF(p_payload->>'status', ''), 'INACTIVE'),
      coalesce(p_payload->'metadata', '{}'::JSONB),
      coalesce((p_payload->>'active')::BOOLEAN, TRUE),
      private.current_user_id()
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.lab_equipment
    SET unit_id = p_unit_id,
        code = BTRIM(p_payload->>'code'),
        name = BTRIM(p_payload->>'name'),
        integration_kind = coalesce(
          NULLIF(p_payload->>'integration_kind', ''),
          integration_kind
        ),
        status = coalesce(NULLIF(p_payload->>'status', ''), status),
        metadata = coalesce(p_payload->'metadata', metadata),
        active = coalesce((p_payload->>'active')::BOOLEAN, active),
        updated_at = NOW()
    WHERE id = p_equipment_id AND company_id = v_company
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Equipment not found in current company';
    END IF;
  END IF;

  RETURN jsonb_build_object('equipment_id', v_id);
END
$fn$;

CREATE OR REPLACE FUNCTION m23_private.upsert_reference_range(
  p_reference_id BIGINT,
  p_exam_id BIGINT,
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, m23_private
AS $fn$
DECLARE
  v_company UUID := private.current_company_id();
  v_id BIGINT;
  v_sex TEXT := upper(coalesce(NULLIF(p_payload->>'sex', ''), 'A'));
  v_minimum_age SMALLINT := coalesce((p_payload->>'minimumAge')::SMALLINT, 0);
  v_maximum_age SMALLINT := coalesce((p_payload->>'maximumAge')::SMALLINT, 120);
  v_minimum NUMERIC := NULLIF(p_payload->>'minimumValue', '')::NUMERIC;
  v_maximum NUMERIC := NULLIF(p_payload->>'maximumValue', '')::NUMERIC;
BEGIN
  IF v_company IS NULL OR NOT m23_private.can('edit', NULL, FALSE) THEN
    RAISE EXCEPTION 'M23 reference range access denied';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.exames_lab_catalogo
    WHERE id = p_exam_id
      AND company_id = v_company
  ) THEN
    RAISE EXCEPTION 'Laboratory exam is outside current company';
  END IF;
  IF NULLIF(BTRIM(p_payload->>'parameter'), '') IS NULL THEN
    RAISE EXCEPTION 'Reference parameter is required';
  END IF;
  IF v_sex NOT IN ('M', 'F', 'A') THEN
    RAISE EXCEPTION 'Invalid reference sex';
  END IF;
  IF v_minimum_age < 0 OR v_maximum_age < v_minimum_age OR v_maximum_age > 150 THEN
    RAISE EXCEPTION 'Invalid reference age range';
  END IF;
  IF v_minimum IS NULL AND v_maximum IS NULL THEN
    RAISE EXCEPTION 'At least one reference limit is required';
  END IF;
  IF v_minimum IS NOT NULL AND v_maximum IS NOT NULL AND v_minimum > v_maximum THEN
    RAISE EXCEPTION 'Reference minimum cannot exceed maximum';
  END IF;

  IF p_reference_id IS NULL THEN
    INSERT INTO public.exames_lab_valor_referencia (
      cd_exame, ds_parametro, vl_minimo, vl_maximo, ds_unidade,
      cd_sexo, nr_idade_min, nr_idade_max, lg_ativo
    )
    VALUES (
      p_exam_id,
      BTRIM(p_payload->>'parameter'),
      v_minimum,
      v_maximum,
      NULLIF(BTRIM(p_payload->>'unit'), ''),
      v_sex,
      v_minimum_age,
      v_maximum_age,
      coalesce((p_payload->>'active')::BOOLEAN, TRUE)
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.exames_lab_valor_referencia r
    SET cd_exame = p_exam_id,
        ds_parametro = BTRIM(p_payload->>'parameter'),
        vl_minimo = v_minimum,
        vl_maximo = v_maximum,
        ds_unidade = NULLIF(BTRIM(p_payload->>'unit'), ''),
        cd_sexo = v_sex,
        nr_idade_min = v_minimum_age,
        nr_idade_max = v_maximum_age,
        lg_ativo = coalesce((p_payload->>'active')::BOOLEAN, r.lg_ativo)
    FROM public.exames_lab_catalogo c
    WHERE r.id = p_reference_id
      AND r.cd_exame = c.id
      AND c.company_id = v_company
    RETURNING r.id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Reference range not found in current company';
    END IF;
  END IF;

  RETURN jsonb_build_object('reference_id', v_id, 'exam_id', p_exam_id);
END
$fn$;

CREATE OR REPLACE FUNCTION m23_private.create_order(
  p_unit_id INTEGER,
  p_patient_id BIGINT,
  p_professional_id BIGINT,
  p_appointment_id BIGINT,
  p_priority TEXT,
  p_clinical_hypothesis TEXT,
  p_notes TEXT,
  p_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, m23_private
AS $fn$
DECLARE
  v_company UUID := private.current_company_id();
  v_actor UUID := private.current_user_id();
  v_order_id BIGINT;
  v_item JSONB;
  v_item_id BIGINT;
  v_item_ids JSONB := '[]'::JSONB;
BEGIN
  IF v_company IS NULL OR v_actor IS NULL
     OR NOT private.org_can_access_unit_runtime(v_company, p_unit_id)
     OR NOT m23_private.can('create', p_unit_id, FALSE) THEN
    RAISE EXCEPTION 'M23 order access denied';
  END IF;
  IF p_priority NOT IN ('ROTINA', 'URGENTE', 'EMERGENCIA') THEN
    RAISE EXCEPTION 'Invalid laboratory priority';
  END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one laboratory exam is required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.patients
    WHERE id = p_patient_id AND company_id = v_company
  ) OR NOT EXISTS (
    SELECT 1 FROM public.professionals
    WHERE id = p_professional_id AND company_id = v_company
  ) THEN
    RAISE EXCEPTION 'Patient or professional is outside current company';
  END IF;

  INSERT INTO public.exames_lab_pedido (
    company_id, unit_id, cd_paciente, cd_medico, cd_appointment,
    tp_prioridade, ds_hipotese_diagnostica, ds_observacoes,
    tp_status, created_by, updated_at
  )
  VALUES (
    v_company, p_unit_id, p_patient_id, p_professional_id, p_appointment_id,
    p_priority, NULLIF(BTRIM(p_clinical_hypothesis), ''),
    NULLIF(BTRIM(p_notes), ''), 'PENDENTE', v_actor, NOW()
  )
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.exames_lab_catalogo
      WHERE id = (v_item->>'exam_id')::BIGINT
        AND company_id = v_company
        AND lg_ativo = TRUE
    ) THEN
      RAISE EXCEPTION 'Invalid laboratory catalog item';
    END IF;
    IF NULLIF(v_item->>'source_exam_request_item_id', '') IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.exam_request_items eri
         JOIN public.exam_requests er ON er.id = eri.request_id
         WHERE eri.id = (v_item->>'source_exam_request_item_id')::UUID
           AND er.company_id = v_company
           AND er.unit_id = p_unit_id
           AND eri.domain = 'LABORATORY'
       ) THEN
      RAISE EXCEPTION 'Source exam request item is invalid';
    END IF;

    INSERT INTO public.exames_lab_pedido_itens (
      cd_pedido, cd_exame, tp_status, ds_observacao,
      source_exam_request_item_id, updated_at
    )
    VALUES (
      v_order_id,
      (v_item->>'exam_id')::BIGINT,
      'PENDENTE',
      NULLIF(BTRIM(v_item->>'notes'), ''),
      NULLIF(v_item->>'source_exam_request_item_id', '')::UUID,
      NOW()
    )
    RETURNING id INTO v_item_id;
    v_item_ids := v_item_ids || jsonb_build_array(v_item_id);
  END LOOP;

  RETURN jsonb_build_object('order_id', v_order_id, 'item_ids', v_item_ids);
END
$fn$;

CREATE OR REPLACE FUNCTION m23_private.collect_specimen(
  p_order_id BIGINT,
  p_specimen_type TEXT,
  p_container_type TEXT,
  p_order_item_ids BIGINT[],
  p_accession_number TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, m23_private
AS $fn$
DECLARE
  v_order public.exames_lab_pedido%ROWTYPE;
  v_actor UUID := private.current_user_id();
  v_specimen_id UUID;
  v_accession TEXT;
  v_barcode TEXT;
  v_item_id BIGINT;
BEGIN
  SELECT * INTO v_order
  FROM public.exames_lab_pedido
  WHERE id = p_order_id
    AND company_id = private.current_company_id()
  FOR UPDATE;

  IF v_order.id IS NULL OR v_order.unit_id IS NULL
     OR NOT private.org_can_access_unit_runtime(v_order.company_id, v_order.unit_id)
     OR NOT m23_private.can('create', v_order.unit_id, FALSE) THEN
    RAISE EXCEPTION 'M23 collection access denied';
  END IF;
  IF coalesce(array_length(p_order_item_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Specimen must include at least one order item';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_order_item_ids) x
    WHERE NOT EXISTS (
      SELECT 1 FROM public.exames_lab_pedido_itens i
      WHERE i.id = x AND i.cd_pedido = p_order_id
        AND i.tp_status NOT IN ('LIBERADO', 'CANCELADO')
    )
  ) THEN
    RAISE EXCEPTION 'Invalid or closed laboratory order item';
  END IF;

  v_accession := coalesce(
    NULLIF(BTRIM(p_accession_number), ''),
    'M23-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS') || '-' ||
      upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 8))
  );
  v_barcode := upper(replace(gen_random_uuid()::TEXT, '-', ''));

  INSERT INTO public.lab_specimens (
    company_id, unit_id, order_id, accession_number, barcode,
    specimen_type, container_type, status, collected_by, collected_at,
    created_by
  )
  VALUES (
    v_order.company_id, v_order.unit_id, p_order_id, v_accession, v_barcode,
    BTRIM(p_specimen_type), BTRIM(p_container_type), 'COLLECTED',
    v_actor, NOW(), v_actor
  )
  RETURNING id INTO v_specimen_id;

  FOREACH v_item_id IN ARRAY p_order_item_ids
  LOOP
    INSERT INTO public.lab_specimen_items(company_id, specimen_id, order_item_id)
    VALUES (v_order.company_id, v_specimen_id, v_item_id);
    UPDATE public.exames_lab_pedido_itens
    SET tp_status = 'COLETADO',
        dt_coleta = NOW(),
        ds_amostra_id = v_accession,
        updated_at = NOW()
    WHERE id = v_item_id;
  END LOOP;

  UPDATE public.exames_lab_pedido
  SET tp_status = 'COLETADO', dt_coleta = coalesce(dt_coleta, NOW()), updated_at = NOW()
  WHERE id = p_order_id;

  PERFORM m23_private.append_specimen_event(
    v_order.company_id, v_specimen_id, 'COLLECTED', 'LABELLED', 'COLLECTED',
    NULL, jsonb_build_object('order_item_ids', to_jsonb(p_order_item_ids))
  );

  RETURN jsonb_build_object(
    'specimen_id', v_specimen_id,
    'accession_number', v_accession,
    'barcode', v_barcode
  );
END
$fn$;

CREATE OR REPLACE FUNCTION m23_private.transition_specimen(
  p_specimen_id UUID,
  p_status TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, m23_private
AS $fn$
DECLARE
  v_specimen public.lab_specimens%ROWTYPE;
  v_allowed BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_specimen
  FROM public.lab_specimens
  WHERE id = p_specimen_id
    AND company_id = private.current_company_id()
  FOR UPDATE;

  IF v_specimen.id IS NULL
     OR NOT private.org_can_access_unit_runtime(v_specimen.company_id, v_specimen.unit_id)
     OR NOT m23_private.can('edit', v_specimen.unit_id, FALSE) THEN
    RAISE EXCEPTION 'M23 specimen transition access denied';
  END IF;

  v_allowed := CASE v_specimen.status
    WHEN 'COLLECTED' THEN p_status IN ('RECEIVED', 'REJECTED', 'RECOLLECTION_REQUIRED')
    WHEN 'RECEIVED' THEN p_status IN ('PROCESSING', 'REJECTED', 'RECOLLECTION_REQUIRED')
    WHEN 'PROCESSING' THEN p_status IN ('STORED', 'REJECTED', 'RECOLLECTION_REQUIRED')
    WHEN 'STORED' THEN p_status = 'DISCARDED'
    ELSE FALSE
  END;
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Invalid specimen transition: % -> %', v_specimen.status, p_status;
  END IF;
  IF p_status IN ('REJECTED', 'RECOLLECTION_REQUIRED')
     AND NULLIF(BTRIM(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Reason is required for rejection or recollection';
  END IF;

  UPDATE public.lab_specimens
  SET status = p_status,
      received_by = CASE WHEN p_status = 'RECEIVED' THEN private.current_user_id() ELSE received_by END,
      received_at = CASE WHEN p_status = 'RECEIVED' THEN NOW() ELSE received_at END,
      rejection_reason = CASE
        WHEN p_status IN ('REJECTED', 'RECOLLECTION_REQUIRED') THEN BTRIM(p_reason)
        ELSE rejection_reason
      END,
      updated_at = NOW()
  WHERE id = p_specimen_id;

  UPDATE public.exames_lab_pedido_itens i
  SET tp_status = CASE WHEN p_status = 'PROCESSING' THEN 'EM_ANALISE' ELSE i.tp_status END,
      updated_at = NOW()
  FROM public.lab_specimen_items si
  WHERE si.specimen_id = p_specimen_id
    AND si.order_item_id = i.id;

  PERFORM m23_private.append_specimen_event(
    v_specimen.company_id, p_specimen_id, 'STATUS_CHANGED',
    v_specimen.status, p_status, NULLIF(BTRIM(p_reason), ''), '{}'::JSONB
  );
  RETURN jsonb_build_object('specimen_id', p_specimen_id, 'status', p_status);
END
$fn$;

CREATE OR REPLACE FUNCTION m23_private.record_qc_run(
  p_equipment_id UUID,
  p_control_name TEXT,
  p_control_lot TEXT,
  p_control_level TEXT,
  p_measured_value NUMERIC,
  p_target_value NUMERIC,
  p_minimum_value NUMERIC,
  p_maximum_value NUMERIC,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, m23_private
AS $fn$
DECLARE
  v_equipment public.lab_equipment%ROWTYPE;
  v_status TEXT;
  v_id UUID;
BEGIN
  SELECT * INTO v_equipment
  FROM public.lab_equipment
  WHERE id = p_equipment_id
    AND company_id = private.current_company_id()
    AND active = TRUE;
  IF v_equipment.id IS NULL
     OR NOT private.org_can_access_unit_runtime(v_equipment.company_id, v_equipment.unit_id)
     OR NOT m23_private.can('create', v_equipment.unit_id, FALSE) THEN
    RAISE EXCEPTION 'M23 QC access denied';
  END IF;
  IF p_minimum_value > p_target_value OR p_target_value > p_maximum_value THEN
    RAISE EXCEPTION 'Invalid QC limits';
  END IF;
  v_status := CASE
    WHEN p_measured_value < p_minimum_value OR p_measured_value > p_maximum_value
      THEN 'OUT_OF_CONTROL'
    WHEN p_measured_value < p_minimum_value + ((p_target_value - p_minimum_value) * 0.25)
      OR p_measured_value > p_maximum_value - ((p_maximum_value - p_target_value) * 0.25)
      THEN 'WARNING'
    ELSE 'IN_CONTROL'
  END;

  INSERT INTO public.lab_quality_control_runs (
    company_id, unit_id, equipment_id, control_name, control_lot,
    control_level, measured_value, target_value, minimum_value, maximum_value,
    status, blocks_release, performed_by, notes
  )
  VALUES (
    v_equipment.company_id, v_equipment.unit_id, p_equipment_id,
    BTRIM(p_control_name), BTRIM(p_control_lot), BTRIM(p_control_level),
    p_measured_value, p_target_value, p_minimum_value, p_maximum_value,
    v_status, v_status = 'OUT_OF_CONTROL', private.current_user_id(),
    NULLIF(BTRIM(p_notes), '')
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('qc_run_id', v_id, 'status', v_status);
END
$fn$;

CREATE OR REPLACE FUNCTION m23_private.record_results(
  p_order_item_id BIGINT,
  p_results JSONB,
  p_equipment_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, m23_private
AS $fn$
DECLARE
  v_order public.exames_lab_pedido%ROWTYPE;
  v_catalog public.exames_lab_catalogo%ROWTYPE;
  v_row JSONB;
  v_old public.exames_lab_resultado%ROWTYPE;
  v_result_id BIGINT;
  v_ids JSONB := '[]'::JSONB;
  v_numeric NUMERIC;
  v_reference_min NUMERIC;
  v_reference_max NUMERIC;
  v_classification TEXT;
BEGIN
  SELECT p.* INTO v_order
  FROM public.exames_lab_pedido p
  JOIN public.exames_lab_pedido_itens i ON i.cd_pedido = p.id
  WHERE i.id = p_order_item_id
    AND p.company_id = private.current_company_id()
  FOR UPDATE OF p;

  IF v_order.id IS NULL OR v_order.unit_id IS NULL
     OR NOT private.org_can_access_unit_runtime(v_order.company_id, v_order.unit_id)
     OR NOT m23_private.can('create', v_order.unit_id, FALSE) THEN
    RAISE EXCEPTION 'M23 result entry access denied';
  END IF;
  IF jsonb_typeof(p_results) <> 'array' OR jsonb_array_length(p_results) = 0 THEN
    RAISE EXCEPTION 'At least one result is required';
  END IF;
  SELECT c.* INTO v_catalog
  FROM public.exames_lab_pedido_itens i
  JOIN public.exames_lab_catalogo c ON c.id = i.cd_exame
  WHERE i.id = p_order_item_id AND c.company_id = v_order.company_id;
  IF p_equipment_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.lab_quality_control_runs q
    WHERE q.company_id = v_order.company_id
      AND q.unit_id = v_order.unit_id
      AND q.equipment_id = p_equipment_id
      AND q.blocks_release = TRUE
      AND q.performed_at >= NOW() - INTERVAL '24 hours'
      AND NOT EXISTS (
        SELECT 1 FROM public.lab_quality_control_runs q2
        WHERE q2.company_id = q.company_id
          AND q2.equipment_id = q.equipment_id
          AND q2.performed_at > q.performed_at
          AND q2.status = 'IN_CONTROL'
      )
  ) THEN
    RAISE EXCEPTION 'Equipment is blocked by out-of-control QC';
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_results)
  LOOP
    IF NULLIF(BTRIM(v_row->>'parameter'), '') IS NULL
       OR (
         NULLIF(v_row->>'numeric_value', '') IS NULL
         AND NULLIF(BTRIM(v_row->>'text_value'), '') IS NULL
       ) THEN
      RAISE EXCEPTION 'Each result requires parameter and value';
    END IF;
    v_numeric := NULLIF(v_row->>'numeric_value', '')::NUMERIC;
    v_reference_min := NULLIF(v_row->>'reference_min', '')::NUMERIC;
    v_reference_max := NULLIF(v_row->>'reference_max', '')::NUMERIC;
    v_classification := CASE
      WHEN v_numeric IS NULL THEN 'INCONCLUSIVO'
      WHEN v_catalog.vl_critico_minimo IS NOT NULL
        AND v_numeric < v_catalog.vl_critico_minimo THEN 'CRITICO_BAIXO'
      WHEN v_catalog.vl_critico_maximo IS NOT NULL
        AND v_numeric > v_catalog.vl_critico_maximo THEN 'CRITICO_ALTO'
      WHEN v_reference_min IS NOT NULL AND v_numeric < v_reference_min THEN 'BAIXO'
      WHEN v_reference_max IS NOT NULL AND v_numeric > v_reference_max THEN 'ALTO'
      WHEN v_reference_min IS NULL AND v_reference_max IS NULL THEN 'INCONCLUSIVO'
      ELSE 'NORMAL'
    END;

    SELECT * INTO v_old
    FROM public.exames_lab_resultado
    WHERE cd_item_pedido = p_order_item_id
      AND ds_parametro = BTRIM(v_row->>'parameter')
      AND is_current = TRUE
    ORDER BY version_no DESC
    LIMIT 1
    FOR UPDATE;

    UPDATE public.exames_lab_resultado
    SET is_current = FALSE
    WHERE id = v_old.id;

    INSERT INTO public.exames_lab_resultado (
      cd_item_pedido, ds_parametro, vl_resultado, vl_resultado_texto,
      ds_unidade, vl_minimo_referencia, vl_maximo_referencia, tp_resultado,
      cd_equipamento, cd_lote_reagente, cd_usuario_laboratorio,
      ds_observacao, version_no, is_current, supersedes_result_id, recorded_by
    )
    VALUES (
      p_order_item_id,
      BTRIM(v_row->>'parameter'),
      v_numeric,
      NULLIF(BTRIM(v_row->>'text_value'), ''),
      NULLIF(BTRIM(v_row->>'unit'), ''),
      v_reference_min,
      v_reference_max,
      v_classification,
      CASE WHEN p_equipment_id IS NULL THEN NULL ELSE p_equipment_id::TEXT END,
      NULLIF(BTRIM(v_row->>'reagent_lot'), ''),
      private.current_user_id(),
      NULLIF(BTRIM(v_row->>'note'), ''),
      coalesce(v_old.version_no, 0) + 1,
      TRUE,
      v_old.id,
      private.current_user_id()
    )
    RETURNING id INTO v_result_id;
    v_ids := v_ids || jsonb_build_array(v_result_id);
  END LOOP;

  UPDATE public.exames_lab_pedido_itens
  SET tp_status = 'EM_ANALISE', updated_at = NOW()
  WHERE id = p_order_item_id;
  UPDATE public.exames_lab_pedido
  SET tp_status = 'EM_ANALISE', updated_at = NOW()
  WHERE id = v_order.id;

  RETURN jsonb_build_object('result_ids', v_ids, 'order_item_id', p_order_item_id);
END
$fn$;

CREATE OR REPLACE FUNCTION m23_private.validate_result(
  p_order_item_id BIGINT,
  p_action TEXT,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, m23_private
AS $fn$
DECLARE
  v_order public.exames_lab_pedido%ROWTYPE;
  v_actor UUID := private.current_user_id();
  v_role TEXT := m23_private.actor_role();
  v_type TEXT;
  v_signature TEXT;
BEGIN
  SELECT p.* INTO v_order
  FROM public.exames_lab_pedido p
  JOIN public.exames_lab_pedido_itens i ON i.cd_pedido = p.id
  WHERE i.id = p_order_item_id
    AND p.company_id = private.current_company_id()
  FOR UPDATE OF p;
  IF v_order.id IS NULL OR v_order.unit_id IS NULL
     OR NOT private.org_can_access_unit_runtime(v_order.company_id, v_order.unit_id)
     OR NOT (
       m23_private.can('edit', v_order.unit_id, FALSE)
       OR (
         v_role IN ('admin', 'administrador', 'medico', 'médico', 'doctor')
         AND m23_private.can('view', v_order.unit_id, FALSE)
       )
     ) THEN
    RAISE EXCEPTION 'M23 validation access denied';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.exames_lab_resultado
    WHERE cd_item_pedido = p_order_item_id AND is_current = TRUE
  ) THEN
    RAISE EXCEPTION 'No current results to validate';
  END IF;

  v_type := CASE p_action
    WHEN 'TECHNICAL_VALIDATE' THEN 'TECHNICAL'
    WHEN 'MEDICAL_VALIDATE' THEN 'MEDICAL'
    WHEN 'RELEASE' THEN 'RELEASE'
    WHEN 'RECTIFY' THEN 'RECTIFICATION'
    ELSE NULL
  END;
  IF v_type IS NULL THEN
    RAISE EXCEPTION 'Invalid validation action';
  END IF;
  IF v_type = 'TECHNICAL'
     AND (
       v_role NOT IN (
         'admin', 'administrador', 'laboratorio', 'laboratório', 'diagnostico'
       )
       OR NOT m23_private.can('edit', v_order.unit_id, FALSE)
     ) THEN
    RAISE EXCEPTION 'Technical validator role required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.exames_lab_resultado
    WHERE cd_item_pedido = p_order_item_id
      AND is_current = TRUE
      AND recorded_by = v_actor
  ) THEN
    RAISE EXCEPTION 'Result recorder cannot validate the same result';
  END IF;
  IF v_type IN ('MEDICAL', 'RELEASE', 'RECTIFICATION')
     AND v_role NOT IN ('admin', 'administrador', 'medico', 'médico', 'doctor') THEN
    RAISE EXCEPTION 'Medical validator role required';
  END IF;
  IF v_type = 'MEDICAL' AND NOT EXISTS (
    SELECT 1 FROM public.lab_result_validations
    WHERE company_id = v_order.company_id
      AND order_item_id = p_order_item_id
      AND validation_type = 'TECHNICAL'
  ) THEN
    RAISE EXCEPTION 'Technical validation is required first';
  END IF;
  IF v_type = 'RELEASE' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.lab_result_validations
      WHERE company_id = v_order.company_id
        AND order_item_id = p_order_item_id
        AND validation_type = 'MEDICAL'
    ) THEN
      RAISE EXCEPTION 'Medical validation is required before release';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.exames_lab_alerta_critico a
      JOIN public.exames_lab_resultado r ON r.id = a.cd_resultado
      WHERE r.cd_item_pedido = p_order_item_id
        AND r.is_current = TRUE
        AND a.lg_comunicado = FALSE
    ) THEN
      RAISE EXCEPTION 'Critical result communication is pending';
    END IF;
  END IF;

  v_signature := encode(
    digest(
      v_order.company_id::TEXT || ':' || p_order_item_id::TEXT || ':' ||
      v_type || ':' || v_actor::TEXT || ':' || clock_timestamp()::TEXT,
      'sha256'
    ),
    'hex'
  );
  INSERT INTO public.lab_result_validations (
    company_id, unit_id, order_item_id, validation_type,
    actor_user_id, actor_role, note, signature_hash
  )
  VALUES (
    v_order.company_id, v_order.unit_id, p_order_item_id, v_type,
    v_actor, v_role, NULLIF(BTRIM(p_note), ''), v_signature
  );

  IF v_type = 'RELEASE' THEN
    UPDATE public.exames_lab_pedido_itens
    SET tp_status = 'LIBERADO', dt_liberacao = NOW(), updated_at = NOW()
    WHERE id = p_order_item_id;
    IF NOT EXISTS (
      SELECT 1 FROM public.exames_lab_pedido_itens
      WHERE cd_pedido = v_order.id AND tp_status NOT IN ('LIBERADO', 'CANCELADO')
    ) THEN
      UPDATE public.exames_lab_pedido
      SET tp_status = 'LIBERADO', dt_liberacao = NOW(), updated_at = NOW()
      WHERE id = v_order.id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'order_item_id', p_order_item_id,
    'validation_type', v_type,
    'signature_hash', v_signature
  );
END
$fn$;

CREATE OR REPLACE FUNCTION m23_private.acknowledge_critical_alert(
  p_alert_id BIGINT,
  p_communication_method TEXT,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, m23_private
AS $fn$
DECLARE
  v_company UUID;
  v_unit INTEGER;
BEGIN
  SELECT p.company_id, p.unit_id INTO v_company, v_unit
  FROM public.exames_lab_alerta_critico a
  JOIN public.exames_lab_resultado r ON r.id = a.cd_resultado
  JOIN public.exames_lab_pedido_itens i ON i.id = r.cd_item_pedido
  JOIN public.exames_lab_pedido p ON p.id = i.cd_pedido
  WHERE a.id = p_alert_id
    AND p.company_id = private.current_company_id()
  FOR UPDATE OF a;
  IF v_company IS NULL OR v_unit IS NULL
     OR NOT private.org_can_access_unit_runtime(v_company, v_unit)
     OR NOT m23_private.can('edit', v_unit, FALSE) THEN
    RAISE EXCEPTION 'M23 critical alert access denied';
  END IF;
  IF p_communication_method NOT IN ('TELEFONE', 'PRESENCIAL', 'WHATSAPP', 'EMAIL') THEN
    RAISE EXCEPTION 'Invalid critical result communication method';
  END IF;
  UPDATE public.exames_lab_alerta_critico
  SET lg_comunicado = TRUE,
      dt_comunicacao = NOW(),
      cd_usuario_comunicou = private.current_user_id(),
      ds_forma_comunicacao = p_communication_method
  WHERE id = p_alert_id AND lg_comunicado = FALSE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Critical alert was already acknowledged or not found';
  END IF;
  RETURN jsonb_build_object(
    'alert_id', p_alert_id,
    'communicated', TRUE,
    'note', NULLIF(BTRIM(p_note), '')
  );
END
$fn$;

CREATE OR REPLACE FUNCTION m23_private.deliver_order(
  p_order_id BIGINT,
  p_delivery_method TEXT,
  p_recipient TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, m23_private
AS $fn$
DECLARE
  v_order public.exames_lab_pedido%ROWTYPE;
  v_delivery_id UUID;
BEGIN
  SELECT * INTO v_order
  FROM public.exames_lab_pedido
  WHERE id = p_order_id
    AND company_id = private.current_company_id()
  FOR UPDATE;
  IF v_order.id IS NULL OR v_order.unit_id IS NULL
     OR NOT private.org_can_access_unit_runtime(v_order.company_id, v_order.unit_id)
     OR NOT m23_private.can('edit', v_order.unit_id, FALSE) THEN
    RAISE EXCEPTION 'M23 delivery access denied';
  END IF;
  IF v_order.tp_status <> 'LIBERADO' THEN
    RAISE EXCEPTION 'Only released laboratory orders can be delivered';
  END IF;
  IF p_delivery_method NOT IN ('PORTAL', 'PRINTED', 'EMAIL_PENDING', 'PICKUP') THEN
    RAISE EXCEPTION 'Invalid delivery method';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.exames_lab_alerta_critico a
    JOIN public.exames_lab_resultado r ON r.id = a.cd_resultado
    JOIN public.exames_lab_pedido_itens i ON i.id = r.cd_item_pedido
    WHERE i.cd_pedido = p_order_id AND a.lg_comunicado = FALSE
  ) THEN
    RAISE EXCEPTION 'Critical result communication is pending';
  END IF;

  INSERT INTO public.lab_delivery_events (
    company_id, unit_id, order_id, delivery_method,
    recipient, delivered_by, metadata
  )
  VALUES (
    v_order.company_id, v_order.unit_id, p_order_id, p_delivery_method,
    NULLIF(BTRIM(p_recipient), ''), private.current_user_id(),
    coalesce(p_metadata, '{}'::JSONB)
  )
  RETURNING id INTO v_delivery_id;
  UPDATE public.exames_lab_pedido
  SET tp_status = 'ENTREGUE', updated_at = NOW()
  WHERE id = p_order_id;
  RETURN jsonb_build_object('delivery_id', v_delivery_id, 'order_id', p_order_id);
END
$fn$;

ALTER FUNCTION m23_private.actor_role() OWNER TO prontomedic_rpc_owner;
ALTER FUNCTION m23_private.append_specimen_event(UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSONB)
  OWNER TO prontomedic_rpc_owner;
ALTER FUNCTION m23_private.upsert_exam_catalog(BIGINT, JSONB)
  OWNER TO prontomedic_rpc_owner;
ALTER FUNCTION m23_private.upsert_equipment(UUID, INTEGER, JSONB)
  OWNER TO prontomedic_rpc_owner;
ALTER FUNCTION m23_private.upsert_reference_range(BIGINT, BIGINT, JSONB)
  OWNER TO prontomedic_rpc_owner;
ALTER FUNCTION m23_private.create_order(INTEGER, BIGINT, BIGINT, BIGINT, TEXT, TEXT, TEXT, JSONB)
  OWNER TO prontomedic_rpc_owner;
ALTER FUNCTION m23_private.collect_specimen(BIGINT, TEXT, TEXT, BIGINT[], TEXT)
  OWNER TO prontomedic_rpc_owner;
ALTER FUNCTION m23_private.transition_specimen(UUID, TEXT, TEXT)
  OWNER TO prontomedic_rpc_owner;
ALTER FUNCTION m23_private.record_qc_run(UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT)
  OWNER TO prontomedic_rpc_owner;
ALTER FUNCTION m23_private.record_results(BIGINT, JSONB, UUID)
  OWNER TO prontomedic_rpc_owner;
ALTER FUNCTION m23_private.validate_result(BIGINT, TEXT, TEXT)
  OWNER TO prontomedic_rpc_owner;
ALTER FUNCTION m23_private.acknowledge_critical_alert(BIGINT, TEXT, TEXT)
  OWNER TO prontomedic_rpc_owner;
ALTER FUNCTION m23_private.deliver_order(BIGINT, TEXT, TEXT, JSONB)
  OWNER TO prontomedic_rpc_owner;

CREATE OR REPLACE FUNCTION public.m23_upsert_exam_catalog_secure(
  p_exam_id BIGINT,
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog, m23_private
AS $fn$
  SELECT m23_private.upsert_exam_catalog(p_exam_id, p_payload)
$fn$;

CREATE OR REPLACE FUNCTION public.m23_create_lab_order_secure(
  p_unit_id INTEGER,
  p_patient_id BIGINT,
  p_professional_id BIGINT,
  p_appointment_id BIGINT,
  p_priority TEXT,
  p_clinical_hypothesis TEXT,
  p_notes TEXT,
  p_items JSONB
)
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog, m23_private
AS $fn$
  SELECT m23_private.create_order(
    p_unit_id, p_patient_id, p_professional_id, p_appointment_id,
    p_priority, p_clinical_hypothesis, p_notes, p_items
  )
$fn$;

CREATE OR REPLACE FUNCTION public.m23_upsert_reference_range_secure(
  p_reference_id BIGINT,
  p_exam_id BIGINT,
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog, m23_private
AS $fn$
  SELECT m23_private.upsert_reference_range(
    p_reference_id, p_exam_id, p_payload
  )
$fn$;

CREATE OR REPLACE FUNCTION public.m23_upsert_equipment_secure(
  p_equipment_id UUID,
  p_unit_id INTEGER,
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog, m23_private
AS $fn$
  SELECT m23_private.upsert_equipment(p_equipment_id, p_unit_id, p_payload)
$fn$;

CREATE OR REPLACE FUNCTION public.m23_collect_specimen_secure(
  p_order_id BIGINT,
  p_specimen_type TEXT,
  p_container_type TEXT,
  p_order_item_ids BIGINT[],
  p_accession_number TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog, m23_private
AS $fn$
  SELECT m23_private.collect_specimen(
    p_order_id, p_specimen_type, p_container_type,
    p_order_item_ids, p_accession_number
  )
$fn$;

CREATE OR REPLACE FUNCTION public.m23_transition_specimen_secure(
  p_specimen_id UUID,
  p_status TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog, m23_private
AS $fn$
  SELECT m23_private.transition_specimen(p_specimen_id, p_status, p_reason)
$fn$;

CREATE OR REPLACE FUNCTION public.m23_record_qc_run_secure(
  p_equipment_id UUID,
  p_control_name TEXT,
  p_control_lot TEXT,
  p_control_level TEXT,
  p_measured_value NUMERIC,
  p_target_value NUMERIC,
  p_minimum_value NUMERIC,
  p_maximum_value NUMERIC,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog, m23_private
AS $fn$
  SELECT m23_private.record_qc_run(
    p_equipment_id, p_control_name, p_control_lot, p_control_level,
    p_measured_value, p_target_value, p_minimum_value, p_maximum_value, p_notes
  )
$fn$;

CREATE OR REPLACE FUNCTION public.m23_record_results_secure(
  p_order_item_id BIGINT,
  p_results JSONB,
  p_equipment_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog, m23_private
AS $fn$
  SELECT m23_private.record_results(p_order_item_id, p_results, p_equipment_id)
$fn$;

CREATE OR REPLACE FUNCTION public.m23_validate_result_secure(
  p_order_item_id BIGINT,
  p_action TEXT,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog, m23_private
AS $fn$
  SELECT m23_private.validate_result(p_order_item_id, p_action, p_note)
$fn$;

CREATE OR REPLACE FUNCTION public.m23_acknowledge_critical_alert_secure(
  p_alert_id BIGINT,
  p_communication_method TEXT,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog, m23_private
AS $fn$
  SELECT m23_private.acknowledge_critical_alert(
    p_alert_id, p_communication_method, p_note
  )
$fn$;

CREATE OR REPLACE FUNCTION public.m23_deliver_order_secure(
  p_order_id BIGINT,
  p_delivery_method TEXT,
  p_recipient TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog, m23_private
AS $fn$
  SELECT m23_private.deliver_order(
    p_order_id, p_delivery_method, p_recipient, p_metadata
  )
$fn$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA m23_private FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA m23_private
  TO app_prontomedic, prontomedic_rpc_owner;

REVOKE ALL ON FUNCTION public.m23_upsert_exam_catalog_secure(BIGINT, JSONB)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.m23_upsert_equipment_secure(UUID, INTEGER, JSONB)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.m23_upsert_reference_range_secure(BIGINT, BIGINT, JSONB)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.m23_create_lab_order_secure(
  INTEGER, BIGINT, BIGINT, BIGINT, TEXT, TEXT, TEXT, JSONB
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.m23_collect_specimen_secure(BIGINT, TEXT, TEXT, BIGINT[], TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.m23_transition_specimen_secure(UUID, TEXT, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.m23_record_qc_run_secure(
  UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.m23_record_results_secure(BIGINT, JSONB, UUID)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.m23_validate_result_secure(BIGINT, TEXT, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.m23_acknowledge_critical_alert_secure(BIGINT, TEXT, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.m23_deliver_order_secure(BIGINT, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.m23_upsert_exam_catalog_secure(BIGINT, JSONB)
  TO app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m23_upsert_equipment_secure(UUID, INTEGER, JSONB)
  TO app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m23_upsert_reference_range_secure(BIGINT, BIGINT, JSONB)
  TO app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m23_create_lab_order_secure(
  INTEGER, BIGINT, BIGINT, BIGINT, TEXT, TEXT, TEXT, JSONB
) TO app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m23_collect_specimen_secure(BIGINT, TEXT, TEXT, BIGINT[], TEXT)
  TO app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m23_transition_specimen_secure(UUID, TEXT, TEXT)
  TO app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m23_record_qc_run_secure(
  UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT
) TO app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m23_record_results_secure(BIGINT, JSONB, UUID)
  TO app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m23_validate_result_secure(BIGINT, TEXT, TEXT)
  TO app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m23_acknowledge_critical_alert_secure(BIGINT, TEXT, TEXT)
  TO app_prontomedic;
GRANT EXECUTE ON FUNCTION public.m23_deliver_order_secure(BIGINT, TEXT, TEXT, JSONB)
  TO app_prontomedic;

GRANT USAGE ON SCHEMA private, auth TO app_prontomedic;
GRANT EXECUTE ON FUNCTION auth.uid() TO app_prontomedic;
GRANT EXECUTE ON FUNCTION public.current_company_id() TO app_prontomedic;
GRANT EXECUTE ON FUNCTION private.current_user_id() TO app_prontomedic;
GRANT EXECUTE ON FUNCTION private.current_company_id() TO app_prontomedic;
GRANT EXECUTE ON FUNCTION private.org_can_access_unit_runtime(UUID, INTEGER)
  TO app_prontomedic;
GRANT EXECUTE ON FUNCTION private.prontomedic_module_action_allowed(
  TEXT, TEXT, INTEGER, BOOLEAN
) TO app_prontomedic;
GRANT EXECUTE ON FUNCTION public.audit_current_company_id()
  TO app_prontomedic;
GRANT EXECUTE ON FUNCTION public.org_can_access_unit(UUID, INTEGER)
  TO app_prontomedic;

GRANT USAGE ON SCHEMA public, private, auth TO prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION private.current_user_id()
  TO prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION private.current_company_id()
  TO prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION private.org_can_access_unit_runtime(UUID, INTEGER)
  TO prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION private.prontomedic_module_action_allowed(
  TEXT, TEXT, INTEGER, BOOLEAN
) TO prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION public.audit_current_company_id()
  TO prontomedic_rpc_owner;
GRANT EXECUTE ON FUNCTION public.org_can_access_unit(UUID, INTEGER)
  TO prontomedic_rpc_owner;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO prontomedic_rpc_owner;
GRANT SELECT, INSERT, UPDATE ON TABLE
  public.exames_lab_catalogo,
  public.exames_lab_valor_referencia,
  public.exames_lab_pedido,
  public.exames_lab_pedido_itens,
  public.exames_lab_resultado,
  public.exames_lab_alerta_critico,
  public.lab_equipment,
  public.lab_specimens,
  public.lab_specimen_items,
  public.lab_specimen_events,
  public.lab_quality_control_runs,
  public.lab_result_validations,
  public.lab_delivery_events,
  public.lab_integration_messages
TO prontomedic_rpc_owner;
GRANT SELECT ON TABLE
  public.companies, public.units, public.patients, public.professionals,
  public.user_profiles, public.roles, public.role_permissions,
  public.permissions, public.user_permissions,
  public.exam_requests, public.exam_request_items
TO prontomedic_rpc_owner;

ALTER FUNCTION public.is_lab_user(UUID)
  SET search_path = pg_catalog, public;
REVOKE ALL ON FUNCTION public.is_lab_user(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_lab_user(UUID) TO prontomedic_rpc_owner;

ALTER FUNCTION public.fn_gerar_alerta_critico()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.fn_gerar_alerta_critico()
  OWNER TO prontomedic_rpc_owner;
REVOKE ALL ON FUNCTION public.fn_gerar_alerta_critico()
  FROM PUBLIC, anon, authenticated, app_prontomedic;
GRANT EXECUTE ON FUNCTION public.fn_gerar_alerta_critico()
  TO prontomedic_rpc_owner;

DO $ledger$
BEGIN
  IF to_regclass('public.prontomedic_deployment_migrations') IS NOT NULL THEN
    INSERT INTO public.prontomedic_deployment_migrations(filename, applied_at)
    VALUES ('20260724160543_module23_laboratory_lis_hardening.sql', NOW())
    ON CONFLICT (filename) DO NOTHING;
  END IF;
END
$ledger$;

COMMIT;
