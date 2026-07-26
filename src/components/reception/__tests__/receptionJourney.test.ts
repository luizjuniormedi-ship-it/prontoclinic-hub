import { describe, expect, it } from "vitest";
import {
  buildReceptionJourney,
  getBlockingReceptionIssues,
} from "@/components/reception/receptionJourney";
import type { CheckinIssue, CheckinReadiness } from "@/services/receptionService";

function issue(overrides: Partial<CheckinIssue> & Pick<CheckinIssue, "type" | "description">): CheckinIssue {
  return {
    severity: "warning",
    step: "general",
    blocking: false,
    resolution_action: null,
    owner: null,
    impact: null,
    legacy_fallback: false,
    ...overrides,
  };
}

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
        issue({
          type: "registration",
          severity: "blocking",
          description: "Cadastro incompleto",
          step: "registration",
          blocking: true,
        }),
        issue({
          type: "authorization",
          severity: "blocking",
          description: "Autorização pendente",
          step: "authorization",
          blocking: true,
        }),
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

  it("preserva e exibe todas as pendências da mesma etapa", () => {
    const steps = buildReceptionJourney(readiness({
      ready: false,
      issues: [
        issue({
          type: "tiss_guide_invalid",
          description: "Guia inválida",
          step: "tiss",
          blocking: true,
        }),
        issue({
          type: "tiss_signature_missing",
          description: "Método de assinatura ausente",
          step: "tiss",
          blocking: true,
        }),
      ],
    }));

    const tiss = steps.find((step) => step.id === "tiss");
    expect(tiss).toEqual(expect.objectContaining({
      status: "attention",
      description: "2 pendências nesta etapa.",
    }));
    expect(tiss?.issues.map((entry) => entry.type)).toEqual([
      "tiss_guide_invalid",
      "tiss_signature_missing",
    ]);
  });

  it.each([
    ["billing_not_prepared", "billing"],
    ["payment_pending", "billing"],
    ["cash_session_required", "billing"],
    ["tiss_guide_invalid", "tiss"],
    ["tiss_signature_missing", "tiss"],
  ] as const)("reconhece %s na etapa %s", (type, stepId) => {
    const steps = buildReceptionJourney(readiness({
      ready: false,
      issues: [issue({
        type,
        description: `Pendência ${type}`,
        step: stepId,
        blocking: true,
      })],
    }));

    expect(steps.find((step) => step.id === stepId)?.issues[0].type).toBe(type);
  });

  it("mantém tipos desconhecidos visíveis na identificação", () => {
    const steps = buildReceptionJourney(readiness({
      ready: false,
      issues: [issue({
        type: "legacy_unknown",
        description: "Pendência legada desconhecida",
        step: "general",
        legacy_fallback: true,
      })],
    }));

    expect(steps.find((step) => step.id === "identification")).toEqual(expect.objectContaining({
      status: "attention",
      issues: [expect.objectContaining({ type: "legacy_unknown" })],
    }));
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
        issue({
          type: "registration",
          severity: "warning",
          description: "Cadastro incompleto",
          step: "registration",
          blocking: true,
        }),
        issue({
          type: "phone",
          severity: "blocking",
          description: "Telefone ausente",
          step: "registration",
          blocking: false,
        }),
      ],
    }));

    expect(blocking).toHaveLength(1);
    expect(blocking[0].type).toBe("registration");
  });
});
