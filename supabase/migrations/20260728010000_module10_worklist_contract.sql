-- Module 10: canonical imaging order and DICOM Modality Worklist contract.
-- DataSIGH is not read or changed by this migration.

BEGIN;

DO $owner$
DECLARE
  v_executor_is_superuser BOOLEAN;
BEGIN
  SELECT rolsuper INTO v_executor_is_superuser
  FROM pg_roles WHERE rolname = CURRENT_USER;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'prontomedic_worklist_rpc_owner'
  ) THEN
    IF NOT COALESCE(v_executor_is_superuser, FALSE) THEN
      RAISE EXCEPTION 'Module 10 requires a superuser to create its RPC owner';
    END IF;
    EXECUTE
      'CREATE ROLE prontomedic_worklist_rpc_owner NOLOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION';
  ELSIF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'prontomedic_worklist_rpc_owner'
      AND (
        rolcanlogin OR rolinherit OR rolbypassrls OR rolsuper
        OR rolcreatedb OR rolcreaterole OR rolreplication
      )
  ) THEN
    IF NOT COALESCE(v_executor_is_superuser, FALSE) THEN
      RAISE EXCEPTION 'Module 10 cannot harden its RPC owner without a superuser';
    END IF;
    EXECUTE
      'ALTER ROLE prontomedic_worklist_rpc_owner NOLOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION';
  END IF;
END
$owner$;

CREATE TABLE IF NOT EXISTS public.imaging_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL DEFAULT public.active_company_id()
    REFERENCES public.companies(id) ON DELETE RESTRICT,
  unit_id INTEGER NOT NULL DEFAULT public.active_unit_id()
    REFERENCES public.units(id) ON DELETE RESTRICT,
  appointment_id BIGINT REFERENCES public.appointments(id) ON DELETE RESTRICT,
  patient_id BIGINT NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  requesting_physician_id BIGINT REFERENCES public.professionals(id) ON DELETE RESTRICT,
  referring_physician_name TEXT,
  clinical_indication TEXT,
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('normal', 'urgent', 'emergency')),
  accession_number VARCHAR(32) NOT NULL DEFAULT
    ('PM' || upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 20))),
  status TEXT NOT NULL DEFAULT 'agendado'
    CHECK (status IN (
      'agendado', 'liberado_worklist', 'em_aquisicao', 'adquirido',
      'enviado_pacs', 'recebido_pacs', 'laudando', 'laudado',
      'entregue', 'cancelado'
    )),
  notes TEXT,
  created_by UUID NOT NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT imaging_orders_company_appointment_uq UNIQUE (company_id, appointment_id),
  CONSTRAINT imaging_orders_company_accession_uq UNIQUE (company_id, accession_number)
);

CREATE TABLE IF NOT EXISTS public.imaging_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL DEFAULT public.active_company_id()
    REFERENCES public.companies(id) ON DELETE RESTRICT,
  unit_id INTEGER NOT NULL DEFAULT public.active_unit_id()
    REFERENCES public.units(id) ON DELETE RESTRICT,
  imaging_order_id UUID NOT NULL REFERENCES public.imaging_orders(id) ON DELETE RESTRICT,
  service_id BIGINT REFERENCES public.services_catalog(id) ON DELETE RESTRICT,
  exam_code VARCHAR(64),
  exam_name TEXT NOT NULL CHECK (length(trim(exam_name)) > 0),
  modality_type VARCHAR(16) NOT NULL
    CHECK (modality_type ~ '^[A-Z0-9]{1,16}$'),
  body_part TEXT,
  laterality TEXT CHECK (laterality IN ('left', 'right', 'bilateral', 'na')),
  contrast_required BOOLEAN NOT NULL DEFAULT FALSE,
  station_aetitle VARCHAR(16)
    CHECK (station_aetitle IS NULL OR station_aetitle ~ '^[A-Z0-9 _-]{1,16}$'),
  scheduled_datetime TIMESTAMPTZ,
  requested_procedure_id VARCHAR(64) NOT NULL DEFAULT gen_random_uuid()::TEXT,
  scheduled_procedure_step_id VARCHAR(64) NOT NULL DEFAULT gen_random_uuid()::TEXT,
  study_instance_uid TEXT,
  status TEXT NOT NULL DEFAULT 'agendado'
    CHECK (status IN (
      'agendado', 'liberado_worklist', 'em_aquisicao', 'adquirido',
      'enviado_pacs', 'recebido_pacs', 'laudando', 'laudado',
      'entregue', 'cancelado'
    )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT imaging_order_items_company_sps_uq
    UNIQUE (company_id, scheduled_procedure_step_id)
);

