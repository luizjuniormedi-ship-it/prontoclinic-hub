BEGIN;
DROP FUNCTION IF EXISTS public.m24_cancel_imaging_order_secure(UUID,TEXT);
DROP FUNCTION IF EXISTS public.m24_create_imaging_order_secure(BIGINT,TEXT,TEXT,JSONB,TEXT);

DROP FUNCTION IF EXISTS public.m24_receive_pacs_study_secure(
  TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, UUID
);

DROP POLICY IF EXISTS m24_report_delivery_rpc_insert ON public.report_delivery_logs;
DROP POLICY IF EXISTS m24_reports_rpc_access ON public.reports;
DROP POLICY IF EXISTS m24_imaging_items_rpc_update ON public.imaging_order_items;
DROP POLICY IF EXISTS m24_imaging_items_rpc_insert ON public.imaging_order_items;
DROP POLICY IF EXISTS m24_imaging_orders_rpc_insert ON public.imaging_orders;
DROP POLICY IF EXISTS m24_professionals_rpc_select ON public.professionals;
DROP POLICY IF EXISTS m24_units_rpc_select ON public.units;
DROP POLICY IF EXISTS m24_imaging_items_rpc_access ON public.imaging_order_items;
DROP POLICY IF EXISTS m24_pacs_studies_rpc_access ON public.pacs_studies;
DROP POLICY IF EXISTS m24_dicom_nodes_rpc_select ON public.dicom_nodes;
DROP POLICY IF EXISTS m24_worklist_rpc_select_update ON public.dicom_worklist_queue;
DROP POLICY IF EXISTS m24_dicom_exams_rpc_select ON public.dicom_exams;

REVOKE SELECT ON public.dicom_exams, public.pacs_studies,
  public.reports, public.dicom_nodes FROM prontomedic_worklist_rpc_owner;
REVOKE UPDATE ON public.reports FROM prontomedic_worklist_rpc_owner;
REVOKE INSERT, UPDATE ON public.pacs_studies FROM prontomedic_worklist_rpc_owner;
REVOKE INSERT ON public.reports, public.report_delivery_logs
  FROM prontomedic_worklist_rpc_owner;
REVOKE INSERT ON public.imaging_orders, public.imaging_order_items FROM prontomedic_worklist_rpc_owner;
REVOKE SELECT ON public.units, public.professionals FROM prontomedic_worklist_rpc_owner;
REVOKE EXECUTE ON FUNCTION auth.uid() FROM prontomedic_worklist_rpc_owner;
REVOKE USAGE ON SCHEMA auth FROM prontomedic_worklist_rpc_owner;

-- Restore the pre-M24 trigger definition exactly, including the legacy text
-- comparison. This rollback is intentionally faithful and must only be used as
-- an emergency reversal while the M24 package is being validated.
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

DROP FUNCTION IF EXISTS public.get_dicom_exam_by_appointment(BIGINT);
CREATE FUNCTION public.get_dicom_exam_by_appointment(p_appointment_id BIGINT)
RETURNS TABLE (
  exam_id BIGINT, study_uid VARCHAR, patient_name VARCHAR, modality VARCHAR,
  nr_images INTEGER, ds_url_dicom TEXT, ds_url_thumb TEXT, ds_status VARCHAR
) AS $$
BEGIN
  RETURN QUERY
  SELECT e.id, e.cd_dicom_exame, e.ds_patient_name, e.ds_modality,
    e.nr_images, e.ds_url_dicom, e.ds_url_thumb, e.ds_status
  FROM public.dicom_exams e
  WHERE e.cd_appointment = p_appointment_id
  ORDER BY e.created_at DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
ALTER FUNCTION public.get_dicom_exam_by_appointment(BIGINT) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.get_dicom_exam_by_appointment(BIGINT) TO PUBLIC;

DROP FUNCTION IF EXISTS public.publish_dicom_report(BIGINT, BOOLEAN, UUID);
DROP FUNCTION IF EXISTS public.publish_dicom_report(BIGINT, BOOLEAN);
CREATE FUNCTION public.publish_dicom_report(
  p_exam_id BIGINT,
  p_publish_to_app BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_exam RECORD;
  v_company_id UUID;
BEGIN
  SELECT * INTO v_exam FROM public.dicom_exams WHERE id = p_exam_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Exame % não encontrado', p_exam_id; END IF;
  v_company_id := public.get_my_company_id();
  IF v_exam.company_id IS DISTINCT FROM v_company_id THEN
    RAISE EXCEPTION 'Acesso negado: exame de outra empresa';
  END IF;
  UPDATE public.dicom_exams
  SET lg_publicar = p_publish_to_app,
      dt_publicado = CASE WHEN p_publish_to_app THEN NOW() ELSE NULL END
  WHERE id = p_exam_id;
  INSERT INTO public.audit_logs (
    company_id, cd_usuario, acao, tabela, registro_id,
    operacao, dados_novos, dt_evento
  ) VALUES (
    v_company_id, auth.uid(), 'UPDATE', 'dicom_exams', p_exam_id::TEXT,
    'dicom_exams UPDATE por ' || COALESCE(auth.uid()::TEXT, 'system'),
    jsonb_build_object('lg_publicar', p_publish_to_app, 'dt_publicado', NOW()),
    NOW()
  );
  RETURN jsonb_build_object('success', TRUE, 'exam_id', p_exam_id, 'published', p_publish_to_app);
END;
$$;
ALTER FUNCTION public.publish_dicom_report(BIGINT, BOOLEAN) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.publish_dicom_report(BIGINT, BOOLEAN)
  TO PUBLIC, authenticated;

CREATE FUNCTION public.publish_dicom_report(
  p_exam_id BIGINT,
  p_publish_to_app BOOLEAN DEFAULT FALSE,
  p_signed_by UUID DEFAULT auth.uid()
)
RETURNS JSONB AS $$
DECLARE
  v_exam RECORD;
  v_company_id UUID;
  v_consent_ok BOOLEAN;
BEGIN
  SELECT e.* INTO v_exam FROM public.dicom_exams e WHERE e.id = p_exam_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Exame DICOM % nao encontrado', p_exam_id; END IF;
  v_company_id := v_exam.company_id;
  IF v_exam.ds_status <> 'LAUDADO' AND p_publish_to_app THEN
    RAISE EXCEPTION 'Exame % nao esta LAUDADO (status=%)', p_exam_id, v_exam.ds_status;
  END IF;
  IF p_publish_to_app AND v_exam.cd_patient IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.paciente_consentimentos
      WHERE cd_paciente = v_exam.cd_patient AND cd_canal = 4
        AND lg_optin = TRUE AND dt_revocacao IS NULL
    ) INTO v_consent_ok;
    IF NOT v_consent_ok THEN
      RAISE EXCEPTION 'Paciente sem consentimento LGPD para canal PUSH (cd_canal=4). Publicacao bloqueada.';
    END IF;
  END IF;
  UPDATE public.dicom_exams
  SET ds_status = CASE WHEN p_publish_to_app THEN 'ENTREGUE' ELSE ds_status END,
      updated_at = NOW()
  WHERE id = p_exam_id;
  RETURN jsonb_build_object(
    'exam_id', p_exam_id,
    'status', CASE WHEN p_publish_to_app THEN 'ENTREGUE' ELSE v_exam.ds_status END,
    'published_to_app', p_publish_to_app,
    'published_at', NOW()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
ALTER FUNCTION public.publish_dicom_report(BIGINT, BOOLEAN, UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.publish_dicom_report(BIGINT, BOOLEAN, UUID) TO PUBLIC;

COMMIT;
