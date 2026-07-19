import { describe, expect, it } from "vitest";
import { MVP_FLOW_CONTRACTS } from "@/config/mvpFlowContracts";

describe("MVP flow contracts", () => {
  it("declares exactly the seven user-facing MVP flows", () => {
    expect(MVP_FLOW_CONTRACTS).toHaveLength(7);
    expect(new Set(MVP_FLOW_CONTRACTS.map((flow) => flow.id)).size).toBe(7);
  });

  it("requires functional acceptance, permission, states, recovery, tests and backend dependencies", () => {
    for (const flow of MVP_FLOW_CONTRACTS) {
      expect(flow.functionalAcceptance).toBeTruthy();
      expect(flow.permissions).toBeTruthy();
      expect(flow.states.length).toBeGreaterThan(1);
      expect(flow.errorRecovery).toBeTruthy();
      expect(flow.focusedTests.length).toBeGreaterThan(0);
      expect(flow.backendDependencies.length).toBeGreaterThan(0);
      expect(["confirmed-local", "partial-local", "divergent", "blocked"]).toContain(flow.baselineStatus);
      expect(flow.baselineEvidence).toBeTruthy();
    }
  });

  it("explicita divergencias e bloqueios conhecidos da baseline local", () => {
    expect(MVP_FLOW_CONTRACTS.find((flow) => flow.id === "schedule")?.baselineStatus).toBe("divergent");
    expect(MVP_FLOW_CONTRACTS.find((flow) => flow.id === "callcenter")?.baselineStatus).toBe("blocked");
    expect(MVP_FLOW_CONTRACTS.find((flow) => flow.id === "billing")?.baselineStatus).toBe("blocked");
  });
});
