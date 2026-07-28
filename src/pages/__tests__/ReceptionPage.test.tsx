import { describe, expect, it } from "vitest";
import {
  assertReceptionPriceFound,
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
});
