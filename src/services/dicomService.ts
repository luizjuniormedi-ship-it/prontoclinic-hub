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
import { getLegacyOrthancUrl, resolveDicomNodeRoute } from "@/services/dicomNodeRoutingService";

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
  unit_id?: number | null;
  ds_equipment: string;
  ds_aetitle: string;
  ds_type: DicomModality;
  ds_ip?: string;
  ds_port: number;
  ds_location?: string;
  lg_worklist: boolean;
  pacs_node_id?: string | null;
  worklist_node_id?: string | null;
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
  unit_id?: number | null;
  source_node_id?: string | null;
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

const ORTHANC_URL = getLegacyOrthancUrl();
const DICOM_GATEWAY_PATH = ((import.meta.env.VITE_DICOM_GATEWAY_URL as string | undefined)
  || `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dicom-gateway`).replace(/\/$/, "");

function equipmentRoute(equipment: Pick<DicomEquipment, "unit_id" | "pacs_node_id">) {
  return { nodeId: equipment.pacs_node_id ?? undefined, unitId: equipment.unit_id ?? undefined };
}

/**
 * DICOM REST calls go through the server-side gateway. The direct URL is only
 * a compatibility fallback for old local installations that do not expose
 * the gateway yet; no Orthanc credential is ever read by this bundle.
 */
