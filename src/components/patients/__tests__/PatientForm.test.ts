import { describe, expect, it } from "vitest";
import { normalizeInsurancePlanId } from "@/components/patients/patientFormUtils";

describe("normalizeInsurancePlanId", () => {
  it("normaliza o ID numérico retornado pelo banco para o valor string do formulário", () => {
    expect(normalizeInsurancePlanId(840040)).toBe("840040");
  });

  it("normaliza plano ausente para string vazia", () => {
    expect(normalizeInsurancePlanId(null)).toBe("");
  });
});
