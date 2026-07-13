import { describe, it, expect, vi, beforeEach } from "vitest";
import { iaClinicaService, sha256 } from "@/services/iaClinicaService";

vi.mock("@/lib/supabase", () => {
  const chain: Record<string, unknown> = {};
  const methods = ["select", "insert", "update", "delete", "eq", "is", "order", "single", "maybeSingle", "limit", "ilike", "gte"];
  for (const m of methods) chain[m] = vi.fn().mockReturnThis();
  return {
    supabase: {
      from: vi.fn(() => chain),
      rpc: vi.fn(),
      functions: { invoke: vi.fn() },
    },
  };
});

import { supabase } from "@/lib/supabase";

describe("iaClinicaService — sha256 (LGPD)", () => {
  it("produz hash SHA-256 de 64 chars hex", async () => {
    const h = await sha256("febre tosse");
    expect(h).toHaveLength(64);
    expect(/^[a-f0-9]+$/.test(h)).toBe(true);
  });
});

describe("iaClinicaService — schemas e validação", () => {
  it("sugerirCid valida consentimento LGPD obrigatório", async () => {
    await expect(
      iaClinicaService.sugerirCid({ sintomas: "febre", consentimento: false as never })
    ).rejects.toThrow();
  });

  it("sugerirCid valida tamanho mínimo dos sintomas", async () => {
    await expect(
      iaClinicaService.sugerirCid({ sintomas: "ab", consentimento: true })
    ).rejects.toThrow();
  });

  it("chatbot valida consentimento LGPD", async () => {
    await expect(
      iaClinicaService.chatbot({ mensagem: "oi", consentimento: false as never })
    ).rejects.toThrow();
  });
});

describe("iaClinicaService — fluxo Edge Function", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sugerirCid faz fallback para lookup local se Edge Function falhar", async () => {
    // Mock Edge Function com erro
    (supabase.functions.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null,
      error: { message: "Edge Function indisponível" },
    });
    // Mock lookup local
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
    };
    (chain as any).then = (resolve: any) =>
      resolve({ data: [{ id: 1, ds_sintomas: "febre", nr_confianca: 0.85 }], error: null });
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    // Mock log LGPD
    const logChain = {
      insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 1 }, error: null }) }) }),
    };
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      if (table === "ia_logs") return logChain;
      return chain;
    });

    const result = await iaClinicaService.sugerirCid({
      sintomas: "febre alta",
      consentimento: true,
    });
    expect(result.modelo).toBe("lookup_local");
    expect(result.sugestoes.length).toBeGreaterThanOrEqual(0);
  });

  it("chatbot falha fechado e registra tentativa sem resposta simulada", async () => {
    (supabase.functions.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null,
      error: { message: "Edge Function indisponível" },
    });
    const logInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: 2 }, error: null }),
      }),
    });
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockImplementation((table: string) =>
      table === "ia_logs" ? { insert: logInsert } : {},
    );

    await expect(
      iaClinicaService.chatbot({ mensagem: "Tenho febre", consentimento: true }),
    ).rejects.toThrow("serviço de chatbot não respondeu");
    expect(logInsert).toHaveBeenCalledWith(
      expect.objectContaining({ ds_resposta: null, ds_modelo: "unavailable" }),
    );
  });

  it("iaLogs.create valida lg_consentimento=true (LGPD)", async () => {
    await expect(
      iaClinicaService.logs.create({
        tp_consulta: "CHATBOT",
        ds_query: "x",
        lg_consentimento: false,
      } as never),
    ).rejects.toThrow(/consentimento/);
  });
});
