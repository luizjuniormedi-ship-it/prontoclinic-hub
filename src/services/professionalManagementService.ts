import { supabase } from "@/lib/supabase";

export interface ProfessionalSpecialtyLink {
  id: number;
  specialty_id: number;
  valid_from: string;
  valid_until: string | null;
  status: string;
}

export interface ProfessionalUnitLink {
  id: number;
  unit_id: number;
  sector_id: number | null;
  valid_from: string;
  valid_until: string | null;
  status: string;
}

export interface ProfessionalServiceLink {
  id: number;
  service_id: number;
  unit_id: number | null;
  valid_from: string;
  valid_until: string | null;
  status: string;
}

export interface ProfessionalDocument {
  id: number;
  document_type: string;
  document_number: string | null;
  issued_at: string | null;
  expires_at: string | null;
  storage_path: string | null;
  status: string;
  notes: string | null;
}

export interface ProfessionalBlockRule {
  id: number;
  block_type: "all" | "execution" | "signature";
  reason: string;
  starts_at: string;
  ends_at: string | null;
  status: string;
}

export interface ProfessionalRemunerationRule {
  id: number;
  unit_id: number | null;
  insurance_company_id: number | null;
  service_id: number | null;
  remuneration_type: "fixed" | "percentage" | "ch" | "package";
  fixed_amount: number | null;
  percentage: number | null;
  reference_value: number | null;
  valid_from: string;
  valid_until: string | null;
  status: string;
  notes: string | null;
}

export interface ProfessionalInsuranceLink {
  id: number;
  insurance_company_id: number;
  lg_clinica: boolean;
  lg_credenciado: boolean;
  ds_observacao: string | null;
  dt_inicio_vinculo: string | null;
  dt_fim_vinculo: string | null;
  lg_ativo: boolean;
}

const linkColumns = "id, specialty_id, valid_from, valid_until, status";
const unitColumns = "id, unit_id, sector_id, valid_from, valid_until, status";
const serviceColumns = "id, service_id, unit_id, valid_from, valid_until, status";
const documentColumns = "id, document_type, document_number, issued_at, expires_at, storage_path, status, notes";
const blockColumns = "id, block_type, reason, starts_at, ends_at, status";
const remunerationColumns = "id, unit_id, insurance_company_id, service_id, remuneration_type, fixed_amount, percentage, reference_value, valid_from, valid_until, status, notes";
const insuranceColumns = "id, insurance_company_id, lg_clinica, lg_credenciado, ds_observacao, dt_inicio_vinculo, dt_fim_vinculo, lg_ativo";

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw new Error("Registro nao retornado pelo banco.");
  return result.data;
}

function unwrapList<T>(result: { data: T[] | null; error: { message: string } | null }): T[] {
  if (result.error) throw new Error(result.error.message);
  return result.data ?? [];
}

