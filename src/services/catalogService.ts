/**
 * catalogService — Substitui o mock api.ts (setTimeout) por queries reais.
 *
 * Mapeia tabelas Supabase → tipos do @/types:
 *   public.specialties      → Specialty
 *   public.rooms            → Room
 *   public.appointment_types → ConsultationType / ExamType / ProcedureType
 *   public.insurance_plans  → HealthInsurancePlan
 *   public.units            → Unit
 *   public.companies        → Company
 *   public.professionals    → Doctor / Professional
 *   public.attendance_types → AttendanceType
 *
 * IMPORTANTE: Todas as queries filtram por company_id via RLS (multi-tenant).
 * Não usar .select('*') — sempre selecionar colunas específicas para reduzir payload.
 */

import { z } from "zod";
import { supabase } from "@/lib/supabase";
import type {
  Specialty, ConsultationType, ExamType, ProcedureType,
  TherapyService, HealthInsurancePlan, Room, AttendanceType,
  Company, Unit,
} from "@/types";

// ── Zod Schemas (validação defensiva) ────────────────────────────────────────

const specialtyRowSchema = z.object({
  id: z.union([z.number(), z.string()]),
  name: z.string(),
  code: z.string().nullable().optional(),
  status: z.enum(["active", "inactive"]).nullable().optional(),
  notes: z.string().nullable().optional(),
  lg_ativo: z.boolean().nullable().optional(),
});

const roomRowSchema = z.object({
  id: z.union([z.number(), z.string()]),
  name: z.string().nullable(),
  type: z.string().nullable().optional(),
  cd_unidade: z.number().nullable().optional(),
  lg_ativo: z.boolean().nullable().optional(),
});

const unitRowSchema = z.object({
  id: z.union([z.number(), z.string()]),
  cd_codigo: z.string(),
  ds_nome: z.string(),
  lg_principal: z.boolean().nullable().optional(),
  lg_ativo: z.boolean().nullable().optional(),
});

const companyRowSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const insurancePlanRowSchema = z.object({
  id: z.union([z.number(), z.string()]),
  name: z.string(),
  codigo: z.string().nullable().optional(),
  lg_ativo: z.boolean().nullable().optional(),
});

// ── Specialties ───────────────────────────────────────────────────────────────

export const specialtiesService = {
  async getAll(onlyActive = true): Promise<Specialty[]> {
    let q = supabase
      .from("specialties")
      .select("id, name, code, lg_ativo")
      .order("name", { ascending: true });
    if (onlyActive) q = q.eq("lg_ativo", true);
    const { data, error } = await q;
    if (error) throw new Error(`Erro ao listar especialidades: ${error.message}`);
    return (data ?? []).map((row): Specialty => {
      const parsed = specialtyRowSchema.parse(row);
      return {
        id: String(parsed.id),
        name: parsed.name,
        code: parsed.code ?? undefined,
        status: parsed.lg_ativo === false ? "inactive" : "active",
        notes: parsed.notes ?? undefined,
      };
    });
  },
};

// ── Rooms ─────────────────────────────────────────────────────────────────────

export const roomsService = {
  async getAll(onlyActive = true): Promise<Room[]> {
    let q = supabase
      .from("rooms")
      .select("id, name, type, cd_unidade, lg_ativo")
      .order("name", { ascending: true });
    if (onlyActive) q = q.eq("lg_ativo", true);
    const { data, error } = await q;
    if (error) return [];
    return (data ?? []).map((row): Room => {
      const parsed = roomRowSchema.parse(row);
      return {
        id: String(parsed.id),
        name: parsed.name ?? "—",
        type: (parsed.type as Room["type"]) ?? "consultorio",
        unitId: parsed.cd_unidade ? String(parsed.cd_unidade) : "",
        unitName: "", // preenchido por getAllWithUnits
        status: parsed.lg_ativo === false ? "inactive" : "active",
      };
    });
  },

  async getAllWithUnits(onlyActive = true): Promise<Room[]> {
    const [rooms, units] = await Promise.all([
      roomsService.getAll(onlyActive),
      unitsService.getAll(onlyActive),
    ]);
    const unitMap = new Map(units.map((u) => [u.id, u.name]));
    return rooms.map((r) => ({
      ...r,
      unitName: unitMap.get(r.unitId) ?? "—",
    }));
  },
};

// ── Appointment Types (Consultations, Exams, Procedures, Therapies) ──────────

