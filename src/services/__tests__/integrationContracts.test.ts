import { describe, expect, it } from "vitest";
import { getIntegrationContract, operationalIntegrationContracts } from "@/services/integrationContracts";

describe("operational integration contracts", () => {
  it("declares preconditions and postconditions for every backend-dependent flow", () => {
    expect(operationalIntegrationContracts).toHaveLength(5);
    for (const contract of operationalIntegrationContracts) {
      expect(contract.requiredTables.length + contract.requiredRpcs.length).toBeGreaterThan(0);
      expect(contract.preconditions.length).toBeGreaterThan(0);
      expect(contract.postconditions.length).toBeGreaterThan(0);
    }
  });

  it("exposes the billing idempotency contract", () => {
    const contract = getIntegrationContract("attendance.record-billing");
    expect(contract?.requiredTables).toContain("billings");
    expect(contract?.postconditions.join(" ")).toMatch(/at most one billing/i);
  });

  it("mapeia a presença da baseline dos quatro fluxos MVP", () => {
    const expected: Record<string, { comprovada: number; ausente: number; runtime: number }> = {
      "agenda.read-write": { comprovada: 13, ausente: 2, runtime: 0 },
      "callcenter.contacts-confirmations": { comprovada: 2, ausente: 5, runtime: 0 },
      "attendance.record-billing": { comprovada: 7, ausente: 0, runtime: 1 },
      "billing.accounts-pending": { comprovada: 2, ausente: 7, runtime: 0 },
    };

    for (const [id, counts] of Object.entries(expected)) {
      const resources = getIntegrationContract(id)?.baselineResources || [];
      expect(resources.filter((resource) => resource.status === "comprovada")).toHaveLength(counts.comprovada);
      expect(resources.filter((resource) => resource.status === "ausente")).toHaveLength(counts.ausente);
      expect(resources.filter((resource) => resource.status === "dependente-runtime")).toHaveLength(counts.runtime);
    }
  });
});
