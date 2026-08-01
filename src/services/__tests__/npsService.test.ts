import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  pesquisasService,
  respostasService,
  npsReportsService,
  convitesService,
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
      token: "a".repeat(64),
      nr_nota_nps: 11,
    });
    expect(r.success).toBe(false);
  });

  it("rejeita nota negativa", () => {
    const r = respostaSchema.safeParse({
      token: "a".repeat(64),
      nr_nota_nps: -1,
    });
    expect(r.success).toBe(false);
  });

  it("aceita nota válida 0-10", () => {
    for (const nota of [0, 5, 9, 10]) {
      const r = respostaSchema.safeParse({
        token: "a".repeat(64),
        nr_nota_nps: nota,
      });
      expect(r.success).toBe(true);
    }
  });

  it("rejeita identificador numérico legado como token", () => {
    const r = respostaSchema.safeParse({
      token: "123",
      nr_nota_nps: 10,
    });
    expect(r.success).toBe(false);
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

  it("envia a resposta apenas pelo RPC público fail-closed", async () => {
    (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: 91,
      error: null,
    });
    const r = await respostasService.create({
      token: "b".repeat(64),
      nr_nota_nps: 9,
    });
    expect(r.id).toBe(91);
    expect(supabase.rpc).toHaveBeenCalledWith("submit_nps_response_public", {
      p_token: "b".repeat(64),
      p_nota: 9,
      p_comentario: null,
      p_respostas: null,
    });
    expect(supabase.from).not.toHaveBeenCalledWith("nps_respostas");
  });

  it("não expõe detalhes internos quando o token falha", async () => {
    (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null,
      error: { message: "duplicate key value violates unique constraint" },
    });
    await expect(
      respostasService.create({
        token: "c".repeat(64),
        nr_nota_nps: 8,
      }),
    ).rejects.toThrow("Este link é inválido, expirou ou já foi utilizado.");
  });
});

describe("pesquisasService — acesso público", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolve pesquisa somente pelo token opaco", async () => {
    (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [{ ds_titulo: "Atendimento", ds_descricao: null, cd_template_perguntas: [] }],
      error: null,
    });
    const pesquisa = await pesquisasService.getPublicByToken("d".repeat(64));
    expect(pesquisa?.ds_titulo).toBe("Atendimento");
    expect(supabase.rpc).toHaveBeenCalledWith("get_nps_survey_public", {
      p_token: "d".repeat(64),
    });
    expect(supabase.from).not.toHaveBeenCalledWith("nps_pesquisas");
  });
});

describe("convitesService — create", () => {
  beforeEach(() => vi.clearAllMocks());

  it("gera convite autenticado com validade limitada", async () => {
    (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: "e".repeat(64),
      error: null,
    });
    const token = await convitesService.create({
      cd_pesquisa: 7,
      cd_paciente: 11,
      cd_appointment: 13,
      ds_origem: "WHATSAPP",
      ttl_days: 5,
    });
    expect(token).toBe("e".repeat(64));
    expect(supabase.rpc).toHaveBeenCalledWith("create_nps_invitation_secure", {
      p_pesquisa_id: 7,
      p_paciente_id: 11,
      p_appointment_id: 13,
      p_origem: "WHATSAPP",
      p_ttl: "5 days",
    });
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