CREATE TABLE IF NOT EXISTS public.dicom_worklist_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  unit_id INTEGER NOT NULL REFERENCES public.units(id) ON DELETE RESTRICT,
  appointment_id BIGINT NOT NULL REFERENCES public.appointments(id) ON DELETE RESTRICT,
  imaging_order_item_id UUID NOT NULL REFERENCES public.imaging_order_items(id) ON DELETE RESTRICT,
  idempotency_key VARCHAR(120) NOT NULL
    CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{8,120}$'),
  patient_id BIGINT NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  patient_name TEXT NOT NULL CHECK (length(trim(patient_name)) > 0),
  patient_birth_date DATE,
  patient_sex CHAR(1) CHECK (patient_sex IS NULL OR patient_sex IN ('F', 'M', 'O')),
  patient_identifier TEXT NOT NULL CHECK (length(trim(patient_identifier)) > 0),
  accession_number VARCHAR(32) NOT NULL,
  requested_procedure_description TEXT NOT NULL,
  requested_procedure_id VARCHAR(64) NOT NULL,
  scheduled_procedure_step_id VARCHAR(64) NOT NULL,
  modality_type VARCHAR(16) NOT NULL,
  scheduled_station_aetitle VARCHAR(16) NOT NULL,
  scheduled_datetime TIMESTAMPTZ NOT NULL,
  referring_physician_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'exported', 'acquired', 'cancelled')),
  exported_to_worklist BOOLEAN NOT NULL DEFAULT FALSE,
  last_export_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT dicom_worklist_queue_company_item_uq
    UNIQUE (company_id, imaging_order_item_id)
);

ALTER TABLE public.imaging_orders
  ADD COLUMN IF NOT EXISTS appointment_id BIGINT
    REFERENCES public.appointments(id) ON DELETE RESTRICT;

UPDATE public.imaging_orders
SET appointment_id = scheduling_id
WHERE appointment_id IS NULL
  AND scheduling_id IS NOT NULL;

ALTER TABLE public.imaging_order_items
  ADD COLUMN IF NOT EXISTS company_id UUID
    REFERENCES public.companies(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS unit_id INTEGER
    REFERENCES public.units(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS service_id BIGINT
    REFERENCES public.services_catalog(id) ON DELETE RESTRICT;

UPDATE public.imaging_order_items AS item
SET company_id = imaging_order.company_id,
    unit_id = imaging_order.unit_id
FROM public.imaging_orders AS imaging_order
WHERE imaging_order.id = item.imaging_order_id
  AND (item.company_id IS NULL OR item.unit_id IS NULL);

DO $contract$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.dicom_worklist_queue
    WHERE imaging_order_item_id IS NOT NULL
      AND imaging_order_item_id::TEXT !~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
  ) THEN
    RAISE EXCEPTION
      'Module 10 cannot convert non-UUID imaging_order_item_id values';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.dicom_worklist_queue
    WHERE patient_id IS NOT NULL
      AND patient_id::TEXT !~ '^[0-9]+$'
  ) THEN
    RAISE EXCEPTION
      'Module 10 cannot convert non-numeric patient_id values';
  END IF;
END
$contract$;

