/**
 * insuranceQuotasService — Cotas de vagas por convenio/servico/medico
 *
 * Espelha o SIGH.agenda_ctrl (vazio, mas modelo existe).
 * Permite limitar quantas vagas um convenio tem por dia/mes
 * para um determinado servico/medico.
 *
 * Migration: 20260101000004_professional_insurances.sql
 */

import { supabase } from "@/lib/supabase";

export interface InsuranceQuota {
  id: number;
  company_id: string;
  insurance_company_id: number;
  service_id?: number;
  professional_id?: number;
  quantidade_liberada: number;
  periodo: "D" | "M";
  dt_inicio: string;
  dt_fim?: string;
  lg_ativo: boolean;
}

export const insuranceQuotasService = {
  async getAll(filters?: {
    insuranceCompanyId?: number;
    serviceId?: number;
    active?: boolean;
  }): Promise<InsuranceQuota[]> {
    let q = supabase
      .from("insurance_quotas")
      .select(`
        *,
        insurance_company:insurance_companies(name),
        service:services_catalog(name),
        professional:professionals(name)
      `)
      .order("dt_inicio", { ascending: false });

    if (filters?.insuranceCompanyId) q = q.eq("insurance_company_id", filters.insuranceCompanyId);
    if (filters?.serviceId) q = q.eq("service_id", filters.serviceId);
    if (filters?.active !== undefined) q = q.eq("lg_ativo", filters.active);

    const { data, error } = await q;
    if (error) throw new Error(`Erro: ${error.message}`);
    return data || [];
  },

  /**
   * Verifica se ainda ha cota disponivel
   */
  async checkAvailability(
    insuranceCompanyId: number,
    serviceId: number,
    professionalId: number,
    periodo: "D" | "M",
    dataReferencia: Date = new Date()
  ): Promise<{ disponivel: number; limite: number; dentro_da_cota: boolean }> {
    const { data: quota, error: qErr } = await supabase
      .from("insurance_quotas")
      .select("*")
      .eq("insurance_company_id", insuranceCompanyId)
      .eq("service_id", serviceId)
      .eq("professional_id", professionalId)
      .eq("periodo", periodo)
      .eq("lg_ativo", true)
      .lte("dt_inicio", dataReferencia.toISOString().split("T")[0])
      .or(`dt_fim.is.null,dt_fim.gte.${dataReferencia.toISOString().split("T")[0]}`)
      .maybeSingle();

    if (qErr) throw new Error(`Erro: ${qErr.message}`);
    if (!quota) {
      return { disponivel: -1, limite: -1, dentro_da_cota: true };
    }

    let dataInicio: string;
    let dataFim: string;
    if (periodo === "D") {
      const d = dataReferencia.toISOString().split("T")[0];
      dataInicio = d;
      dataFim = d;
    } else {
      const ym = dataReferencia.toISOString().slice(0, 7);
      dataInicio = `${ym}-01`;
      dataFim = `${ym}-31`;
    }

    const { count, error: cErr } = await supabase
      .from("appointments")
      .select("*", { count: "exact", head: true })
      .eq("insurance_company_id", insuranceCompanyId)
      .eq("service_id", serviceId)
      .eq("professional_id", professionalId)
      .gte("appointment_date", dataInicio)
      .lte("appointment_date", dataFim)
      .not("status", "in", "(cancelled,no_show)");

    if (cErr) throw new Error(`Erro: ${cErr.message}`);

    const usado = count || 0;
    const disponivel = quota.quantidade_liberada - usado;
    return {
      disponivel,
      limite: quota.quantidade_liberada,
      dentro_da_cota: disponivel > 0,
    };
  },

  async create(input: Partial<InsuranceQuota>): Promise<InsuranceQuota> {
    const { data, error } = await supabase
      .from("insurance_quotas")
      .insert(input)
      .select()
      .single();
    if (error) throw new Error(`Erro ao criar cota: ${error.message}`);
    return data;
  },

  async update(id: number, input: Partial<InsuranceQuota>): Promise<InsuranceQuota> {
    const { data, error } = await supabase
      .from("insurance_quotas")
      .update(input)
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(`Erro: ${error.message}`);
    return data;
  },

  async delete(id: number): Promise<void> {
    const { error } = await supabase.from("insurance_quotas").delete().eq("id", id);
    if (error) throw new Error(`Erro: ${error.message}`);
  },
};