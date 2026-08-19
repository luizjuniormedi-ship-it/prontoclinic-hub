BEGIN;

DO $prerequisites$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'prontomedic_worklist_rpc_owner'
  ) THEN
    RAISE EXCEPTION 'M24 requires prontomedic_worklist_rpc_owner';
  END IF;
  IF to_regclass('public.dicom_worklist_queue') IS NULL
     OR to_regclass('public.pacs_studies') IS NULL
     OR to_regclass('public.reports') IS NULL THEN
    RAISE EXCEPTION 'M24 canonical RIS tables are missing';
  END IF;
END
$prerequisites$;

-- The original trigger predates the UUID conversion performed by M10. Keep the
-- same canonical trigger, but compare the legacy PACS text key safely and write
-- exclusively to public.reports.
CREATE OR REPLACE FUNCTION public.create_report_for_received_study()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_order public.imaging_orders%ROWTYPE;
BEGIN
  SELECT imaging_order.* INTO v_order
  FROM public.imaging_orders AS imaging_order
  JOIN public.imaging_order_items AS item
    ON item.imaging_order_id = imaging_order.id
  WHERE item.id::TEXT = NEW.imaging_order_item_id
    AND imaging_order.company_id = NEW.company_id
    AND imaging_order.unit_id = NEW.unit_id
    AND imaging_order.patient_id::TEXT = NEW.patient_id
  LIMIT 1;

  IF FOUND AND NEW.study_instance_uid IS NOT NULL THEN
    INSERT INTO public.reports(
      company_id, unit_id, patient_id, imaging_order_item_id, pacs_study_id,
      study_instance_uid, status, priority, title, clinical_indication,
      requester_professional_id, requester_name
    ) VALUES (
      v_order.company_id, v_order.unit_id, v_order.patient_id,
      NEW.imaging_order_item_id::UUID, NEW.id, NEW.study_instance_uid,
      'aguardando_laudo',
      CASE v_order.priority
        WHEN 'emergency' THEN 'urgente'
        WHEN 'urgent' THEN 'prioritario'
        ELSE 'rotina'
      END,
      'Laudo ' || COALESCE(NEW.modality_type, 'Imagem'),
      v_order.clinical_indication, v_order.requesting_physician_id,
      v_order.referring_physician_name
    )
    ON CONFLICT (company_id, study_instance_uid)
      WHERE study_instance_uid IS NOT NULL AND deleted_at IS NULL
    DO NOTHING;
  END IF;
  RETURN NEW;
END
$function$;

-- Dedicated owner policies retain FORCE-RLS behavior on the M10 aggregate and
-- constrain the definer to the caller's active application context.
DROP POLICY IF EXISTS m24_dicom_exams_rpc_select ON public.dicom_exams;
CREATE POLICY m24_dicom_exams_rpc_select ON public.dicom_exams
  FOR SELECT TO prontomedic_worklist_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
    AND public.request_aal() = 'aal2'
    AND public.can_access('dicom', 'view')
  );

DROP POLICY IF EXISTS m24_worklist_rpc_select_update ON public.dicom_worklist_queue;
CREATE POLICY m24_worklist_rpc_select_update ON public.dicom_worklist_queue
  FOR ALL TO prontomedic_worklist_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
    AND public.request_aal() = 'aal2'
    AND public.can_access('dicom', 'edit')
  )
  WITH CHECK (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
    AND public.request_aal() = 'aal2'
    AND public.can_access('dicom', 'edit')
  );

DROP POLICY IF EXISTS m24_pacs_studies_rpc_access ON public.pacs_studies;
CREATE POLICY m24_pacs_studies_rpc_access ON public.pacs_studies
  FOR ALL TO prontomedic_worklist_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
    AND public.request_aal() = 'aal2'
    AND public.can_access('dicom', 'edit')
  )
  WITH CHECK (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
    AND public.request_aal() = 'aal2'
    AND public.can_access('dicom', 'edit')
  );