ALTER TABLE public.dicom_worklist_queue
  ALTER COLUMN imaging_order_item_id TYPE UUID
    USING NULLIF(imaging_order_item_id::TEXT, '')::UUID,
  ALTER COLUMN patient_id TYPE BIGINT
    USING NULLIF(patient_id::TEXT, '')::BIGINT,
  ADD COLUMN IF NOT EXISTS appointment_id BIGINT
    REFERENCES public.appointments(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(120);

UPDATE public.dicom_worklist_queue AS queue
SET appointment_id = imaging_order.appointment_id,
    idempotency_key = COALESCE(
      queue.idempotency_key,
      'legacy:' || queue.id::TEXT
    )
FROM public.imaging_order_items AS item
JOIN public.imaging_orders AS imaging_order
  ON imaging_order.id = item.imaging_order_id
WHERE item.id = queue.imaging_order_item_id
  AND (queue.appointment_id IS NULL OR queue.idempotency_key IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS imaging_orders_company_appointment_uq
  ON public.imaging_orders(company_id, appointment_id);
CREATE UNIQUE INDEX IF NOT EXISTS dicom_worklist_queue_company_item_uq
  ON public.dicom_worklist_queue(company_id, imaging_order_item_id);

DO $preflight$
DECLARE
  v_table TEXT;
  v_column TEXT;
BEGIN
  FOR v_table, v_column IN
    SELECT * FROM (VALUES
      ('imaging_orders', 'company_id'),
      ('imaging_orders', 'unit_id'),
      ('imaging_orders', 'appointment_id'),
      ('imaging_order_items', 'company_id'),
      ('imaging_order_items', 'unit_id'),
      ('dicom_worklist_queue', 'company_id'),
      ('dicom_worklist_queue', 'unit_id'),
      ('dicom_worklist_queue', 'appointment_id'),
      ('dicom_worklist_queue', 'idempotency_key')
    ) AS required(table_name, column_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = v_table
        AND column_name = v_column
    ) THEN
      RAISE EXCEPTION 'Module 10 preflight failed: %.% is missing', v_table, v_column;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM public.imaging_orders
    WHERE company_id IS NULL OR unit_id IS NULL OR patient_id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.imaging_order_items
    WHERE company_id IS NULL OR unit_id IS NULL OR imaging_order_id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.dicom_worklist_queue
    WHERE company_id IS NULL OR unit_id IS NULL OR appointment_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Module 10 preflight failed: unscoped imaging/worklist rows exist';
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.m10_enforce_imaging_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_TABLE_NAME = 'imaging_orders' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.units unit
      WHERE unit.id = NEW.unit_id
        AND unit.company_id = NEW.company_id
        AND unit.lg_ativo = TRUE
    ) THEN
      RAISE EXCEPTION 'Imaging order unit is outside the active company';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.patients patient
      WHERE patient.id = NEW.patient_id
        AND patient.company_id = NEW.company_id
    ) THEN
      RAISE EXCEPTION 'Imaging order patient is outside the active company';
    END IF;
    IF NEW.requesting_physician_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.professionals professional
      WHERE professional.id = NEW.requesting_physician_id
        AND professional.company_id = NEW.company_id
        AND professional.lg_ativo = TRUE
    ) THEN
      RAISE EXCEPTION 'Imaging order physician is outside the active company';
    END IF;
    IF NEW.appointment_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.appointments appointment
      WHERE appointment.id = NEW.appointment_id
        AND appointment.company_id = NEW.company_id
        AND appointment.unit_id = NEW.unit_id
        AND appointment.patient_id = NEW.patient_id
    ) THEN
      RAISE EXCEPTION 'Imaging order appointment has an inconsistent scope';
    END IF;
  ELSIF TG_TABLE_NAME = 'imaging_order_items' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.imaging_orders imaging_order
      WHERE imaging_order.id = NEW.imaging_order_id
        AND imaging_order.company_id = NEW.company_id
        AND imaging_order.unit_id = NEW.unit_id
    ) THEN
      RAISE EXCEPTION 'Imaging item has an inconsistent order scope';
    END IF;
  ELSIF TG_TABLE_NAME = 'dicom_worklist_queue' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.imaging_order_items item
      JOIN public.imaging_orders imaging_order
        ON imaging_order.id = item.imaging_order_id
       AND imaging_order.company_id = item.company_id
       AND imaging_order.unit_id = item.unit_id
      WHERE item.id = NEW.imaging_order_item_id
        AND item.company_id = NEW.company_id
        AND item.unit_id = NEW.unit_id
        AND imaging_order.appointment_id = NEW.appointment_id
        AND imaging_order.patient_id = NEW.patient_id
    ) THEN
      RAISE EXCEPTION 'Worklist row has an inconsistent tenant relationship';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_m10_imaging_orders_scope ON public.imaging_orders;
