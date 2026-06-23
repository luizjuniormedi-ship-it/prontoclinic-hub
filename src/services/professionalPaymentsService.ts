/**
 * professionalPaymentsService — Repasses/produção médica
 *
 * Migration: 20260101000030_professional_payments.sql
 * Tabela:    public.professional_payments
 */

import { z } from "zod";
import { supabase } from "@/lib/supabase";

export const tpRemunerationEnum = z.enum(["FIXED", "PACKAGE", "CH", "PERCENTAGE"]);
export const paymentStatusEnum = z.enum(["apurado", "conferido", "pago", "cancelado"]);

export const professionalPaymentSchema = z.object({
  cd_professional: z.number().int().positive(),
  cd_unit: z.number().int().positive().optional().nullable(),
  dt_reference: z.string().min(1),
  ds_reference: z.string().optional().nullable(),
  total_procedures: z.number().int().nonnegative().default(0),
  total_value: z.number().nonnegative(),
  total_received: z.number().nonnegative().default(0),
  tp_remuneration: tpRemunerationEnum.default("PERCENTAGE"),
  percentage: z.number().nonnegative().default(0),
  status: paymentStatusEnum.default("apurado"),
  dt_pago: z.string().optional().nullable(),
  ds_observacao: z.string().optional().nullable(),
});

export type ProfessionalPaymentInput = z.infer<typeof professionalPaymentSchema>;
export type ProfessionalPaymentStatus = z.infer<typeof paymentStatusEnum>;

export interface ProfessionalPayment {
  id: number;
  company_id: string;
  cd_professional: number;
  cd_unit: number | null;
  dt_reference: string;
  ds_reference: string | null;
  total_procedures: number;
  total_value: number;
  total_received: number;
  tp_remuneration: z.infer<typeof tpRemunerationEnum>;
  percentage: number;
  status: ProfessionalPaymentStatus;
  dt_pago: string | null;
  ds_observacao: string | null;
  lg_ativo: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProfessionalPaymentWithDetails extends ProfessionalPayment {
  professionalName?: string;
  unitName?: string;
}

export const professionalPaymentsService = {
  async getAll(filters?: {
    cd_professional?: number;
    cd_unit?: number;
    status?: ProfessionalPaymentStatus;
    dataInicio?: string;
    dataFim?: string;
    limit?: number;
  }): Promise<ProfessionalPayment[]> {
    let q = supabase
      .from("professional_payments")
      .select("*")
      .eq("lg_ativo", true)
      .order("dt_reference", { ascending: false });
    if (filters?.cd_professional) q = q.eq("cd_professional", filters.cd_professional);
    if (filters?.cd_unit) q = q.eq("cd_unit", filters.cd_unit);
    if (filters?.status) q = q.eq("status", filters.status);
    if (filters?.dataInicio) q = q.gte("dt_reference", filters.dataInicio);
    if (filters?.dataFim) q = q.lte("dt_reference", filters.dataFim);
    if (filters?.limit) q = q.limit(filters.limit);
    const { data, error } = await q;
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data ?? []) as ProfessionalPayment[];
  },

  async getAllWithDetails(filters?: Parameters<typeof professionalPaymentsService.getAll>[0]): Promise<ProfessionalPaymentWithDetails[]> {
    const payments = await professionalPaymentsService.getAll(filters);
    // Carregar profissionais e unidades em paralelo
    const [profsRes, unitsRes] = await Promise.all([
      supabase.from("professionals").select("id, full_name").order("full_name"),
      supabase.from("units").select("id, ds_nome").eq("lg_ativo", true),
    ]);
    const profMap = new Map((profsRes.data ?? []).map((p: { id: number; full_name: string }) => [p.id, p.full_name]));
    const unitMap = new Map((unitsRes.data ?? []).map((u: { id: number; ds_nome: string }) => [u.id, u.ds_nome]));
    return payments.map((p) => ({
      ...p,
      professionalName: profMap.get(p.cd_professional) ?? `Profissional #${p.cd_professional}`,
      unitName: p.cd_unit ? unitMap.get(p.cd_unit) ?? "—" : "—",
    }));
  },

  async getById(id: number): Promise<ProfessionalPayment | null> {
    const { data, error } = await supabase
      .from("professional_payments")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data as ProfessionalPayment) ?? null;
  },

  async create(input: ProfessionalPaymentInput): Promise<ProfessionalPayment> {
    const parsed = professionalPaymentSchema.parse(input);
    const { data, error } = await supabase
      .from("professional_payments")
      .insert(parsed)
      .select()
      .single();
    if (error) throw new Error(`Erro ao criar repasse: ${error.message}`);
    return data as ProfessionalPayment;
  },

  async update(id: number, input: Partial<ProfessionalPaymentInput>): Promise<ProfessionalPayment> {
    const parsed = professionalPaymentSchema.partial().parse(input);
    const { data, error } = await supabase
      .from("professional_payments")
      .update(parsed)
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(`Erro: ${error.message}`);
    return data as ProfessionalPayment;
  },

  async marcarComoPago(id: number, dt_pago: string): Promise<ProfessionalPayment> {
    const { data, error } = await supabase
      .from("professional_payments")
      .update({ status: "pago", dt_pago })
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(`Erro: ${error.message}`);
    return data as ProfessionalPayment;
  },

  async getEstatisticas(dataInicio?: string, dataFim?: string): Promise<{
    total_apurado: number;
    total_pago: number;
    total_pendente: number;
    qtd_profissionais: number;
  }> {
    const payments = await professionalPaymentsService.getAll({ dataInicio, dataFim });
    const total_apurado = payments.filter((p) => p.status === "apurado").reduce((s, p) => s + Number(p.total_value), 0);
    const total_pago = payments.filter((p) => p.status === "pago").reduce((s, p) => s + Number(p.total_value), 0);
    const total_pendente = total_apurado - total_pago;
    const qtd_profissionais = new Set(payments.map((p) => p.cd_professional)).size;
    return { total_apurado, total_pago, total_pendente, qtd_profissionais };
  },
};