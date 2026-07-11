/**
 * insuranceService — CRUD de Convênios, Planos, Fonte Pagadora
 *
 * Espelha o modelo SIGH: convenios (992), convenio_planos (395),
 * fonte_pagadora (53), convxmedi (48173 credenciamentos).
 *
 * Migrations relacionadas:
 * - 20260101000001_payment_sources.sql
 * - 20260101000002_insurance_companies.sql
 * - 20260101000003_insurance_plans.sql
 * - 20260101000004_professional_insurances.sql
 */

import { supabase } from "@/lib/supabase";

export type PaymentSourceType = "SUS" | "PARTICULAR" | "CORTESIA" | "CONVENIO";

export interface PaymentSource {
  id: number;
  company_id: string;
  name: string;
  type: PaymentSourceType;
  cnpj?: string;
  razao_social?: string;
  lg_ativo: boolean;
  cd_origem_sigh?: number;
  created_at: string;
  updated_at: string;
}

export interface InsuranceCompany {
  id: number;
  company_id: string;
  payment_source_id?: number;
  name: string;
  registro_ans?: string;
  cnpj?: string;
  razao_social?: string;
  telefone1?: string;
  telefone2?: string;
  percentual_desconto: number;
  lg_ativo: boolean;
  lg_guia_obrigatoria: boolean;
  lg_cid_obrigatorio: boolean;
  lg_matric_obrigatorio: boolean;
  lg_autorizac_obrigatorio: boolean;
  cd_origem_sigh?: number;
  created_at: string;
  updated_at: string;
}

export interface InsurancePlan {
  id: number;
  company_id: string;
  insurance_company_id: number;
  name: string;
  codigo?: string;
  lg_ativo: boolean;
  lg_coparticipacao: boolean;
  percentual_coparticipacao: number;
  tipo_acomodacao?: "ENFERMARIA" | "APARTAMENTO" | "AMBULATORIAL" | "HOME_CARE";
  cd_origem_sigh?: number;
  created_at: string;
  updated_at: string;
}

export interface ProfessionalInsurance {
  id: number;
  company_id: string;
  professional_id: number;
  insurance_company_id: number;
  lg_clinica: boolean;
  lg_credenciado: boolean;
  ds_observacao?: string;
  dt_inicio_vinculo?: string;
  dt_fim_vinculo?: string;
  lg_ativo: boolean;
}

export const paymentSourceService = {
  async getAll(): Promise<PaymentSource[]> {
    const { data, error } = await supabase
      .from("payment_sources")
      .select("*")
      .order("type", { ascending: false })
      .order("name");
    if (error) throw new Error(`Erro ao listar fontes pagadoras: ${error.message}`);
    return data || [];
  },

  async getByType(type: PaymentSourceType): Promise<PaymentSource[]> {
    const { data, error } = await supabase
      .from("payment_sources")
      .select("*")
      .eq("type", type)
      .eq("lg_ativo", true)
      .order("name");
    if (error) throw new Error(`Erro: ${error.message}`);
    return data || [];
  },

  async getById(id: number): Promise<PaymentSource | null> {
    const { data, error } = await supabase
      .from("payment_sources")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`Erro: ${error.message}`);
    return data;
  },
};