DROP POLICY IF EXISTS m24_dicom_nodes_rpc_select ON public.dicom_nodes;
CREATE POLICY m24_dicom_nodes_rpc_select ON public.dicom_nodes
  FOR SELECT TO prontomedic_worklist_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND (unit_id IS NULL OR unit_id = public.active_unit_id())
    AND public.org_can_access_unit(company_id, public.active_unit_id())
    AND public.request_aal() = 'aal2'
    AND public.can_access('dicom', 'edit')
  );

DROP POLICY IF EXISTS m24_imaging_items_rpc_access ON public.imaging_order_items;
CREATE POLICY m24_imaging_items_rpc_access ON public.imaging_order_items
  FOR SELECT TO prontomedic_worklist_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
    AND public.request_aal() = 'aal2'
    AND public.can_access('dicom', 'edit')
  );

DROP POLICY IF EXISTS m24_imaging_items_rpc_update ON public.imaging_order_items;
CREATE POLICY m24_imaging_items_rpc_update ON public.imaging_order_items
  FOR UPDATE TO prontomedic_worklist_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
    AND public.request_aal() = 'aal2'
    AND public.can_access('dicom', 'edit')
  )
  WITH CHECK (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
    AND public.request_aal() = 'aal2'
    AND public.can_access('dicom', 'edit')
  );

DROP POLICY IF EXISTS m24_imaging_orders_rpc_insert ON public.imaging_orders;
DROP POLICY IF EXISTS m24_units_rpc_select ON public.units;
CREATE POLICY m24_units_rpc_select ON public.units FOR SELECT TO prontomedic_worklist_rpc_owner
USING (company_id=public.active_company_id() AND id=public.active_unit_id() AND public.org_can_access_unit(company_id,id));
DROP POLICY IF EXISTS m24_professionals_rpc_select ON public.professionals;
CREATE POLICY m24_professionals_rpc_select ON public.professionals FOR SELECT TO prontomedic_worklist_rpc_owner
USING (company_id=public.active_company_id());
CREATE POLICY m24_imaging_orders_rpc_insert ON public.imaging_orders FOR INSERT TO prontomedic_worklist_rpc_owner
WITH CHECK (company_id=public.active_company_id() AND unit_id=public.active_unit_id() AND public.org_can_access_unit(company_id,unit_id) AND public.request_aal()='aal2' AND public.can_access('dicom','create'));
DROP POLICY IF EXISTS m24_imaging_items_rpc_insert ON public.imaging_order_items;
CREATE POLICY m24_imaging_items_rpc_insert ON public.imaging_order_items FOR INSERT TO prontomedic_worklist_rpc_owner
WITH CHECK (company_id=public.active_company_id() AND unit_id=public.active_unit_id() AND public.org_can_access_unit(company_id,unit_id) AND public.request_aal()='aal2' AND public.can_access('dicom','create'));

DROP POLICY IF EXISTS m24_reports_rpc_access ON public.reports;
CREATE POLICY m24_reports_rpc_access ON public.reports
  FOR ALL TO prontomedic_worklist_rpc_owner
  USING (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
    AND public.request_aal() = 'aal2'
    AND public.can_access('dicom', 'edit')
  )
  WITH CHECK (
    company_id = public.active_company_id()
    AND unit_id = public.active_unit_id()
    AND public.org_can_access_unit(company_id, unit_id)
    AND public.request_aal() = 'aal2'
    AND public.can_access('dicom', 'edit')
  );

DROP POLICY IF EXISTS m24_report_delivery_rpc_insert ON public.report_delivery_logs;
CREATE POLICY m24_report_delivery_rpc_insert ON public.report_delivery_logs
  FOR INSERT TO prontomedic_worklist_rpc_owner
  WITH CHECK (
    delivered_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.reports AS report
      WHERE report.id = report_id
        AND report.company_id = public.active_company_id()
        AND report.unit_id = public.active_unit_id()
    )
  );

