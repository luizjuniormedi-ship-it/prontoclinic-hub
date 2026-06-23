/**
 * dicomService — Módulo PACS/DICOM (ProntoClinic Hub)
 *
 * Espelha o modelo SIGH (Sistema Integrado de Gestão Hospitalar):
 *   - dicom_equipamentos (5) → public.dicom_equipment
 *   - dicom_worklist (28)    → public.dicom_worklist
 *   - dicom_exames (39)      → public.dicom_exams
 *   - dicom_exames_fotos (28)→ public.dicom_exam_images
 *   - laudospadroes (139)    → public.report_templates
 *   - 7.733 laudos           → tabela medical_records (legado)
 *
 * Integra com:
 *   - Orthanc PACS (VITE_ORTHANC_URL, default http://localhost:8042)
 *   - Conquest DICOM
 *   - AWS HealthImaging
 *
 * Migration relacionada: 20260101000009_dicom.sql
 */

import { supabase } from "@/lib/supabase";

// ── Types ──────────────────────────────────────────────────────────

export type DicomModality = "US" | "CT" | "MR" | "CR" | "XA" | "PT" | "NM" | "MG" | "DX" | "ECG";

export type DicomExamStatus =
  | "REQUESTED"
  | "SCHEDULED"
  | "IN_PROGRESS"
  | "RECEIVED"
  | "LAUDANDO"
  | "LAUDADO"
  | "ENTREGUE"
  | "CANCELLED";

export type ReportTemplateType =
  | "RADIOLOGIA"
  | "CARDIOLOGIA"
  | "OFTALMOLOGIA"
  | "GASTRO"
  | "UROLOGIA"
  | "GINECOLOGIA"
  | "ORTOPEDIA"
  | "NEUROLOGIA"
  | "PATOLOGIA"
  | "GENERICO";

export interface DicomEquipment {
  id: number;
  company_id: string;
  ds_equipment: string;
  ds_aetitle: string;
  ds_type: DicomModality;
  ds_ip?: string;
  ds_port: number;
  ds_location?: string;
  lg_worklist: boolean;
  lg_verify_photo: boolean;
  ds_format_name: string;
  ds_manufacturer?: string;
  ds_model?: string;
  ds_software_version?: string;
  lg_active: boolean;
  ds_observacao?: string;
  cd_origem_sigh?: number;
  created_at: string;
  updated_at: string;
}

export interface DicomWorklistItem {
  id: number;
  company_id: string;
  cd_equipment: number;
  ds_id_equipment?: string;
  ds_type?: string;
  ds_value?: string;
  ds_tag?: string;
  ds_description?: string;
  lg_active: boolean;
  cd_origem_sigh?: number;
  created_at: string;
}

export interface DicomExam {
  id: number;
  company_id: string;
  cd_dicom_exame?: string; // StudyInstanceUID
  ds_id_patient?: string;
  cd_laudo?: number;
  cd_appointment?: number;
  cd_patient?: number;
  cd_equipment?: number;
  ds_patient_name?: string;
  dt_exame?: string;
  dt_nascimento?: string;
  ds_sexo?: "M" | "F" | "O";
  ds_modality?: DicomModality;
  ds_ae_title?: string;
  ds_exame?: string;
  ds_url_dicom?: string;
  ds_url_thumb?: string;
  ds_url_report?: string;
  nr_images: number;
  ds_status: DicomExamStatus;
  ds_clinical_info?: string;
  ds_referring_physician?: string;
  cd_origem_sigh?: number;
  created_at: string;
  updated_at: string;
}

export interface DicomExamImage {
  id: number;
  cd_dicom_exam: number;
  ds_filename?: string;
  bl_thumb_url?: string;
  bl_dicom_url?: string;
  nr_instance?: number;
  nr_series?: number;
  ds_sop_instance_uid?: string;
  ds_series_description?: string;
  dt_acquisition?: string;
  nr_rows?: number;
  nr_columns?: number;
  ds_transfer_syntax?: string;
  created_at: string;
}