CREATE TRIGGER trg_m10_imaging_orders_scope
  BEFORE INSERT OR UPDATE OF company_id, unit_id, appointment_id, patient_id,
    requesting_physician_id
  ON public.imaging_orders
  FOR EACH ROW EXECUTE FUNCTION public.m10_enforce_imaging_scope();

DROP TRIGGER IF EXISTS trg_m10_imaging_order_items_scope ON public.imaging_order_items;
CREATE TRIGGER trg_m10_imaging_order_items_scope
  BEFORE INSERT OR UPDATE OF company_id, unit_id, imaging_order_id
  ON public.imaging_order_items
  FOR EACH ROW EXECUTE FUNCTION public.m10_enforce_imaging_scope();

DROP TRIGGER IF EXISTS trg_m10_worklist_queue_scope ON public.dicom_worklist_queue;
CREATE TRIGGER trg_m10_worklist_queue_scope
  BEFORE INSERT OR UPDATE OF company_id, unit_id, appointment_id,
    imaging_order_item_id, patient_id
  ON public.dicom_worklist_queue
  FOR EACH ROW EXECUTE FUNCTION public.m10_enforce_imaging_scope();

CREATE INDEX IF NOT EXISTS imaging_orders_scope_idx
  ON public.imaging_orders(company_id, unit_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS imaging_order_items_order_idx
  ON public.imaging_order_items(company_id, unit_id, imaging_order_id);
CREATE INDEX IF NOT EXISTS dicom_worklist_queue_scope_idx
  ON public.dicom_worklist_queue(company_id, unit_id, status, scheduled_datetime);

INSERT INTO public.role_permissions (
  company_id, role_id, module,
  can_view, can_create, can_edit, can_delete, can_export
)
SELECT
  company.id,
  role.id,
  module.name,
  TRUE,
  CASE
    WHEN lower(role.name) IN (
      'admin', 'administrador', 'superadmin', 'super_admin',
      'recepcao', 'recepção', 'medico', 'médico',
      'radiologia', 'imagem', 'diagnostico', 'diagnóstico'
    ) THEN TRUE ELSE FALSE
  END,
  CASE
    WHEN lower(role.name) IN (
      'admin', 'administrador', 'superadmin', 'super_admin',
      'recepcao', 'recepção', 'medico', 'médico',
      'radiologia', 'imagem', 'diagnostico', 'diagnóstico'
    ) THEN TRUE ELSE FALSE
  END,
  lower(role.name) IN (
    'admin', 'administrador', 'superadmin', 'super_admin',
    'radiologia', 'imagem', 'diagnostico', 'diagnóstico'
  ),
  lower(role.name) IN (
    'admin', 'administrador', 'superadmin', 'super_admin',
    'radiologia', 'imagem', 'diagnostico', 'diagnóstico'
  )
FROM public.companies company
CROSS JOIN public.roles role
CROSS JOIN (VALUES ('dicom'), ('worklist')) AS module(name)
WHERE company.lg_ativo = TRUE
  AND role.lg_ativo = TRUE
  AND lower(role.name) IN (
    'admin', 'administrador', 'superadmin', 'super_admin',
    'recepcao', 'recepção', 'medico', 'médico',
    'radiologia', 'imagem', 'diagnostico', 'diagnóstico'
  )
ON CONFLICT (company_id, role_id, module) DO NOTHING;

ALTER TABLE public.imaging_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.imaging_orders FORCE ROW LEVEL SECURITY;
ALTER TABLE public.imaging_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.imaging_order_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.dicom_worklist_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dicom_worklist_queue FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS m10_imaging_orders_select ON public.imaging_orders;
CREATE POLICY m10_imaging_orders_select ON public.imaging_orders
  FOR SELECT TO authenticated
  USING (
    company_id = public.active_company_id()
    AND (public.active_unit_id() IS NULL OR unit_id = public.active_unit_id())
    AND (public.can_access('dicom', 'view') OR public.can_access('worklist', 'view'))
  );

DROP POLICY IF EXISTS m10_imaging_order_items_select ON public.imaging_order_items;
CREATE POLICY m10_imaging_order_items_select ON public.imaging_order_items
  FOR SELECT TO authenticated
  USING (
    company_id = public.active_company_id()
    AND (public.active_unit_id() IS NULL OR unit_id = public.active_unit_id())
    AND (public.can_access('dicom', 'view') OR public.can_access('worklist', 'view'))
  );

DROP POLICY IF EXISTS m10_worklist_queue_select ON public.dicom_worklist_queue;
CREATE POLICY m10_worklist_queue_select ON public.dicom_worklist_queue
  FOR SELECT TO authenticated
  USING (
    company_id = public.active_company_id()
    AND (public.active_unit_id() IS NULL OR unit_id = public.active_unit_id())
    AND (
      public.can_access('dicom', 'view')
      OR public.can_access('worklist', 'view')
      OR public.can_access('recepcao', 'view')
    )
  );

DROP POLICY IF EXISTS m10_imaging_orders_write ON public.imaging_orders;
CREATE POLICY m10_imaging_orders_write ON public.imaging_orders
  FOR ALL TO authenticated
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
    AND public.can_access('dicom', 'edit')
  )
  WITH CHECK (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
    AND (
      public.can_access('dicom', 'create')
      OR public.can_access('dicom', 'edit')
    )
    AND (
      appointment_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.appointments appointment
        WHERE appointment.id = appointment_id
          AND appointment.company_id = company_id
          AND appointment.unit_id = unit_id
          AND appointment.patient_id = patient_id
      )
    )
  );

