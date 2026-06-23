import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  pesquisasService,
  respostasService,
  npsReportsService,
  pesquisaSchema,
  respostaSchema,
  perguntaSchema,
} from "@/services/npsService";

vi.mock("@/lib/supabase", () => {
  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(),
    single: vi.fn(),
  };
  (chain as { then: (r: (v: unknown) => unknown) => unknown }).then = (r) =>
    r({ data: [], error: null });
  return {
    supabase: {
      from: vi.fn(() => chain),
      rpc: vi.fn(),
    },
  };
});

import { supabase } from "@/lib/supabase";

describe("npsService — perguntaSchema (Zod)", () => {
  it("aceita pergunta NPS obrigatória", () => {
    const r = perguntaSchema.safeParse({
      id: "q1",
      texto: "Recomendaria?",
      tipo: "NPS",
      obrigatoria: true,
    });
    expect(r.success).toBe(true);
  });

  it("rejeita tipo inválido", () => {
    const r = perguntaSchema.safeParse({
      id: "q1",
      texto: "x",
      tipo: "INVALIDO",
    });
    expect(r.success).toBe(false);
  });
});

describe("npsService — pesquisaSchema (Zod)", () => {
  it("rejeita pesquisa sem perguntas", () => {
    const r = pesquisaSchema.safeParse({
      ds_titulo: "P1",
      dt_inicio: "2026-01-01",
      cd_template_perguntas: [],
    });
    expect(r.success).toBe(false);
  });

  it("rejeita título curto", () => {
    const r = pesquisaSchema.safeParse({
      ds_titulo: "P",
      dt_inicio: "2026-01-01",
      cd_template_perguntas: [
        { id: "q1", texto: "x", tipo: "NPS" },
      ],
    });
    expect(r.success).toBe(false);
  });
});

describe("npsService — respostaSchema (Zod)", () => {
  it("rejeita nota fora de 0-10", () => {
    const r = respostaSchema.safeParse({
      cd_pesquisa: 1,
      cd_paciente: 1,
      nr_nota_nps: 11,
    });
    expect(r.success).toBe(false);
  });

  it("rejeita nota negativa", () => {
    const r = respostaSchema.safeParse({
      cd_pesquisa: 1,
      cd_paciente: 1,
      nr_nota_nps: -1,
    });
    expect(r.success).toBe(false);
  });

  it("aceita nota válida 0-10", () => {
    for (const nota of [0, 5, 9, 10]) {
      const r = respostaSchema.safeParse({
        cd_pesquisa: 1,
        cd_paciente: 1,
        nr_nota_nps: nota,
      });
      expect(r.success).toBe(true);
    }
  });
});

describe("pesquisasService — getAll", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lista pesquisas ativas por padrão", async () => {
    const eqSpy = vi.fn().mockReturnThis();
    const chain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: eqSpy,
      order: vi.fn().mockReturnThis(),
    };
    (chain as { then: (r: (v: unknown) => unknown) => unknown }).then = (r) =>
      r({ data: [{ id: 1, ds_titulo: "P1" }], error: null });
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    const result = await pesquisasService.getAll();
    expect(eqSpy).toHaveBeenCalledWith("lg_ativo", true);
    expect(result).toHaveLength(1);
  });
});

describe("respostasService — create", () => {
  beforeEach(() => vi.clearAllMocks());

  it("cria resposta com campos opcionais nulos", async () => {
    const chain: Record<string, unknown> = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 1, cd_pesquisa: 1, cd_paciente: 1, nr_nota_nps: 9, tp_promotor: "PROMOTOR" },
        error: null,
      }),
    };
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    const r = await respostasService.create({
      cd_pesquisa: 1,
      cd_paciente: 1,
      nr_nota_nps: 9,
    });
    expect(r.tp_promotor).toBe("PROMOTOR");
  });
});

describe("npsReportsService — getAnalise (fallback)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calcula NPS = %promotores - %detratores (fallback quando view falha)", async () => {
    // Mock view falha
    const viewChain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: "view not found" } }),
    };
    // Mock pesquisa
    const pesquisaChain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 1, ds_titulo: "P1" }, error: null }),
    };
    // Mock respostas (2 promoters, 1 neut, 1 det)
    const respostasChain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    };
    (respostasChain as { then: (r: (v: unknown) => unknown) => unknown }).then = (r) =>
      r({
        data: [
          { id: 1, nr_nota_nps: 10, tp_promotor: "PROMOTOR" },
          { id: 2, nr_nota_nps: 9, tp_promotor: "PROMOTOR" },
          { id: 3, nr_nota_nps: 7, tp_promotor: "NEUTRO" },
          { id: 4, nr_nota_nps: 3, tp_promotor: "DETRATOR" },
        ],
        error: null,
      });
    let fromCall = 0;
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
      fromCall += 1;
      if (fromCall === 1) return viewChain;
      if (fromCall === 2) return respostasChain;
      return pesquisaChain;
    });
    const a = await npsReportsService.getAnalise(1);
    expect(a).not.toBeNull();
    expect(a?.nr_promotores).toBe(2);
    expect(a?.nr_neutros).toBe(1);
    expect(a?.nr_detrators).toBe(1);
    // 50% - 25% = 25
    expect(a?.nr_nps_score).toBe(25);
    // média = (10+9+7+3)/4 = 7.25
    expect(a?.nr_nota_media).toBe(7.3);
  });
});

describe("npsReportsService — getDistribuicaoNotas", () => {
  beforeEach(() => vi.clearAllMocks());

  it("contabiliza notas 0-10 e retorna histograma completo", async () => {
    const chain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    };
    (chain as { then: (r: (v: unknown) => unknown) => unknown }).then = (r) =>
      r({
        data: [
          { nr_nota_nps: 10 },
          { nr_nota_nps: 10 },
          { nr_nota_nps: 5 },
          { nr_nota_nps: 0 },
        ],
        error: null,
      });
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    const dist = await npsReportsService.getDistribuicaoNotas(1);
    expect(dist[10]).toBe(2);
    expect(dist[5]).toBe(1);
    expect(dist[0]).toBe(1);
    expect(dist[1]).toBe(0); // notas não respondidas vêm zeradas
  });
});