export interface ReportTemplate {
  id: number;
  company_id: string;
  cd_service?: number;
  ds_name: string;
  ds_title?: string;
  bl_template_web?: string;
  bl_template_rtf?: string;
  ds_template_short?: string;
  ds_type: ReportTemplateType;
  cd_category?: number;
  lg_print_label: boolean;
  ds_caminho?: string;
  nm_sequence: number;
  lg_active: boolean;
  ds_observacao?: string;
  cd_origem_sigh?: number;
  created_at: string;
  updated_at: string;
}

// ── Helpers ────────────────────────────────────────────────────────

const ORTHANC_URL = (import.meta.env.VITE_ORTHANC_URL as string) || "http://localhost:8042";
const ORTHANC_USER = (import.meta.env.VITE_ORTHANC_USER as string) || "orthanc";
const ORTHANC_PASS = (import.meta.env.VITE_ORTHANC_PASS as string) || "orthanc";

/** Build Basic Auth header for Orthanc REST API */
function orthancAuth(): string {
  return "Basic " + btoa(`${ORTHANC_USER}:${ORTHANC_PASS}`);
}

function formatDicomDate(iso?: string): string {
  if (!iso) return "";
  return iso.replace(/-/g, "").substring(0, 8);
}

function formatDicomTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}${m}${s}`;
}

function formatDicomName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return name.toUpperCase();
  const last = parts[parts.length - 1].toUpperCase();
  const first = parts.slice(0, -1).join(" ").toUpperCase();
  return `${last}^${first}`;
}

function generateUID(): string {
  const root = "1.2.826.0.1.3680043.8.1055";
  return `${root}.${Date.now()}.${Math.floor(Math.random() * 99999)}`;
}

// ── Equipment Service ─────────────────────────────────────────────

export const equipmentService = {
  async getEquipment(companyId: string): Promise<DicomEquipment[]> {
    const { data, error } = await supabase
      .from("dicom_equipment")
      .select("*")
      .eq("company_id", companyId)
      .order("ds_equipment");
    if (error) throw error;
    return (data || []) as DicomEquipment[];
  },

  async getById(id: number): Promise<DicomEquipment> {
    const { data, error } = await supabase
      .from("dicom_equipment")
      .select("*")
      .eq("id", id)
      .single();
    if (error) throw error;
    return data as DicomEquipment;
  },

  async createEquipment(
    companyId: string,
    data: Partial<DicomEquipment>
  ): Promise<DicomEquipment> {
    const payload = {
      company_id: companyId,
      ds_equipment: data.ds_equipment || "Novo Equipamento",
      ds_aetitle: data.ds_aetitle || `EQ_${Date.now().toString(36).toUpperCase()}`,
      ds_type: data.ds_type || ("US" as DicomModality),
      ds_ip: data.ds_ip,
      ds_port: data.ds_port || 104,
      ds_location: data.ds_location,
      lg_worklist: data.lg_worklist || false,
      lg_verify_photo: data.lg_verify_photo || false,
      ds_format_name: data.ds_format_name || "LAST^FIRST^MIDDLE^PREFIX",
      ds_manufacturer: data.ds_manufacturer,
      ds_model: data.ds_model,
      ds_software_version: data.ds_software_version,
      lg_active: data.lg_active ?? true,
      ds_observacao: data.ds_observacao,
    };
    const { data: row, error } = await supabase
      .from("dicom_equipment")
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    return row as DicomEquipment;
  },

  async updateEquipment(id: number, updates: Partial<DicomEquipment>): Promise<DicomEquipment> {
    const { data, error } = await supabase
      .from("dicom_equipment")
      .update(updates)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data as DicomEquipment;
  },

  async deleteEquipment(id: number): Promise<void> {
    const { error } = await supabase.from("dicom_equipment").delete().eq("id", id);
    if (error) throw error;
  },

  /** Testa conexão (echo) com o modality via Orthanc REST /modalities/{aet}/echo */
  async testConnection(id: number): Promise<{ ok: boolean; latencyMs: number; message: string }> {
    const eq = await this.getById(id);
    if (!eq.ds_aetitle || !eq.ds_ip) {
      return { ok: false, latencyMs: 0, message: "AE Title ou IP nao configurados" };
    }
    const t0 = performance.now();
    try {
      const res = await fetch(`${ORTHANC_URL}/modalities/${eq.ds_aetitle}/echo`, {
        method: "POST",
        headers: { Authorization: orthancAuth() },
        signal: AbortSignal.timeout(5000),
      });
      const t1 = performance.now();
      if (!res.ok) {
        return {
          ok: false,
          latencyMs: Math.round(t1 - t0),
          message: `Orthanc respondeu ${res.status}: ${res.statusText}`,
        };
      }
      return {
        ok: true,
        latencyMs: Math.round(t1 - t0),
        message: `Echo OK em ${Math.round(t1 - t0)}ms`,
      };
    } catch (e) {
      const t1 = performance.now();
      return {
        ok: false,
        latencyMs: Math.round(t1 - t0),
        message: e instanceof Error ? e.message : "Falha na conexao",
      };
    }
  },
};

// ── Worklist Service ───────────────────────────────────────────────

export const worklistService = {
  async getWorklist(equipmentId: number): Promise<DicomWorklistItem[]> {
    const { data, error } = await supabase
      .from("dicom_worklist")
      .select("*")
      .eq("cd_equipment", equipmentId)
      .order("ds_type");
    if (error) throw error;
    return (data || []) as DicomWorklistItem[];
  },

  async addWorklistTag(
    equipmentId: number,
    companyId: string,
    tag: { ds_id_equipment: string; ds_type: string; ds_value: string; ds_tag?: string; ds_description?: string }
  ): Promise<DicomWorklistItem> {
    const { data, error } = await supabase
      .from("dicom_worklist")
      .insert({
        cd_equipment: equipmentId,
        company_id: companyId,
        ds_id_equipment: tag.ds_id_equipment,
        ds_type: tag.ds_type,
        ds_value: tag.ds_value,
        ds_tag: tag.ds_tag,
        ds_description: tag.ds_description,
        lg_active: true,
      })
      .select()
      .single();
    if (error) throw error;
    return data as DicomWorklistItem;
  },

  async removeWorklistTag(id: number): Promise<void> {
    const { error } = await supabase.from("dicom_worklist").delete().eq("id", id);
    if (error) throw error;
  },
};

// ── Exams Service ──────────────────────────────────────────────────

export const examService = {
  async getExamsByPatient(patientId: number, limit = 50): Promise<DicomExam[]> {
    const { data, error } = await supabase
      .from("dicom_exams")
      .select("*")
      .eq("cd_patient", patientId)
      .order("dt_exame", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data || []) as DicomExam[];
  },

  async getExamByAppointment(appointmentId: number): Promise<DicomExam | null> {
    const { data, error } = await supabase
      .from("dicom_exams")
      .select("*")
      .eq("cd_appointment", appointmentId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return (data as DicomExam) || null;
  },

  async getExamById(id: number): Promise<DicomExam> {
    const { data, error } = await supabase
      .from("dicom_exams")
      .select("*, dicom_equipment(ds_equipment, ds_aetitle, ds_type)")
      .eq("id", id)
      .single();
    if (error) throw error;
    return data as DicomExam;
  },

  async getImages(examId: number): Promise<DicomExamImage[]> {
    const { data, error } = await supabase
      .from("dicom_exam_images")
      .select("*")
      .eq("cd_dicom_exam", examId)
      .order("nr_series", { ascending: true })
      .order("nr_instance", { ascending: true });
    if (error) throw error;
    return (data || []) as DicomExamImage[];
  },

  async listByCompany(
    companyId: string,
    filters?: { status?: DicomExamStatus; modality?: DicomModality; dateFrom?: string; dateTo?: string }
  ): Promise<DicomExam[]> {
    let q = supabase
      .from("dicom_exams")
      .select("*, dicom_equipment(ds_equipment, ds_aetitle, ds_type)")
      .eq("company_id", companyId)
      .order("dt_exame", { ascending: false });
    if (filters?.status) q = q.eq("ds_status", filters.status);
    if (filters?.modality) q = q.eq("ds_modality", filters.modality);
    if (filters?.dateFrom) q = q.gte("dt_exame", filters.dateFrom);
    if (filters?.dateTo) q = q.lte("dt_exame", filters.dateTo);
    const { data, error } = await q.limit(200);
    if (error) throw error;
    return (data || []) as DicomExam[];
  },

  /** Solicita envio do estudo para o PACS (Orthanc store) */
  async requestStudy(examId: number): Promise<{ orthancId: string; studyUid: string }> {
    const exam = await this.getExamById(examId);
    if (!exam.cd_dicom_exame) {
      throw new Error("Exame sem StudyInstanceUID — nao foi possivel enviar ao PACS");
    }
    // Dispara C-STORE via Orthanc REST /peers/{aet}/store
    const eq = exam.cd_equipment
      ? await equipmentService.getById(exam.cd_equipment)
      : null;
    if (!eq) {
      throw new Error("Equipamento de destino nao configurado para este exame");
    }
    const res = await fetch(
      `${ORTHANC_URL}/peers/${eq.ds_aetitle}/store`,
      {
        method: "POST",
        headers: { Authorization: orthancAuth(), "Content-Type": "application/json" },
        body: JSON.stringify({ StudyInstanceUID: exam.cd_dicom_exame }),
        signal: AbortSignal.timeout(30000),
      }
    );
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Orthanc store falhou (${res.status}): ${txt}`);
    }
    const { ID } = await res.json();
    await supabase
      .from("dicom_exams")
      .update({ ds_status: "IN_PROGRESS", updated_at: new Date().toISOString() })
      .eq("id", examId);
    return { orthancId: ID, studyUid: exam.cd_dicom_exame };
  },

  /** Upload de imagem DICOM (.dcm) via signed URL S3 (ou Supabase Storage) */
  async uploadImage(
    examId: number,
    file: File
  ): Promise<{ imageId: number; url: string; sopInstanceUid: string }> {
    const sopInstanceUid = generateUID();
    const filename = `${sopInstanceUid}.dcm`;
    const path = `dicom/${examId}/${filename}`;

    // Upload para o Supabase Storage (bucket "dicom")
    const { error: upErr } = await supabase.storage
      .from("dicom")
      .upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: "application/dicom",
      });
    if (upErr) {
      // Fallback: signed URL S3 caso nao seja Supabase Storage
      throw new Error(`Upload falhou: ${upErr.message}. Configure bucket "dicom" no Supabase Storage.`);
    }

    const { data: pub } = supabase.storage.from("dicom").getPublicUrl(path);

    // Registrar no banco
    const { data: row, error: insErr } = await supabase
      .from("dicom_exam_images")
      .insert({
        cd_dicom_exam: examId,
        ds_filename: file.name,
        bl_dicom_url: pub.publicUrl,
        bl_thumb_url: pub.publicUrl,
        ds_sop_instance_uid: sopInstanceUid,
        dt_acquisition: new Date().toISOString(),
        nr_instance: Math.floor(Math.random() * 1000),
      })
      .select()
      .single();
    if (insErr) throw insErr;

    // Incrementar nr_images
    const { data: cur } = await supabase
      .from("dicom_exams")
      .select("nr_images")
      .eq("id", examId)
      .single();
    if (cur) {
      await supabase
        .from("dicom_exams")
        .update({ nr_images: (cur.nr_images || 0) + 1, updated_at: new Date().toISOString() })
        .eq("id", examId);
    }

    return { imageId: row.id, url: pub.publicUrl, sopInstanceUid };
  },

  async updateStatus(examId: number, status: DicomExamStatus): Promise<void> {
    const { error } = await supabase
      .from("dicom_exams")
      .update({ ds_status: status, updated_at: new Date().toISOString() })
      .eq("id", examId);
    if (error) throw error;
  },
};