DROP POLICY IF EXISTS m10_imaging_order_items_write ON public.imaging_order_items;
CREATE POLICY m10_imaging_order_items_write ON public.imaging_order_items
  FOR ALL TO authenticated
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
    AND public.can_access('dicom', 'edit')
  )
  WITH CHECK (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
    AND (
      public.can_access('dicom', 'create')
      OR public.can_access('dicom', 'edit')
    )
    AND EXISTS (
      SELECT 1 FROM public.imaging_orders imaging_order
      WHERE imaging_order.id = imaging_order_id
        AND imaging_order.company_id = company_id
        AND imaging_order.unit_id = unit_id
    )
  );

DROP POLICY IF EXISTS m10_worklist_queue_update ON public.dicom_worklist_queue;
CREATE POLICY m10_worklist_queue_update ON public.dicom_worklist_queue
  FOR UPDATE TO authenticated
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
    AND public.can_access('dicom', 'edit')
  )
  WITH CHECK (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
    AND public.can_access('dicom', 'edit')
  );

DROP POLICY IF EXISTS m10_imaging_orders_rpc_select ON public.imaging_orders;
CREATE POLICY m10_imaging_orders_rpc_select ON public.imaging_orders
  FOR SELECT TO prontomedic_worklist_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND (public.active_unit_id() IS NULL OR unit_id = public.active_unit_id())
    AND public.org_can_access_unit(company_id, unit_id)
  );

DROP POLICY IF EXISTS m10_imaging_orders_rpc_update ON public.imaging_orders;
CREATE POLICY m10_imaging_orders_rpc_update ON public.imaging_orders
  FOR UPDATE TO prontomedic_worklist_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND (public.active_unit_id() IS NULL OR unit_id = public.active_unit_id())
    AND public.org_can_access_unit(company_id, unit_id)
  )
  WITH CHECK (
    company_id = public.active_company_id()
    AND (public.active_unit_id() IS NULL OR unit_id = public.active_unit_id())
    AND public.org_can_access_unit(company_id, unit_id)
  );

DROP POLICY IF EXISTS m10_imaging_order_items_rpc_select ON public.imaging_order_items;
CREATE POLICY m10_imaging_order_items_rpc_select ON public.imaging_order_items
  FOR SELECT TO prontomedic_worklist_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND (public.active_unit_id() IS NULL OR unit_id = public.active_unit_id())
    AND public.org_can_access_unit(company_id, unit_id)
  );

DROP POLICY IF EXISTS m10_imaging_order_items_rpc_update ON public.imaging_order_items;
CREATE POLICY m10_imaging_order_items_rpc_update ON public.imaging_order_items
  FOR UPDATE TO prontomedic_worklist_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND (public.active_unit_id() IS NULL OR unit_id = public.active_unit_id())
    AND public.org_can_access_unit(company_id, unit_id)
  )
  WITH CHECK (
    company_id = public.active_company_id()
    AND (public.active_unit_id() IS NULL OR unit_id = public.active_unit_id())
    AND public.org_can_access_unit(company_id, unit_id)
  );

