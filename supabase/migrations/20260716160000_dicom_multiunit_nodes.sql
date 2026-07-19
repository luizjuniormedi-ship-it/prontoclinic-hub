-- =============================================================================
-- Migration: 20260716160000_dicom_multiunit_nodes
-- Objetivo: roteamento DICOM multiunidade para PACS e Worklist.
--
-- Esta migration nao migra nem consulta DataSIGH. A configuracao legada em
-- dicom_equipment continua valida; os novos vinculos sao opcionais.
-- Credenciais Orthanc nunca sao armazenadas nesta base ou expostas ao browser.
-- O gateway server-side resolve rest_endpoint_ref por segredo de ambiente.
-- =============================================================================

BEGIN;

-- A VPS ProntoMedic usa PostgreSQL direto e a role app_prontomedic. Mantenha
-- as roles de grupo da Data API para que a mesma migration rode tanto nesse
-- ambiente quanto no Supabase, sem criar logins ou credenciais adicionais.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.dicom_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  unit_id INTEGER REFERENCES public.units(id) ON DELETE RESTRICT,
  name VARCHAR(120) NOT NULL,
  node_kind VARCHAR(20) NOT NULL CHECK (node_kind IN ('pacs', 'worklist')),
  aetitle VARCHAR(16) NOT NULL,
  dicom_host VARCHAR(255),
  dicom_port INTEGER NOT NULL DEFAULT 4242 CHECK (dicom_port BETWEEN 1 AND 65535),
  rest_endpoint_ref VARCHAR(120),
  priority INTEGER NOT NULL DEFAULT 100 CHECK (priority >= 0),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  health_status VARCHAR(20) NOT NULL DEFAULT 'unknown'
    CHECK (health_status IN ('unknown', 'healthy', 'degraded', 'offline')),
  last_health_check_at TIMESTAMPTZ,
  last_health_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT dicom_nodes_company_name_kind_key UNIQUE (company_id, name, node_kind)
);

