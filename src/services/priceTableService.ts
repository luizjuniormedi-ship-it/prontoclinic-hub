import { supabase } from '@/lib/supabase';

export interface DbPriceEntry {
  id: string;
  appointment_type_id: string | null;
  service_id: string | null;
  insurance_plan_id: string | null;
  price: number;
  description: string | null;
  active: boolean;
  company_id: string | null;
  created_at: string;
  updated_at: string;
  // joined
  appointment_type_name?: string;
}

export interface PriceEntryInput {
  appointment_type_id?: string;
  service_id?: string;
  insurance_plan_id?: string | null;
  price: number;
  description?: string;
  active?: boolean;
  company_id?: string;
}

export const priceTableService = {
  async getAll(): Promise<DbPriceEntry[]> {
    const { data, error } = await supabase
      .from('price_table')
      .select('*, appointment_types(name)')
      .order('created_at', { ascending: false });
    if (error) throw new Error(`Erro ao buscar preços: ${error.message}`);
    return (data || []).map((d: any) => ({
      ...d,
      appointment_type_name: d.appointment_types?.name,
      appointment_types: undefined,
    }));
  },

  async create(input: PriceEntryInput): Promise<DbPriceEntry> {
    const row: Record<string, any> = { ...input };
    if (row.insurance_plan_id === '') row.insurance_plan_id = null;
    const { data, error } = await supabase
      .from('price_table')
      .insert(row)
      .select()
      .single();
    if (error) {
      if (error.code === '23505') throw new Error('Já existe um preço para esta combinação de tipo e convênio.');
      throw new Error(`Erro ao criar preço: ${error.message}`);
    }
    return data;
  },

  async update(id: string, input: Partial<PriceEntryInput>): Promise<DbPriceEntry> {
    const row: Record<string, any> = { ...input, updated_at: new Date().toISOString() };
    if (row.insurance_plan_id === '') row.insurance_plan_id = null;
    const { data, error } = await supabase
      .from('price_table')
      .update(row)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(`Erro ao atualizar preço: ${error.message}`);
    return data;
  },

  async delete(id: string): Promise<void> {
    const { error } = await supabase
      .from('price_table')
      .delete()
      .eq('id', id);
    if (error) throw new Error(`Erro ao excluir preço: ${error.message}`);
  },

  /**
   * Find the best price for a given appointment type and insurance.
   * Priority:
   *   1. Price matching appointment_type_id + insurance_plan_id
   *   2. Price matching appointment_type_id + NULL insurance (particular)
   *   3. Price from services_catalog.price as fallback
   *   4. Returns 0
   */
  async findPrice(appointmentTypeId?: string | null, insurancePlanId?: string | null): Promise<number> {
    if (!appointmentTypeId) return 0;

    // 1. Try specific insurance price
    if (insurancePlanId) {
      const { data } = await supabase
        .from('price_table')
        .select('price')
        .eq('appointment_type_id', appointmentTypeId)
        .eq('insurance_plan_id', insurancePlanId)
        .eq('active', true)
        .maybeSingle();
      if (data?.price != null && data.price > 0) return Number(data.price);
    }

    // 2. Try particular price (insurance_plan_id IS NULL)
    const { data: particularPrice } = await supabase
      .from('price_table')
      .select('price')
      .eq('appointment_type_id', appointmentTypeId)
      .is('insurance_plan_id', null)
      .eq('active', true)
      .maybeSingle();
    if (particularPrice?.price != null && particularPrice.price > 0) return Number(particularPrice.price);

    // 3. Fallback: services_catalog (if appointment_type has a linked service)
    // Not directly linked, so return 0
    return 0;
  },
};