DROP POLICY IF EXISTS m10_worklist_queue_rpc_access ON public.dicom_worklist_queue;
CREATE POLICY m10_worklist_queue_rpc_access ON public.dicom_worklist_queue
  FOR ALL TO prontomedic_worklist_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND (public.active_unit_id() IS NULL OR unit_id = public.active_unit_id())
    AND public.org_can_access_unit(company_id, unit_id)
  )
  WITH CHECK (
    company_id = public.active_company_id()
    AND (public.active_unit_id() IS NULL OR unit_id = public.active_unit_id())
    AND public.org_can_access_unit(company_id, unit_id)
  );

REVOKE ALL ON public.imaging_orders, public.imaging_order_items,
  public.dicom_worklist_queue FROM PUBLIC, anon;
REVOKE INSERT, DELETE, TRUNCATE ON public.dicom_worklist_queue
  FROM authenticated;
GRANT SELECT ON public.imaging_orders, public.imaging_order_items,
  public.dicom_worklist_queue TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.imaging_orders, public.imaging_order_items
  TO authenticated;
GRANT UPDATE ON public.dicom_worklist_queue
  TO authenticated;

CREATE OR REPLACE FUNCTION public.release_appointment_to_worklist_secure(
  p_appointment_id BIGINT,
  p_idempotency_key TEXT
)
RETURNS SETOF public.dicom_worklist_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_company UUID := public.active_company_id();
  v_unit INTEGER := public.active_unit_id();
  v_appointment public.appointments;
  v_order public.imaging_orders;
  v_patient public.patients;
  v_item public.imaging_order_items;
