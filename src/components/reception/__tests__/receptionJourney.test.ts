import { describe, expect, it } from "vitest";
import {
  buildReceptionJourney,
  getBlockingReceptionIssues,
} from "@/components/reception/receptionJourney";
import type { CheckinReadiness } from "@/services/receptionService";

function readiness(overrides: Partial<CheckinReadiness> = {}): CheckinReadiness {
  return {
    appointment_id: 10,
    patient_id: 20,
    ready: true,
    issues: [],
    has_authorization_pending: false,
    has_document_pending: false,
    ...overrides,
  };
}

describe("reception journey", () => {
  it("mantém somente o destino pendente quando o paciente está pronto", () => {
    const steps = buildReceptionJourney(readiness());

    expect(steps.find((step) => step.id === "identification")?.status).toBe("complete");
    expect(steps.find((step) => step.id === "registration")?.status).toBe("complete");
    expect(steps.find((step) => step.id === "eligibility")?.status).toBe("complete");
    expect(steps.find((step) => step.id === "authorization")?.status).toBe("complete");
    expect(steps.find((step) => step.id === "destination")?.status).toBe("pending");
  });

  it("mapeia pendências para a etapa correta", () => {
    const steps = buildReceptionJourney(readiness({
      ready: false,
      issues: [
        { type: "registration", severity: "blocking", description: "Cadastro incompleto" },
        { type: "authorization", severity: "blocking", description: "Autorização pendente" },
      ],
      has_authorization_pending: true,
      has_document_pending: true,
    }));

    expect(steps.find((step) => step.id === "registration")).toEqual(expect.objectContaining({
      status: "attention",
      description: "Cadastro incompleto",
    }));
    expect(steps.find((step) => step.id === "authorization")).toEqual(expect.objectContaining({
      status: "attention",
      description: "Autorização pendente",
    }));
    expect(steps.find((step) => step.id === "eligibility")?.status).toBe("complete");
  });

  it("deixa etapas não validadas como pendentes durante o carregamento", () => {
    const steps = buildReceptionJourney(null);

    expect(steps.find((step) => step.id === "identification")?.status).toBe("complete");
    expect(steps.filter((step) => step.id !== "identification").every((step) => step.status === "pending")).toBe(true);
  });

  it("retorna apenas pendências bloqueantes", () => {
    const blocking = getBlockingReceptionIssues(readiness({
      ready: false,
      issues: [
        { type: "registration", severity: "blocking", description: "Cadastro incompleto" },
        { type: "phone", severity: "warning", description: "Telefone ausente" },
      ],
    }));

    expect(blocking).toHaveLength(1);
    expect(blocking[0].type).toBe("registration");
  });
});
