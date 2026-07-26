import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/lib/supabase";
import {
  normalizeCheckinIssue,
  receptionService,
} from "@/services/receptionService";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("receptionService readiness", () => {
  it("preserva issue estruturada retornada pelo backend", () => {
    const issue = normalizeCheckinIssue({
      type: "payment_pending",
      severity: "blocking",
      description: "Pagamento pendente",
      step: "billing",
      blocking: true,
      resolution_action: "Registrar ou encaminhar o pagamento",
      owner: "Recepção",
      impact: "Bloqueia o check-in",
    });

    expect(issue).toEqual({
      type: "payment_pending",
      severity: "blocking",
      description: "Pagamento pendente",
      step: "billing",
      blocking: true,
      resolution_action: "Registrar ou encaminhar o pagamento",
      owner: "Recepção",
      impact: "Bloqueia o check-in",
      legacy_fallback: false,
    });
  });

  it.each([
    ["billing_not_prepared", "billing"],
    ["payment_pending", "billing"],
    ["cash_session_required", "billing"],
    ["tiss_guide_invalid", "tiss"],
    ["tiss_signature_missing", "tiss"],
  ] as const)("aplica fallback explícito de %s para %s", (type, step) => {
    const issue = normalizeCheckinIssue({
      type,
      severity: "blocking",
      description: "Pendência legada",
    });

    expect(issue.step).toBe(step);
    expect(issue.blocking).toBe(true);
    expect(issue.legacy_fallback).toBe(true);
  });

  it("mantém tipo legado desconhecido visível na etapa geral", () => {
    expect(normalizeCheckinIssue({
      type: "legacy_unknown",
      description: "Pendência desconhecida",
    })).toEqual(expect.objectContaining({
      step: "general",
      legacy_fallback: true,
      blocking: false,
    }));
  });

  it("normaliza readiness e checkout antes de expor à interface", async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: {
        appointment_id: 101,
        patient_id: 5,
        ready: false,
        issues: [{
          type: "billing_not_prepared",
          severity: "blocking",
          description: "Pré-conta ausente",
        }],
        checkout: {
          prepared: "false",
          cash_session_open: "false",
        },
      },
      error: null,
    } as never);

    const result = await receptionService.getReadiness("101");

    expect(result.ready).toBe(false);
    expect(result.issues[0]).toEqual(expect.objectContaining({
      step: "billing",
      blocking: true,
      legacy_fallback: true,
    }));
    expect(result.checkout?.prepared).toBe(false);
    expect(result.checkout?.cash_session_open).toBe(false);
  });

  it("normaliza issues devolvidas pelo check-in", async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: {
        checkin_id: 88,
        ticket_id: 99,
        ticket: "R-001",
        released_by_exception: false,
        issues: [{
          type: "payment_pending",
          severity: "blocking",
          description: "Pagamento pendente",
        }],
      },
      error: null,
    } as never);

    const result = await receptionService.checkin("101", "normal");

    expect(result.issues[0]).toEqual(expect.objectContaining({
      step: "billing",
      blocking: true,
      legacy_fallback: true,
    }));
  });
});
