import { describe, expect, it } from "vitest";
import {
  assertReceptionBillingIntegrity,
  assertReceptionPriceFound,
  assertReceptionReceivableIntegrity,
  assertReceptionReceivableRequired,
  clearWalkinKey,
  clearWorkflowKey,
  getOrCreateWalkinKey,
  getOrCreateWorkflowKey,
  resolveReceptionPayer,
  type PatientRow,
} from "@/pages/ReceptionPage";
import type { InsuranceCompany, InsurancePlan } from "@/services/insuranceService";

const patient: PatientRow = {
  id: "patient-1",
  full_name: "Paciente QA",
  cpf: null,
  birth_date: null,
  phone: null,
  allergies: null,
  insurance_plan_id: "10",
};

const plan = {
  id: 10,
  insurance_company_id: 20,
  name: "Plano QA",
} as InsurancePlan;

const insurer = {
  id: 20,
  name: "Convênio QA",
} as InsuranceCompany;

describe("ReceptionPage — decisão segura do pagador", () => {
  it("reutiliza a chave do workflow após reabrir e limpa somente ao concluir", () => {
    const first = getOrCreateWorkflowKey("91001", "company-a", 10);
    const resumed = getOrCreateWorkflowKey("91001", "company-a", 10);
    expect(resumed).toBe(first);

    clearWorkflowKey("91001", "company-a", 10);
    const next = getOrCreateWorkflowKey("91001", "company-a", 10);
    expect(next).not.toBe(first);
    clearWorkflowKey("91001", "company-a", 10);
  });

  it("reutiliza a chave do atendimento espontâneo até o handoff", () => {
    const first = getOrCreateWalkinKey("company-a", 10);
    const resumed = getOrCreateWalkinKey("company-a", 10);
    expect(resumed).toBe(first);

    clearWalkinKey("company-a", 10);
    const next = getOrCreateWalkinKey("company-a", 10);
    expect(next).not.toBe(first);
    clearWalkinKey("company-a", 10);
  });

  it("bloqueia quando o cadastro do paciente está indisponível", () => {
    expect(() => resolveReceptionPayer(undefined, [], [], true)).toThrow(
      "Cadastro do paciente indisponível",
    );
  });

  it("bloqueia paciente conveniado quando o catálogo não carregou", () => {
    expect(() => resolveReceptionPayer(patient, [], [], false)).toThrow(
      "pagador não pode ser definido com segurança",
    );
  });

  it("não converte plano ou convênio ausente em atendimento particular", () => {
    expect(() => resolveReceptionPayer(patient, [], [insurer], true)).toThrow(
      "Plano do paciente não foi encontrado",
    );
    expect(() => resolveReceptionPayer(patient, [plan], [], true)).toThrow(
      "Convênio do paciente não foi encontrado",
    );
  });

  it("classifica particular somente quando o paciente não possui plano", () => {
    expect(
      resolveReceptionPayer(
        { ...patient, insurance_plan_id: null },
        [],
        [],
        false,
      ),
    ).toEqual({ plan: null, insurer: null, billingType: "particular" });
  });

  it("preserva o convênio quando plano e operadora são válidos", () => {
    expect(resolveReceptionPayer(patient, [plan], [insurer], true)).toEqual({
      plan,
      insurer,
      billingType: "convenio",
    });
  });

  it("bloqueia pré-conta quando não há preço encontrado", () => {
    expect(() => assertReceptionPriceFound(false)).toThrow(
      "Preço não cadastrado para este atendimento",
    );
    expect(() => assertReceptionPriceFound(true)).not.toThrow();
  });

  it("bloqueia alteração do pagador depois da cotação validada", () => {
    const quote = {
      billingType: "convenio" as const,
      insuranceId: 20,
      totalGrossAmount: 150,
    };
    expect(() =>
      assertReceptionBillingIntegrity(quote, {
        ...quote,
        billingType: "particular",
        insuranceId: null,
      }),
    ).toThrow("divergiu da cotação validada");
    expect(() =>
      assertReceptionBillingIntegrity(quote, { ...quote, insuranceId: 21 }),
    ).toThrow("divergiu da cotação validada");
  });

  it("bloqueia alteração do valor e aceita a cotação original", () => {
    const quote = {
      billingType: "particular" as const,
      insuranceId: null,
      totalGrossAmount: 89.9,
    };
    expect(() =>
      assertReceptionBillingIntegrity(quote, {
        ...quote,
        totalGrossAmount: 0,
      }),
    ).toThrow("divergiu da cotação validada");
    expect(() => assertReceptionBillingIntegrity(quote, quote)).not.toThrow();
    expect(() => assertReceptionBillingIntegrity(null, quote)).toThrow(
      "Cotação da pré-conta indisponível",
    );
  });

  it("limita recebível ao valor da pré-conta e ao tipo do pagador", () => {
    expect(() =>
      assertReceptionReceivableIntegrity("particular", 100, "private", 100),
    ).not.toThrow();
    expect(() =>
      assertReceptionReceivableIntegrity("convenio", 100, "copayment", 20),
    ).not.toThrow();
    expect(() =>
      assertReceptionReceivableIntegrity("particular", 100, "private", 101),
    ).toThrow("não pode exceder a pré-conta");
    expect(() =>
      assertReceptionReceivableIntegrity("convenio", 100, "private", 20),
    ).toThrow("incompatível com a fonte pagadora");
  });

  it("impede check-in particular sem título financeiro pendente", () => {
    expect(() =>
      assertReceptionReceivableRequired("particular", false),
    ).toThrow("Atendimento particular exige título financeiro pendente");
    expect(() =>
      assertReceptionReceivableRequired("particular", true),
    ).not.toThrow();
    expect(() =>
      assertReceptionReceivableRequired("convenio", false),
    ).not.toThrow();
  });
});