// ── Report Templates Service ───────────────────────────────────────

export const templateService = {
  async getReportTemplate(serviceId: number, type?: ReportTemplateType): Promise<ReportTemplate | null> {
    let q = supabase
      .from("report_templates")
      .select("*")
      .eq("cd_service", serviceId)
      .eq("lg_active", true);
    if (type) q = q.eq("ds_type", type);
    const { data, error } = await q.order("nm_sequence").limit(1).maybeSingle();
    if (error) throw error;
    return (data as ReportTemplate) || null;
  },

  async listTemplates(
    companyId: string,
    filters?: { type?: ReportTemplateType; serviceId?: number; active?: boolean }
  ): Promise<ReportTemplate[]> {
    let q = supabase
      .from("report_templates")
      .select("*")
      .eq("company_id", companyId)
      .order("ds_type")
      .order("nm_sequence");
    if (filters?.type) q = q.eq("ds_type", filters.type);
    if (filters?.serviceId) q = q.eq("cd_service", filters.serviceId);
    if (filters?.active !== undefined) q = q.eq("lg_active", filters.active);
    const { data, error } = await q;
    if (error) throw error;
    return (data || []) as ReportTemplate[];
  },

  async saveTemplate(
    companyId: string,
    data: Partial<ReportTemplate>
  ): Promise<ReportTemplate> {
    const payload = {
      company_id: companyId,
      cd_service: data.cd_service,
      ds_name: data.ds_name || "Novo Template",
      ds_title: data.ds_title,
      bl_template_web: data.bl_template_web,
      bl_template_rtf: data.bl_template_rtf,
      ds_template_short: data.ds_template_short,
      ds_type: data.ds_type || "RADIOLOGIA",
      cd_category: data.cd_category,
      lg_print_label: data.lg_print_label || false,
      ds_caminho: data.ds_caminho,
      nm_sequence: data.nm_sequence || 1,
      lg_active: data.lg_active ?? true,
      ds_observacao: data.ds_observacao,
    };
    const { data: row, error } = await supabase
      .from("report_templates")
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    return row as ReportTemplate;
  },

  async updateTemplate(id: number, updates: Partial<ReportTemplate>): Promise<ReportTemplate> {
    const { data, error } = await supabase
      .from("report_templates")
      .update(updates)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data as ReportTemplate;
  },

  /** Renderiza variaveis {{nome}}, {{data}}, {{exame}} no template web */
  renderTemplate(template: string, vars: Record<string, string | undefined>): string {
    if (!template) return "";
    return template.replace(/\{\{(\w+)\}\}/g, (_, k) => {
      const v = vars[k];
      return v === undefined || v === null ? `[${k}]` : String(v);
    });
  },
};