GRANT SELECT ON public.dicom_exams, public.dicom_worklist_queue,
  public.pacs_studies, public.imaging_orders, public.imaging_order_items,
  public.reports, public.dicom_nodes TO prontomedic_worklist_rpc_owner;
GRANT UPDATE ON public.dicom_worklist_queue, public.imaging_order_items,
  public.reports TO prontomedic_worklist_rpc_owner;
GRANT INSERT, UPDATE ON public.pacs_studies TO prontomedic_worklist_rpc_owner;
GRANT INSERT ON public.reports, public.report_delivery_logs
  TO prontomedic_worklist_rpc_owner;
GRANT INSERT ON public.imaging_orders, public.imaging_order_items TO prontomedic_worklist_rpc_owner;
GRANT SELECT ON public.units, public.professionals TO prontomedic_worklist_rpc_owner;
GRANT USAGE ON SCHEMA auth TO prontomedic_worklist_rpc_owner;
GRANT EXECUTE ON FUNCTION auth.uid() TO prontomedic_worklist_rpc_owner;

DROP FUNCTION IF EXISTS public.get_dicom_exam_by_appointment(BIGINT);
CREATE FUNCTION public.get_dicom_exam_by_appointment(p_appointment_id BIGINT)
RETURNS TABLE (
  exam_id BIGINT,
  study_uid VARCHAR,
  patient_name VARCHAR,
  modality VARCHAR,
  nr_images INTEGER,
  ds_url_dicom TEXT,
  ds_url_thumb TEXT,
  ds_status VARCHAR
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_company UUID := public.active_company_id();
  v_unit INTEGER := public.active_unit_id();
BEGIN
  IF auth.uid() IS NULL OR public.request_aal() <> 'aal2' THEN
    RAISE EXCEPTION 'AAL2 required to read DICOM exam';
  END IF;
  IF v_company IS NULL OR v_unit IS NULL
     OR NOT public.org_can_access_unit(v_company, v_unit)
     OR NOT public.can_access('dicom', 'view') THEN
    RAISE EXCEPTION 'DICOM read access denied';
  END IF;
  IF p_appointment_id IS NULL OR p_appointment_id <= 0 THEN
    RAISE EXCEPTION 'Invalid appointment';
  END IF;

  RETURN QUERY
  SELECT exam.id, exam.cd_dicom_exame, exam.ds_patient_name,
    exam.ds_modality, exam.nr_images, exam.ds_url_dicom,
    exam.ds_url_thumb, exam.ds_status
  FROM public.dicom_exams AS exam
  WHERE exam.company_id = v_company
    AND exam.unit_id = v_unit
    AND exam.cd_appointment = p_appointment_id
  ORDER BY exam.created_at DESC
  LIMIT 1;
END
$function$;

ALTER FUNCTION public.get_dicom_exam_by_appointment(BIGINT)
  OWNER TO prontomedic_worklist_rpc_owner;
REVOKE ALL ON FUNCTION public.get_dicom_exam_by_appointment(BIGINT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dicom_exam_by_appointment(BIGINT)
  TO authenticated, app_prontomedic;

-- Remove defaults and overload ambiguity before recreating the installed
-- two- and three-argument signatures.
DROP FUNCTION IF EXISTS public.publish_dicom_report(BIGINT, BOOLEAN, UUID);
DROP FUNCTION IF EXISTS public.publish_dicom_report(BIGINT, BOOLEAN);

CREATE FUNCTION public.publish_dicom_report(
  p_exam_id BIGINT,
  p_publish_to_app BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_company UUID := public.active_company_id();
  v_unit INTEGER := public.active_unit_id();
  v_exam public.dicom_exams%ROWTYPE;
  v_report public.reports%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR public.request_aal() <> 'aal2' THEN
    RAISE EXCEPTION 'AAL2 required to publish DICOM report';
  END IF;
  IF v_company IS NULL OR v_unit IS NULL
     OR NOT public.org_can_access_unit(v_company, v_unit)
     OR NOT public.can_access('dicom', 'edit') THEN
    RAISE EXCEPTION 'DICOM report publication denied';
  END IF;

  SELECT exam.* INTO v_exam
  FROM public.dicom_exams AS exam
  WHERE exam.id = p_exam_id
    AND exam.company_id = v_company
    AND exam.unit_id = v_unit;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DICOM exam not found in active scope';
  END IF;

  SELECT report.* INTO v_report
  FROM public.reports AS report
  WHERE report.company_id = v_company
    AND report.unit_id = v_unit
    AND report.study_instance_uid = v_exam.cd_dicom_exame
    AND report.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canonical report not found for DICOM exam';
  END IF;

  IF p_publish_to_app THEN
    IF v_report.status NOT IN ('liberado', 'entregue') THEN
      RAISE EXCEPTION 'Only released report can be published';
    END IF;
    IF v_report.status = 'liberado' THEN
      PERFORM set_config('app.report_delivery_rpc', '1', TRUE);
      UPDATE public.reports
      SET status = 'entregue', delivered_at = NOW(), updated_at = NOW()
      WHERE id = v_report.id
      RETURNING * INTO v_report;
      INSERT INTO public.report_delivery_logs(
        report_id, canal, destinatario, delivered_by
      ) VALUES (
        v_report.id, 'APP', v_exam.cd_patient::TEXT, auth.uid()
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'exam_id', v_exam.id,
    'report_id', v_report.id,
    'published', p_publish_to_app,
    'published_at', v_report.delivered_at,
    'status', v_report.status
  );
END
$function$;

ALTER FUNCTION public.publish_dicom_report(BIGINT, BOOLEAN)
  OWNER TO prontomedic_worklist_rpc_owner;
REVOKE ALL ON FUNCTION public.publish_dicom_report(BIGINT, BOOLEAN)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_dicom_report(BIGINT, BOOLEAN)
  TO authenticated, app_prontomedic;

CREATE FUNCTION public.publish_dicom_report(
  p_exam_id BIGINT,
  p_publish_to_app BOOLEAN,
  p_signed_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF p_signed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Report actor must match authenticated user';
  END IF;
  RETURN public.publish_dicom_report(p_exam_id, p_publish_to_app);
END
$function$;

ALTER FUNCTION public.publish_dicom_report(BIGINT, BOOLEAN, UUID)
  OWNER TO prontomedic_worklist_rpc_owner;
REVOKE ALL ON FUNCTION public.publish_dicom_report(BIGINT, BOOLEAN, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_dicom_report(BIGINT, BOOLEAN, UUID)
  TO authenticated, app_prontomedic;

CREATE OR REPLACE FUNCTION public.m24_receive_pacs_study_secure(
  p_accession_number TEXT,
  p_study_instance_uid TEXT,
  p_study_date DATE DEFAULT NULL,
  p_study_time TEXT DEFAULT NULL,
  p_modality_type TEXT DEFAULT NULL,
  p_station_aetitle TEXT DEFAULT NULL,
  p_scheduled_procedure_step_id TEXT DEFAULT NULL,
  p_source_node_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_company UUID := public.active_company_id();
  v_unit INTEGER := public.active_unit_id();
  v_queue public.dicom_worklist_queue%ROWTYPE;
  v_study public.pacs_studies%ROWTYPE;
  v_existing_study public.pacs_studies%ROWTYPE;
  v_report_id UUID;
  v_matches INTEGER;
  v_modality_type TEXT;
  v_station_aetitle TEXT;
BEGIN
  IF auth.uid() IS NULL OR public.request_aal() <> 'aal2' THEN
    RAISE EXCEPTION 'AAL2 required to ingest PACS study';
  END IF;
  IF v_company IS NULL OR v_unit IS NULL
     OR NOT public.org_can_access_unit(v_company, v_unit)
     OR NOT public.can_access('dicom', 'edit') THEN
    RAISE EXCEPTION 'PACS ingestion denied';
  END IF;
  IF NULLIF(BTRIM(p_accession_number), '') IS NULL THEN
    RAISE EXCEPTION 'Accession number is required';
  END IF;
  IF NULLIF(BTRIM(p_study_instance_uid), '') IS NULL
     OR p_study_instance_uid !~ '^[0-9]+(\.[0-9]+)+$'
     OR length(p_study_instance_uid) > 200 THEN
    RAISE EXCEPTION 'Invalid StudyInstanceUID';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_company::TEXT || ':' || BTRIM(p_accession_number), 0)
  );

  SELECT COUNT(*) INTO v_matches
  FROM public.dicom_worklist_queue AS queue
  WHERE queue.accession_number = BTRIM(p_accession_number)
    AND queue.company_id = v_company
    AND queue.unit_id = v_unit
    AND queue.status IN ('pending', 'exported', 'acquired')
    AND (
      NULLIF(BTRIM(p_scheduled_procedure_step_id), '') IS NULL
      OR queue.scheduled_procedure_step_id = BTRIM(p_scheduled_procedure_step_id)
    );
  IF v_matches = 0 THEN
    RAISE EXCEPTION 'Worklist item not found in active scope';
  ELSIF v_matches > 1 THEN
    RAISE EXCEPTION 'Ambiguous accession: ScheduledProcedureStepID is required';
  END IF;

  SELECT queue.* INTO v_queue
  FROM public.dicom_worklist_queue AS queue
  WHERE queue.accession_number = BTRIM(p_accession_number)
    AND queue.company_id = v_company
    AND queue.unit_id = v_unit
    AND queue.status IN ('pending', 'exported', 'acquired')
    AND (
      NULLIF(BTRIM(p_scheduled_procedure_step_id), '') IS NULL
      OR queue.scheduled_procedure_step_id = BTRIM(p_scheduled_procedure_step_id)
    )
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Worklist item not found in active scope';
  END IF;

  IF p_source_node_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.dicom_nodes AS node
    WHERE node.id = p_source_node_id
      AND node.company_id = v_company
      AND (node.unit_id IS NULL OR node.unit_id = v_unit)
      AND node.is_active
  ) THEN
    RAISE EXCEPTION 'PACS source node is outside active scope';
  END IF;

  v_modality_type := COALESCE(NULLIF(BTRIM(p_modality_type), ''), v_queue.modality_type);
  v_station_aetitle := COALESCE(NULLIF(BTRIM(p_station_aetitle), ''), v_queue.scheduled_station_aetitle);

  SELECT study.* INTO v_existing_study
  FROM public.pacs_studies AS study
  WHERE study.study_instance_uid = BTRIM(p_study_instance_uid)
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing_study.company_id IS DISTINCT FROM v_company
       OR v_existing_study.unit_id IS DISTINCT FROM v_unit
       OR v_existing_study.imaging_order_item_id IS DISTINCT FROM v_queue.imaging_order_item_id::TEXT
       OR v_existing_study.source_node_id IS DISTINCT FROM p_source_node_id
       OR v_existing_study.accession_number IS DISTINCT FROM v_queue.accession_number
       OR v_existing_study.study_date IS DISTINCT FROM p_study_date
       OR v_existing_study.study_time IS DISTINCT FROM NULLIF(BTRIM(p_study_time), '')
       OR v_existing_study.modality_type IS DISTINCT FROM v_modality_type
       OR v_existing_study.station_aetitle IS DISTINCT FROM v_station_aetitle THEN
      RAISE EXCEPTION 'StudyInstanceUID replay payload differs from canonical study';
    END IF;
    v_study := v_existing_study;
  ELSE

    INSERT INTO public.pacs_studies(
    company_id, unit_id, source_node_id, patient_id,
    imaging_order_item_id, study_instance_uid, accession_number,
    study_date, study_time, modality_type, station_aetitle,
    pacs_status, received_at
  ) VALUES (
    v_company, v_unit, p_source_node_id, v_queue.patient_id::TEXT,
    v_queue.imaging_order_item_id::TEXT, BTRIM(p_study_instance_uid),
    v_queue.accession_number, p_study_date, NULLIF(BTRIM(p_study_time), ''),
    v_modality_type,
    v_station_aetitle,
    'received', NOW()
  )
    ON CONFLICT (study_instance_uid) DO NOTHING
    RETURNING * INTO v_study;
  END IF;

  IF v_study.id IS NULL THEN
    RAISE EXCEPTION 'StudyInstanceUID already belongs to another scope or worklist item';
  END IF;

  UPDATE public.imaging_order_items
  SET study_instance_uid = v_study.study_instance_uid,
      status = 'recebido_pacs',
      updated_at = NOW()
  WHERE id = v_queue.imaging_order_item_id
    AND company_id = v_company
    AND unit_id = v_unit
    AND status IN ('liberado_worklist', 'em_aquisicao', 'enviado_pacs', 'recebido_pacs');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Imaging item is not eligible for PACS ingestion';
  END IF;

  UPDATE public.dicom_worklist_queue
  SET status = 'acquired', updated_at = NOW()
  WHERE id = v_queue.id
    AND company_id = v_company
    AND unit_id = v_unit;

  SELECT report.id INTO v_report_id
  FROM public.reports AS report
  WHERE report.company_id = v_company
    AND report.unit_id = v_unit
    AND report.study_instance_uid = v_study.study_instance_uid
    AND report.pacs_study_id = v_study.id
    AND report.deleted_at IS NULL;
  IF v_report_id IS NULL THEN
    RAISE EXCEPTION 'Canonical report was not created for PACS study';
  END IF;

  RETURN to_jsonb(v_study) || jsonb_build_object(
    'study_id', v_study.id,
    'report_id', v_report_id,
    'worklist_id', v_queue.id,
    'company_id', v_company,
    'unit_id', v_unit,
    'idempotent', v_queue.status = 'acquired'
  );
END
$function$;

ALTER FUNCTION public.m24_receive_pacs_study_secure(
  TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, UUID
) OWNER TO prontomedic_worklist_rpc_owner;
REVOKE ALL ON FUNCTION public.m24_receive_pacs_study_secure(
  TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, UUID
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m24_receive_pacs_study_secure(
  TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, UUID
) TO authenticated, app_prontomedic;

CREATE FUNCTION public.m24_create_imaging_order_secure(p_appointment_id BIGINT,p_clinical_indication TEXT,p_priority TEXT,p_items JSONB,p_idempotency_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $f$
DECLARE c UUID:=public.active_company_id(); u INTEGER:=public.active_unit_id(); a public.appointments%ROWTYPE; o public.imaging_orders%ROWTYPE; x JSONB; n INTEGER:=0; k TEXT; physician_name TEXT;
BEGIN
 IF auth.uid() IS NULL OR public.request_aal()<>'aal2' THEN RAISE EXCEPTION 'AAL2 required to create imaging order'; END IF;
 IF c IS NULL OR u IS NULL OR NOT public.org_can_access_unit(c,u) OR NOT public.can_access('dicom','create') THEN RAISE EXCEPTION 'Imaging order creation denied'; END IF;
 IF p_appointment_id IS NULL OR NULLIF(BTRIM(p_idempotency_key),'') IS NULL THEN RAISE EXCEPTION 'Appointment and idempotency key are required'; END IF;
 IF jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0 OR jsonb_array_length(p_items)>50 THEN RAISE EXCEPTION 'Imaging order requires between 1 and 50 items'; END IF;
 IF COALESCE(NULLIF(lower(BTRIM(p_priority)),''),'normal') NOT IN ('normal','urgent','emergency') THEN RAISE EXCEPTION 'Invalid imaging priority'; END IF;
 k:='M24-'||upper(substr(md5(
   c::TEXT||':'||BTRIM(p_idempotency_key)||':'||
   COALESCE(BTRIM(p_clinical_indication),'')||':'||
   COALESCE(NULLIF(lower(BTRIM(p_priority)),''),'normal')||':'||p_items::TEXT
 ),1,24));
 SELECT * INTO a FROM public.appointments WHERE id=p_appointment_id AND company_id=c AND unit_id=u FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Appointment not found in active scope'; END IF;
 IF a.status NOT IN ('scheduled','confirmed','in_progress') THEN RAISE EXCEPTION 'Appointment is not eligible for an imaging order'; END IF;
 IF a.scheduled_at IS NULL THEN RAISE EXCEPTION 'Appointment has no canonical scheduled_at'; END IF;
 SELECT professional.full_name INTO physician_name
 FROM public.professionals AS professional
 WHERE professional.id=a.professional_id AND professional.company_id=c;
 IF physician_name IS NULL THEN RAISE EXCEPTION 'Requesting physician not found in active scope'; END IF;
 SELECT * INTO o FROM public.imaging_orders WHERE company_id=c AND appointment_id=p_appointment_id FOR UPDATE;
 IF FOUND THEN
  IF o.accession_number IS DISTINCT FROM k THEN RAISE EXCEPTION 'Appointment already has a different imaging order'; END IF;
  RETURN jsonb_build_object('order_id',o.id,'appointment_id',p_appointment_id,'idempotent',TRUE);
 END IF;
 INSERT INTO public.imaging_orders(company_id,unit_id,patient_id,appointment_id,requesting_physician_id,referring_physician_name,clinical_indication,priority,accession_number,status,notes,created_by)
 VALUES(c,u,a.patient_id,a.id,a.professional_id,physician_name,NULLIF(BTRIM(p_clinical_indication),''),COALESCE(NULLIF(lower(BTRIM(p_priority)),''),'normal'),k,'agendado',NULL,auth.uid()) RETURNING * INTO o;
 FOR x IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  IF NULLIF(BTRIM(x->>'exam_name'),'') IS NULL OR NULLIF(BTRIM(x->>'modality_type'),'') IS NULL OR NULLIF(BTRIM(x->>'station_aetitle'),'') IS NULL THEN RAISE EXCEPTION 'Each imaging item requires exam_name, modality_type and station_aetitle'; END IF;
  INSERT INTO public.imaging_order_items(
    company_id,unit_id,imaging_order_id,exam_name,modality_type,
    body_part,laterality,contrast_required,requested_procedure_id,
    scheduled_procedure_step_id,station_aetitle,scheduled_date,
    scheduled_time,scheduled_datetime,status
  ) VALUES(
    c,u,o.id,BTRIM(x->>'exam_name'),upper(BTRIM(x->>'modality_type')),
    NULLIF(BTRIM(x->>'body_part'),''),NULLIF(BTRIM(x->>'laterality'),''),
    COALESCE((x->>'contrast_required')::BOOLEAN,FALSE),
    COALESCE(NULLIF(BTRIM(x->>'requested_procedure_id'),''),o.accession_number||'-RP-'||LPAD((n+1)::TEXT,2,'0')),
    COALESCE(NULLIF(BTRIM(x->>'scheduled_procedure_step_id'),''),o.accession_number||'-SPS-'||LPAD((n+1)::TEXT,2,'0')),
    NULLIF(BTRIM(x->>'station_aetitle'),''),a.appointment_date,a.start_time,
    a.scheduled_at,'agendado'
  ); n:=n+1;
 END LOOP;
 RETURN jsonb_build_object('order_id',o.id,'appointment_id',a.id,'item_count',n,'idempotent',FALSE);
END $f$;
ALTER FUNCTION public.m24_create_imaging_order_secure(BIGINT,TEXT,TEXT,JSONB,TEXT) OWNER TO prontomedic_worklist_rpc_owner;
REVOKE ALL ON FUNCTION public.m24_create_imaging_order_secure(BIGINT,TEXT,TEXT,JSONB,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.m24_create_imaging_order_secure(BIGINT,TEXT,TEXT,JSONB,TEXT) TO authenticated,app_prontomedic;

CREATE FUNCTION public.m24_cancel_imaging_order_secure(p_order_id UUID,p_reason TEXT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $f$
DECLARE c UUID:=public.active_company_id(); u INTEGER:=public.active_unit_id(); o public.imaging_orders%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR public.request_aal()<>'aal2' THEN RAISE EXCEPTION 'AAL2 required to cancel imaging order'; END IF;
 IF NULLIF(BTRIM(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Cancellation reason is required'; END IF;
 IF c IS NULL OR u IS NULL OR NOT public.org_can_access_unit(c,u) OR NOT public.can_access('dicom','edit') THEN RAISE EXCEPTION 'Imaging order cancellation denied'; END IF;
 SELECT * INTO o FROM public.imaging_orders WHERE id=p_order_id AND company_id=c AND unit_id=u;
 IF NOT FOUND THEN RAISE EXCEPTION 'Imaging order not found in active scope'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(c::TEXT||':'||o.accession_number,0));
 SELECT * INTO o FROM public.imaging_orders WHERE id=p_order_id AND company_id=c AND unit_id=u FOR UPDATE;
 IF o.status='cancelado' THEN RETURN jsonb_build_object('order_id',o.id,'status','cancelado','idempotent',TRUE); END IF;
 IF EXISTS(SELECT 1 FROM public.imaging_order_items i LEFT JOIN public.dicom_worklist_queue q ON q.imaging_order_item_id=i.id LEFT JOIN public.pacs_studies s ON s.imaging_order_item_id=i.id::TEXT WHERE i.imaging_order_id=o.id AND (i.status IN ('em_aquisicao','enviado_pacs','recebido_pacs') OR q.status='acquired' OR s.id IS NOT NULL)) THEN RAISE EXCEPTION 'Imaging order can no longer be cancelled after acquisition/PACS'; END IF;
 IF o.status NOT IN('agendado','liberado_worklist') OR EXISTS(SELECT 1 FROM public.imaging_order_items i WHERE i.imaging_order_id=o.id AND i.status NOT IN('agendado','liberado_worklist')) THEN RAISE EXCEPTION 'Imaging order is not in a reversible state'; END IF;
 UPDATE public.dicom_worklist_queue SET status='cancelled',last_error='Cancelled: '||BTRIM(p_reason),updated_at=NOW() WHERE imaging_order_item_id IN(SELECT id FROM public.imaging_order_items WHERE imaging_order_id=o.id) AND status IN('pending','exported');
 UPDATE public.imaging_order_items SET status='cancelado',updated_at=NOW() WHERE imaging_order_id=o.id AND status IN('agendado','liberado_worklist');
 UPDATE public.imaging_orders SET status='cancelado',notes=concat_ws(E'\n',notes,'cancelled:'||BTRIM(p_reason)),updated_at=NOW() WHERE id=o.id;
 RETURN jsonb_build_object('order_id',o.id,'status','cancelado','idempotent',FALSE);
END $f$;
ALTER FUNCTION public.m24_cancel_imaging_order_secure(UUID,TEXT) OWNER TO prontomedic_worklist_rpc_owner;
REVOKE ALL ON FUNCTION public.m24_cancel_imaging_order_secure(UUID,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.m24_cancel_imaging_order_secure(UUID,TEXT) TO authenticated,app_prontomedic;

COMMIT;
