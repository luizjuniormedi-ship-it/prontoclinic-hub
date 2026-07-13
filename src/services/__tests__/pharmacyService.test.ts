/**
 * pharmacyService.test.ts
 *
 * Testes unitários do módulo de Farmácia.
 * Cobre os principais métodos do pharmacyService.
 *
 * Cobre:
 *   - medicamentos.getAll com filtros
 *   - lotes.getValidos retorna apenas qt_atual > 0 e status válido
 *   - lotes.getProximosVencimento filtra por dias
 *   - movimentacoes.entrada valida quantidade
 *   - movimentacoes.saida valida estoque suficiente (via RPC)
 *   - dispensacoes.create valida itens
 *   - getEstoqueBaixo filtra por ponto_reposicao
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  pharmacyService,
  medicamentoSchema,
  dispensacaoSchema,
  SNGPC_INTEGRATION_STATUS,
} from "@/services/pharmacyService";

// Mock do Supabase
vi.mock("@/lib/supabase", () => {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn(),
    maybeSingle: vi.fn(),
  };
  return {
    supabase: {
      from: vi.fn(() => chain),
      rpc: vi.fn(),
    },
  };
});

import { supabase } from "@/lib/supabase";

describe("medicamentosService — getAll com filtros", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("aplica filtro search em principio_ativo OU nome_comercial", async () => {
    const orSpy = vi.fn().mockReturnThis();
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      or: orSpy,
    };
    (chain as any).then = (resolve: any) => resolve({ data: [], error: null });
    (supabase.from as any).mockReturnValue(chain);

    await pharmacyService.medicamentos.getAll({ search: "dipirona" });
    expect(orSpy).toHaveBeenCalledWith("cd_principio_ativo.ilike.%dipirona%,cd_nome_comercial.ilike.%dipirona%");
  });

  it("aplica filtro classe terapeutica", async () => {
    const eqSpy = vi.fn().mockReturnThis();
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      eq: eqSpy,
    };
    (chain as any).then = (resolve: any) => resolve({ data: [], error: null });
    (supabase.from as any).mockReturnValue(chain);

    await pharmacyService.medicamentos.getAll({ classe: "ANTIBIOTICO" });
    expect(eqSpy).toHaveBeenCalledWith("cd_classe_terapeutica", "ANTIBIOTICO");
  });

  it("aplica filtro lg_controlado", async () => {
    const eqSpy = vi.fn().mockReturnThis();
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      eq: eqSpy,
    };
    (chain as any).then = (resolve: any) => resolve({ data: [], error: null });
    (supabase.from as any).mockReturnValue(chain);

    await pharmacyService.medicamentos.getAll({ controlado: true });
    expect(eqSpy).toHaveBeenCalledWith("lg_controlado", true);
  });

  it("lança erro se Supabase retornar erro", async () => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
    };
    (chain as any).then = (resolve: any) => resolve({ data: null, error: { message: "DB down" } });
    (supabase.from as any).mockReturnValue(chain);

    await expect(pharmacyService.medicamentos.getAll()).rejects.toThrow(/DB down/);
  });
});

describe("lotesService — getValidos (FEFO)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("filtra apenas status OK, VENCE_30_DIAS, VENCE_90_DIAS (não vencidos)", async () => {
    const inSpy = vi.fn().mockReturnThis();
    const eqSpy = vi.fn().mockReturnThis();
    const orderSpy = vi.fn().mockReturnThis();
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      eq: eqSpy,
      in: inSpy,
      order: orderSpy,
    };
    (chain as any).then = (resolve: any) => resolve({ data: [], error: null });
    (supabase.from as any).mockReturnValue(chain);

    await pharmacyService.lotes.getValidos(1, "MEDICAMENTO");
    expect(eqSpy).toHaveBeenCalledWith("cd_medicamento_id", 1);
    expect(inSpy).toHaveBeenCalledWith("status_validade", ["OK", "VENCE_30_DIAS", "VENCE_90_DIAS"]);
    expect(orderSpy.mock.calls).toEqual([
      ["dt_validade", { ascending: true }],
      ["cd_lote", { ascending: true }],
    ]);
  });

  it("usa cd_material_id para tipo MATERIAL", async () => {
    const eqSpy = vi.fn().mockReturnThis();
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      eq: eqSpy,
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
    };
    (chain as any).then = (resolve: any) => resolve({ data: [], error: null });
    (supabase.from as any).mockReturnValue(chain);

    await pharmacyService.lotes.getValidos(2, "MATERIAL");
    expect(eqSpy).toHaveBeenCalledWith("cd_material_id", 2);
  });
});

describe("lotesService — getProximosVencimento", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calcula data limite e filtra por dt_validade <= limite", async () => {
    const lteSpy = vi.fn().mockReturnThis();
    const orderSpy = vi.fn().mockReturnThis();
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      lte: lteSpy,
      order: orderSpy,
    };
    (chain as any).then = (resolve: any) => resolve({ data: [], error: null });
    (supabase.from as any).mockReturnValue(chain);

    const antes = new Date();
    await pharmacyService.lotes.getProximosVencimento(30);
    const depois = new Date();

    expect(lteSpy).toHaveBeenCalledTimes(1);
    const chamada = lteSpy.mock.calls[0];
    expect(chamada[0]).toBe("dt_validade");
    // Verifica que a data limite é ~hoje + 30 dias
    const dataChamada = new Date(chamada[1] as string);
    const diffDias = Math.round((dataChamada.getTime() - antes.getTime()) / 86400000);
    expect(diffDias).toBeGreaterThanOrEqual(29);
    expect(diffDias).toBeLessThanOrEqual(31);
    expect(orderSpy.mock.calls).toEqual([
      ["dt_validade", { ascending: true }],
      ["cd_lote", { ascending: true }],
    ]);
    void depois;
  });
});

describe("movimentacoesService — entrada (validação)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejeita quantidade zero ou negativa (validação client-side)", async () => {
    await expect(pharmacyService.movimentacoes.entrada(1, 0, "teste")).rejects.toThrow(/inteira positiva/);
    await expect(pharmacyService.movimentacoes.entrada(1, -5, "teste")).rejects.toThrow(/inteira positiva/);
    await expect(pharmacyService.movimentacoes.entrada(1, 1.5, "teste")).rejects.toThrow(/inteira positiva/);
  });

  it("rejeita motivo vazio", async () => {
    await expect(pharmacyService.movimentacoes.entrada(1, 10, "")).rejects.toThrow(/Motivo/);
  });

  it("chama RPC registrar_movimentacao_estoque com tipo ENTRADA", async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: [{ id: 99, qt_anterior: 50, qt_posterior: 60 }],
      error: null,
    });

    const result = await pharmacyService.movimentacoes.entrada(1, 10, "Compra de fornecedor X");
    expect(supabase.rpc).toHaveBeenCalledWith("registrar_movimentacao_estoque", {
      p_lote_id: 1,
      p_tipo: "ENTRADA",
      p_quantidade: 10,
      p_motivo: "Compra de fornecedor X",
    });
    expect(result.id).toBe(99);
    expect(result.qt_posterior).toBe(60);
  });
});

describe("movimentacoesService — saida (valida estoque)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejeita quantidade inválida", async () => {
    await expect(pharmacyService.movimentacoes.saida(1, 0, 5, "teste")).rejects.toThrow(/inteira positiva/);
  });

  it("rejeita pacienteId inválido", async () => {
    await expect(pharmacyService.movimentacoes.saida(1, 10, 0, "teste")).rejects.toThrow(/Paciente/);
  });

  it("propaga erro 'Estoque insuficiente' da RPC", async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: null,
      error: { message: "Estoque insuficiente. Disponível: 5, solicitado: 10" },
    });
    await expect(pharmacyService.movimentacoes.saida(1, 10, 5, "Dispensação")).rejects.toThrow(/Estoque insuficiente/);
  });

  it("chama RPC com tipo SAIDA, dados do paciente e prescrição nula", async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: [{ id: 100, qt_anterior: 30, qt_posterior: 20 }],
      error: null,
    });
    await pharmacyService.movimentacoes.saida(1, 10, 5, "Receita ambulatorial", 99);
    expect(supabase.rpc).toHaveBeenCalledWith("registrar_movimentacao_estoque", {
      p_lote_id: 1,
      p_tipo: "SAIDA",
      p_quantidade: 10,
      p_motivo: "Receita ambulatorial",
      p_paciente_id: 5,
      p_appointment_id: 99,
      p_prescricao_id: null,
    });
  });

  it("rejeita prescrição não canônica antes da RPC", async () => {
    await expect(
      pharmacyService.movimentacoes.saida(1, 10, 5, "Receita ambulatorial", 99, 77),
    ).rejects.toThrow(/Prescrição canônica ainda não está disponível/);

    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});

describe("dispensacoesService — create (validação de itens)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("valida schema Zod: exige ao menos 1 item", () => {
    expect(() =>
      dispensacaoSchema.parse({
        cd_paciente: 1,
        idempotency_key: "11111111-1111-4111-8111-111111111111",
        itens: [],
      }),
    ).toThrow();
  });

  it("valida schema Zod: cd_paciente positivo", () => {
    expect(() =>
      dispensacaoSchema.parse({
        cd_paciente: 0,
        idempotency_key: "11111111-1111-4111-8111-111111111111",
        itens: [{ cd_lote: 1, qt_dispensada: 1 }],
      }),
    ).toThrow();
  });

  it("valida schema Zod: qt_dispensada positivo", () => {
    expect(() =>
      dispensacaoSchema.parse({
        cd_paciente: 1,
        idempotency_key: "11111111-1111-4111-8111-111111111111",
        itens: [{ cd_lote: 1, qt_dispensada: 0 }],
      }),
    ).toThrow();
  });

  it("confirma cabeçalho, itens e estoque por uma única RPC atômica sem prescrição", async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: {
        id: 50,
        company_id: "c1",
        cd_paciente: 1,
        dt_dispensacao: "2026-07-13T12:00:00.000Z",
        cd_usuario: "22222222-2222-4222-8222-222222222222",
        idempotent_replay: false,
      },
      error: null,
    });

    const result = await pharmacyService.dispensacoes.create({
      cd_paciente: 1,
      cd_appointment: 99,
      ds_observacao: "  Receita ambulatorial  ",
      idempotency_key: "11111111-1111-4111-8111-111111111111",
      itens: [
        { cd_lote: 10, qt_dispensada: 5 },
        { cd_lote: 11, qt_dispensada: 3, vl_unitario: 4.5 },
      ],
    });

    expect(result.id).toBe(50);
    expect(supabase.rpc).toHaveBeenCalledOnce();
    expect(supabase.rpc).toHaveBeenCalledWith("dispensar_estoque", {
      p_idempotency_key: "11111111-1111-4111-8111-111111111111",
      p_paciente_id: 1,
      p_itens: [
        { cd_lote: 10, qt_dispensada: 5 },
        { cd_lote: 11, qt_dispensada: 3 },
      ],
      p_appointment_id: 99,
      p_prescricao_id: null,
      p_observacao: "Receita ambulatorial",
    });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("rejeita cd_prescricao_id antes da RPC enquanto não há prescrição canônica", async () => {
    await expect(pharmacyService.dispensacoes.create({
      cd_paciente: 1,
      cd_prescricao_id: 77,
      idempotency_key: "11111111-1111-4111-8111-111111111111",
      itens: [{ cd_lote: 10, qt_dispensada: 1 }],
    })).rejects.toThrow(/Prescrição canônica ainda não está disponível/);

    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("propaga o erro real da RPC sem rollback ou escrita alternativa", async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: null,
      error: { message: "Estoque insuficiente no lote 10" },
    });

    await expect(pharmacyService.dispensacoes.create({
      cd_paciente: 1,
      idempotency_key: "11111111-1111-4111-8111-111111111111",
      itens: [{ cd_lote: 10, qt_dispensada: 5 }],
    })).rejects.toThrow("Estoque insuficiente no lote 10");

    expect(supabase.rpc).toHaveBeenCalledOnce();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("falha fechado quando a RPC não comprova o commit", async () => {
    (supabase.rpc as any).mockResolvedValue({ data: null, error: null });

    await expect(pharmacyService.dispensacoes.create({
      cd_paciente: 1,
      idempotency_key: "11111111-1111-4111-8111-111111111111",
      itens: [{ cd_lote: 10, qt_dispensada: 1 }],
    })).rejects.toThrow("Resposta inválida ao confirmar dispensação");
  });
});

describe("receitasControladasService — SNGPC", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("declara integração pendente e nunca marca receita como enviada localmente", async () => {
    expect(pharmacyService.receitasControladas.integrationStatus).toEqual(
      SNGPC_INTEGRATION_STATUS,
    );
    expect(SNGPC_INTEGRATION_STATUS.integrated).toBe(false);
    expect(SNGPC_INTEGRATION_STATUS.state).toBe("PENDENTE_INTEGRACAO");

    await expect(pharmacyService.receitasControladas.enviarSNGPC(42))
      .rejects.toThrow(/não integrado/i);

    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});

describe("pharmacyReportsService — getEstoqueBaixo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna apenas materiais com qt_atual <= ponto_reposicao", async () => {
    // Mock da view v_estoque_atual
    const viewChain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    };
    (viewChain as any).then = (resolve: any) =>
      resolve({
        data: [
          { cd_lote: 1, cd_produto_tipo: "MATERIAL", cd_material_id: 10, ds_produto: "Seringa 5mL", qt_atual: 100 },
          { cd_lote: 2, cd_produto_tipo: "MATERIAL", cd_material_id: 11, ds_produto: "Luva M", qt_atual: 50 },
        ],
        error: null,
      });
    (supabase.from as any).mockReturnValueOnce(viewChain);

    // Mock da query de materiais com ponto_reposicao
    const matChain: any = {
      select: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
    };
    (matChain as any).then = (resolve: any) =>
      resolve({
        data: [
          { id: 10, ds_nome: "Seringa 5mL", ponto_reposicao: 200 }, // 100 < 200 → ABAIXO
          { id: 11, ds_nome: "Luva M", ponto_reposicao: 2000 }, // 50 < 2000 → ABAIXO
        ],
        error: null,
      });
    (supabase.from as any).mockReturnValueOnce(matChain);

    const resultado = await pharmacyService.reports.getEstoqueBaixo();
    expect(resultado).toHaveLength(2);
    // Ordenado por menor saldo relativo (mais crítico primeiro):
    // Luva M: 50/2000 = 0.025 (mais crítico)
    // Seringa 5mL: 100/200 = 0.5
    expect(resultado[0].descricao).toBe("Luva M");
    expect(resultado[1].descricao).toBe("Seringa 5mL");
    // Verifica ordenação por menor saldo relativo
    expect(resultado[0].qt_atual / resultado[0].ponto_reposicao)
      .toBeLessThanOrEqual(resultado[1].qt_atual / resultado[1].ponto_reposicao);
  });
});

describe("medicamentoSchema (Zod)", () => {
  it("aceita payload mínimo válido", () => {
    const result = medicamentoSchema.parse({ cd_principio_ativo: "Dipirona" });
    expect(result.lg_ativo).toBe(true);
    expect(result.lg_generico).toBe(false);
  });

  it("rejeita principio_ativo com menos de 2 chars", () => {
    expect(() => medicamentoSchema.parse({ cd_principio_ativo: "A" })).toThrow();
  });

  it("rejeita tp_receita inválido", () => {
    expect(() =>
      medicamentoSchema.parse({ cd_principio_ativo: "Dipirona", tp_receita: "INVALIDO" }),
    ).toThrow();
  });

  it("aceita todos os 5 tipos de receita", () => {
    for (const tp of ["BRANCA", "AZUL", "AMARELA", "VERMELHA", "CONTROLE_ESPECIAL"]) {
      const result = medicamentoSchema.parse({ cd_principio_ativo: "DIP", tp_receita: tp });
      expect(result.tp_receita).toBe(tp);
    }
  });
});