export const professionalManagementService = {
  listSpecialties(professionalId: number) {
    return supabase.from("professional_specialties").select(linkColumns).eq("professional_id", professionalId).order("valid_from").then((result) => unwrapList<ProfessionalSpecialtyLink>(result));
  },
  addSpecialty(input: { company_id: string; professional_id: number; specialty_id: number; valid_from: string; valid_until?: string | null }) {
    return supabase.from("professional_specialties").insert({ ...input, status: "active" }).select(linkColumns).single().then((result) => unwrap<ProfessionalSpecialtyLink>(result));
  },
  removeSpecialty(id: number) {
    return supabase.from("professional_specialties").delete().eq("id", id).then((result) => { if (result.error) throw new Error(result.error.message); });
  },

  listUnitLinks(professionalId: number) {
    return supabase.from("professional_units").select(unitColumns).eq("professional_id", professionalId).order("valid_from").then((result) => unwrapList<ProfessionalUnitLink>(result));
  },
  addUnitLink(input: { company_id: string; professional_id: number; unit_id: number; sector_id?: number | null; valid_from: string; valid_until?: string | null }) {
    return supabase.from("professional_units").insert({ ...input, status: "active" }).select(unitColumns).single().then((result) => unwrap<ProfessionalUnitLink>(result));
  },
  updateUnitLink(id: number, input: Partial<Pick<ProfessionalUnitLink, "sector_id" | "valid_until" | "status">>) {
    return supabase.from("professional_units").update(input).eq("id", id).select(unitColumns).single().then((result) => unwrap<ProfessionalUnitLink>(result));
  },

  listServiceLinks(professionalId: number) {
    return supabase.from("professional_services").select(serviceColumns).eq("professional_id", professionalId).order("valid_from").then((result) => unwrapList<ProfessionalServiceLink>(result));
  },
  addServiceLink(input: { company_id: string; professional_id: number; service_id: number; unit_id?: number | null; valid_from: string; valid_until?: string | null }) {
    return supabase.from("professional_services").insert({ ...input, status: "active" }).select(serviceColumns).single().then((result) => unwrap<ProfessionalServiceLink>(result));
  },
  updateServiceLink(id: number, input: Partial<Pick<ProfessionalServiceLink, "valid_until" | "status">>) {
    return supabase.from("professional_services").update(input).eq("id", id).select(serviceColumns).single().then((result) => unwrap<ProfessionalServiceLink>(result));
  },

  listDocuments(professionalId: number) {
    return supabase.from("professional_documents").select(documentColumns).eq("professional_id", professionalId).order("expires_at").then((result) => unwrapList<ProfessionalDocument>(result));
  },
  addDocument(input: { company_id: string; professional_id: number; document_type: string; document_number?: string | null; issued_at?: string | null; expires_at?: string | null; storage_path?: string | null; notes?: string | null }) {
    return supabase.from("professional_documents").insert({ ...input, status: "active" }).select(documentColumns).single().then((result) => unwrap<ProfessionalDocument>(result));
  },
  updateDocument(id: number, input: Partial<Pick<ProfessionalDocument, "document_number" | "issued_at" | "expires_at" | "storage_path" | "status" | "notes">>) {
    return supabase.from("professional_documents").update(input).eq("id", id).select(documentColumns).single().then((result) => unwrap<ProfessionalDocument>(result));
  },

  listBlocks(professionalId: number) {
    return supabase.from("professional_block_rules").select(blockColumns).eq("professional_id", professionalId).order("starts_at", { ascending: false }).then((result) => unwrapList<ProfessionalBlockRule>(result));
  },
  addBlock(input: { company_id: string; professional_id: number; block_type: ProfessionalBlockRule["block_type"]; reason: string; starts_at: string; ends_at?: string | null }) {
    return supabase.from("professional_block_rules").insert({ ...input, status: "active" }).select(blockColumns).single().then((result) => unwrap<ProfessionalBlockRule>(result));
  },
  updateBlock(id: number, input: Partial<Pick<ProfessionalBlockRule, "ends_at" | "status" | "reason">>) {
    return supabase.from("professional_block_rules").update(input).eq("id", id).select(blockColumns).single().then((result) => unwrap<ProfessionalBlockRule>(result));
  },

  listRemunerationRules(professionalId: number) {
    return supabase.from("professional_remuneration_rules").select(remunerationColumns).eq("professional_id", professionalId).order("valid_from", { ascending: false }).then((result) => unwrapList<ProfessionalRemunerationRule>(result));
  },
  addRemunerationRule(input: Omit<ProfessionalRemunerationRule, "id" | "status"> & { company_id: string; professional_id: number }) {
    return supabase.from("professional_remuneration_rules").insert({ ...input, status: "active" }).select(remunerationColumns).single().then((result) => unwrap<ProfessionalRemunerationRule>(result));
  },
  updateRemunerationRule(id: number, input: Partial<Pick<ProfessionalRemunerationRule, "fixed_amount" | "percentage" | "reference_value" | "valid_until" | "status" | "notes">>) {
    return supabase.from("professional_remuneration_rules").update(input).eq("id", id).select(remunerationColumns).single().then((result) => unwrap<ProfessionalRemunerationRule>(result));
  },

  listInsuranceLinks(professionalId: number) {
    return supabase.from("professional_insurances").select(insuranceColumns).eq("professional_id", professionalId).order("lg_ativo", { ascending: false }).then((result) => unwrapList<ProfessionalInsuranceLink>(result));
  },
  addInsuranceLink(input: { company_id: string; professional_id: number; insurance_company_id: number; lg_clinica: boolean; lg_credenciado: boolean; dt_inicio_vinculo?: string | null; dt_fim_vinculo?: string | null; ds_observacao?: string | null }) {
    return supabase.from("professional_insurances").insert({ ...input, lg_ativo: true }).select(insuranceColumns).single().then((result) => unwrap<ProfessionalInsuranceLink>(result));
  },
  updateInsuranceLink(id: number, input: Partial<Pick<ProfessionalInsuranceLink, "lg_clinica" | "lg_credenciado" | "dt_fim_vinculo" | "ds_observacao" | "lg_ativo">>) {
    return supabase.from("professional_insurances").update(input).eq("id", id).select(insuranceColumns).single().then((result) => unwrap<ProfessionalInsuranceLink>(result));
  },
};