BEGIN
  IF public.request_aal() <> 'aal2' THEN
    RAISE EXCEPTION 'AAL2 required to release DICOM worklist';
  END IF;
  IF NOT (
    public.can_access('recepcao', 'edit')
    OR public.can_access('dicom', 'create')
    OR public.can_access('worklist', 'create')
  ) THEN
    RAISE EXCEPTION 'Worklist release permission required';
  END IF;
  IF p_idempotency_key IS NULL
     OR p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,120}$' THEN
    RAISE EXCEPTION 'Invalid worklist idempotency key';
  END IF;

  SELECT * INTO v_appointment
  FROM public.appointments appointment
  WHERE appointment.id = p_appointment_id
    AND appointment.company_id = v_company
    AND (v_unit IS NULL OR appointment.unit_id = v_unit)
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Appointment not found in active scope'; END IF;

  SELECT * INTO v_order
  FROM public.imaging_orders imaging_order
  WHERE imaging_order.company_id = v_company
    AND imaging_order.unit_id = v_appointment.unit_id
    AND imaging_order.appointment_id = v_appointment.id
    AND imaging_order.patient_id = v_appointment.patient_id
    AND imaging_order.status <> 'cancelado'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Imaging order not found for appointment'; END IF;

  SELECT * INTO v_patient
  FROM public.patients patient
  WHERE patient.id = v_appointment.patient_id
    AND patient.company_id = v_company;
  IF NOT FOUND THEN RAISE EXCEPTION 'Patient not found in active company'; END IF;

  IF COALESCE(trim(v_patient.full_name), '') = ''
     OR COALESCE(trim(COALESCE(v_patient.cpf, v_patient.nr_cpf, v_patient.cd_cpf)), '') = '' THEN
    RAISE EXCEPTION 'Patient identity is incomplete for DICOM worklist';
  END IF;

  FOR v_item IN
    SELECT *
    FROM public.imaging_order_items item
    WHERE item.company_id = v_company
      AND item.unit_id = v_order.unit_id
      AND item.imaging_order_id = v_order.id
      AND item.status = 'agendado'
    ORDER BY item.created_at
    FOR UPDATE
  LOOP
    IF v_item.station_aetitle !~ '^[A-Z0-9 _-]{1,16}$'
       OR v_item.modality_type !~ '^[A-Z0-9]{1,16}$'
       OR COALESCE(trim(v_item.requested_procedure_id), '') = ''
       OR COALESCE(trim(v_item.scheduled_procedure_step_id), '') = ''
       OR v_item.scheduled_datetime IS NULL THEN
      RAISE EXCEPTION 'Imaging item % has incomplete DICOM identifiers', v_item.id;
    END IF;

    INSERT INTO public.dicom_worklist_queue(
      company_id, unit_id, appointment_id, imaging_order_item_id,
      idempotency_key, patient_id, patient_name, patient_birth_date,
      patient_sex, patient_identifier, accession_number,
      requested_procedure_description, requested_procedure_id,
      scheduled_procedure_step_id, modality_type,
      scheduled_station_aetitle, scheduled_datetime,
      referring_physician_name
    ) VALUES (
      v_company, v_order.unit_id, v_appointment.id, v_item.id,
      p_idempotency_key, v_patient.id, v_patient.full_name,
      COALESCE(v_patient.birth_date, v_patient.dt_nascimento),
      COALESCE(v_patient.sex, v_patient.cd_sexo),
      COALESCE(v_patient.cpf, v_patient.nr_cpf, v_patient.cd_cpf),
      v_order.accession_number, v_item.exam_name,
      v_item.requested_procedure_id, v_item.scheduled_procedure_step_id,
      v_item.modality_type, v_item.station_aetitle,
      v_item.scheduled_datetime, v_order.referring_physician_name
    )
    ON CONFLICT (company_id, imaging_order_item_id) DO UPDATE
      SET updated_at = NOW()
      WHERE public.dicom_worklist_queue.idempotency_key = EXCLUDED.idempotency_key;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Worklist item already exists with another idempotency key';
    END IF;

    UPDATE public.imaging_order_items
    SET status = 'liberado_worklist', updated_at = NOW()
    WHERE id = v_item.id;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM public.dicom_worklist_queue queue
    WHERE queue.company_id = v_company
      AND queue.appointment_id = v_appointment.id
      AND queue.idempotency_key = p_idempotency_key
  ) THEN
    RAISE EXCEPTION 'No eligible imaging item was released';
  END IF;

  UPDATE public.imaging_orders
  SET status = 'liberado_worklist', updated_at = NOW()
  WHERE id = v_order.id;

  RETURN QUERY
  SELECT queue.*
  FROM public.dicom_worklist_queue queue
  WHERE queue.company_id = v_company
    AND queue.appointment_id = v_appointment.id
    AND queue.idempotency_key = p_idempotency_key
  ORDER BY queue.scheduled_datetime, queue.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.release_appointment_to_worklist_secure(BIGINT, TEXT)
  FROM PUBLIC, anon;
ALTER FUNCTION public.release_appointment_to_worklist_secure(BIGINT, TEXT)
  OWNER TO prontomedic_worklist_rpc_owner;

GRANT USAGE ON SCHEMA public TO prontomedic_worklist_rpc_owner;
GRANT SELECT, UPDATE ON public.imaging_orders, public.imaging_order_items
  TO prontomedic_worklist_rpc_owner;
GRANT SELECT, INSERT, UPDATE ON public.dicom_worklist_queue
  TO prontomedic_worklist_rpc_owner;
GRANT SELECT ON public.appointments, public.patients
  TO prontomedic_worklist_rpc_owner;
GRANT EXECUTE ON FUNCTION public.active_company_id()
  TO prontomedic_worklist_rpc_owner;
GRANT EXECUTE ON FUNCTION public.active_unit_id()
  TO prontomedic_worklist_rpc_owner;
GRANT EXECUTE ON FUNCTION public.request_aal()
  TO prontomedic_worklist_rpc_owner;
GRANT EXECUTE ON FUNCTION public.can_access(TEXT, TEXT)
  TO prontomedic_worklist_rpc_owner;
GRANT EXECUTE ON FUNCTION public.org_can_access_unit(UUID, INTEGER)
  TO prontomedic_worklist_rpc_owner;

GRANT EXECUTE ON FUNCTION public.release_appointment_to_worklist_secure(BIGINT, TEXT)
  TO authenticated;

COMMENT ON FUNCTION public.release_appointment_to_worklist_secure(BIGINT, TEXT)
  IS 'Atomically releases a scoped imaging appointment to DICOM MWL without touching DataSIGH.';

COMMIT;
