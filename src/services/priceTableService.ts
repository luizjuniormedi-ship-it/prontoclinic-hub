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

const EMPTY_PRICE_LOOKUP: PriceLookup = {
  vl_particular: 0,
  vl_convenio: 0,
  vl_material: 0,
  vl_medicamento: 0,
  vl_taxa: 0,
  vl_diaria: 0,
  vl_gases: 0,
  found: false,
};

function normalizeMoney(value: unknown): number {
  const normalized = typeof value === "string"
    ? value.trim().replace(",", ".")
    : value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.round(parsed * 100) / 100
    : 0;
}

function normalizePriceLookup(value: unknown): PriceLookup {
  if (typeof value === "string") {
    const record = value.trim();
    if (record.startsWith("(") && record.endsWith(")")) {
      const fields = record.slice(1, -1).split(",");
      if (fields.length === 8) {
        return {
          vl_particular: normalizeMoney(fields[0]),
          vl_convenio: normalizeMoney(fields[1]),
          vl_material: normalizeMoney(fields[2]),
          vl_medicamento: normalizeMoney(fields[3]),
          vl_taxa: normalizeMoney(fields[4]),
          vl_diaria: normalizeMoney(fields[5]),
          vl_gases: normalizeMoney(fields[6]),
          found: fields[7] === "t" || fields[7] === "true",
        };
      }
    }
  }
  if (!value || typeof value !== "object") return { ...EMPTY_PRICE_LOOKUP };
  const row = value as Record<string, unknown>;
  return {
    vl_particular: normalizeMoney(row.vl_particular),
    vl_convenio: normalizeMoney(row.vl_convenio),
    vl_material: normalizeMoney(row.vl_material),
    vl_medicamento: normalizeMoney(row.vl_medicamento),
    vl_taxa: normalizeMoney(row.vl_taxa),
    vl_diaria: normalizeMoney(row.vl_diaria),
    vl_gases: normalizeMoney(row.vl_gases),
    found: row.found === true || row.found === 1 || row.found === "true",
  };
}

function normalizePersistedMoney(value: unknown, field: string): number {
  if (value === null || value === undefined) return 0;
  const normalized = typeof value === "string"
    ? value.trim().replace(",", ".")
    : value;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Contrato inválido em price_tables.${field}`);
  }
  return Math.round(parsed * 100) / 100;
}

function normalizePriceTable(value: unknown): PriceTable {
  const row = value as Record<string, unknown>;
  return {
    ...(row as unknown as PriceTable),
    vl_particular: normalizePersistedMoney(row.vl_particular, "vl_particular"),
    vl_convenio: normalizePersistedMoney(row.vl_convenio, "vl_convenio"),
    vl_material: normalizePersistedMoney(row.vl_material, "vl_material"),
    vl_medicamento: normalizePersistedMoney(row.vl_medicamento, "vl_medicamento"),
    vl_taxa: normalizePersistedMoney(row.vl_taxa, "vl_taxa"),
    vl_diaria: normalizePersistedMoney(row.vl_diaria, "vl_diaria"),
    vl_gases: normalizePersistedMoney(row.vl_gases, "vl_gases"),
    percentual_acrescimo: normalizePersistedMoney(
      row.percentual_acrescimo,
      "percentual_acrescimo",
    ),
  };
}

export const priceTableService = {
  async getAll(filters?: {
    serviceId?: number;
    planId?: number | null;
    active?: boolean;
  }): Promise<PriceTable[]> {
    let q = supabase
      .from("price_tables")
      .select("*")
      .order("dt_inicio", { ascending: false })
      .limit(200);

    if (filters?.serviceId) q = q.eq("service_id", filters.serviceId);
    if (filters?.planId !== undefined) {
      if (filters.planId === null) q = q.is("insurance_plan_id", null);
      else q = q.eq("insurance_plan_id", filters.planId);
    }
    if (filters?.active !== undefined) q = q.eq("active", filters.active);

    const { data, error } = await q;
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data || []).map(normalizePriceTable);
  },

  async count(): Promise<number> {
    const { count, error } = await supabase
      .from("price_tables")
      .select("id", { count: "exact", head: true });
    if (error) throw new Error(`Erro ao contar preços: ${error.message}`);
    return count || 0;
  },

  async findPrice(
    serviceId: number,
    appointmentTypeId: number,
    insurancePlanId: number | null = null,
    companyId?: string | null,
  ): Promise<PriceLookup> {
    const { data, error } = await supabase.rpc("find_price", {
      p_company_id: companyId || null,
      p_service_id: serviceId,
      p_appointment_type_id: appointmentTypeId,
      p_insurance_plan_id: insurancePlanId,
    });
    if (error) {
      console.warn("find_price RPC falhou, retornando 0:", error);
      return { ...EMPTY_PRICE_LOOKUP };
    }
    return normalizePriceLookup(Array.isArray(data) ? data[0] : data);
  },

  async create(input: Partial<PriceTable>): Promise<PriceTable> {
    const { data, error } = await supabase
      .from("price_tables")
      .insert(input)
      .select()
      .single();
    if (error) throw new Error(`Erro ao criar preco: ${error.message}`);
    return normalizePriceTable(data);
  },

  async update(id: number, input: Partial<PriceTable>): Promise<PriceTable> {
    const { data, error } = await supabase
      .from("price_tables")
      .update(input)
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(`Erro: ${error.message}`);
    return normalizePriceTable(data);
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
    return (data || []).map(normalizePriceTable);
  },
};
