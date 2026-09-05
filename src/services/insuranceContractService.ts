import { supabase } from "@/lib/supabase";

export interface InsuranceContract {
  id: number;
  company_id: string;
  insurance_company_id: number;
  insurance_plan_id?: number | null;
  unit_id?: number | null;
  contract_number?: string | null;
  start_date: string;
  end_date?: string | null;
  status: "vigente" | "vencido" | "suspenso" | "encerrado" | "em_renegociacao" | "em_implantacao" | "bloqueado";
  submission_deadline_days: number;
  payment_deadline_days: number;
  denial_appeal_deadline_days: number;
  notes?: string | null;
}

export const insuranceContractService = {
  async list(): Promise<InsuranceContract[]> {
    const { data, error } = await supabase
      .from("insurance_contracts")
      .select("*")
      .order("start_date", { ascending: false });
    if (error) throw new Error(`Erro ao listar contratos de convenio: ${error.message}`);
    return (data || []) as InsuranceContract[];
  },

  async create(input: Omit<InsuranceContract, "id" | "company_id"> & { company_id: string }): Promise<InsuranceContract> {
    const { data, error } = await supabase.from("insurance_contracts").insert(input).select().single();
    if (error) throw new Error(`Erro ao criar contrato de convenio: ${error.message}`);
    return data as InsuranceContract;
  },

  async update(id: number, input: Partial<InsuranceContract>): Promise<InsuranceContract> {
    const { data, error } = await supabase.from("insurance_contracts").update(input).eq("id", id).select().single();
    if (error) throw new Error(`Erro ao atualizar contrato de convenio: ${error.message}`);
    return data as InsuranceContract;
  },

};
