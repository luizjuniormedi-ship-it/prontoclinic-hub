-- ProntoMedic imaging orders and Modality Worklist export queue.
-- DataSIGH is deliberately not referenced: this migration only changes
-- ProntoMedic's PostgreSQL database.

CREATE TABLE IF NOT EXISTS public.imaging_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL DEFAULT public.current_company_id()
    REFERENCES public.companies(id) ON DELETE CASCADE,
  unit_id INTEGER REFERENCES public.units(id) ON DELETE SET NULL,
  patient_id BIGINT NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  encounter_id TEXT,
  scheduling_id TEXT,
  requesting_physician_id BIGINT REFERENCES public.professionals(id) ON DELETE SET NULL,
  referring_physician_name VARCHAR(200),
  clinical_indication TEXT,
  priority VARCHAR(20) NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('normal', 'urgent', 'emergency')),
  accession_number VARCHAR(64) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'agendado'
    CHECK (status IN (
      'agendado', 'liberado_worklist', 'em_aquisicao', 'adquirido',
      'enviado_pacs', 'recebido_pacs', 'laudando', 'laudado',
      'entregue', 'cancelado'
    )),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT imaging_orders_company_accession_key
    UNIQUE (company_id, accession_number)
);

CREATE TABLE IF NOT EXISTS public.imaging_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  imaging_order_id UUID NOT NULL
    REFERENCES public.imaging_orders(id) ON DELETE CASCADE,
  company_id UUID NOT NULL DEFAULT public.current_company_id()
    REFERENCES public.companies(id) ON DELETE CASCADE,
  unit_id INTEGER REFERENCES public.units(id) ON DELETE SET NULL,
  exam_code VARCHAR(64),
  exam_name VARCHAR(200) NOT NULL,
  modality_type VARCHAR(16) NOT NULL,
  body_part VARCHAR(100),
  laterality VARCHAR(12)
    CHECK (laterality IS NULL OR laterality IN ('left', 'right', 'bilateral', 'na')),
  contrast_required BOOLEAN NOT NULL DEFAULT FALSE,
  station_aetitle VARCHAR(16),
  scheduled_date DATE,
  scheduled_time TIME,
  scheduled_datetime TIMESTAMPTZ,
  requested_procedure_id VARCHAR(64),
  scheduled_procedure_step_id VARCHAR(64),
  study_instance_uid VARCHAR(128),
  status VARCHAR(30) NOT NULL DEFAULT 'agendado'
    CHECK (status IN (
      'agendado', 'liberado_worklist', 'em_aquisicao', 'adquirido',
      'enviado_pacs', 'recebido_pacs', 'laudando', 'laudado',
      'entregue', 'cancelado'
    )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.dicom_worklist_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  imaging_order_item_id UUID NOT NULL UNIQUE
    REFERENCES public.imaging_order_items(id) ON DELETE CASCADE,
  company_id UUID NOT NULL DEFAULT public.current_company_id()
    REFERENCES public.companies(id) ON DELETE CASCADE,
  unit_id INTEGER REFERENCES public.units(id) ON DELETE SET NULL,
  patient_id BIGINT NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  patient_name VARCHAR(200) NOT NULL,
  patient_birth_date DATE,
  patient_sex VARCHAR(1)
    CHECK (patient_sex IS NULL OR patient_sex IN ('F', 'M', 'O')),
  patient_identifier VARCHAR(64),
  accession_number VARCHAR(64) NOT NULL,
  requested_procedure_description VARCHAR(200),
  requested_procedure_id VARCHAR(64),
  scheduled_procedure_step_id VARCHAR(64),
  modality_type VARCHAR(16) NOT NULL,
  scheduled_station_aetitle VARCHAR(16),
  scheduled_station_name VARCHAR(100),
  scheduled_datetime TIMESTAMPTZ,
  referring_physician_name VARCHAR(200),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'exported', 'acquired', 'cancelled')),
  exported_to_worklist BOOLEAN NOT NULL DEFAULT FALSE,
  export_state VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (export_state IN ('pending', 'exporting', 'exported', 'failed')),
  export_attempts INTEGER NOT NULL DEFAULT 0 CHECK (export_attempts >= 0),
  export_claimed_at TIMESTAMPTZ,
  next_export_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_export_at TIMESTAMPTZ,
  last_export_error TEXT,
  orthanc_worklist_id TEXT,
  delete_state VARCHAR(20) NOT NULL DEFAULT 'not_required'
    CHECK (delete_state IN ('not_required', 'pending', 'deleting', 'deleted', 'failed')),
  delete_attempts INTEGER NOT NULL DEFAULT 0 CHECK (delete_attempts >= 0),
  next_delete_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_delete_error TEXT,
  orthanc_deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_imaging_orders_company_status
  ON public.imaging_orders(company_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_imaging_order_items_order
  ON public.imaging_order_items(imaging_order_id);
CREATE INDEX IF NOT EXISTS idx_imaging_order_items_company_status
  ON public.imaging_order_items(company_id, status, scheduled_datetime);
CREATE INDEX IF NOT EXISTS idx_dicom_worklist_queue_export
  ON public.dicom_worklist_queue(export_state, next_export_at)
  WHERE exported_to_worklist = FALSE AND status = 'pending';
CREATE INDEX IF NOT EXISTS idx_dicom_worklist_queue_company_schedule
  ON public.dicom_worklist_queue(company_id, scheduled_datetime DESC);
CREATE INDEX IF NOT EXISTS idx_dicom_worklist_queue_accession
  ON public.dicom_worklist_queue(company_id, accession_number);
CREATE INDEX IF NOT EXISTS idx_dicom_worklist_queue_delete
  ON public.dicom_worklist_queue(delete_state, next_delete_at)
  WHERE status = 'cancelled' AND orthanc_worklist_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_imaging_order_item_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  parent_company UUID;
  parent_unit INTEGER;
BEGIN
  SELECT company_id, unit_id
    INTO parent_company, parent_unit
  FROM public.imaging_orders
  WHERE id = NEW.imaging_order_id;

  IF parent_company IS NULL THEN
    RAISE EXCEPTION 'imaging order % not found', NEW.imaging_order_id;
  END IF;

  NEW.company_id := parent_company;
  NEW.unit_id := COALESCE(NEW.unit_id, parent_unit);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_worklist_queue_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  parent_company UUID;
  parent_unit INTEGER;
BEGIN
  SELECT company_id, unit_id
    INTO parent_company, parent_unit
  FROM public.imaging_order_items
  WHERE id = NEW.imaging_order_item_id;

  IF parent_company IS NULL THEN
    RAISE EXCEPTION 'imaging order item % not found', NEW.imaging_order_item_id;
  END IF;

  NEW.company_id := parent_company;
  NEW.unit_id := COALESCE(NEW.unit_id, parent_unit);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_imaging_order_items_scope ON public.imaging_order_items;
CREATE TRIGGER trg_imaging_order_items_scope
  BEFORE INSERT OR UPDATE OF imaging_order_id, company_id, unit_id
  ON public.imaging_order_items
  FOR EACH ROW EXECUTE FUNCTION public.sync_imaging_order_item_scope();

DROP TRIGGER IF EXISTS trg_dicom_worklist_queue_scope ON public.dicom_worklist_queue;
CREATE TRIGGER trg_dicom_worklist_queue_scope
  BEFORE INSERT OR UPDATE OF imaging_order_item_id, company_id, unit_id
  ON public.dicom_worklist_queue
  FOR EACH ROW EXECUTE FUNCTION public.sync_worklist_queue_scope();

CREATE OR REPLACE FUNCTION public.release_imaging_item_to_worklist()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE public.imaging_order_items
  SET status = 'liberado_worklist'
  WHERE id = NEW.imaging_order_item_id AND status = 'agendado';

  UPDATE public.imaging_orders io
  SET status = 'liberado_worklist'
  WHERE io.id = (
    SELECT imaging_order_id
    FROM public.imaging_order_items
    WHERE id = NEW.imaging_order_item_id
  ) AND io.status = 'agendado';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_release_imaging_item_to_worklist
  ON public.dicom_worklist_queue;
CREATE TRIGGER trg_release_imaging_item_to_worklist
  AFTER INSERT ON public.dicom_worklist_queue
  FOR EACH ROW EXECUTE FUNCTION public.release_imaging_item_to_worklist();

DROP TRIGGER IF EXISTS trg_imaging_orders_updated_at ON public.imaging_orders;
CREATE TRIGGER trg_imaging_orders_updated_at
  BEFORE UPDATE ON public.imaging_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_imaging_order_items_updated_at ON public.imaging_order_items;
CREATE TRIGGER trg_imaging_order_items_updated_at
  BEFORE UPDATE ON public.imaging_order_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_dicom_worklist_queue_updated_at ON public.dicom_worklist_queue;
CREATE TRIGGER trg_dicom_worklist_queue_updated_at
  BEFORE UPDATE ON public.dicom_worklist_queue
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.imaging_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.imaging_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dicom_worklist_queue ENABLE ROW LEVEL SECURITY;

-- Table owners must not silently bypass tenant isolation. Background workers
-- that legitimately span tenants must use an explicit BYPASSRLS service role.
ALTER TABLE public.imaging_orders FORCE ROW LEVEL SECURITY;
ALTER TABLE public.imaging_order_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.dicom_worklist_queue FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS imaging_orders_tenant_access ON public.imaging_orders;
CREATE POLICY imaging_orders_tenant_access ON public.imaging_orders
  FOR ALL
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

DROP POLICY IF EXISTS imaging_order_items_tenant_access ON public.imaging_order_items;
CREATE POLICY imaging_order_items_tenant_access ON public.imaging_order_items
  FOR ALL
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

DROP POLICY IF EXISTS dicom_worklist_queue_tenant_access ON public.dicom_worklist_queue;
CREATE POLICY dicom_worklist_queue_tenant_access ON public.dicom_worklist_queue
  FOR ALL
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.imaging_orders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.imaging_order_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dicom_worklist_queue TO authenticated;

COMMENT ON TABLE public.dicom_worklist_queue IS
  'ProntoMedic-owned MWL queue exported to Orthanc; never writes to DataSIGH.';