-- Compatibilidade com instalacoes anteriores, nas quais dicom_nodes ja
-- existia com node_type/ip_address/port/active. CREATE TABLE IF NOT EXISTS
-- nao acrescenta colunas ausentes, portanto normalize os dois contratos
-- antes de criar indices, policies ou receber novos registros.
ALTER TABLE public.dicom_nodes
  ADD COLUMN IF NOT EXISTS unit_id INTEGER REFERENCES public.units(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS node_kind VARCHAR(20),
  ADD COLUMN IF NOT EXISTS dicom_host VARCHAR(255),
  ADD COLUMN IF NOT EXISTS dicom_port INTEGER DEFAULT 4242,
  ADD COLUMN IF NOT EXISTS rest_endpoint_ref VARCHAR(120),
  ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 100,
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS health_status VARCHAR(20) DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS last_health_check_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_health_error TEXT,
  ADD COLUMN IF NOT EXISTS node_type VARCHAR(20),
  ADD COLUMN IF NOT EXISTS ip_address INET,
  ADD COLUMN IF NOT EXISTS port INTEGER,
  ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE;

UPDATE public.dicom_nodes
SET node_kind = CASE
      WHEN lower(coalesce(node_type, '')) IN ('pacs', 'worklist') THEN lower(node_type)
      ELSE node_kind
    END,
    dicom_host = COALESCE(dicom_host, host(ip_address)),
    dicom_port = COALESCE(dicom_port, port, 4242),
    priority = COALESCE(priority, 100),
    is_default = COALESCE(is_default, FALSE),
    is_active = COALESCE(is_active, active, TRUE),
    health_status = COALESCE(health_status, 'unknown');

CREATE OR REPLACE FUNCTION public.sync_dicom_node_contracts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.node_kind := COALESCE(NEW.node_kind, NEW.node_type);
  NEW.node_type := COALESCE(NEW.node_type, NEW.node_kind);
  NEW.dicom_host := COALESCE(NEW.dicom_host, host(NEW.ip_address));
  NEW.dicom_port := COALESCE(NEW.dicom_port, NEW.port, 4242);
  NEW.port := COALESCE(NEW.port, NEW.dicom_port);
  NEW.is_active := COALESCE(NEW.is_active, NEW.active, TRUE);
  NEW.active := COALESCE(NEW.active, NEW.is_active, TRUE);
  NEW.priority := COALESCE(NEW.priority, 100);
  NEW.is_default := COALESCE(NEW.is_default, FALSE);
  NEW.health_status := COALESCE(NEW.health_status, 'unknown');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_dicom_node_contracts() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_sync_dicom_node_contracts ON public.dicom_nodes;
CREATE TRIGGER trg_sync_dicom_node_contracts
  BEFORE INSERT OR UPDATE ON public.dicom_nodes
  FOR EACH ROW EXECUTE FUNCTION public.sync_dicom_node_contracts();

CREATE UNIQUE INDEX IF NOT EXISTS dicom_nodes_one_default_per_scope
  ON public.dicom_nodes(company_id, COALESCE(unit_id, 0), node_kind)
  WHERE is_default = TRUE AND is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_dicom_nodes_scope
  ON public.dicom_nodes(company_id, unit_id, node_kind, is_active, priority);

ALTER TABLE public.dicom_equipment
  ADD COLUMN IF NOT EXISTS unit_id INTEGER REFERENCES public.units(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS pacs_node_id UUID REFERENCES public.dicom_nodes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS worklist_node_id UUID REFERENCES public.dicom_nodes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_dicom_equipment_unit ON public.dicom_equipment(company_id, unit_id);
CREATE INDEX IF NOT EXISTS idx_dicom_equipment_pacs_node ON public.dicom_equipment(pacs_node_id);
CREATE INDEX IF NOT EXISTS idx_dicom_equipment_worklist_node ON public.dicom_equipment(worklist_node_id);

ALTER TABLE public.dicom_worklist
  ADD COLUMN IF NOT EXISTS unit_id INTEGER REFERENCES public.units(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS destination_node_id UUID REFERENCES public.dicom_nodes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_dicom_worklist_destination
  ON public.dicom_worklist(company_id, unit_id, destination_node_id);

ALTER TABLE public.dicom_exams
  ADD COLUMN IF NOT EXISTS unit_id INTEGER REFERENCES public.units(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS source_node_id UUID REFERENCES public.dicom_nodes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_dicom_exams_source_node ON public.dicom_exams(company_id, unit_id, source_node_id);

CREATE TABLE IF NOT EXISTS public.dicom_worklist_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  unit_id INTEGER REFERENCES public.units(id) ON DELETE RESTRICT,
  destination_node_id UUID REFERENCES public.dicom_nodes(id) ON DELETE SET NULL,
  imaging_order_item_id TEXT,
  patient_id TEXT NOT NULL,
  patient_name VARCHAR(200) NOT NULL,
  patient_birth_date DATE,
  patient_sex VARCHAR(1),
  patient_identifier VARCHAR(100),
  accession_number VARCHAR(100) NOT NULL,
  requested_procedure_description TEXT,
  requested_procedure_id VARCHAR(100),
  scheduled_procedure_step_id VARCHAR(100),
  modality_type VARCHAR(10) NOT NULL,
  scheduled_station_aetitle VARCHAR(20),
  scheduled_station_name VARCHAR(100),
  scheduled_datetime TIMESTAMPTZ,
  referring_physician_name VARCHAR(200),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'exported', 'acquired', 'cancelled', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT,
  exported_to_worklist BOOLEAN NOT NULL DEFAULT FALSE,
  last_export_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dicom_worklist_queue_route
  ON public.dicom_worklist_queue(company_id, unit_id, destination_node_id, status, scheduled_datetime);
CREATE INDEX IF NOT EXISTS idx_dicom_worklist_queue_accession
  ON public.dicom_worklist_queue(company_id, accession_number);

CREATE TABLE IF NOT EXISTS public.pacs_studies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  unit_id INTEGER REFERENCES public.units(id) ON DELETE RESTRICT,
  source_node_id UUID REFERENCES public.dicom_nodes(id) ON DELETE SET NULL,
  patient_id TEXT NOT NULL,
  imaging_order_item_id TEXT,
  study_instance_uid VARCHAR(200) NOT NULL UNIQUE,
  accession_number VARCHAR(100),
  study_date DATE,
  study_time VARCHAR(20),
  modality_type VARCHAR(10),
  station_aetitle VARCHAR(20),
  pacs_status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (pacs_status IN ('pending', 'received', 'reported', 'delivered')),
  received_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.pacs_studies
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS unit_id INTEGER REFERENCES public.units(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS source_node_id UUID REFERENCES public.dicom_nodes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_pacs_studies_route
  ON public.pacs_studies(company_id, unit_id, source_node_id, received_at DESC);

CREATE OR REPLACE FUNCTION public.dicom_unit_access(p_company_id UUID, p_unit_id INTEGER)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT p_company_id = COALESCE(
      NULLIF(current_setting('request.jwt.claim.company_id', true), '')::UUID,
      (SELECT up_company.company_id FROM public.user_profiles up_company WHERE up_company.id = auth.uid())
    )
    AND (
      p_unit_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.user_profiles up
        WHERE up.id = auth.uid()
          AND up.company_id = p_company_id
          AND (
            up.primary_unit_id IS NULL
            OR up.primary_unit_id = p_unit_id
            OR lower(coalesce(up.role_name, '')) IN ('admin', 'administrador')
          )
      )
    )
$$;
REVOKE ALL ON FUNCTION public.dicom_unit_access(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dicom_unit_access(UUID, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.dicom_is_technical_role()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND lower(coalesce(up.role_name, '')) IN (
        'admin', 'administrador', 'technical', 'tecnico', 'technician',
        'radiologist', 'radiologia', 'ti'
      )
  )
$$;
REVOKE ALL ON FUNCTION public.dicom_is_technical_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dicom_is_technical_role() TO authenticated;

ALTER TABLE public.dicom_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dicom_worklist_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pacs_studies ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.dicom_nodes, public.dicom_worklist_queue, public.pacs_studies FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.dicom_nodes, public.dicom_worklist_queue, public.pacs_studies TO authenticated;

DROP POLICY IF EXISTS dicom_nodes_tenant_read ON public.dicom_nodes;
CREATE POLICY dicom_nodes_tenant_read ON public.dicom_nodes
  FOR SELECT TO authenticated
  USING (public.dicom_unit_access(company_id, unit_id));
DROP POLICY IF EXISTS dicom_nodes_tenant_write ON public.dicom_nodes;
CREATE POLICY dicom_nodes_tenant_write ON public.dicom_nodes
  FOR ALL TO authenticated
  USING (public.dicom_is_technical_role() AND public.dicom_unit_access(company_id, unit_id))
  WITH CHECK (public.dicom_is_technical_role() AND public.dicom_unit_access(company_id, unit_id));

DROP POLICY IF EXISTS dicom_worklist_queue_tenant_read ON public.dicom_worklist_queue;
CREATE POLICY dicom_worklist_queue_tenant_read ON public.dicom_worklist_queue
  FOR SELECT TO authenticated
  USING (public.dicom_unit_access(company_id, unit_id));
DROP POLICY IF EXISTS dicom_worklist_queue_tenant_write ON public.dicom_worklist_queue;
CREATE POLICY dicom_worklist_queue_tenant_write ON public.dicom_worklist_queue
  FOR ALL TO authenticated
  USING (public.dicom_is_technical_role() AND public.dicom_unit_access(company_id, unit_id))
  WITH CHECK (
    public.dicom_is_technical_role()
    AND public.dicom_unit_access(company_id, unit_id)
    AND (
      destination_node_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.dicom_nodes n
        WHERE n.id = destination_node_id
          AND n.company_id = company_id
          AND (n.unit_id IS NULL OR n.unit_id = dicom_worklist_queue.unit_id)
      )
    )
  );

DROP POLICY IF EXISTS pacs_studies_tenant_read ON public.pacs_studies;
CREATE POLICY pacs_studies_tenant_read ON public.pacs_studies
  FOR SELECT TO authenticated
  USING (public.dicom_unit_access(company_id, unit_id));
DROP POLICY IF EXISTS pacs_studies_tenant_write ON public.pacs_studies;
CREATE POLICY pacs_studies_tenant_write ON public.pacs_studies
  FOR ALL TO authenticated
  USING (public.dicom_is_technical_role() AND public.dicom_unit_access(company_id, unit_id))
  WITH CHECK (public.dicom_is_technical_role() AND public.dicom_unit_access(company_id, unit_id));

-- Remove the older company-only policies so unit scoping cannot be widened by
-- PostgreSQL's permissive policy OR semantics.
DROP POLICY IF EXISTS "Users can read dicom_equipment from their company" ON public.dicom_equipment;
DROP POLICY IF EXISTS "Admins and radiology can manage dicom_equipment" ON public.dicom_equipment;
DROP POLICY IF EXISTS "Users can read dicom_exams from their company" ON public.dicom_exams;
DROP POLICY IF EXISTS "Admins and radiology can manage dicom_exams" ON public.dicom_exams;
DROP POLICY IF EXISTS dicom_equipment_unit_read ON public.dicom_equipment;
DROP POLICY IF EXISTS dicom_equipment_unit_write ON public.dicom_equipment;
DROP POLICY IF EXISTS dicom_exams_unit_read ON public.dicom_exams;
DROP POLICY IF EXISTS dicom_exams_unit_write ON public.dicom_exams;
CREATE POLICY dicom_equipment_unit_read ON public.dicom_equipment
  FOR SELECT TO authenticated USING (public.dicom_unit_access(company_id, unit_id));
CREATE POLICY dicom_equipment_unit_write ON public.dicom_equipment
  FOR ALL TO authenticated
  USING (public.dicom_is_technical_role() AND public.dicom_unit_access(company_id, unit_id))
  WITH CHECK (public.dicom_is_technical_role() AND public.dicom_unit_access(company_id, unit_id));
CREATE POLICY dicom_exams_unit_read ON public.dicom_exams
  FOR SELECT TO authenticated USING (public.dicom_unit_access(company_id, unit_id));
CREATE POLICY dicom_exams_unit_write ON public.dicom_exams
  FOR ALL TO authenticated
  USING (public.dicom_is_technical_role() AND public.dicom_unit_access(company_id, unit_id))
  WITH CHECK (public.dicom_is_technical_role() AND public.dicom_unit_access(company_id, unit_id));

COMMENT ON TABLE public.dicom_nodes IS 'PACS/Worklist por unidade; rest_endpoint_ref e resolvido somente no gateway server-side.';
COMMENT ON COLUMN public.dicom_nodes.rest_endpoint_ref IS 'Referencia opaca de segredo do gateway; nunca e uma credencial nem senha.';
COMMENT ON COLUMN public.dicom_worklist_queue.attempts IS 'Contador de tentativas de exportacao para o Worklist destination_node_id.';

COMMIT;
