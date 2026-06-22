/**
 * priceTableService — Tabela de Preços por Convênio/Serviço
 *
 * Complementa o priceTableService existente. Espelha o SIGH.99pgm_medicor
 * (3673 regras) e servicos.VL_PARTICULAR.
 *
 * Migration relacionada: 20260101000005_price_tables.sql
 *
 * Função SQL `find_price()` no banco busca com fallback:
 * 1. Preço específico do convênio
 * 2. Preço particular
 * 3. services_catalog.price
 * 4. 0
 */

import { supabase } from "@/lib/supabase";

export interface PriceTable {
  id: number;
  company_id: string;
  appointment_type_id?: number;
  service_id?: number;
  insurance_plan_id?: number;
  dt_inicio: string;
  dt_fim?: string;
  vl_particular: number;
  vl_convenio: number;
  vl_material: number;
  vl_medicamento: number;
  vl_taxa: number;
  vl_diaria: number;
  vl_gases: number;
  tp_calculo: "FIXO" | "PERCENTUAL" | "COBRO";
  percentual_acrescimo: number;
  description?: string;
  active: boolean;
  cd_origem_sigh?: number;
  created_at: string;
  updated_at: string;
}

export interface PriceLookup {
  vl_particular: number;
  vl_convenio: number;
  vl_material: number;
  vl_medicamento: number;
  vl_taxa: number;
  vl_diaria: number;
  vl_gases: number;
  found: boolean;
}

export const priceTableService = {
  async getAll(filters?: {
    serviceId?: number;
    planId?: number | null;
    active?: boolean;
  }): Promise<PriceTable[]> {
    let q = supabase
      .from("price_tables")
      .select(`
        *,
        service:services_catalog(name),
        plan:insurance_plans(name),
        appointment_type:appointment_types(name)
      `)
      .order("dt_inicio", { ascending: false });

    if (filters?.serviceId) q = q.eq("service_id", filters.serviceId);
    if (filters?.planId !== undefined) {
      if (filters.planId === null) q = q.is("insurance_plan_id", null);
      else q = q.eq("insurance_plan_id", filters.planId);
    }
    if (filters?.active !== undefined) q = q.eq("active", filters.active);

    const { data, error } = await q;
    if (error) throw new Error(`Erro: ${error.message}`);
    return data || [];
  },

  async findPrice(
    serviceId: number,
    appointmentTypeId: number,
    insurancePlanId: number | null = null
  ): Promise<PriceLookup> {
    const { data, error } = await supabase.rpc("find_price", {
      p_company_id: null,
      p_service_id: serviceId,
      p_appointment_type_id: appointmentTypeId,
      p_insurance_plan_id: insurancePlanId,
    });
    if (error) {
      console.warn("find_price RPC falhou, retornando 0:", error);
      return {
        vl_particular: 0, vl_convenio: 0, vl_material: 0, vl_medicamento: 0,
        vl_taxa: 0, vl_diaria: 0, vl_gases: 0, found: false,
      };
    }
    return data?.[0] || {
      vl_particular: 0, vl_convenio: 0, vl_material: 0, vl_medicamento: 0,
      vl_taxa: 0, vl_diaria: 0, vl_gases: 0, found: false,
    };
  },

  async create(input: Partial<PriceTable>): Promise<PriceTable> {
    const { data, error } = await supabase
      .from("price_tables")
      .insert(input)
      .select()
      .single();
    if (error) throw new Error(`Erro ao criar preco: ${error.message}`);
    return data;
  },

  async update(id: number, input: Partial<PriceTable>): Promise<PriceTable> {
    const { data, error } = await supabase
      .from("price_tables")
      .update(input)
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(`Erro: ${error.message}`);
    return data;
  },

  async delete(id: number): Promise<void> {
    const { error } = await supabase.from("price_tables").delete().eq("id", id);
    if (error) throw new Error(`Erro: ${error.message}`);
  },

  async bulkCreate(inputs: Partial<PriceTable>[]): Promise<PriceTable[]> {
    const { data, error } = await supabase
      .from("price_tables")
      .insert(inputs)
      .select();
    if (error) throw new Error(`Erro no bulk: ${error.message}`);
    return data || [];
  },
};