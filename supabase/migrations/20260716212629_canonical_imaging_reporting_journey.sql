-- Canonical medico -> imagem -> Worklist/PACS -> laudo journey.
-- Created with `supabase migration new canonical_imaging_reporting_journey`.
BEGIN;

CREATE TABLE IF NOT EXISTS public.imaging_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  unit_id INTEGER REFERENCES public.units(id) ON DELETE RESTRICT,
  patient_id BIGINT NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  encounter_id BIGINT,
  scheduling_id BIGINT REFERENCES public.appointments(id) ON DELETE SET NULL,
  requesting_physician_id BIGINT NOT NULL REFERENCES public.professionals(id) ON DELETE RESTRICT,
  referring_physician_name VARCHAR(200),
  clinical_indication TEXT,
  priority VARCHAR(20) NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','urgent','emergency')),
  accession_number VARCHAR(64) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'agendado',
  notes TEXT,
  created_by UUID NOT NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT imaging_orders_company_accession_key UNIQUE (company_id, accession_number)
);

CREATE TABLE IF NOT EXISTS public.imaging_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  imaging_order_id UUID NOT NULL REFERENCES public.imaging_orders(id) ON DELETE CASCADE,
  exam_code VARCHAR(80),
  exam_name VARCHAR(200) NOT NULL,
  modality_type VARCHAR(10) NOT NULL,
  body_part VARCHAR(100),
  laterality VARCHAR(20) CHECK (laterality IS NULL OR laterality IN ('left','right','bilateral','na')),
  contrast_required BOOLEAN NOT NULL DEFAULT FALSE,
  station_aetitle VARCHAR(20),
  scheduled_date DATE,
  scheduled_time TIME,
  scheduled_datetime TIMESTAMPTZ,
  requested_procedure_id VARCHAR(100),
  scheduled_procedure_step_id VARCHAR(100),
  study_instance_uid VARCHAR(200),
  status VARCHAR(30) NOT NULL DEFAULT 'agendado',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.imaging_orders
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS unit_id INTEGER REFERENCES public.units(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS patient_id BIGINT REFERENCES public.patients(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS encounter_id BIGINT,
  ADD COLUMN IF NOT EXISTS scheduling_id BIGINT REFERENCES public.appointments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS requesting_physician_id BIGINT REFERENCES public.professionals(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS referring_physician_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS clinical_indication TEXT,
  ADD COLUMN IF NOT EXISTS priority VARCHAR(20) NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS accession_number VARCHAR(64),
  ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'agendado',
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS created_by UUID DEFAULT auth.uid(),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.imaging_order_items
  ADD COLUMN IF NOT EXISTS imaging_order_id UUID REFERENCES public.imaging_orders(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS exam_code VARCHAR(80),
  ADD COLUMN IF NOT EXISTS exam_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS modality_type VARCHAR(10),
  ADD COLUMN IF NOT EXISTS body_part VARCHAR(100),
  ADD COLUMN IF NOT EXISTS laterality VARCHAR(20),
  ADD COLUMN IF NOT EXISTS contrast_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS station_aetitle VARCHAR(20),
  ADD COLUMN IF NOT EXISTS scheduled_date DATE,
  ADD COLUMN IF NOT EXISTS scheduled_time TIME,
  ADD COLUMN IF NOT EXISTS scheduled_datetime TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS requested_procedure_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS scheduled_procedure_step_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS study_instance_uid VARCHAR(200),
  ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'agendado',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS public.report_types (
  id SERIAL PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(120) NOT NULL,
  category VARCHAR(60) NOT NULL DEFAULT 'RADIOLOGIA',
  sla_minutes INTEGER,
  requires_images BOOLEAN NOT NULL DEFAULT TRUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT report_types_company_code_key UNIQUE (company_id, code)
);
ALTER TABLE public.report_types
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS code VARCHAR(40),
  ADD COLUMN IF NOT EXISTS name VARCHAR(120),
  ADD COLUMN IF NOT EXISTS category VARCHAR(60) NOT NULL DEFAULT 'RADIOLOGIA',
  ADD COLUMN IF NOT EXISTS sla_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS requires_images BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS public.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  unit_id INTEGER REFERENCES public.units(id) ON DELETE RESTRICT,
  patient_id BIGINT NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  medical_record_id BIGINT,
  report_type_id INTEGER REFERENCES public.report_types(id) ON DELETE SET NULL,
  imaging_order_item_id UUID REFERENCES public.imaging_order_items(id) ON DELETE SET NULL,
  pacs_study_id UUID REFERENCES public.pacs_studies(id) ON DELETE SET NULL,
  study_instance_uid VARCHAR(200),
  cd_servico_sigh BIGINT,
  status VARCHAR(40) NOT NULL DEFAULT 'aguardando_laudo',
  priority VARCHAR(20) NOT NULL DEFAULT 'rotina',
  title VARCHAR(240),
  clinical_indication TEXT,
  technique TEXT,
  findings TEXT,
  conclusion TEXT,
  recommendation TEXT,
  cid_principal VARCHAR(20),
  signed_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  signed_by_user_id UUID,
  signed_by_name VARCHAR(200),
  signed_by_crm VARCHAR(30),
  executor_professional_id BIGINT REFERENCES public.professionals(id) ON DELETE SET NULL,
  executor_name VARCHAR(200),
  executor_crm VARCHAR(30),
  requester_professional_id BIGINT REFERENCES public.professionals(id) ON DELETE SET NULL,
  requester_name VARCHAR(200),
  has_critical_finding BOOLEAN NOT NULL DEFAULT FALSE,
  is_rectified BOOLEAN NOT NULL DEFAULT FALSE,
  previous_report_id UUID REFERENCES public.reports(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1,
  validation_code VARCHAR(80) DEFAULT encode(gen_random_bytes(16), 'hex'),
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Existing installations may already have the imported SIGH reports table.
ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS unit_id INTEGER REFERENCES public.units(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS patient_id BIGINT REFERENCES public.patients(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS medical_record_id BIGINT,
  ADD COLUMN IF NOT EXISTS report_type_id INTEGER REFERENCES public.report_types(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS imaging_order_item_id UUID REFERENCES public.imaging_order_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pacs_study_id UUID REFERENCES public.pacs_studies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS study_instance_uid VARCHAR(200),
  ADD COLUMN IF NOT EXISTS cd_servico_sigh BIGINT,
  ADD COLUMN IF NOT EXISTS status VARCHAR(40) NOT NULL DEFAULT 'aguardando_laudo',
  ADD COLUMN IF NOT EXISTS priority VARCHAR(20) NOT NULL DEFAULT 'rotina',
  ADD COLUMN IF NOT EXISTS title VARCHAR(240),
  ADD COLUMN IF NOT EXISTS clinical_indication TEXT,
  ADD COLUMN IF NOT EXISTS technique TEXT,
  ADD COLUMN IF NOT EXISTS findings TEXT,
  ADD COLUMN IF NOT EXISTS conclusion TEXT,
  ADD COLUMN IF NOT EXISTS recommendation TEXT,
  ADD COLUMN IF NOT EXISTS cid_principal VARCHAR(20),
  ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS signed_by_user_id UUID,
  ADD COLUMN IF NOT EXISTS signed_by_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS signed_by_crm VARCHAR(30),
  ADD COLUMN IF NOT EXISTS executor_professional_id BIGINT REFERENCES public.professionals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS executor_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS executor_crm VARCHAR(30),
  ADD COLUMN IF NOT EXISTS requester_professional_id BIGINT REFERENCES public.professionals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS requester_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS has_critical_finding BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_rectified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS previous_report_id UUID REFERENCES public.reports(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS validation_code VARCHAR(80) DEFAULT encode(gen_random_bytes(16), 'hex'),
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS reports_one_active_per_study
  ON public.reports(company_id, study_instance_uid)
  WHERE study_instance_uid IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS imaging_orders_owner_rls_idx ON public.imaging_orders(company_id, requesting_physician_id, created_by);
CREATE INDEX IF NOT EXISTS imaging_orders_patient_idx ON public.imaging_orders(company_id, patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS imaging_order_items_order_rls_idx ON public.imaging_order_items(imaging_order_id);
CREATE INDEX IF NOT EXISTS reports_owner_rls_idx ON public.reports(company_id, requester_professional_id, executor_professional_id);
CREATE INDEX IF NOT EXISTS reports_study_idx ON public.reports(pacs_study_id, imaging_order_item_id);
CREATE INDEX IF NOT EXISTS professionals_auth_owner_idx ON public.professionals(user_id, company_id, id);

CREATE TABLE IF NOT EXISTS public.report_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  signer_user_id UUID NOT NULL,
  signer_professional_id BIGINT NOT NULL REFERENCES public.professionals(id) ON DELETE RESTRICT,
  signer_name VARCHAR(200) NOT NULL,
  signer_crm VARCHAR(30) NOT NULL,
  signer_role VARCHAR(40) NOT NULL DEFAULT 'laudador',
  signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.report_signatures
  ADD COLUMN IF NOT EXISTS report_id UUID REFERENCES public.reports(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS signer_user_id UUID,
  ADD COLUMN IF NOT EXISTS signer_professional_id BIGINT REFERENCES public.professionals(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS signer_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS signer_crm VARCHAR(30),
  ADD COLUMN IF NOT EXISTS signer_role VARCHAR(40) NOT NULL DEFAULT 'laudador',
  ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS report_signatures_report_idx ON public.report_signatures(report_id);

CREATE TABLE IF NOT EXISTS public.report_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  technique TEXT,
  findings TEXT,
  conclusion TEXT,
  recommendation TEXT,
  motivo_retificacao TEXT NOT NULL,
  created_by UUID NOT NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT report_versions_report_version_key UNIQUE(report_id, version)
);
CREATE TABLE IF NOT EXISTS public.report_delivery_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  canal VARCHAR(40) NOT NULL,
  destinatario VARCHAR(240) NOT NULL,
  delivered_by UUID NOT NULL DEFAULT auth.uid(),
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.report_versions
  ADD COLUMN IF NOT EXISTS report_id UUID REFERENCES public.reports(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS version INTEGER,
  ADD COLUMN IF NOT EXISTS technique TEXT,
  ADD COLUMN IF NOT EXISTS findings TEXT,
  ADD COLUMN IF NOT EXISTS conclusion TEXT,
  ADD COLUMN IF NOT EXISTS recommendation TEXT,
  ADD COLUMN IF NOT EXISTS motivo_retificacao TEXT,
  ADD COLUMN IF NOT EXISTS created_by UUID DEFAULT auth.uid(),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.report_delivery_logs
  ADD COLUMN IF NOT EXISTS report_id UUID REFERENCES public.reports(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS canal VARCHAR(40),
  ADD COLUMN IF NOT EXISTS destinatario VARCHAR(240),
  ADD COLUMN IF NOT EXISTS delivered_by UUID DEFAULT auth.uid(),
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS report_versions_report_idx ON public.report_versions(report_id, version DESC);
CREATE INDEX IF NOT EXISTS report_delivery_logs_report_idx ON public.report_delivery_logs(report_id, delivered_at DESC);

ALTER TABLE public.imaging_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.imaging_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_delivery_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.imaging_orders, public.imaging_order_items, public.report_types, public.reports, public.report_signatures, public.report_versions, public.report_delivery_logs FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.imaging_orders, public.imaging_order_items, public.reports TO authenticated;
GRANT SELECT ON TABLE public.report_types TO authenticated;
GRANT SELECT, INSERT ON TABLE public.report_signatures TO authenticated;
GRANT SELECT, INSERT ON TABLE public.report_versions, public.report_delivery_logs TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.report_types_id_seq TO authenticated;

-- Runtime proxy role: grant only the verbs needed by the two invoker RPCs,
-- report editing, PACS ingestion and Worklist processing. No DELETE and no
-- UPDATE on immutable signature/version/delivery audit rows.
REVOKE ALL ON TABLE public.imaging_orders, public.imaging_order_items, public.report_types,
  public.reports, public.report_signatures, public.report_versions, public.report_delivery_logs
  FROM app_prontomedic;
GRANT SELECT, INSERT, UPDATE ON TABLE public.imaging_orders, public.imaging_order_items, public.reports TO app_prontomedic;
GRANT SELECT ON TABLE public.report_types TO app_prontomedic;
GRANT SELECT, INSERT ON TABLE public.report_signatures, public.report_versions, public.report_delivery_logs TO app_prontomedic;
GRANT SELECT ON TABLE public.user_profiles, public.professionals, public.patients, public.appointments, public.dicom_nodes TO app_prontomedic;
GRANT SELECT, INSERT, UPDATE ON TABLE public.dicom_worklist_queue, public.pacs_studies TO app_prontomedic;
REVOKE UPDATE, DELETE ON TABLE public.report_signatures, public.report_versions, public.report_delivery_logs FROM authenticated, app_prontomedic;
REVOKE DELETE ON TABLE public.reports, public.imaging_orders, public.imaging_order_items FROM authenticated, app_prontomedic;

DROP POLICY IF EXISTS app_imaging_user_profile_self ON public.user_profiles;
CREATE POLICY app_imaging_user_profile_self ON public.user_profiles FOR SELECT TO app_prontomedic
USING (id = (SELECT auth.uid()) AND company_id = public.request_company_id());
DROP POLICY IF EXISTS app_imaging_professionals_tenant ON public.professionals;
CREATE POLICY app_imaging_professionals_tenant ON public.professionals FOR SELECT TO app_prontomedic
USING (company_id = public.request_company_id());
DROP POLICY IF EXISTS app_imaging_patients_tenant ON public.patients;
CREATE POLICY app_imaging_patients_tenant ON public.patients FOR SELECT TO app_prontomedic
USING (company_id = public.request_company_id());
DROP POLICY IF EXISTS app_imaging_appointments_tenant ON public.appointments;
CREATE POLICY app_imaging_appointments_tenant ON public.appointments FOR SELECT TO app_prontomedic
USING (company_id = public.request_company_id());
DROP POLICY IF EXISTS app_imaging_dicom_nodes_tenant ON public.dicom_nodes;
CREATE POLICY app_imaging_dicom_nodes_tenant ON public.dicom_nodes FOR SELECT TO app_prontomedic
USING (company_id = public.request_company_id());
DROP POLICY IF EXISTS app_imaging_worklist_read ON public.dicom_worklist_queue;
CREATE POLICY app_imaging_worklist_read ON public.dicom_worklist_queue FOR SELECT TO app_prontomedic
USING (company_id = public.request_company_id());
DROP POLICY IF EXISTS app_imaging_pacs_studies ON public.pacs_studies;
CREATE POLICY app_imaging_pacs_studies ON public.pacs_studies FOR ALL TO app_prontomedic
USING (company_id = public.request_company_id() AND (public.dicom_is_technical_role() OR EXISTS (
  SELECT 1 FROM public.user_profiles up WHERE up.id=(SELECT auth.uid())
    AND lower(coalesce(up.role_name,'')) IN ('master','admin_master','master_admin','adm_master')
)))
WITH CHECK (company_id = public.request_company_id() AND (public.dicom_is_technical_role() OR EXISTS (
  SELECT 1 FROM public.user_profiles up WHERE up.id=(SELECT auth.uid())
    AND lower(coalesce(up.role_name,'')) IN ('master','admin_master','master_admin','adm_master')
)));

CREATE OR REPLACE FUNCTION public.imaging_tenant_access(p_company_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT p_company_id = (SELECT company_id FROM public.user_profiles WHERE id = (SELECT auth.uid()))
    AND (current_user <> 'app_prontomedic' OR p_company_id = public.request_company_id())
$$;
REVOKE ALL ON FUNCTION public.imaging_tenant_access(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.imaging_tenant_access(UUID) TO authenticated, app_prontomedic;

DROP POLICY IF EXISTS imaging_orders_scoped_select ON public.imaging_orders;
CREATE POLICY imaging_orders_scoped_select ON public.imaging_orders FOR SELECT TO authenticated, app_prontomedic
USING (
  public.imaging_tenant_access(company_id)
  AND (
    requesting_physician_id IN (SELECT id FROM public.professionals WHERE user_id = (SELECT auth.uid()))
    OR EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = (SELECT auth.uid()) AND lower(coalesce(up.role_name,'')) IN ('admin','administrador','radiologist','radiologia','diagnostico','diagnóstico','technician','tecnico','técnico'))
  )
);
DROP POLICY IF EXISTS imaging_orders_owner_insert ON public.imaging_orders;
CREATE POLICY imaging_orders_owner_insert ON public.imaging_orders FOR INSERT TO authenticated, app_prontomedic
WITH CHECK (
  public.imaging_tenant_access(company_id)
  AND created_by = (SELECT auth.uid())
  AND requesting_physician_id IN (SELECT id FROM public.professionals WHERE user_id = (SELECT auth.uid()) AND company_id = imaging_orders.company_id)
);
DROP POLICY IF EXISTS imaging_orders_scoped_update ON public.imaging_orders;
CREATE POLICY imaging_orders_scoped_update ON public.imaging_orders FOR UPDATE TO authenticated, app_prontomedic
USING (
  public.imaging_tenant_access(company_id)
  AND (requesting_physician_id IN (SELECT id FROM public.professionals WHERE user_id = (SELECT auth.uid()))
       OR EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = (SELECT auth.uid()) AND lower(coalesce(up.role_name,'')) IN ('admin','administrador','master','admin_master','master_admin','adm_master','radiologist','radiologia','diagnostico','diagnóstico','technician','tecnico','técnico')))
)
WITH CHECK (public.imaging_tenant_access(company_id));

DROP POLICY IF EXISTS imaging_order_items_scoped_select ON public.imaging_order_items;
CREATE POLICY imaging_order_items_scoped_select ON public.imaging_order_items FOR SELECT TO authenticated, app_prontomedic
USING (EXISTS (SELECT 1 FROM public.imaging_orders o WHERE o.id = imaging_order_id));
DROP POLICY IF EXISTS imaging_order_items_scoped_insert ON public.imaging_order_items;
CREATE POLICY imaging_order_items_scoped_insert ON public.imaging_order_items FOR INSERT TO authenticated, app_prontomedic
WITH CHECK (EXISTS (SELECT 1 FROM public.imaging_orders o WHERE o.id = imaging_order_id AND o.requesting_physician_id IN (SELECT id FROM public.professionals WHERE user_id = (SELECT auth.uid()))));
DROP POLICY IF EXISTS imaging_order_items_scoped_update ON public.imaging_order_items;
CREATE POLICY imaging_order_items_scoped_update ON public.imaging_order_items FOR UPDATE TO authenticated, app_prontomedic
USING (EXISTS (SELECT 1 FROM public.imaging_orders o WHERE o.id = imaging_order_id))
WITH CHECK (EXISTS (SELECT 1 FROM public.imaging_orders o WHERE o.id = imaging_order_id));

DROP POLICY IF EXISTS report_types_tenant_select ON public.report_types;
CREATE POLICY report_types_tenant_select ON public.report_types FOR SELECT TO authenticated, app_prontomedic
USING (company_id IS NULL OR public.imaging_tenant_access(company_id));

DROP POLICY IF EXISTS reports_scoped_select ON public.reports;
CREATE POLICY reports_scoped_select ON public.reports FOR SELECT TO authenticated, app_prontomedic
USING (
  public.imaging_tenant_access(company_id)
  AND (requester_professional_id IN (SELECT id FROM public.professionals WHERE user_id = (SELECT auth.uid()))
       OR executor_professional_id IN (SELECT id FROM public.professionals WHERE user_id = (SELECT auth.uid()))
       OR EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = (SELECT auth.uid()) AND lower(coalesce(up.role_name,'')) IN ('admin','administrador','radiologist','radiologia','diagnostico','diagnóstico','technician','tecnico','técnico')))
);
DROP POLICY IF EXISTS reports_technical_insert ON public.reports;
CREATE POLICY reports_technical_insert ON public.reports FOR INSERT TO authenticated, app_prontomedic
WITH CHECK (
  public.imaging_tenant_access(company_id)
  AND EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = (SELECT auth.uid()) AND lower(coalesce(up.role_name,'')) IN ('admin','administrador','master','admin_master','master_admin','adm_master','radiologist','radiologia','diagnostico','diagnóstico','technician','tecnico','técnico'))
);
DROP POLICY IF EXISTS reports_executor_update ON public.reports;
CREATE POLICY reports_executor_update ON public.reports FOR UPDATE TO authenticated, app_prontomedic
USING (
  public.imaging_tenant_access(company_id)
  AND (executor_professional_id IS NULL OR executor_professional_id IN (SELECT id FROM public.professionals WHERE user_id = (SELECT auth.uid()))
       OR EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id=(SELECT auth.uid()) AND lower(coalesce(up.role_name,'')) IN ('admin','administrador','master','admin_master','master_admin','adm_master')))
  AND EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = (SELECT auth.uid()) AND lower(coalesce(up.role_name,'')) IN ('admin','administrador','master','admin_master','master_admin','adm_master','medico','médico','radiologist','radiologia'))
)
WITH CHECK (
  public.imaging_tenant_access(company_id)
  AND (executor_professional_id IS NULL OR executor_professional_id IN (SELECT id FROM public.professionals WHERE user_id = (SELECT auth.uid()))
       OR EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id=(SELECT auth.uid()) AND lower(coalesce(up.role_name,'')) IN ('admin','administrador','master','admin_master','master_admin','adm_master')))
);

DROP POLICY IF EXISTS report_signatures_scoped_select ON public.report_signatures;
CREATE POLICY report_signatures_scoped_select ON public.report_signatures FOR SELECT TO authenticated, app_prontomedic
USING (EXISTS (SELECT 1 FROM public.reports r WHERE r.id = report_id));
DROP POLICY IF EXISTS report_signatures_self_insert ON public.report_signatures;
CREATE POLICY report_signatures_self_insert ON public.report_signatures FOR INSERT TO authenticated, app_prontomedic
WITH CHECK (
  signer_user_id = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.professionals p
    WHERE p.id = signer_professional_id AND p.user_id = (SELECT auth.uid())
      AND p.full_name = signer_name AND p.crm = signer_crm AND trim(coalesce(p.crm,'')) <> ''
  )
  AND EXISTS (SELECT 1 FROM public.reports r WHERE r.id = report_id)
);
CREATE POLICY report_versions_scoped_select ON public.report_versions FOR SELECT TO authenticated, app_prontomedic
USING (EXISTS (SELECT 1 FROM public.reports r WHERE r.id = report_id));
CREATE POLICY report_versions_self_insert ON public.report_versions FOR INSERT TO authenticated, app_prontomedic
WITH CHECK (created_by = (SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.reports r WHERE r.id = report_id));
CREATE POLICY report_delivery_logs_scoped_select ON public.report_delivery_logs FOR SELECT TO authenticated, app_prontomedic
USING (EXISTS (SELECT 1 FROM public.reports r WHERE r.id = report_id));
CREATE POLICY report_delivery_logs_self_insert ON public.report_delivery_logs FOR INSERT TO authenticated, app_prontomedic
WITH CHECK (delivered_by = (SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.reports r WHERE r.id = report_id));

-- Doctors can enqueue only items belonging to their own order. Technical roles
-- retain the operational permission from the multi-unit migration.
DROP POLICY IF EXISTS dicom_worklist_queue_tenant_write ON public.dicom_worklist_queue;
CREATE POLICY dicom_worklist_queue_tenant_write ON public.dicom_worklist_queue FOR ALL TO authenticated, app_prontomedic
USING (
  public.imaging_tenant_access(company_id) AND public.dicom_unit_access(company_id, unit_id)
  AND (public.dicom_is_technical_role() OR EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id=(SELECT auth.uid()) AND lower(coalesce(up.role_name,'')) IN ('master','admin_master','master_admin','adm_master')) OR EXISTS (
    SELECT 1 FROM public.imaging_order_items i JOIN public.imaging_orders o ON o.id = i.imaging_order_id
    WHERE i.id::text = dicom_worklist_queue.imaging_order_item_id
      AND o.requesting_physician_id IN (SELECT id FROM public.professionals WHERE user_id = (SELECT auth.uid()))
  ))
)
WITH CHECK (
  public.imaging_tenant_access(company_id) AND public.dicom_unit_access(company_id, unit_id)
  AND (public.dicom_is_technical_role() OR EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id=(SELECT auth.uid()) AND lower(coalesce(up.role_name,'')) IN ('master','admin_master','master_admin','adm_master')) OR EXISTS (
    SELECT 1 FROM public.imaging_order_items i JOIN public.imaging_orders o ON o.id = i.imaging_order_id
    WHERE i.id::text = dicom_worklist_queue.imaging_order_item_id
      AND o.requesting_physician_id IN (SELECT id FROM public.professionals WHERE user_id = (SELECT auth.uid()))
  ))
);

CREATE OR REPLACE FUNCTION public.create_imaging_order_from_attendance(
  p_appointment_id BIGINT, p_exam_name TEXT, p_modality_type TEXT,
  p_clinical_indication TEXT DEFAULT NULL, p_priority TEXT DEFAULT 'normal',
  p_scheduled_datetime TIMESTAMPTZ DEFAULT NOW()
) RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_appointment public.appointments%ROWTYPE;
  v_prof public.professionals%ROWTYPE;
  v_patient public.patients%ROWTYPE;
  v_order public.imaging_orders%ROWTYPE;
  v_item public.imaging_order_items%ROWTYPE;
  v_accession TEXT;
  v_unit_id INTEGER;
  v_node_id UUID;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  IF trim(coalesce(p_exam_name,'')) = '' THEN RAISE EXCEPTION 'exam name is required'; END IF;
  IF upper(p_modality_type) NOT IN ('CR','CT','MR','US','DX','XA','MG','PT','NM','RF','OT') THEN RAISE EXCEPTION 'invalid modality'; END IF;
  IF p_priority NOT IN ('normal','urgent','emergency') THEN RAISE EXCEPTION 'invalid priority'; END IF;

  SELECT * INTO v_prof FROM public.professionals WHERE user_id = (SELECT auth.uid()) AND lg_ativo = TRUE ORDER BY id LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'usuário sem profissional ativo vinculado'; END IF;
  SELECT * INTO STRICT v_appointment FROM public.appointments
    WHERE id = p_appointment_id AND company_id = v_prof.company_id AND professional_id = v_prof.id FOR UPDATE;
  SELECT * INTO STRICT v_patient FROM public.patients WHERE id = v_appointment.patient_id AND company_id = v_prof.company_id;
  v_unit_id := COALESCE((to_jsonb(v_appointment)->>'unit_id')::INTEGER, (SELECT primary_unit_id FROM public.user_profiles WHERE id = (SELECT auth.uid())));
  v_accession := 'PM-' || to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS') || '-' || substr(gen_random_uuid()::text,1,6);

  INSERT INTO public.imaging_orders(company_id, unit_id, patient_id, scheduling_id, requesting_physician_id,
    referring_physician_name, clinical_indication, priority, accession_number, status, created_by)
  VALUES(v_prof.company_id, v_unit_id, v_patient.id, v_appointment.id, v_prof.id, v_prof.full_name,
    p_clinical_indication, p_priority, v_accession, 'liberado_worklist', (SELECT auth.uid())) RETURNING * INTO v_order;

  INSERT INTO public.imaging_order_items(imaging_order_id, exam_name, modality_type, scheduled_date, scheduled_time,
    scheduled_datetime, requested_procedure_id, scheduled_procedure_step_id, status)
  VALUES(v_order.id, trim(p_exam_name), upper(p_modality_type), p_scheduled_datetime::date, p_scheduled_datetime::time,
    p_scheduled_datetime, 'RP-'||v_order.id, 'SPS-'||gen_random_uuid(), 'liberado_worklist') RETURNING * INTO v_item;

  SELECT id INTO v_node_id FROM public.dicom_nodes
    WHERE company_id = v_prof.company_id AND node_kind = 'worklist' AND is_active
      AND (unit_id = v_unit_id OR unit_id IS NULL)
    ORDER BY (unit_id = v_unit_id) DESC, is_default DESC, priority, id LIMIT 1;

  INSERT INTO public.dicom_worklist_queue(company_id, unit_id, destination_node_id, imaging_order_item_id,
    patient_id, patient_name, patient_birth_date, patient_sex, patient_identifier, accession_number,
    requested_procedure_description, requested_procedure_id, scheduled_procedure_step_id, modality_type,
    scheduled_datetime, referring_physician_name, status, exported_to_worklist)
  VALUES(v_prof.company_id, v_unit_id, v_node_id, v_item.id::text, v_patient.id::text, v_patient.full_name,
    v_patient.birth_date, v_patient.sex, v_patient.id::text, v_accession, v_item.exam_name,
    v_item.requested_procedure_id, v_item.scheduled_procedure_step_id, v_item.modality_type,
    p_scheduled_datetime, v_prof.full_name, 'pending', FALSE);

  RETURN jsonb_build_object('order_id',v_order.id,'item_id',v_item.id,'accession_number',v_accession);
END $$;

CREATE OR REPLACE FUNCTION public.create_report_for_received_study()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE v_order public.imaging_orders%ROWTYPE;
BEGIN
  SELECT o.* INTO v_order FROM public.imaging_orders o JOIN public.imaging_order_items i ON i.imaging_order_id=o.id
    WHERE i.id::text = NEW.imaging_order_item_id LIMIT 1;
  IF FOUND AND NEW.study_instance_uid IS NOT NULL AND NEW.imaging_order_item_id ~* '^[0-9a-f-]{36}$' THEN
    INSERT INTO public.reports(company_id, unit_id, patient_id, imaging_order_item_id, pacs_study_id,
      study_instance_uid, status, priority, title, clinical_indication, requester_professional_id, requester_name)
    VALUES(v_order.company_id, v_order.unit_id, v_order.patient_id, NEW.imaging_order_item_id::UUID, NEW.id,
      NEW.study_instance_uid, 'aguardando_laudo', CASE v_order.priority WHEN 'emergency' THEN 'urgente' WHEN 'urgent' THEN 'prioritario' ELSE 'rotina' END,
      'Laudo '||coalesce(NEW.modality_type,'Imagem'), v_order.clinical_indication, v_order.requesting_physician_id, v_order.referring_physician_name)
    ON CONFLICT (company_id, study_instance_uid) WHERE study_instance_uid IS NOT NULL AND deleted_at IS NULL DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pacs_study_create_report ON public.pacs_studies;
CREATE TRIGGER trg_pacs_study_create_report AFTER INSERT OR UPDATE OF pacs_status ON public.pacs_studies
FOR EACH ROW WHEN (NEW.pacs_status = 'received') EXECUTE FUNCTION public.create_report_for_received_study();

CREATE OR REPLACE FUNCTION public.guard_report_signature_transition()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_content_changed BOOLEAN;
  v_signature_changed BOOLEAN;
  v_delivery_changed BOOLEAN;
  v_signing BOOLEAN := coalesce(current_setting('app.report_signing_rpc', TRUE),'') = '1';
  v_delivery BOOLEAN := coalesce(current_setting('app.report_delivery_rpc', TRUE),'') = '1';
  v_rectify BOOLEAN := coalesce(current_setting('app.report_rectify_rpc', TRUE),'') = '1';
BEGIN
  v_content_changed := NEW.technique IS DISTINCT FROM OLD.technique
    OR NEW.findings IS DISTINCT FROM OLD.findings
    OR NEW.conclusion IS DISTINCT FROM OLD.conclusion
    OR NEW.recommendation IS DISTINCT FROM OLD.recommendation;
  v_signature_changed := NEW.signed_at IS DISTINCT FROM OLD.signed_at
    OR NEW.released_at IS DISTINCT FROM OLD.released_at
    OR NEW.signed_by_user_id IS DISTINCT FROM OLD.signed_by_user_id
    OR NEW.signed_by_name IS DISTINCT FROM OLD.signed_by_name
    OR NEW.signed_by_crm IS DISTINCT FROM OLD.signed_by_crm;
  v_delivery_changed := NEW.delivered_at IS DISTINCT FROM OLD.delivered_at;

  IF OLD.status IN ('assinado','liberado','entregue','retificado')
     AND (v_content_changed OR v_signature_changed OR v_delivery_changed OR NEW.status IS DISTINCT FROM OLD.status) THEN
    IF v_delivery AND OLD.status = 'liberado' AND NEW.status = 'entregue'
       AND NOT v_content_changed AND NOT v_signature_changed THEN
      RETURN NEW;
    ELSIF v_rectify AND OLD.status IN ('assinado','liberado','entregue','retificado')
       AND NEW.status = 'em_digitacao' AND NOT v_content_changed THEN
      RETURN NEW;
    ELSE
      RAISE EXCEPTION 'laudo finalizado somente pode mudar pelos RPCs de entrega/retificação';
    END IF;
  END IF;

  IF (NEW.status IN ('assinado','liberado') OR v_signature_changed) AND NOT v_signing THEN
    RAISE EXCEPTION 'assinatura/liberação exige sign_and_release_radiology_report';
  END IF;
  IF NEW.status = 'entregue' AND NOT v_delivery THEN
    RAISE EXCEPTION 'entrega exige deliver_radiology_report';
  END IF;
  IF v_delivery_changed AND NOT v_delivery AND NOT v_rectify THEN
    RAISE EXCEPTION 'data de entrega somente pode mudar pelos RPCs de entrega/retificação';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_report_signature_transition ON public.reports;
CREATE TRIGGER trg_guard_report_signature_transition BEFORE UPDATE ON public.reports
FOR EACH ROW EXECUTE FUNCTION public.guard_report_signature_transition();

CREATE OR REPLACE FUNCTION public.sign_and_release_radiology_report(p_report_id UUID)
RETURNS public.reports LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE v_prof public.professionals%ROWTYPE; v_report public.reports%ROWTYPE; v_role TEXT;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  SELECT * INTO v_prof FROM public.professionals WHERE user_id=(SELECT auth.uid()) AND lg_ativo=TRUE ORDER BY id LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'usuário sem profissional ativo vinculado'; END IF;
  SELECT lower(coalesce(role_name,'')) INTO v_role FROM public.user_profiles WHERE id=(SELECT auth.uid()) AND company_id=v_prof.company_id;
  IF v_role NOT IN ('admin','administrador','master','admin_master','master_admin','adm_master','medico','médico','radiologist','radiologia') THEN RAISE EXCEPTION 'perfil não autorizado a assinar laudo'; END IF;
  IF trim(coalesce(v_prof.crm,''))='' THEN RAISE EXCEPTION 'CRM obrigatório no cadastro profissional'; END IF;
  SELECT * INTO STRICT v_report FROM public.reports WHERE id=p_report_id AND company_id=v_prof.company_id FOR UPDATE;
  IF v_report.status NOT IN ('em_revisao','aguardando_assinatura') THEN RAISE EXCEPTION 'status não permite assinatura: %',v_report.status; END IF;
  IF v_report.executor_professional_id IS NOT NULL AND v_report.executor_professional_id<>v_prof.id THEN RAISE EXCEPTION 'laudo atribuído a outro profissional'; END IF;
  PERFORM set_config('app.report_signing_rpc','1',TRUE);
  UPDATE public.reports SET status='liberado', signed_at=NOW(), released_at=NOW(), signed_by_user_id=(SELECT auth.uid()),
    signed_by_name=v_prof.full_name, signed_by_crm=v_prof.crm, executor_professional_id=v_prof.id,
    executor_name=v_prof.full_name, executor_crm=v_prof.crm, updated_at=NOW() WHERE id=p_report_id RETURNING * INTO v_report;
  INSERT INTO public.report_signatures(report_id, signer_user_id, signer_professional_id, signer_name, signer_crm)
  VALUES(p_report_id,(SELECT auth.uid()),v_prof.id,v_prof.full_name,v_prof.crm);
  RETURN v_report;
END $$;

CREATE OR REPLACE FUNCTION public.deliver_radiology_report(p_report_id UUID, p_canal TEXT, p_destinatario TEXT)
RETURNS public.reports LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE v_report public.reports%ROWTYPE; v_company UUID; v_role TEXT;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  IF trim(coalesce(p_canal,''))='' OR trim(coalesce(p_destinatario,''))='' THEN RAISE EXCEPTION 'canal e destinatário são obrigatórios'; END IF;
  SELECT company_id, lower(coalesce(role_name,'')) INTO v_company, v_role FROM public.user_profiles WHERE id=(SELECT auth.uid());
  IF v_role NOT IN ('admin','administrador','master','admin_master','master_admin','adm_master','medico','médico','radiologist','radiologia') THEN RAISE EXCEPTION 'perfil não autorizado a entregar laudo'; END IF;
  SELECT * INTO STRICT v_report FROM public.reports WHERE id=p_report_id AND company_id=v_company FOR UPDATE;
  IF v_report.status <> 'liberado' THEN RAISE EXCEPTION 'somente laudo liberado pode ser entregue'; END IF;
  PERFORM set_config('app.report_delivery_rpc','1',TRUE);
  UPDATE public.reports SET status='entregue', delivered_at=NOW(), updated_at=NOW() WHERE id=p_report_id RETURNING * INTO v_report;
  INSERT INTO public.report_delivery_logs(report_id, canal, destinatario, delivered_by)
  VALUES(p_report_id,trim(p_canal),trim(p_destinatario),(SELECT auth.uid()));
  RETURN v_report;
END $$;

CREATE OR REPLACE FUNCTION public.rectify_radiology_report(p_report_id UUID, p_motivo TEXT)
RETURNS public.reports LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE v_report public.reports%ROWTYPE; v_prof public.professionals%ROWTYPE; v_role TEXT;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  IF trim(coalesce(p_motivo,''))='' THEN RAISE EXCEPTION 'motivo da retificação é obrigatório'; END IF;
  SELECT * INTO v_prof FROM public.professionals WHERE user_id=(SELECT auth.uid()) AND lg_ativo=TRUE ORDER BY id LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'usuário sem profissional ativo vinculado'; END IF;
  SELECT lower(coalesce(role_name,'')) INTO v_role FROM public.user_profiles WHERE id=(SELECT auth.uid()) AND company_id=v_prof.company_id;
  IF v_role NOT IN ('admin','administrador','master','admin_master','master_admin','adm_master','medico','médico','radiologist','radiologia') THEN RAISE EXCEPTION 'perfil não autorizado a retificar laudo'; END IF;
  IF trim(coalesce(v_prof.crm,''))='' THEN RAISE EXCEPTION 'CRM obrigatório no cadastro profissional'; END IF;
  SELECT * INTO STRICT v_report FROM public.reports WHERE id=p_report_id AND company_id=v_prof.company_id FOR UPDATE;
  IF v_report.status NOT IN ('assinado','liberado','entregue','retificado') THEN RAISE EXCEPTION 'status não permite retificação: %',v_report.status; END IF;
  IF v_report.executor_professional_id IS NOT NULL AND v_report.executor_professional_id<>v_prof.id AND v_role NOT IN ('admin','administrador') THEN RAISE EXCEPTION 'somente o executor ou administrador pode retificar'; END IF;
  INSERT INTO public.report_versions(report_id,version,technique,findings,conclusion,recommendation,motivo_retificacao,created_by)
  VALUES(v_report.id,v_report.version,v_report.technique,v_report.findings,v_report.conclusion,v_report.recommendation,trim(p_motivo),(SELECT auth.uid()));
  PERFORM set_config('app.report_rectify_rpc','1',TRUE);
  UPDATE public.reports SET status='em_digitacao', is_rectified=TRUE, version=v_report.version+1,
    signed_at=NULL, released_at=NULL, delivered_at=NULL, signed_by_user_id=NULL,
    signed_by_name=NULL, signed_by_crm=NULL, updated_at=NOW()
  WHERE id=p_report_id RETURNING * INTO v_report;
  RETURN v_report;
END $$;

REVOKE ALL ON FUNCTION public.create_imaging_order_from_attendance(BIGINT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sign_and_release_radiology_report(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_report_for_received_study() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guard_report_signature_transition() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.deliver_radiology_report(UUID,TEXT,TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rectify_radiology_report(UUID,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_imaging_order_from_attendance(BIGINT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sign_and_release_radiology_report(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deliver_radiology_report(UUID,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rectify_radiology_report(UUID,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_imaging_order_from_attendance(BIGINT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ),
  public.sign_and_release_radiology_report(UUID), public.deliver_radiology_report(UUID,TEXT,TEXT),
  public.rectify_radiology_report(UUID,TEXT) TO app_prontomedic;

COMMIT;