export const insuranceCompanyService = {
  async getAll(): Promise<InsuranceCompany[]> {
    const { data, error } = await supabase
      .from("insurance_companies")
      .select("*")
      .eq("lg_ativo", true)
      .order("name");
    if (error) throw new Error(`Erro ao listar convenios: ${error.message}`);
    return data || [];
  },

  async getById(id: number): Promise<InsuranceCompany | null> {
    const { data, error } = await supabase
      .from("insurance_companies")
      .select("*, payment_source:payment_sources(*)")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`Erro: ${error.message}`);
    return data;
  },

  async search(query: string, limit = 20): Promise<InsuranceCompany[]> {
    const { data, error } = await supabase
      .from("insurance_companies")
      .select("id, name, registro_ans, company_id, lg_ativo, percentual_desconto, lg_guia_obrigatoria, lg_cid_obrigatorio, lg_matric_obrigatorio, lg_autorizac_obrigatorio, created_at, updated_at")
      .ilike("name", `%${query}%`)
      .eq("lg_ativo", true)
      .limit(limit);
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data || []) as InsuranceCompany[];
  },

  async create(input: Partial<InsuranceCompany>): Promise<InsuranceCompany> {
    const { data, error } = await supabase
      .from("insurance_companies")
      .insert(input)
      .select()
      .single();
    if (error) throw new Error(`Erro ao criar convenio: ${error.message}`);
    return data;
  },

  async update(id: number, input: Partial<InsuranceCompany>): Promise<InsuranceCompany> {
    const { data, error } = await supabase
      .from("insurance_companies")
      .update(input)
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(`Erro ao atualizar convenio: ${error.message}`);
    return data;
  },

  async softDelete(id: number): Promise<void> {
    const { error } = await supabase
      .from("insurance_companies")
      .update({ lg_ativo: false })
      .eq("id", id);
    if (error) throw new Error(`Erro ao desativar convenio: ${error.message}`);
  },
};

export const insurancePlanService = {
  async getAll(): Promise<InsurancePlan[]> {
    const { data, error } = await supabase
      .from("insurance_plans")
      .select("*, insurance_company:insurance_companies(name)")
      .eq("lg_ativo", true)
      .order("name");
    if (error) throw new Error(`Erro: ${error.message}`);
    return data || [];
  },

  async getByInsurance(insuranceCompanyId: number): Promise<InsurancePlan[]> {
    const { data, error } = await supabase
      .from("insurance_plans")
      .select("*")
      .eq("insurance_company_id", insuranceCompanyId)
      .eq("lg_ativo", true)
      .order("name");
    if (error) throw new Error(`Erro: ${error.message}`);
    return data || [];
  },

  async create(input: Partial<InsurancePlan>): Promise<InsurancePlan> {
    const { data, error } = await supabase
      .from("insurance_plans")
      .insert(input)
      .select()
      .single();
    if (error) throw new Error(`Erro ao criar plano: ${error.message}`);
    return data;
  },

  async update(id: number, input: Partial<InsurancePlan>): Promise<InsurancePlan> {
    const { data, error } = await supabase
      .from("insurance_plans")
      .update(input)
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(`Erro: ${error.message}`);
    return data;
  },
};

export const professionalInsuranceService = {
  async getByProfessional(professionalId: number): Promise<ProfessionalInsurance[]> {
    const { data, error } = await supabase
      .from("professional_insurances")
      .select("*, insurance_company:insurance_companies(name, registro_ans)")
      .eq("professional_id", professionalId)
      .eq("lg_ativo", true);
    if (error) throw new Error(`Erro: ${error.message}`);
    return data || [];
  },

  async getByInsurance(insuranceCompanyId: number): Promise<ProfessionalInsurance[]> {
    const { data, error } = await supabase
      .from("professional_insurances")
      .select("*, professional:professionals(name, crm, crm_uf)")
      .eq("insurance_company_id", insuranceCompanyId)
      .eq("lg_ativo", true);
    if (error) throw new Error(`Erro: ${error.message}`);
    return data || [];
  },

  async create(input: Partial<ProfessionalInsurance>): Promise<ProfessionalInsurance> {
    const { data, error } = await supabase
      .from("professional_insurances")
      .insert(input)
      .select()
      .single();
    if (error) throw new Error(`Erro: ${error.message}`);
    return data;
  },

  async delete(id: number): Promise<void> {
    const { error } = await supabase
      .from("professional_insurances")
      .delete()
      .eq("id", id);
    if (error) throw new Error(`Erro: ${error.message}`);
  },
};