async function orthancFetch(path: string, init?: RequestInit, route?: { nodeId?: string; unitId?: number | null }): Promise<Response> {
  const params = new URLSearchParams({ path });
  if (route?.nodeId) params.set("node_id", route.nodeId);
  if (route?.unitId != null) params.set("unit_id", String(route.unitId));
  const gatewayUrl = `${DICOM_GATEWAY_PATH}?${params.toString()}`;
  const { data: sessionData } = await supabase.auth.getSession();
  const headers = new Headers(init?.headers);
  if (sessionData.session?.access_token) headers.set("Authorization", `Bearer ${sessionData.session.access_token}`);
  const gatewayResponse = await fetch(gatewayUrl, { ...init, headers });
  if (gatewayResponse.status !== 404 || !import.meta.env.DEV) return gatewayResponse;
  return fetch(`${ORTHANC_URL}${path}`, init);
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
      const res = await orthancFetch(`/modalities/${eq.ds_aetitle}/echo`, {
        method: "POST",
        signal: AbortSignal.timeout(5000),
      }, equipmentRoute(eq));
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

  /**
   * Lista todos os itens da worklist (alias para WorklistPage).
   * Retorna uma estrutura flat com campos derivados mapeados.
   */
  async list(): Promise<Array<{
    id: number;
    cd_patient?: number;
    cd_unit?: number;
    ds_procedure?: string;
    modality?: string;
    requesting_physician?: string;
    scheduled_at?: string;
    priority?: string;
    status?: string;
    created_at?: string;
  }>> {
    const { data, error } = await supabase
      .from("dicom_worklist")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      if ((error as { code?: string }).code === "PGRST116") return [];
      throw error;
    }
    return (data || []) as Array<{
      id: number;
      cd_patient?: number;
      cd_unit?: number;
      ds_procedure?: string;
      modality?: string;
      requesting_physician?: string;
      scheduled_at?: string;
      priority?: string;
      status?: string;
      created_at?: string;
    }>;
  },

  /**
   * Atualiza um item da worklist (alias para WorklistPage).
   */
  async update(id: number, updates: { status?: string; [key: string]: unknown }): Promise<void> {
    const { error } = await supabase
      .from("dicom_worklist")
      .update(updates)
      .eq("id", id);
    if (error) throw error;
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

  /**
   * Lista exames de imagem com filtros opcionais.
   * Wrapper para PACSPage: aceita { status, company_id }.
   */
  async list(filters?: { status?: DicomExamStatus; company_id?: string }): Promise<DicomExam[]> {
    let q = supabase
      .from("dicom_exams")
      .select("*, dicom_equipment(ds_equipment, ds_aetitle, ds_type)")
      .order("dt_exame", { ascending: false })
      .limit(200);
    if (filters?.status) q = q.eq("ds_status", filters.status);
    if (filters?.company_id) q = q.eq("company_id", filters.company_id);
    const { data, error } = await q;
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
    const res = await orthancFetch(
      `/peers/${eq.ds_aetitle}/store`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ StudyInstanceUID: exam.cd_dicom_exame }),
        signal: AbortSignal.timeout(30000),
      },
      equipmentRoute(eq)
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
      .from("reports")
      .select("*")
      .eq("imaging_order_item_id", examId) // legado: usar order_item como proxy
      .maybeSingle();
    if (existing) {
      const { data, error } = await supabase
        .from("reports")
        .update({
          conclusion: content,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .select()
        .single();
      if (error) throw error;
      return this.mapRow(data);
    }
    void signedBy;
    throw new Error("O laudo canônico é criado automaticamente quando o estudo é recebido pelo PACS.");
  },

  async getReport(examId: number): Promise<DicomReport | null> {
    const { data, error } = await supabase
      .from("reports")
      .select("*")
      .eq("imaging_order_item_id", examId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ? this.mapRow(data) : null;
  },

  /**
   * Lista laudos de radiologia (wrapper para PACSPage / RadiologyReportsPage).
   */
  async list(filters?: { company_id?: string; status?: string }): Promise<DicomReport[]> {
    let q = supabase
      .from("reports")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(200);
    if (filters?.company_id) q = q.eq("company_id", filters.company_id);
    if (filters?.status) q = q.eq("status", filters.status);
    const { data, error } = await q;
    if (error) throw error;
    return (data || []).map((r: Record<string, unknown>) => this.mapRow(r));
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
    const r = row as Record<string, any>;
    return {
      id: (r.id as number) ?? 0,
      cd_dicom_exam: (r.imaging_order_item_id as number) ?? 0,
      cd_patient: (r.patient_id as number) ?? undefined,
      cd_laudo: (r.imaging_order_item_id as number) ?? undefined,
      ds_content: (r.conclusion as string) || (r.findings as string) || "",
      ds_status: (["liberado", "entregue"].includes(String(r.status)) ? "FINAL" : "DRAFT") as DicomReport["ds_status"],
      ds_signed_by: r.signed_by_name as string | undefined,
      dt_signed_at: r.signed_at as string | undefined,
      lg_published_app: false,
      cd_origem_sigh: r.cd_origem_sigh as number | undefined,
      created_at: (r.created_at as string) ?? "",
      updated_at: (r.updated_at as string) ?? "",
    };
  },
};

// ── DICOMweb (QIDO-RS / WADO-RS) helpers ───────────────────────────

export const dicomWeb = {
  /**
   * QIDO-RS: busca estudos por patient ID
   * Endpoint: GET /studies?PatientID=...
   */
  async queryStudiesByPatient(patientId: string, route?: { nodeId?: string; unitId?: number | null }): Promise<Array<{
    studyInstanceUID: string;
    studyDate?: string;
    studyTime?: string;
    modality?: string;
    accessionNumber?: string;
  }>> {
    const res = await orthancFetch(`/dicom-web/studies?PatientID=${encodeURIComponent(patientId)}`, undefined, route);
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
  getInstanceUrl(studyInstanceUID: string, sopInstanceUID: string, route?: { nodeId?: string; unitId?: number | null }): string {
    const params = new URLSearchParams({ path: `/dicom-web/studies/${studyInstanceUID}/instances/${sopInstanceUID}` });
    if (route?.nodeId) params.set("node_id", route.nodeId);
    if (route?.unitId != null) params.set("unit_id", String(route.unitId));
    return `${DICOM_GATEWAY_PATH}?${params.toString()}`;
  },

  /** Baixa a instância pelo gateway autenticado para consumidores que não
   * conseguem anexar Authorization (como o loader legado do Cornerstone). */
  async getInstanceObjectUrl(
    studyInstanceUID: string,
    sopInstanceUID: string,
    route?: { nodeId?: string; unitId?: number | null }
  ): Promise<string> {
    const res = await orthancFetch(
      `/dicom-web/studies/${encodeURIComponent(studyInstanceUID)}/instances/${encodeURIComponent(sopInstanceUID)}`,
      undefined,
      route
    );
    if (!res.ok) throw new Error(`WADO-RS falhou: ${res.status}`);
    return URL.createObjectURL(await res.blob());
  },

  /** WADO-URI (legado): retorna URL para visualizacao em viewer */
  getWadoUri(studyInstanceUID: string, route?: { nodeId?: string; unitId?: number | null }): string {
    const params = new URLSearchParams({ path: `/wado?requestType=WADO&studyUID=${studyInstanceUID}&contentType=image/jpeg` });
    if (route?.nodeId) params.set("node_id", route.nodeId);
    if (route?.unitId != null) params.set("unit_id", String(route.unitId));
    return `${DICOM_GATEWAY_PATH}?${params.toString()}`;
  },
};

// ── DICOM Nodes (PACS/MWL/Viewer) Service ──────────────────────────
// Persistido em `dicom_nodes`. O fallback para dicom_equipment mantém o
// comportamento de instalações que ainda nao aplicaram a migration.

async function currentCompanyId(): Promise<string | undefined> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Sessao autenticada obrigatoria para criar um no DICOM");
  const { data } = await supabase.from("user_profiles").select("company_id").eq("id", auth.user.id).maybeSingle();
  if (!data?.company_id) throw new Error("Usuario autenticado sem empresa ativa");
  return data.company_id as string;
}

function isMissingRelation(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  return e?.code === "PGRST116" || e?.code === "42P01" || Boolean(e?.message?.includes("does not exist"));
}

export const nodesService = {
  async list(companyId?: string): Promise<Array<{
    id: string;
    name: string;
    node_type: string;
    node_kind?: "pacs" | "worklist";
    unit_id?: number | null;
    aetitle: string;
    ip_address?: string;
    port?: number;
    rest_endpoint_ref?: string | null;
    priority?: number;
    is_default?: boolean;
    health_status?: string;
    description?: string;
    active: boolean;
  }>> {
    let q = supabase.from("dicom_nodes").select("*").order("priority").order("name");
    if (companyId) q = q.eq("company_id", companyId);
    const modern = await q;
    if (!modern.error) return (modern.data || []).map((r: Record<string, unknown>) => ({
      id: String(r.id),
      name: (r.name as string) ?? "",
      node_type: (r.node_kind as string) ?? "pacs",
      node_kind: r.node_kind as "pacs" | "worklist",
      unit_id: (r.unit_id as number | null) ?? null,
      aetitle: (r.aetitle as string) ?? "",
      ip_address: r.dicom_host as string | undefined,
      port: r.dicom_port as number | undefined,
      rest_endpoint_ref: r.rest_endpoint_ref as string | null | undefined,
      priority: r.priority as number | undefined,
      is_default: r.is_default as boolean | undefined,
      health_status: r.health_status as string | undefined,
      description: r.last_health_error as string | undefined,
      active: (r.is_active as boolean) ?? true,
    }));
    if (!isMissingRelation(modern.error)) throw modern.error;

    let legacy = supabase.from("dicom_equipment").select("*").order("ds_equipment");
    if (companyId) legacy = legacy.eq("company_id", companyId);
    const { data, error } = await legacy;
    if (error) throw error;
    return (data || []).map((r: Record<string, unknown>) => ({
      id: String(r.id), name: (r.ds_equipment as string) ?? "",
      node_type: "pacs", node_kind: "pacs", unit_id: (r.unit_id as number | null) ?? null,
      aetitle: (r.ds_aetitle as string) ?? "", ip_address: r.ds_ip as string | undefined,
      port: r.ds_port as number | undefined, description: r.ds_observacao as string | undefined,
      active: (r.lg_active as boolean) ?? true,
    }));
  },

  async create(payload: {
    name: string;
    node_type: string;
    unit_id?: number | null;
    aetitle: string;
    ip_address?: string;
    port?: number;
    rest_endpoint_ref?: string | null;
    priority?: number;
    is_default?: boolean;
    description?: string;
    active?: boolean;
  }): Promise<{ id: string }> {
    const companyId = await currentCompanyId();
    const { data, error } = await supabase.from("dicom_nodes").insert({
      company_id: companyId,
      unit_id: payload.unit_id ?? null,
      name: payload.name,
      node_kind: payload.node_type === "worklist" ? "worklist" : "pacs",
      aetitle: payload.aetitle,
      dicom_host: payload.ip_address,
      dicom_port: payload.port || 4242,
      rest_endpoint_ref: payload.rest_endpoint_ref ?? null,
      priority: payload.priority ?? 100,
      is_default: payload.is_default ?? false,
      is_active: payload.active ?? true,
      last_health_error: payload.description,
    }).select("id").single();
    if (error) throw error;
    return { id: String(data.id) };
  },

  async update(id: string, payload: Partial<{
    name: string;
    node_type: string;
    unit_id?: number | null;
    aetitle: string;
    ip_address?: string;
    port?: number;
    rest_endpoint_ref?: string | null;
    priority?: number;
    is_default?: boolean;
    description?: string;
    active?: boolean;
  }>): Promise<void> {
    const updates: Record<string, unknown> = {};
    if (payload.name !== undefined) updates.name = payload.name;
    if (payload.aetitle !== undefined) updates.aetitle = payload.aetitle;
    if (payload.node_type !== undefined) updates.node_kind = payload.node_type === "worklist" ? "worklist" : "pacs";
    if (payload.ip_address !== undefined) updates.dicom_host = payload.ip_address;
    if (payload.port !== undefined) updates.dicom_port = payload.port;
    if (payload.unit_id !== undefined) updates.unit_id = payload.unit_id;
    if (payload.rest_endpoint_ref !== undefined) updates.rest_endpoint_ref = payload.rest_endpoint_ref;
    if (payload.priority !== undefined) updates.priority = payload.priority;
    if (payload.is_default !== undefined) updates.is_default = payload.is_default;
    if (payload.description !== undefined) updates.last_health_error = payload.description;
    if (payload.active !== undefined) updates.is_active = payload.active;
    const { error } = await supabase.from("dicom_nodes").update(updates).eq("id", id);
    if (error) throw error;
  },
};

// ── DICOM Modalities (worklist SCP) Service ────────────────────────
// View derivada de dicom_equipment filtrada por lg_worklist=true.
export const modalitiesService = {
  async list(companyId?: string, unitId?: number | null): Promise<Array<{
    id: string;
    unit_id?: number | null;
    name: string;
    modality_type: string;
    aetitle: string;
    manufacturer?: string;
    model?: string;
    ip_address?: string;
    port?: number;
    worklist_enabled: boolean;
    pacs_node_id?: string;
    worklist_node_id?: string;
    pacs_node_name?: string;
    worklist_node_name?: string;
    room_name?: string;
    active: boolean;
  }>> {
    let q = supabase
      .from("dicom_equipment")
      .select("*")
      .order("ds_equipment");
    if (companyId) q = q.eq("company_id", companyId);
    if (unitId != null) q = q.eq("unit_id", unitId);
    const { data, error } = await q;
    if (error) throw error;
    return (data || []).map((r: Record<string, unknown>) => ({
      id: String(r.id),
      unit_id: (r.unit_id as number | null) ?? null,
      name: (r.ds_equipment as string) ?? "",
      modality_type: (r.ds_type as string) ?? "US",
      aetitle: (r.ds_aetitle as string) ?? "",
      manufacturer: r.ds_manufacturer as string | undefined,
      model: r.ds_model as string | undefined,
      ip_address: r.ds_ip as string | undefined,
      port: r.ds_port as number | undefined,
      worklist_enabled: (r.lg_worklist as boolean) ?? false,
      pacs_node_id: r.pacs_node_id ? String(r.pacs_node_id) : undefined,
      worklist_node_id: r.worklist_node_id ? String(r.worklist_node_id) : undefined,
      room_name: r.ds_location as string | undefined,
      active: (r.lg_active as boolean) ?? true,
    }));
  },

  async create(payload: {
    name: string;
    unit_id?: number | null;
    modality_type: string;
    aetitle: string;
    manufacturer?: string;
    model?: string;
    ip_address?: string;
    port?: number | null;
    worklist_enabled?: boolean;
    pacs_node_id?: string | null;
    worklist_node_id?: string | null;
    room_name?: string;
    active?: boolean;
  }): Promise<{ id: string }> {
    const companyId = await currentCompanyId();
    const { data, error } = await supabase
      .from("dicom_equipment")
      .insert({
        company_id: companyId,
        unit_id: payload.unit_id ?? null,
        ds_equipment: payload.name,
        ds_aetitle: payload.aetitle,
        ds_type: (payload.modality_type as DicomModality) || "US",
        ds_manufacturer: payload.manufacturer,
        ds_model: payload.model,
        ds_ip: payload.ip_address,
        ds_port: payload.port || 104,
        ds_location: payload.room_name,
        lg_worklist: payload.worklist_enabled ?? false,
        pacs_node_id: payload.pacs_node_id || null,
        worklist_node_id: payload.worklist_node_id || null,
        lg_active: payload.active ?? true,
      })
      .select("id")
      .single();
    if (error) throw error;
    return { id: String(data.id) };
  },

  async update(id: string, payload: Partial<{
    name: string;
    unit_id?: number | null;
    modality_type: string;
    aetitle: string;
    manufacturer?: string;
    model?: string;
    ip_address?: string;
    port?: number | null;
    worklist_enabled?: boolean;
    pacs_node_id?: string | null;
    worklist_node_id?: string | null;
    room_name?: string;
    active?: boolean;
  }>): Promise<void> {
    const updates: Record<string, unknown> = {};
    if (payload.name !== undefined) updates.ds_equipment = payload.name;
    if (payload.unit_id !== undefined) updates.unit_id = payload.unit_id;
    if (payload.aetitle !== undefined) updates.ds_aetitle = payload.aetitle;
    if (payload.modality_type !== undefined) updates.ds_type = payload.modality_type;
    if (payload.manufacturer !== undefined) updates.ds_manufacturer = payload.manufacturer;
    if (payload.model !== undefined) updates.ds_model = payload.model;
    if (payload.ip_address !== undefined) updates.ds_ip = payload.ip_address;
    if (payload.port !== undefined) updates.ds_port = payload.port;
    if (payload.room_name !== undefined) updates.ds_location = payload.room_name;
    if (payload.worklist_enabled !== undefined) updates.lg_worklist = payload.worklist_enabled;
    if (payload.pacs_node_id !== undefined) updates.pacs_node_id = payload.pacs_node_id || null;
    if (payload.worklist_node_id !== undefined) updates.worklist_node_id = payload.worklist_node_id || null;
    if (payload.active !== undefined) updates.lg_active = payload.active;
    const { error } = await supabase
      .from("dicom_equipment")
      .update(updates)
      .eq("id", Number(id));
    if (error) throw error;
  },
};

// ── Worklist Queue (legacy DICOM MWL) Service ─────────────────────
// Esta tabela física é `dicom_worklist_queue`. Cria/atualiza registros
// a partir de imaging_order_items.

import type { WorklistQueueStatus, DicomWorklistItem as DicomWorklistItemAlias } from "@/types/dicom";

export const worklistQueueServiceRaw = {
  async list(filters?: { status?: string; unit_id?: number | null; destination_node_id?: string }): Promise<DicomWorklistItemAlias[]> {
    let q = supabase
      .from("dicom_worklist_queue")
      .select("*")
      .order("scheduled_datetime", { ascending: false });
    if (filters?.status) q = q.eq("status", filters.status);
    if (filters?.unit_id != null) q = q.eq("unit_id", filters.unit_id);
    if (filters?.destination_node_id) q = q.eq("destination_node_id", filters.destination_node_id);
    const { data, error } = await q;
    if (error) {
      // Se a tabela não existir (404), retorna array vazio silenciosamente
      if ((error as { code?: string }).code === "PGRST116" || (error as { message?: string }).message?.includes("does not exist")) {
        return [];
      }
      throw error;
    }
    return (data || []) as unknown as DicomWorklistItemAlias[];
  },

  async markExported(id: string): Promise<void> {
    const { error } = await supabase
      .from("dicom_worklist_queue")
      .update({
        status: "exported" as WorklistQueueStatus,
        exported_to_worklist: true,
        last_export_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) throw error;
  },

  async cancel(id: string): Promise<void> {
    const { error } = await supabase
      .from("dicom_worklist_queue")
      .update({
        status: "cancelled" as WorklistQueueStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) throw error;
  },

  async createFromOrderItem(
    item: import("@/types/dicom").ImagingOrderItem,
    order: import("@/types/dicom").ImagingOrder,
    patient: { id: string; full_name: string; birth_date?: string; sex?: string; cpf?: string }
  ): Promise<DicomWorklistItemAlias> {
    const unitId = order.unit_id == null ? null : Number(order.unit_id);
    const route = order.company_id
      ? await resolveDicomNodeRoute(order.company_id, { unitId, kind: "worklist" })
      : { node: null };
    const { data, error } = await supabase
      .from("dicom_worklist_queue")
      .insert({
        company_id: order.company_id,
        unit_id: unitId,
        destination_node_id: route.node?.id ?? null,
        imaging_order_item_id: item.id,
        patient_id: order.patient_id,
        patient_name: patient.full_name,
        patient_birth_date: patient.birth_date,
        patient_sex: patient.sex,
        patient_identifier: patient.cpf,
        accession_number: order.accession_number,
        requested_procedure_description: item.exam_name,
        requested_procedure_id: item.requested_procedure_id,
        scheduled_procedure_step_id: item.scheduled_procedure_step_id,
        modality_type: item.modality_type,
        scheduled_station_aetitle: item.station_aetitle,
        scheduled_datetime: item.scheduled_datetime,
        referring_physician_name: order.referring_physician_name,
        status: "pending" as WorklistQueueStatus,
        exported_to_worklist: false,
      })
      .select()
      .single();
    if (error) throw error;
    return data as unknown as DicomWorklistItemAlias;
  },
};

// ── Imaging Order Items Service ────────────────────────────────────

import type { ImagingOrder, ImagingOrderItem, ImagingOrderStatus } from "@/types/dicom";

export const imagingOrderItemsServiceReal = {
  async listByOrder(orderId: string): Promise<ImagingOrderItem[]> {
    const { data, error } = await supabase
      .from("imaging_order_items")
      .select("*")
      .eq("imaging_order_id", orderId)
      .order("created_at");
    if (error) {
      if ((error as { code?: string }).code === "PGRST116") return [];
      throw error;
    }
    return (data || []) as unknown as ImagingOrderItem[];
  },

  async create(payload: Partial<ImagingOrderItem>): Promise<ImagingOrderItem> {
    const { data, error } = await supabase
      .from("imaging_order_items")
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    return data as unknown as ImagingOrderItem;
  },

  async updateStatus(id: string, status: ImagingOrderStatus): Promise<void> {
    const { error } = await supabase
      .from("imaging_order_items")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
  },
};

// ── Imaging Orders Service ─────────────────────────────────────────

export const imagingOrdersServiceReal = {
  async list(filters?: { status?: string }): Promise<ImagingOrder[]> {
    let q = supabase
      .from("imaging_orders")
      .select("*, patients(full_name)")
      .order("created_at", { ascending: false })
      .limit(200);
    if (filters?.status) q = q.eq("status", filters.status);
    const { data, error } = await q;
    if (error) {
      if ((error as { code?: string }).code === "PGRST116") return [];
      throw error;
    }
    return (data || []).map((r: Record<string, unknown>) => {
      const patient = r.patients as { full_name?: string } | null;
      return {
        ...(r as unknown as ImagingOrder),
        patient_name: patient?.full_name,
      } as ImagingOrder;
    });
  },

  async create(payload: Partial<ImagingOrder>): Promise<ImagingOrder> {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) throw new Error("Sessão obrigatória para criar pedido de imagem.");
    const { data: professional, error: professionalError } = await supabase
      .from("professionals")
      .select("id, full_name, company_id")
      .eq("user_id", authData.user.id)
      .eq("lg_ativo", true)
      .single();
    if (professionalError || !professional) throw new Error("Usuário sem profissional ativo vinculado.");
    const { data: profile } = await supabase.from("user_profiles").select("primary_unit_id").eq("id", authData.user.id).maybeSingle();
    const accession = `PM-${new Date().toISOString().replace(/\D/g, "").slice(0, 17)}-${crypto.randomUUID().slice(0, 6)}`;
    const { data, error } = await supabase
      .from("imaging_orders")
      .insert({
        ...payload,
        company_id: professional.company_id,
        unit_id: payload.unit_id ?? profile?.primary_unit_id ?? null,
        requesting_physician_id: professional.id,
        referring_physician_name: professional.full_name,
        accession_number: payload.accession_number || accession,
        status: payload.status || "agendado",
        created_by: authData.user.id,
      })
      .select()
      .single();
    if (error) throw error;
    return data as unknown as ImagingOrder;
  },
};

// ── DICOM Exam Service (wrapper para listar estudos) ──────────────

import type { PacsStudy } from "@/types/dicom";

export const pacsStudiesServiceReal = {
  async list(filters?: { status?: DicomExamStatus; company_id?: string }): Promise<DicomExam[]> {
    let q = supabase
      .from("dicom_exams")
      .select("*, dicom_equipment(ds_equipment, ds_aetitle, ds_type)")
      .order("dt_exame", { ascending: false })
      .limit(200);
    if (filters?.status) q = q.eq("ds_status", filters.status);
    if (filters?.company_id) q = q.eq("company_id", filters.company_id);
    const { data, error } = await q;
    if (error) throw error;
    return (data || []) as DicomExam[];
  },
};

// ── Worklist Service (legacy "dicom_worklist" — manter alias) ──────

export const worklistServiceAlias = {
  async list(): Promise<Array<{
    id: number;
    cd_patient?: number;
    cd_unit?: number;
    ds_procedure?: string;
    modality?: string;
    requesting_physician?: string;
    scheduled_at?: string;
    priority?: string;
    status?: string;
    created_at?: string;
  }>> {
    const { data, error } = await supabase
      .from("dicom_worklist")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      if ((error as { code?: string }).code === "PGRST116") return [];
      throw error;
    }
    return (data || []) as Array<{
      id: number;
      cd_patient?: number;
      cd_unit?: number;
      ds_procedure?: string;
      modality?: string;
      requesting_physician?: string;
      scheduled_at?: string;
      priority?: string;
      status?: string;
      created_at?: string;
    }>;
  },

  async update(id: number, updates: { status?: string }): Promise<void> {
    const { error } = await supabase
      .from("dicom_worklist")
      .update(updates)
      .eq("id", id);
    if (error) throw error;
  },
};

// ── Radiology Reports Service (wrapper) ────────────────────────────

import type { RadiologyReport } from "@/types/dicom";

export const radiologyReportsServiceReal = {
  async list(filters?: { status?: string; company_id?: string }): Promise<RadiologyReport[]> {
    let q = supabase
      .from("reports")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(200);
    if (filters?.status) q = q.eq("status", filters.status);
    if (filters?.company_id) q = q.eq("company_id", filters.company_id);
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data || []) as unknown as RadiologyReport[];
    // Resolve nomes de pacientes numa 2a query (proxy REST local nao faz embedding)
    const patientIds = [...new Set(rows.map((r) => r.patient_id).filter(Boolean))];
    const nameById: Record<string, string> = {};
    if (patientIds.length > 0) {
      const { data: pats } = await supabase
        .from("patients")
        .select("id, full_name")
        .in("id", patientIds as string[]);
      for (const p of (pats || []) as Array<{ id: string; full_name: string }>) {
        nameById[String(p.id)] = p.full_name;
      }
    }
    return rows.map((r) => ({ ...r, patient_name: nameById[String(r.patient_id)] }));
  },

  async update(id: string, updates: Partial<RadiologyReport>): Promise<void> {
    const { error } = await supabase
      .from("reports")
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) throw error;
  },

  async sign(id: string, radiologistName: string): Promise<void> {
    void radiologistName;
    const { error } = await supabase.rpc("sign_and_release_radiology_report", { p_report_id: id });
    if (error) throw error;
  },
};

