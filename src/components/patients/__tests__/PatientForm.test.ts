import { describe, expect, it } from "vitest";
import { normalizeInsurancePlanId } from "@/components/patients/patientFormUtils";
import {
  normalizePatientBirthDate,
  patientBirthDateError,
} from "@/components/patients/PatientForm";

describe("normalizeInsurancePlanId", () => {
  it("normaliza o ID numérico retornado pelo banco para o valor string do formulário", () => {
    expect(normalizeInsurancePlanId(840040)).toBe("840040");
  });

  it("normaliza plano ausente para string vazia", () => {
    expect(normalizeInsurancePlanId(null)).toBe("");
  });
});

describe("data de nascimento do paciente", () => {
  it("mantém a data ISO válida usada pelo input controlado e pelo create", () => {
    expect(normalizePatientBirthDate("1990-01-15")).toBe("1990-01-15");
    expect(patientBirthDateError("1990-01-15", new Date(2026, 6, 25))).toBeNull();
  });

  it("rejeita datas inexistentes, futuras e anteriores ao limite cadastral", () => {
    expect(normalizePatientBirthDate("2026-02-31")).toBe("");
    expect(patientBirthDateError("2027-01-01", new Date(2026, 6, 25)))
      .toBe("Data de nascimento não pode estar no futuro.");
    expect(patientBirthDateError("1899-12-31", new Date(2026, 6, 25)))
      .toBe("Informe uma data de nascimento válida.");
  });
});

