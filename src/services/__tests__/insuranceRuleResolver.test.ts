import { describe, expect, it } from "vitest";
import { selectInsuranceRule, type InsuranceRuleCandidate } from "../insuranceRuleResolver";

const base: InsuranceRuleCandidate = {
  contractId: "contract-default",
  versionId: "version-default",
  insuranceCompanyId: 10,
  versionNo: 1,
  validFrom: "2026-01-01",
  status: "active",
};

describe("selectInsuranceRule", () => {
  it("seleciona a regra específica da unidade antes do fallback corporativo", () => {
    const result = selectInsuranceRule(
      [base, { ...base, contractId: "contract-unit-2", versionId: "version-unit-2", unitId: 2 }],
      { insuranceCompanyId: 10, unitId: 2, referenceDate: "2026-07-22" },
    );
    expect(result?.contractId).toBe("contract-unit-2");
  });

  it("prioriza plano e profissional compatíveis sem cruzar unidade", () => {
    const result = selectInsuranceRule(
      [
        { ...base, contractId: "wrong-unit", unitId: 9, planId: 30, professionalIds: [7] },
        { ...base, contractId: "plan-and-professional", unitId: 2, planId: 30, professionalIds: [7], versionNo: 2 },
        { ...base, contractId: "plan-fallback", planId: 30, versionNo: 3 },
      ],
      { insuranceCompanyId: 10, planId: 30, unitId: 2, professionalId: 7, referenceDate: "2026-07-22" },
    );
    expect(result?.contractId).toBe("plan-and-professional");
  });

  it("retorna null quando a regra está fora da vigência", () => {
    expect(
      selectInsuranceRule([{ ...base, validTo: "2026-07-01" }], {
        insuranceCompanyId: 10,
        unitId: 1,
        referenceDate: "2026-07-22",
      }),
    ).toBeNull();
  });
});
