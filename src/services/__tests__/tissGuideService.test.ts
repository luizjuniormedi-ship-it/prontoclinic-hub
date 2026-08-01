import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));

import {
  assertSignedGuideImmutable,
  canTransitionTissGuide,
  tissGuideService,
  validateTissGuideDraft,
} from "@/services/tissGuideService";

describe("tissGuideService — M16", () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it("valida tipos, versao e ambiente antes de criar", () => {
    expect(validateTissGuideDraft({ guideType: "SP/SADT", tissVersion: "4.03.00", environment: "HOMOLOGACAO" })).toEqual([]);
    expect(validateTissGuideDraft({ guideType: "INVALID", tissVersion: "", environment: "LOCAL" })).toEqual([
      "Tipo de guia TISS invalido",
      "Versao TISS obrigatoria",
      "Ambiente TISS invalido",
    ]);
  });

  it("aceita apenas transicoes lineares e encerra a guia assinada", () => {
    expect(canTransitionTissGuide("DRAFT", "VALIDATED")).toBe(true);
    expect(canTransitionTissGuide("VALIDATED", "SIGNED")).toBe(true);
    expect(canTransitionTissGuide("DRAFT", "SIGNED")).toBe(false);
    expect(canTransitionTissGuide("SIGNED", "DRAFT")).toBe(false);
    expect(() => assertSignedGuideImmutable({ status: "SIGNED" }, { status: "SIGNED" })).not.toThrow();
    expect(() => assertSignedGuideImmutable({ status: "SIGNED" }, { status: "DRAFT" })).toThrow();
  });

  it("cria guia sem aceitar company_id do navegador e usa RPC protegido", async () => {
    rpc.mockResolvedValue({ data: { id: "guide-1", status: "DRAFT" }, error: null });

    await tissGuideService.create({
      guideType: "SP/SADT",
      appointmentId: 42,
      billingAccountId: "billing-1",
    });

    expect(rpc).toHaveBeenCalledWith("create_tiss_guide_secure", expect.objectContaining({
      p_guide_type: "SP/SADT",
      p_appointment_id: 42,
      p_billing_account_id: "billing-1",
    }));
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_company_id");
  });

  it("lista guias exclusivamente pela projeção segura do tenant ativo", async () => {
    rpc.mockResolvedValue({
      data: [{
        id: "guide-1",
        status: "DRAFT",
        guide_type: "SP/SADT",
        guide_number: 10,
        tiss_version: "4.03.00",
        environment: "HOMOLOGACAO",
      }],
      error: null,
    });

    const result = await tissGuideService.list("company-1");

    expect(rpc).toHaveBeenCalledWith("m16_list_guides_secure", {
      p_status: null,
      p_limit: 500,
    });
    expect(result[0]).toMatchObject({
      id: "guide-1",
      company_id: "company-1",
      validation_errors: [],
    });
  });

  it("encadeia validacao, assinatura, cancelamento e substituicao por RPC", async () => {
    rpc.mockResolvedValue({ data: { id: "guide-1", status: "SIGNED" }, error: null });

    await tissGuideService.validate("guide-1");
    await tissGuideService.sign("guide-1", "a".repeat(64), "fixture-signature");
    await tissGuideService.cancel("guide-1", "Cancelamento de teste");
    await tissGuideService.substitute("guide-1", "Correção de teste");

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "validate_tiss_guide_secure",
      "sign_tiss_guide_secure",
      "cancel_tiss_guide_secure",
      "substitute_tiss_guide_secure",
    ]);
  });

  it("bloqueia assinatura sem hash e propaga erro do backend", async () => {
    await expect(tissGuideService.sign("guide-1", "curto")).rejects.toThrow("Hash de assinatura obrigatorio");
    rpc.mockResolvedValue({ data: null, error: { message: "guia fora do tenant" } });
    await expect(tissGuideService.validate("guide-1")).rejects.toThrow("guia fora do tenant");
  });
});

