/**
 * Tipos faltantes identificados na auditoria pré-deploy.
 * Centraliza aliases para tipos que são referenciados em várias pages
 * mas não estavam exportados de seus services originais.
 */

import type { AppointmentStatus } from "@/types";

// ── InsuranceCompany (local, antes vinha de insuranceService) ────────────────
export interface InsuranceCompany {
  id: string;
  name: string;
  code?: string;
  type?: string;
  status?: "active" | "inactive";
  payment_source_id?: string | number | null;
  payment_source?: string | null;
  notes?: string | null;
  company_id?: string;
  created_at?: string;
  updated_at?: string;
}

// ── Appointment aliases ───────────────────────────────────────────────────────
export type AppointmentStatusForBadge = AppointmentStatus;
export type AppointmentTypeLiteral =
  | "consulta"
  | "exame"
  | "procedimento"
  | "retorno"
  | "terapia_avulsa"
  | "terapia_pacote";

// ── Patient DB row shape ─────────────────────────────────────────────────────
export interface PatientDbRow {
  id: string | number;
  full_name: string;
  cpf: string | null;
  birth_date: string | null;
  phone: string | null;
  email: string | null;
  sex: "F" | "M" | "O" | null;
  lg_ativo?: boolean;
  company_id?: string;
  insurance_plan_id?: string | number | null;
  insurance_plan?: {
    insurance_company?: { name: string | null } | null;
  } | null;
  insurance_card_number?: string | null;
  allergies?: string | null;
  clinical_alerts?: string | null;
  created_at: string;
  updated_at: string;
}

// ── DICOM Exam status literals (estendido) ───────────────────────────────────
export type DicomExamStatusExt =
  | "solicitado"
  | "agendado"
  | "em_execucao"
  | "concluido"
  | "cancelado"
  | "enviado_pacs"
  | "laudado"
  | "recebido_pacs";

// ── Insurance alias (compat) ───────────────────────────────────────────────────
export type InsuranceCompanyWithPaymentSource = InsuranceCompany & {
  payment_source?: string | null;
};

// ── Worklist item alias ───────────────────────────────────────────────────────
export interface DicomWorklistItemWithEquipment {
  id: number;
  equipment_id: number;
  equipment_aet?: string;
  equipment_port?: number;
  modality: string;
  patient_id: number;
  patient_name: string;
  patient_birth_date?: string;
  patient_sex?: string;
  scheduled_station_aetitle?: string;
  scheduled_datetime: string;
  accession_number: string;
  requested_procedure_id?: string;
  requested_procedure_description?: string;
  referring_physician_name?: string;
  status: string;
  exported_at?: string | null;
}

// ── PriceTable types (compat) ─────────────────────────────────────────────────
export interface DbPriceEntry {
  id: string | number;
  service_id?: number | null;
  appointment_type_id: string | number | null;
  insurance_plan_id?: number | string | null;
  appointment_type_name?: string;
  service?: string;
  plan?: string;
  price: number;
  description?: string | null;
  active: boolean;
  company_id: string;
  created_at: string;
  updated_at: string;
}

export interface PriceEntryInput {
  service_id?: number | null;
  appointment_type_id: string | number;
  insurance_plan_id?: number | string | null;
  price: number;
  description?: string | null;
  active?: boolean;
  company_id?: string;
}

// ── Notification stats shape (compat) ─────────────────────────────────────────
export interface NotificationStats {
  channel: string;
  total: number;
  sent: number;
  failed: number;
  cancelled: number;
  pending: number;
  delivered: number;
  taxa_sucesso_pct: number;
}

// ── PreCadastro type ──────────────────────────────────────────────────────────
export interface PreCadastroPublico {
  id: string | number;
  nm_paciente: string;
  nr_cpf: string;
  ds_email: string;
  nr_telefone: string;
  dt_nascimento?: string | null;
  especialidade?: string | null;
  tp_status: "pendente" | "confirmado" | "cancelado";
  ds_observacao?: string | null;
  created_at: string;
}

// ── DicomReport type ─────────────────────────────────────────────────────────
export interface DicomReportPublic {
  id: number;
  cd_laudo?: number | null;
  ds_laudo?: string | null;
  tp_status?: string | null;
  cd_exame: number;
  ds_conteudo?: string;
  tp_assinatura?: string | null;
  dt_publicacao?: string | null;
  created_at: string;
}