export const appointmentTypesService = {
  /**
   * Lista tipos de atendimento como ConsultationType.
   * appointment_types tem apenas (id, name, company_id).
   * Para mapear para ConsultationType, juntamos com specialties via default_specialty_id
   * se existir, senão fica vazio.
   */
  async getConsultations(onlyActive = true): Promise<ConsultationType[]> {
    const types = await appointmentTypesService.getRaw(onlyActive);
    return types.map((t) => ({
      id: String(t.id),
      name: t.name,
      specialtyId: "",
      specialtyName: "—",
      defaultDuration: t.default_duration ?? 30,
      particularPrice: 0,
      acceptedInsurances: [],
      status: "active" as const,
    }));
  },

  async getExams(onlyActive = true): Promise<ExamType[]> {
    const types = await appointmentTypesService.getRaw(onlyActive, "EXAME");
    return types.map((t) => ({
      id: String(t.id),
      name: t.name,
      category: "EXAME",
      specialtyId: "",
      specialtyName: "—",
      defaultDuration: t.default_duration ?? 30,
      particularPrice: 0,
      acceptedInsurances: [],
      requiresPrep: false,
      defaultPriority: "normal" as const,
      status: "active" as const,
    }));
  },

  async getProcedures(onlyActive = true): Promise<ProcedureType[]> {
    const types = await appointmentTypesService.getRaw(onlyActive, "PROCEDIMENTO");
    return types.map((t) => ({
      id: String(t.id),
      name: t.name,
      specialtyId: "",
      specialtyName: "—",
      defaultDuration: t.default_duration ?? 60,
      particularPrice: 0,
      acceptedInsurances: [],
      requiresAuthorization: false,
      status: "active" as const,
    }));
  },

  async getTherapies(onlyActive = true): Promise<TherapyService[]> {
    const types = await appointmentTypesService.getRaw(onlyActive, "TERAPIA");
    return types.map((t) => ({
      id: String(t.id),
      name: t.name,
      type: "TERAPIA",
      defaultDuration: t.default_duration ?? 45,
      particularPrice: 0,
      allowsPackage: false,
      status: "active" as const,
    }));
  },

  async getAttendanceTypes(onlyActive = true): Promise<AttendanceType[]> {
    const types = await appointmentTypesService.getRaw(onlyActive);
    return types.map((t) => ({
      id: String(t.id),
      name: t.name,
      category: "consulta" as AttendanceType["category"],
      defaultDuration: t.default_duration ?? 30,
      status: "active" as const,
    }));
  },

  async getRaw(onlyActive = true, category?: string): Promise<Array<{
    id: number | string;
    name: string;
    default_duration?: number;
    category?: string;
  }>> {
    let q = supabase
      .from("appointment_types")
      .select("id, name, default_duration, category, lg_ativo")
      .order("name");
    if (onlyActive) q = q.eq("lg_ativo", true);
    if (category) q = q.eq("category", category);
    const { data, error } = await q;
    if (error) throw new Error(`Erro ao listar tipos de atendimento: ${error.message}`);
    return data ?? [];
  },
};

// ── Insurance Plans ──────────────────────────────────────────────────────────

export const insurancePlansService = {
  async getAll(onlyActive = true): Promise<HealthInsurancePlan[]> {
    let q = supabase
      .from("insurance_plans")
      .select("id, name, codigo, lg_ativo")
      .order("name");
    if (onlyActive) q = q.eq("lg_ativo", true);
    const { data, error } = await q;
    if (error) throw new Error(`Erro ao listar planos: ${error.message}`);
    return (data ?? []).map((row): HealthInsurancePlan => {
      const parsed = insurancePlanRowSchema.parse(row);
      return {
        id: String(parsed.id),
        name: parsed.name,
        code: parsed.codigo ?? "—",
        type: "CONVENIO",
        status: parsed.lg_ativo === false ? "inactive" : "active",
      };
    });
  },
};

// ── Units ────────────────────────────────────────────────────────────────────

export const unitsService = {
  async getAll(onlyActive = true): Promise<Unit[]> {
    let q = supabase
      .from("units")
      .select("id, cd_codigo, ds_nome, lg_principal, lg_ativo")
      .order("lg_principal", { ascending: false })
      .order("ds_nome");
    if (onlyActive) q = q.eq("lg_ativo", true);
    const { data, error } = await q;
    if (error) throw new Error(`Erro ao listar unidades: ${error.message}`);
    return (data ?? []).map((row): Unit => {
      const parsed = unitRowSchema.parse(row);
      return {
        id: String(parsed.id),
        code: parsed.cd_codigo,
        name: parsed.ds_nome,
        companyId: "",
        companyName: "",
        cnpj: undefined,
        address: "",
        city: "",
        state: "",
        phone: "",
        email: "",
        type: parsed.lg_principal ? "matriz" : "filial",
        status: parsed.lg_ativo === false ? "inactive" : "active",
      };
    });
  },

  async getByCompany(companyId: string, onlyActive = true): Promise<Unit[]> {
    let q = supabase
      .from("units")
      .select("id, cd_codigo, ds_nome, lg_principal, lg_ativo, company_id")
      .eq("company_id", companyId)
      .order("lg_principal", { ascending: false });
    if (onlyActive) q = q.eq("lg_ativo", true);
    const { data, error } = await q;
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data ?? []).map((row): Unit => {
      const parsed = unitRowSchema.parse(row);
      return {
        id: String(parsed.id),
        code: parsed.cd_codigo,
        name: parsed.ds_nome,
        companyId,
        companyName: "",
        cnpj: undefined,
        address: "",
        city: "",
        state: "",
        phone: "",
        email: "",
        type: parsed.lg_principal ? "matriz" : "filial",
        status: parsed.lg_ativo === false ? "inactive" : "active",
      };
    });
  },
};

// ── Companies ────────────────────────────────────────────────────────────────

export const companiesService = {
  async getAll(): Promise<Company[]> {
    const { data, error } = await supabase
      .from("companies")
      .select("id, name, cnpj, phone, email, lg_ativo, created_at")
      .order("name");
    if (error) throw new Error(`Erro ao listar empresas: ${error.message}`);
    return (data ?? []).map((row: { id: string; name: string; cnpj?: string | null; phone?: string | null; email?: string | null; lg_ativo?: boolean | null; created_at?: string | null }): Company => ({
      id: row.id,
      legalName: row.name,
      tradeName: row.name,
      cnpj: row.cnpj ?? "",
      phone: row.phone ?? "",
      email: row.email ?? "",
      status: row.lg_ativo === false ? "inactive" : "active",
      createdAt: row.created_at ?? new Date().toISOString(),
    }));
  },
};

// ── Composite exports ────────────────────────────────────────────────────────

export const catalogService = {
  specialties: specialtiesService,
  rooms: roomsService,
  appointmentTypes: appointmentTypesService,
  insurancePlans: insurancePlansService,
  units: unitsService,
  companies: companiesService,
};
