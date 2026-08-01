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
  status: "draft" | "active" | "retired";
  submission_deadline_days: number;
  payment_deadline_days: number;
  denial_appeal_deadline_days: number;
  notes?: string | null;
}

export interface InsuranceContractVersion {
  id: string;
  company_id: string;
  contract_id: number;
  version_no: number;
  valid_from: string;
  valid_to?: string | null;
  coverage_rules: Record<string, unknown>;
  waiting_rules: Record<string, unknown>;
  copay_rules: Record<string, unknown>;
  package_rules: Record<string, unknown>;
  deadline_rules: Record<string, unknown>;
  denial_rules: Record<string, unknown>;
  status: "draft" | "active" | "retired";
}

export interface InsuranceRuleResolution {
  matched: boolean;
  contract_id?: number;
  contract_version_id?: string;
  contract_code?: string | null;
  name?: string | null;
  insurance_company_id: number;
  plan_id?: number | null;
  unit_id: number;
  version_no?: number;
  valid_from?: string;
  valid_to?: string | null;
  coverage_rules?: Record<string, unknown>;
  waiting_rules?: Record<string, unknown>;
  copay_rules?: Record<string, unknown>;
  package_rules?: Record<string, unknown>;
  deadline_rules?: Record<string, unknown>;
  denial_rules?: Record<string, unknown>;
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

  async createVersion(input: Omit<InsuranceContractVersion, "id" | "company_id"> & { company_id: string }): Promise<InsuranceContractVersion> {
    const { data, error } = await supabase.from("insurance_contract_versions").insert(input).select().single();
    if (error) throw new Error(`Erro ao criar versao de contrato: ${error.message}`);
    return data as InsuranceContractVersion;
  },

  async listVersions(contractId: number): Promise<InsuranceContractVersion[]> {
    const { data, error } = await supabase
      .from("insurance_contract_versions")
      .select("*")
      .eq("contract_id", contractId)
      .order("version_no", { ascending: false });
    if (error) throw new Error(`Erro ao listar versoes de contrato: ${error.message}`);
    return (data || []) as InsuranceContractVersion[];
  },

  async updateVersion(id: string, input: Partial<InsuranceContractVersion>): Promise<InsuranceContractVersion> {
    const { data, error } = await supabase
      .from("insurance_contract_versions")
      .update(input)
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(`Erro ao atualizar versao de contrato: ${error.message}`);
    return data as InsuranceContractVersion;
  },

  async linkUnit(contractId: number, companyId: string, unitId: number): Promise<void> {
    const { error } = await supabase.from("insurance_contract_units").upsert({ company_id: companyId, contract_id: contractId, unit_id: unitId });
    if (error) throw new Error(`Erro ao vincular unidade ao contrato: ${error.message}`);
  },

  async linkProfessional(contractId: number, companyId: string, professionalId: number): Promise<void> {
    const { error } = await supabase.from("insurance_contract_professionals").upsert({ company_id: companyId, contract_id: contractId, professional_id: professionalId });
    if (error) throw new Error(`Erro ao vincular profissional ao contrato: ${error.message}`);
  },

  async resolve(input: {
    insuranceCompanyId: number;
    planId?: number | null;
    unitId: number;
    professionalId?: number | null;
    referenceDate?: string;
  }): Promise<InsuranceRuleResolution> {
    const { data, error } = await supabase.rpc("resolve_insurance_rule", {
      p_insurance_company_id: input.insuranceCompanyId,
      p_plan_id: input.planId ?? null,
      p_unit_id: input.unitId,
      p_professional_id: input.professionalId ?? null,
      p_reference_date: input.referenceDate ?? new Date().toISOString().slice(0, 10),
    });
    if (error) throw new Error(`Erro ao resolver regra do convenio: ${error.message}`);
    return data as InsuranceRuleResolution;
  },

  async captureSnapshot(input: {
    companyId: string;
    appointmentId: number;
    patientId?: number | null;
    unitId: number;
    insuranceCompanyId: number;
    planId?: number | null;
    rule: InsuranceRuleResolution;
  }): Promise<void> {
    if (!input.rule.matched || !input.rule.contract_version_id) {
      throw new Error("Nao e possivel capturar snapshot sem regra vigente");
    }
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase.from("insurance_rule_snapshots").insert({
      company_id: input.companyId,
      source_module: "insurance_contracts",
      source_record_id: String(input.appointmentId),
      operation: "rule_snapshot",
      patient_id: input.patientId ?? null,
      appointment_id: input.appointmentId,
      insurance_company_id: input.insuranceCompanyId,
      insurance_plan_id: input.planId ?? null,
      unit_id: input.unitId,
      validation_result: { matched: true },
      rule_payload: input.rule,
      contract_id: input.rule.contract_id,
      contract_version_id: input.rule.contract_version_id,
      created_by: userData.user?.id ?? null,
    });
    if (error) throw new Error(`Erro ao capturar regra do convenio: ${error.message}`);
  },
};
