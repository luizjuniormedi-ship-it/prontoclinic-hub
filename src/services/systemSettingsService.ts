/**
 * systemSettingsService — persiste configurações globais em `system_settings`.
 * Cada configuração é (company_id, category, key, value, data_type).
 */
import { supabase } from "@/lib/supabase";

export interface SystemSetting {
  id: number;
  company_id: string;
  category: string;
  key: string;
  value: string | null;
  data_type: "string" | "number" | "boolean";
  ds_descricao: string | null;
  updated_at: string;
}

function parseValue(v: string | null, type: string): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  if (type === "number") return Number(v);
  if (type === "boolean") return v === "true" || v === "1";
  return v;
}

function serializeValue(v: string | number | boolean | null): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

export const systemSettingsService = {
  async getAll(): Promise<SystemSetting[]> {
    const { data, error } = await supabase
      .from("system_settings")
      .select("id, company_id, category, key, value, data_type, ds_descricao, updated_at")
      .order("category")
      .order("key");
    if (error) throw new Error(`Erro ao carregar configuracoes: ${error.message}`);
    return (data ?? []) as SystemSetting[];
  },

  async getByCategory(category: string): Promise<Record<string, string | number | boolean | null>> {
    const { data, error } = await supabase
      .from("system_settings")
      .select("key, value, data_type")
      .eq("category", category);
    if (error) throw new Error(`Erro: ${error.message}`);
    const out: Record<string, string | number | boolean | null> = {};
    for (const row of (data ?? []) as { key: string; value: string | null; data_type: string }[]) {
      out[row.key] = parseValue(row.value, row.data_type);
    }
    return out;
  },

  async set(category: string, key: string, value: string | number | boolean | null): Promise<void> {
    // busca id existente (upsert composto)
    const { data: existing } = await supabase
      .from("system_settings")
      .select("id")
      .eq("category", category)
      .eq("key", key)
      .maybeSingle();
    if (existing && (existing as { id: number }).id) {
      const { error } = await supabase
        .from("system_settings")
        .update({ value: serializeValue(value), updated_at: new Date().toISOString() })
        .eq("id", (existing as { id: number }).id);
      if (error) throw new Error(`Erro ao salvar: ${error.message}`);
    } else {
      const type = typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "string";
      const { error } = await supabase
        .from("system_settings")
        .insert({
          category,
          key,
          value: serializeValue(value),
          data_type: type,
        });
      if (error) throw new Error(`Erro ao criar: ${error.message}`);
    }
  },

  async setBulk(category: string, values: Record<string, string | number | boolean | null>): Promise<void> {
    for (const [key, value] of Object.entries(values)) {
      await systemSettingsService.set(category, key, value);
    }
  },
};
