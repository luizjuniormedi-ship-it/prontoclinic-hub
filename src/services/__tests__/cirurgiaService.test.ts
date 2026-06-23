import { describe, it, expect, vi, beforeEach } from "vitest";
import { cirurgiaService } from "@/services/cirurgiaService";

vi.mock("@/lib/supabase", () => {
  const chain: Record<string, unknown> = {};
  const methods = ["select", "insert", "update", "delete", "eq", "is", "order", "single", "maybeSingle", "limit", "in", "gte", "lte"];
  for (const m of methods) chain[m] = vi.fn().mockReturnThis();
  return {
    supabase: {
      from: vi.fn(() => chain),
      rpc: vi.fn(),
    },
  };
});

import { supabase } from "@/lib/supabase";

describe("cirurgiaService — salas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getAll filtra apenas ativas por padrão", async () => {
    const eqSpy = vi.fn().mockReturnThis();
    const chain = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      eq: eqSpy,
    };
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    await cirurgiaService.salas.getAll();
    expect(eqSpy).toHaveBeenCalledWith("lg_ativa", true);
  });

  it("create valida ds_nome obrigatório", async () => {
    await expect(
      cirurgiaService.salas.create({ ds_nome: "" } as never)
    ).rejects.toThrow();
  });

  it("create aceita sala com tp_sala opcional", async () => {
    const insertSpy = vi.fn((row: unknown) => ({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: 1, ...(row as object) },
          error: null,
        }),
      }),
    }));
    const chain = { insert: insertSpy };
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    const result = await cirurgiaService.salas.create({ ds_nome: "Sala 1", tp_sala: "CIRURGIA_GERAL" });
    expect(result.ds_nome).toBe("Sala 1");
  });
});

describe("cirurgiaService — cirurgias", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("create valida cd_paciente obrigatório", async () => {
    await expect(
      cirurgiaService.cirurgias.create({ cd_paciente: 0, dt_agendamento: "2026-06-22T10:00:00Z" } as never)
    ).rejects.toThrow();
  });

  it("create valida dt_agendamento obrigatório", async () => {
    await expect(
      cirurgiaService.cirurgias.create({ cd_paciente: 1, dt_agendamento: "" } as never)
    ).rejects.toThrow();
  });

  it("iniciar atualiza status para EM_ANDAMENTO", async () => {
    const updateSpy = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 1, tp_status: "EM_ANDAMENTO" }, error: null }) }) }) });
    const chain = { update: updateSpy };
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    const result = await cirurgiaService.cirurgias.iniciar(1);
    expect(result.tp_status).toBe("EM_ANDAMENTO");
  });

  it("adicionarMaterial valida que material ou medicamento é obrigatório", async () => {
    await expect(
      cirurgiaService.cirurgias.adicionarMaterial({ cd_cirurgia: 1 } as never)
    ).rejects.toThrow();
  });
});

describe("cirurgiaService — getAgendaDiaria", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("busca cirurgias em um dia específico", async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
    };
    (chain as any).then = (resolve: any) => resolve({ data: [{ id: 1 }], error: null });
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    const result = await cirurgiaService.cirurgias.getAgendaDiaria("2026-06-22");
    expect(result.length).toBe(1);
  });
});
