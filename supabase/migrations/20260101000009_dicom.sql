-- =============================================================================
-- Migration: 20260101000009_dicom
-- Descrição: Módulo PACS/DICOM espelhado do SIGH (Sistema Integrado de Gestão Hospitalar)
--            - 5 equipamentos (SIGH.dicom_equipamentos)
--            - 28 worklist (SIGH.dicom_worklist)
--            - 39 exames (SIGH.dicom_exames)
--            - 28 fotos por exame (SIGH.dicom_exames_fotos)
--            - 7.733 laudos
--            - 139 templates de laudo (SIGH.laudospadroes)
--
-- Integra com Orthanc/Conquest/AWS HealthImaging via DICOMweb (WADO-RS/QIDO-RS)
-- ou via REST API direta do Orthanc (VITE_ORTHANC_URL).
-- =============================================================================

-- ============================================================================
-- 1.1. dicom_equipment — equipamentos DICOM (CT, MR, US, CR, XA, etc)
--     Espelha SIGH.dicom_equipamentos (5 registros)
--     AE Title = Application Entity Title = identificador único do modality
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.dicom_equipment (
  id SERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  ds_equipment VARCHAR(100) NOT NULL,
  ds_aetitle VARCHAR(20) NOT NULL,
  ds_type VARCHAR(10) NOT NULL CHECK (ds_type IN ('US', 'CT', 'MR', 'CR', 'XA', 'PT', 'NM', 'MG', 'DX', 'ECG')),
  ds_ip VARCHAR(45),
  ds_port INTEGER DEFAULT 104,
  ds_location VARCHAR(100),
  lg_worklist BOOLEAN DEFAULT FALSE,
  lg_verify_photo BOOLEAN DEFAULT FALSE,
  ds_format_name VARCHAR(50) DEFAULT 'LAST^FIRST^MIDDLE^PREFIX',
  ds_manufacturer VARCHAR(100),
  ds_model VARCHAR(100),
  ds_software_version VARCHAR(50),
  lg_active BOOLEAN NOT NULL DEFAULT TRUE,
  ds_observacao TEXT,
  cd_origem_sigh INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uniq_equipment_company_aetitle UNIQUE (company_id, ds_aetitle)
);

CREATE INDEX idx_dicom_equipment_company ON public.dicom_equipment(company_id);
CREATE INDEX idx_dicom_equipment_type ON public.dicom_equipment(company_id, ds_type);
CREATE INDEX idx_dicom_equipment_active ON public.dicom_equipment(company_id, lg_active);
CREATE INDEX idx_dicom_equipment_worklist ON public.dicom_equipment(company_id, lg_worklist) WHERE lg_worklist = TRUE;

COMMENT ON TABLE public.dicom_equipment IS 'Equipamentos DICOM (SIGH.dicom_equipamentos): US, CT, MR, CR, XA, PT, NM, MG';
COMMENT ON COLUMN public.dicom_equipment.ds_aetitle IS 'Application Entity Title DICOM (1-16 chars). Identificador unico da estacao';
COMMENT ON COLUMN public.dicom_equipment.ds_format_name IS 'DICOM standard PS3.15 Annex E: ordem dos componentes do nome do paciente';
COMMENT ON COLUMN public.dicom_equipment.cd_origem_sigh IS 'SIGH.dicom_equipamentos.CD_EQUIPAMENTO';