// ── DICOM Dashboard Stats ──────────────────────────────────────────

export const dicomDashboardServiceReal = {
  async getStats(): Promise<{
    activeModalities: number;
    worklistEnabled: number;
    worklistPending: number;
    worklistExported: number;
    pendingReports: number;
    completedReports: number;
    ordersInAcquisition: number;
    ordersSentPacs: number;
  }> {
    const [eqRes, wlRes, repRes, ordRes] = await Promise.all([
      supabase.from("dicom_equipment").select("id, lg_worklist, lg_active", { count: "exact" }),
      supabase.from("dicom_worklist_queue").select("status", { count: "exact" }),
      supabase.from("reports").select("status", { count: "exact" }),
      supabase.from("imaging_orders").select("status", { count: "exact" }),
    ]);

    const eq = (eqRes.data || []) as Array<{ lg_worklist?: boolean; lg_active?: boolean }>;
    const wl = (wlRes.data || []) as Array<{ status?: string }>;
    const rep = (repRes.data || []) as Array<{ status?: string }>;
    const ord = (ordRes.data || []) as Array<{ status?: string }>;

    return {
      activeModalities: eq.filter(e => e.lg_active !== false).length,
      worklistEnabled: eq.filter(e => e.lg_worklist === true).length,
      worklistPending: wl.filter(w => w.status === "pending").length,
      worklistExported: wl.filter(w => w.status === "exported").length,
      pendingReports: rep.filter(r => ["aguardando_laudo", "em_digitacao", "em_revisao", "aguardando_assinatura"].includes(r.status || "")).length,
      completedReports: rep.filter(r => r.status === "liberado" || r.status === "entregue").length,
      ordersInAcquisition: ord.filter(o => o.status === "em_aquisicao").length,
      ordersSentPacs: ord.filter(o => o.status === "enviado_pacs" || o.status === "recebido_pacs").length,
    };
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
export const dicomNodesService = nodesService;
export const dicomModalitiesService = modalitiesService;
export const worklistQueueService = worklistQueueServiceRaw;
export const dicomDashboardService = dicomDashboardServiceReal;
export const radiologyReportsService = radiologyReportsServiceReal;
export const pacsStudiesService = pacsStudiesServiceReal;
export const imagingOrderItemsService = imagingOrderItemsServiceReal;
export const imagingOrdersService = imagingOrdersServiceReal;
export { worklistServiceAlias as worklistServiceLegacy };

export default dicomService;
