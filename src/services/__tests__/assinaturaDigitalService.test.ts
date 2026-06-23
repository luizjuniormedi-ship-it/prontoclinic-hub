import { describe, it, expect, vi, beforeEach } from "vitest";
import { assinaturaDigitalService, certificadoValido, sha256 } from "@/services/assinaturaDigitalService";

vi.mock("@/lib/supabase", () => {
  const chain: Record<string, unknown> = {};
  const methods = ["select", "insert", "update", "delete", "eq", "is", "order", "single", "maybeSingle", "limit"];
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

describe("assinaturaDigitalService — sha256", () => {
  it("produz hash SHA-256 hex de 64 chars", async () => {
    const hash = await sha256("hello world");
    expect(hash).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
    expect(hash.length).toBe(64);
    expect(/^[a-f0-9]+$/.test(hash)).toBe(true);
  });

  it("hash diferente para entradas diferentes", async () => {
    const a = await sha256("foo");
    const b = await sha256("bar");
    expect(a).not.toBe(b);
  });
});

describe("assinaturaDigitalService — certificadoValido", () => {
  it("certificado dentro da validade e não revogado é válido", () => {
    const hoje = new Date();
    const amanha = new Date(hoje.getTime() + 86400_000);
    const ontem = new Date(hoje.getTime() - 86400_000);
    expect(
      certificadoValido({
        id: 1,
        company_id: "c1",
        cd_profissional: 1,
        tp_certificado: "A1",
        nr_serie: "X",
        dt_validade_inicio: ontem.toISOString().slice(0, 10),
        dt_validade_fim: amanha.toISOString().slice(0, 10),
        lg_ativo: true,
        lg_revogado: false,
        dt_revogacao: null,
        ds_motivo_revogacao: null,
        created_at: new Date().toISOString(),
      } as never),
    ).toBe(true);
  });

  it("certificado revogado não é válido", () => {
    const hoje = new Date();
    const amanha = new Date(hoje.getTime() + 86400_000);
    const ontem = new Date(hoje.getTime() - 86400_000);
    expect(
      certificadoValido({
        id: 1,
        company_id: "c1",
        cd_profissional: 1,
        tp_certificado: "A1",
        nr_serie: "X",
        dt_validade_inicio: ontem.toISOString().slice(0, 10),
        dt_validade_fim: amanha.toISOString().slice(0, 10),
        lg_ativo: true,
        lg_revogado: true,
        dt_revogacao: hoje.toISOString(),
        ds_motivo_revogacao: "roubo",
        created_at: new Date().toISOString(),
      } as never),
    ).toBe(false);
  });
});

describe("assinaturaDigitalService — certificados CRUD", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("create valida campos obrigatórios", async () => {
    await expect(
      assinaturaDigitalService.certificados.create({ cd_profissional: 0, tp_certificado: "A1", nr_serie: "" } as never)
    ).rejects.toThrow();
  });

  it("create valida dt_validade_fim > dt_validade_inicio", async () => {
    await expect(
      assinaturaDigitalService.certificados.create({
        cd_profissional: 1,
        tp_certificado: "A1",
        nr_serie: "X",
        dt_validade_inicio: "2026-12-31",
        dt_validade_fim: "2026-01-01",
        lg_ativo: true,
      } as never),
    ).rejects.toThrow(/posterior/);
  });

  it("create aceita certificado com todos os campos válidos", async () => {
    const chain = {
      insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 1, nr_serie: "ABC" }, error: null }) }) }),
    };
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    const result = await assinaturaDigitalService.certificados.create({
      cd_profissional: 1,
      tp_certificado: "A1",
      nr_serie: "ABC",
      dt_validade_inicio: "2026-01-01",
      dt_validade_fim: "2027-01-01",
      lg_ativo: true,
    });
    expect(result.nr_serie).toBe("ABC");
  });

  it("create documento valida hash SHA-256 (64 hex)", async () => {
    await expect(
      assinaturaDigitalService.documentos.create({
        cd_certificado: 1,
        cd_profissional: 1,
        tp_documento: "RECEITA",
        ds_hash_documento: "invalido",
        ds_hash_assinatura: "x",
        ds_assinatura_p7s: "x",
        lg_consentimento: true as never,
      } as never),
    ).rejects.toThrow();
  });
});