CREATE TRIGGER trg_dicom_equipment_updated_at
  BEFORE UPDATE ON public.dicom_equipment
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 1.2. dicom_worklist — tags de worklist (DICOM Modality Worklist - MWL)
--     Espelha SIGH.dicom_worklist (28 registros)
--     Cada equipamento pode ter N tags MWL (SpecificCharacterSet, PatientID, etc)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.dicom_worklist (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_equipment INTEGER NOT NULL REFERENCES public.dicom_equipment(id) ON DELETE CASCADE,
  ds_id_equipment VARCHAR(50),
  ds_type VARCHAR(50),
  ds_value TEXT,
  ds_tag VARCHAR(20),
  ds_description VARCHAR(100),
  lg_active BOOLEAN DEFAULT TRUE,
  cd_origem_sigh INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dicom_worklist_equipment ON public.dicom_worklist(cd_equipment);
CREATE INDEX idx_dicom_worklist_company ON public.dicom_worklist(company_id);
CREATE INDEX idx_dicom_worklist_type ON public.dicom_worklist(cd_equipment, ds_type);

COMMENT ON TABLE public.dicom_worklist IS 'Tags DICOM Modality Worklist por equipamento (SIGH.dicom_worklist)';
COMMENT ON COLUMN public.dicom_worklist.ds_tag IS 'Tag DICOM no formato GGHH,EEEE (ex: 0010,0020 = PatientID)';

-- ============================================================================
-- 1.3. dicom_exams — exames DICOM recebidos dos modalities
--     Espelha SIGH.dicom_exames (39 registros no SIGH atual, 7.733 laudos)
--     StudyInstanceUID é o identificador universal do estudo DICOM
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.dicom_exams (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_dicom_exame VARCHAR(100) UNIQUE,
  ds_id_patient VARCHAR(100),
  cd_laudo BIGINT,
  cd_appointment BIGINT,
  cd_patient BIGINT REFERENCES public.patients(id) ON DELETE SET NULL,
  cd_equipment INTEGER REFERENCES public.dicom_equipment(id) ON DELETE SET NULL,
  ds_patient_name VARCHAR(200),
  dt_exame TIMESTAMPTZ,
  dt_nascimento DATE,
  ds_sexo CHAR(1) CHECK (ds_sexo IS NULL OR ds_sexo IN ('M', 'F', 'O')),
  ds_modality VARCHAR(10),
  ds_ae_title VARCHAR(20),
  ds_exame VARCHAR(200),
  ds_url_dicom TEXT,
  ds_url_thumb TEXT,
  ds_url_report TEXT,
  nr_images INTEGER DEFAULT 0,
  ds_status VARCHAR(20) DEFAULT 'RECEIVED' CHECK (ds_status IN (
    'REQUESTED', 'SCHEDULED', 'IN_PROGRESS', 'RECEIVED', 'LAUDANDO', 'LAUDADO', 'ENTREGUE', 'CANCELLED'
  )),
  ds_clinical_info TEXT,
  ds_referring_physician VARCHAR(200),
  cd_origem_sigh INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dicom_exams_company ON public.dicom_exams(company_id);
CREATE INDEX idx_dicom_exams_patient ON public.dicom_exams(cd_patient);
CREATE INDEX idx_dicom_exams_laudo ON public.dicom_exams(cd_laudo);
CREATE INDEX idx_dicom_exams_appointment ON public.dicom_exams(cd_appointment);
CREATE INDEX idx_dicom_exams_dt ON public.dicom_exams(company_id, dt_exame DESC);
CREATE INDEX idx_dicom_exams_modality ON public.dicom_exams(company_id, ds_modality);
CREATE INDEX idx_dicom_exams_status ON public.dicom_exams(company_id, ds_status);

COMMENT ON TABLE public.dicom_exams IS 'Exames DICOM recebidos dos modalities (SIGH.dicom_exames + 7.733 laudos)';
COMMENT ON COLUMN public.dicom_exams.cd_dicom_exame IS 'StudyInstanceUID DICOM (1.2.826.0.1.3680043.x.y.z)';
COMMENT ON COLUMN public.dicom_exams.ds_url_dicom IS 'URL S3/MinIO/Orthanc para o arquivo .dcm completo';
COMMENT ON COLUMN public.dicom_exams.cd_origem_sigh IS 'SIGH.dicom_exames.CD_DICOM_EXAME';

CREATE TRIGGER trg_dicom_exams_updated_at
  BEFORE UPDATE ON public.dicom_exams
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 1.4. dicom_exam_images — imagens (frames/instances) do estudo DICOM
--     Espelha SIGH.dicom_exames_fotos (28 registros)
--     Cada estudo tem N instancias/series (CT pode ter 500+ slices)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.dicom_exam_images (
  id BIGSERIAL PRIMARY KEY,
  cd_dicom_exam BIGINT NOT NULL REFERENCES public.dicom_exams(id) ON DELETE CASCADE,
  ds_filename VARCHAR(255),
  bl_thumb_url TEXT,
  bl_dicom_url TEXT,
  nr_instance INTEGER,
  nr_series INTEGER,
  ds_sop_instance_uid VARCHAR(100),
  ds_series_description VARCHAR(200),
  dt_acquisition TIMESTAMPTZ,
  nr_rows INTEGER,
  nr_columns INTEGER,
  ds_transfer_syntax VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dicom_exam_images_exam ON public.dicom_exam_images(cd_dicom_exam);
CREATE INDEX idx_dicom_exam_images_series ON public.dicom_exam_images(cd_dicom_exam, nr_series, nr_instance);
CREATE INDEX idx_dicom_exam_images_sop ON public.dicom_exam_images(ds_sop_instance_uid);

COMMENT ON TABLE public.dicom_exam_images IS 'Imagens/instâncias do exame DICOM (SIGH.dicom_exames_fotos)';
COMMENT ON COLUMN public.dicom_exam_images.bl_dicom_url IS 'S3 key ou presigned URL para o arquivo .dcm';
COMMENT ON COLUMN public.dicom_exam_images.nr_instance IS 'Instance Number (0020,0013) - ordem dentro da serie';

-- ============================================================================
-- 1.5. report_templates — templates de laudo (RADIOLOGIA, CARDIOLOGIA, etc)
--     Espelha SIGH.laudospadroes (139 registros)
--     Suporta RTF (compatibilidade SIGH legado) + Web (HTML/Markdown moderno)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.report_templates (
  id SERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cd_service BIGINT REFERENCES public.services_catalog(id) ON DELETE SET NULL,
  ds_name VARCHAR(100) NOT NULL,
  ds_title VARCHAR(150),
  bl_template_web TEXT,
  bl_template_rtf TEXT,
  ds_template_short VARCHAR(50),
  ds_type VARCHAR(20) DEFAULT 'RADIOLOGIA' CHECK (ds_type IN (
    'RADIOLOGIA', 'CARDIOLOGIA', 'OFTALMOLOGIA', 'GASTRO', 'UROLOGIA',
    'GINECOLOGIA', 'ORTOPEDIA', 'NEUROLOGIA', 'PATOLOGIA', 'GENERICO'
  )),
  cd_category SMALLINT,
  lg_print_label BOOLEAN DEFAULT FALSE,
  ds_caminho TEXT,
  nm_sequence SMALLINT DEFAULT 1,
  lg_active BOOLEAN NOT NULL DEFAULT TRUE,
  ds_observacao TEXT,
  cd_origem_sigh INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_report_templates_company ON public.report_templates(company_id);
CREATE INDEX idx_report_templates_service ON public.report_templates(cd_service);
CREATE INDEX idx_report_templates_type ON public.report_templates(company_id, ds_type);
CREATE INDEX idx_report_templates_active ON public.report_templates(company_id, lg_active);
CREATE INDEX idx_report_templates_name ON public.report_templates USING gin(ds_name gin_trgm_ops);

COMMENT ON TABLE public.report_templates IS 'Templates de laudo por especialidade/servico (SIGH.laudospadroes)';
COMMENT ON COLUMN public.report_templates.bl_template_web IS 'Template HTML/Markdown moderno (com variaveis {{nome}}, {{data}})';
COMMENT ON COLUMN public.report_templates.bl_template_rtf IS 'Template RTF legado (compatibilidade com laudos exportados do SIGH)';
COMMENT ON COLUMN public.report_templates.ds_template_short IS 'Versao resumida do template (one-liner para UI)';
COMMENT ON COLUMN public.report_templates.cd_origem_sigh IS 'SIGH.laudospadroes.CD_LAUDOPADRAO';

CREATE TRIGGER trg_report_templates_updated_at
  BEFORE UPDATE ON public.report_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 1.6. RLS — Row Level Security
-- ============================================================================
ALTER TABLE public.dicom_equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dicom_worklist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dicom_exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dicom_exam_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read dicom_equipment from their company"
  ON public.dicom_equipment FOR SELECT
  TO authenticated
  USING (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

CREATE POLICY "Admins and radiology can manage dicom_equipment"
  ON public.dicom_equipment FOR ALL
  TO authenticated
  USING (
    company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role_name IN ('admin', 'radiologist', 'technician', 'reception')
    )
  )
  WITH CHECK (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

CREATE POLICY "Users can read dicom_worklist from their company"
  ON public.dicom_worklist FOR SELECT
  TO authenticated
  USING (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

CREATE POLICY "Admins and radiology can manage dicom_worklist"
  ON public.dicom_worklist FOR ALL
  TO authenticated
  USING (
    company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role_name IN ('admin', 'radiologist', 'technician')
    )
  )
  WITH CHECK (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

CREATE POLICY "Users can read dicom_exams from their company"
  ON public.dicom_exams FOR SELECT
  TO authenticated
  USING (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

CREATE POLICY "Admins and radiology can manage dicom_exams"
  ON public.dicom_exams FOR ALL
  TO authenticated
  USING (
    company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role_name IN ('admin', 'radiologist', 'technician', 'doctor', 'reception')
    )
  )
  WITH CHECK (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

CREATE POLICY "Users can read dicom_exam_images from their company"
  ON public.dicom_exam_images FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.dicom_exams e
      WHERE e.id = dicom_exam_images.cd_dicom_exam
        AND e.company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
    )
  );

CREATE POLICY "Radiology can manage dicom_exam_images"
  ON public.dicom_exam_images FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.dicom_exams e
      WHERE e.id = dicom_exam_images.cd_dicom_exam
        AND e.company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
        AND EXISTS (
          SELECT 1 FROM public.user_profiles
          WHERE id = auth.uid() AND role_name IN ('admin', 'radiologist', 'technician')
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.dicom_exams e
      WHERE e.id = dicom_exam_images.cd_dicom_exam
        AND e.company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
    )
  );

CREATE POLICY "Users can read report_templates from their company"
  ON public.report_templates FOR SELECT
  TO authenticated
  USING (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

CREATE POLICY "Radiology can manage report_templates"
  ON public.report_templates FOR ALL
  TO authenticated
  USING (
    company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role_name IN ('admin', 'radiologist', 'doctor')
    )
  )
  WITH CHECK (company_id = (SELECT company_id FROM public.user_profiles WHERE id = auth.uid()));

-- ============================================================================
-- 1.7. Funcao: buscar laudo de um agendamento
--     Usado pela API de agendamento para carregar contexto do exame
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_dicom_exam_by_appointment(p_appointment_id BIGINT)
RETURNS TABLE (
  exam_id BIGINT,
  study_uid VARCHAR,
  patient_name VARCHAR,
  modality VARCHAR,
  nr_images INTEGER,
  ds_url_dicom TEXT,
  ds_url_thumb TEXT,
  ds_status VARCHAR
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id,
    e.cd_dicom_exame,
    e.ds_patient_name,
    e.ds_modality,
    e.nr_images,
    e.ds_url_dicom,
    e.ds_url_thumb,
    e.ds_status
  FROM public.dicom_exams e
  WHERE e.cd_appointment = p_appointment_id
  ORDER BY e.created_at DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION public.get_dicom_exam_by_appointment(BIGINT) IS 'Retorna o exame DICOM vinculado a um agendamento';

-- ============================================================================
-- 1.8. Funcao: publicar laudo para o paciente (SIGH.LG_LIBERAR_APP_SITE)
--     LGPD: exige consentimento do canal APP/PUSH (cd_canal = 4) ativo
--     Registra em audit_log (LGPD art. 37 - registro de operacao)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.publish_dicom_report(
  p_exam_id BIGINT,
  p_publish_to_app BOOLEAN DEFAULT FALSE,
  p_signed_by UUID DEFAULT auth.uid()
)
RETURNS JSONB AS $$
DECLARE
  v_exam RECORD;
  v_company_id UUID;
  v_consent_ok BOOLEAN;
  v_result JSONB;
BEGIN
  -- Lock pessimista para evitar publicacao dupla
  SELECT e.* INTO v_exam
  FROM public.dicom_exams e
  WHERE e.id = p_exam_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exame DICOM % nao encontrado', p_exam_id;
  END IF;

  v_company_id := v_exam.company_id;

  -- Validar status: somente laudos LAUDADO podem ser publicados
  IF v_exam.ds_status <> 'LAUDADO' AND p_publish_to_app THEN
    RAISE EXCEPTION 'Exame % nao esta LAUDADO (status=%)', p_exam_id, v_exam.ds_status;
  END IF;

  -- Validar consentimento LGPD se for publicar no app
  IF p_publish_to_app AND v_exam.cd_patient IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.paciente_consentimentos
      WHERE cd_paciente = v_exam.cd_patient
        AND cd_canal = 4 -- PUSH
        AND lg_optin = TRUE
        AND dt_revocacao IS NULL
    ) INTO v_consent_ok;

    IF NOT v_consent_ok THEN
      RAISE EXCEPTION 'Paciente sem consentimento LGPD para canal PUSH (cd_canal=4). Publicacao bloqueada.';
    END IF;
  END IF;

  -- Atualizar status
  UPDATE public.dicom_exams
  SET
    ds_status = CASE WHEN p_publish_to_app THEN 'ENTREGUE' ELSE ds_status END,
    updated_at = NOW()
  WHERE id = p_exam_id;

  -- Audit log LGPD
  INSERT INTO public.audit_logs (
    company_id, user_id, action, resource_type, resource_id, metadata, created_at
  ) VALUES (
    v_company_id, p_signed_by, 'PUBLISH_DICOM_REPORT', 'dicom_exams', p_exam_id,
    jsonb_build_object(
      'publish_to_app', p_publish_to_app,
      'patient_id', v_exam.cd_patient,
      'study_uid', v_exam.cd_dicom_exame
    ),
    NOW()
  );

  v_result := jsonb_build_object(
    'exam_id', p_exam_id,
    'status', CASE WHEN p_publish_to_app THEN 'ENTREGUE' ELSE v_exam.ds_status END,
    'published_to_app', p_publish_to_app,
    'published_at', NOW()
  );

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.publish_dicom_report(BIGINT, BOOLEAN, UUID) IS 'Publica laudo no app do paciente (SIGH.LG_LIBERAR_APP_SITE). Valida LGPD.';

-- ============================================================================
-- View: exames pendentes de laudo (fila de trabalho do radiologista)
-- ============================================================================
CREATE OR REPLACE VIEW public.vw_dicom_pending_reports AS
SELECT
  e.id,
  e.company_id,
  e.cd_dicom_exame,
  e.cd_patient,
  e.ds_patient_name,
  e.ds_exame,
  e.ds_modality,
  e.dt_exame,
  e.ds_clinical_info,
  e.ds_referring_physician,
  e.nr_images,
  e.ds_status,
  eq.ds_equipment,
  eq.ds_aetitle,
  eq.ds_type,
  COUNT(i.id) AS nr_images_received
FROM public.dicom_exams e
LEFT JOIN public.dicom_equipment eq ON eq.id = e.cd_equipment
LEFT JOIN public.dicom_exam_images i ON i.cd_dicom_exam = e.id
WHERE e.ds_status IN ('RECEIVED', 'LAUDANDO')
GROUP BY e.id, eq.ds_equipment, eq.ds_aetitle, eq.ds_type;

COMMENT ON VIEW public.vw_dicom_pending_reports IS 'Fila de laudos pendentes com info do equipamento';