// ── Reports (Laudos) Service ───────────────────────────────────────

export interface DicomReport {
  id: number;
  cd_dicom_exam: number;
  cd_patient?: number;
  cd_laudo?: number;
  ds_content: string;
  ds_status: "DRAFT" | "PRELIMINARY" | "FINAL" | "AMENDED" | "CORRECTED";
  ds_signed_by?: string;
  dt_signed_at?: string;
  lg_published_app: boolean;
  dt_published?: string;
  cd_origem_sigh?: number;
  created_at: string;
  updated_at: string;
}

export const reportService = {
  async saveReport(
    examId: number,
    content: string,
    signedBy?: string
  ): Promise<DicomReport> {
    // upsert por cd_dicom_exam: se ja existe, atualiza
    const { data: existing } = await supabase
      .from("radiology_reports")
      .select("*")
      .eq("imaging_order_item_id", examId) // legado: usar order_item como proxy
      .maybeSingle();
    if (existing) {
      const { data, error } = await supabase
        .from("radiology_reports")
        .update({
          content,
          radiologist_name: signedBy,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .select()
        .single();
      if (error) throw error;
      return this.mapRow(data);
    }
    const { data, error } = await supabase
      .from("radiology_reports")
      .insert({
        imaging_order_item_id: examId,
        content,
        radiologist_name: signedBy,
        status: "draft",
      })
      .select()
      .single();
    if (error) throw error;
    return this.mapRow(data);
  },

  async getReport(examId: number): Promise<DicomReport | null> {
    const { data, error } = await supabase
      .from("radiology_reports")
      .select("*")
      .eq("imaging_order_item_id", examId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ? this.mapRow(data) : null;
  },

  /** Publica laudo no app do paciente (SIGH.LG_LIBERAR_APP_SITE) via RPC */
  async publishReport(examId: number, publishToApp: boolean): Promise<{
    examId: number;
    status: string;
    publishedToApp: boolean;
    publishedAt: string;
  }> {
    // Localizar o dicom_exam.id a partir do imaging_order_item_id legado
    const { data: exam } = await supabase
      .from("dicom_exams")
      .select("id")
      .eq("cd_laudo", examId)
      .maybeSingle();
    const targetId = exam?.id || examId;
    const { data, error } = await supabase.rpc("publish_dicom_report", {
      p_exam_id: targetId,
      p_publish_to_app: publishToApp,
    });
    if (error) throw error;
    return data as {
      examId: number;
      status: string;
      publishedToApp: boolean;
      publishedAt: string;
    };
  },

  mapRow(row: Record<string, unknown>): DicomReport {
    return {
      id: row.id,
      cd_dicom_exam: row.imaging_order_item_id,
      cd_patient: row.patient_id,
      cd_laudo: row.imaging_order_item_id,
      ds_content: row.content || "",
      ds_status: (row.status || "draft").toUpperCase(),
      ds_signed_by: row.radiologist_name,
      dt_signed_at: row.signed_at,
      lg_published_app: false,
      cd_origem_sigh: row.cd_origem_sigh,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  },
};

// ── DICOMweb (QIDO-RS / WADO-RS) helpers ───────────────────────────

export const dicomWeb = {
  /**
   * QIDO-RS: busca estudos por patient ID
   * Endpoint: GET /studies?PatientID=...
   */
  async queryStudiesByPatient(patientId: string): Promise<Array<{
    studyInstanceUID: string;
    studyDate?: string;
    studyTime?: string;
    modality?: string;
    accessionNumber?: string;
  }>> {
    const url = `${ORTHANC_URL}/dicom-web/studies?PatientID=${encodeURIComponent(patientId)}`;
    const res = await fetch(url, { headers: { Authorization: orthancAuth() } });
    if (!res.ok) throw new Error(`QIDO-RS falhou: ${res.status}`);
    const arr = await res.json();
    return (arr || []).map((s: Record<string, { Value?: string[] } | undefined>) => ({
      studyInstanceUID: s["0020000D"]?.Value?.[0] || "",
      studyDate: s["00080020"]?.Value?.[0] || "",
      studyTime: s["00080030"]?.Value?.[0] || "",
      modality: s["00080060"]?.Value?.[0] || "",
      accessionNumber: s["00080050"]?.Value?.[0] || "",
    }));
  },

  /**
   * WADO-RS: retorna URL para download de uma instancia DICOM
   * Endpoint: GET /studies/{study}/instances/{sop}
   */
  getInstanceUrl(studyInstanceUID: string, sopInstanceUID: string): string {
    return `${ORTHANC_URL}/dicom-web/studies/${studyInstanceUID}/instances/${sopInstanceUID}`;
  },

  /** WADO-URI (legado): retorna URL para visualizacao em viewer */
  getWadoUri(studyInstanceUID: string): string {
    return `${ORTHANC_URL}/wado?requestType=WADO&studyUID=${studyInstanceUID}&contentType=image/jpeg`;
  },
};

// ── Backward-compat: exporta o servico agregado (substitui o mock) ──

export const dicomService = {
  ...equipmentService,
  ...worklistService,
  ...examService,
  ...templateService,
  ...reportService,
  formatDicomDate,
  formatDicomTime,
  formatDicomName,
  generateUID,
};

// Aliases para compatibilidade com pages que esperam nomes diferentes
// (migração da versão mock → produção)
export const dicomNodesService = equipmentService;
export const dicomModalitiesService = equipmentService;
export const worklistQueueService = worklistService;
export const dicomDashboardService = {
  ...examService,
  ...worklistService,
  ...equipmentService,
};
export const radiologyReportsService = reportService;
export const pacsStudiesService = examService;
export const imagingOrderItemsService = examService;
export const imagingOrdersService = examService;

export default dicomService;
