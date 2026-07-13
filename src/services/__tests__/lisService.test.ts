/**
 * Testes do módulo LIS — classificar, parseHL7, pedido.create
 *
 * Cobre:
 *  - classificar: NORMAL, ALTO, BAIXO, CRITICO_BAIXO, CRITICO_ALTO, INCONCLUSIVO
 *  - parseHL7: extrai OBX, PID, OBR, MSH
 *  - pedido.create: valida que precisa ter ao menos 1 item
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { classificar, parseHL7, pedido, resultado } from "@/services/lisService";

vi.mock("@/lib/supabase", () => {
  const chain = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
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

describe("lisService — classificar()", () => {
  it("retorna NORMAL quando valor está dentro do range", () => {
    expect(classificar(80, 70, 99)).toBe("NORMAL");
    expect(classificar(70, 70, 99)).toBe("NORMAL");
    expect(classificar(99, 70, 99)).toBe("NORMAL");
  });

  it("retorna ALTO quando valor está acima do máximo", () => {
    expect(classificar(120, 70, 99)).toBe("ALTO");
    expect(classificar(140, 70, 99)).toBe("ALTO");
  });

  it("retorna BAIXO quando valor está abaixo do mínimo", () => {
    expect(classificar(60, 70, 99)).toBe("BAIXO");
    expect(classificar(40, 70, 99)).toBe("BAIXO");
  });

  it("retorna CRITICO_ALTO quando valor está 50% acima do máximo", () => {
    // 99 * 1.5 = 148.5, então 150 é crítico alto
    expect(classificar(150, 70, 99)).toBe("CRITICO_ALTO");
    expect(classificar(500, 70, 99)).toBe("CRITICO_ALTO");
  });

  it("retorna CRITICO_BAIXO quando valor está 50% abaixo do mínimo", () => {
    // 70 * 0.5 = 35, então 30 é crítico baixo
    expect(classificar(30, 70, 99)).toBe("CRITICO_BAIXO");
    expect(classificar(10, 70, 99)).toBe("CRITICO_BAIXO");
  });

  it("retorna INCONCLUSIVO quando valor é null/undefined/NaN", () => {
    expect(classificar(null, 70, 99)).toBe("INCONCLUSIVO");
    expect(classificar(undefined, 70, 99)).toBe("INCONCLUSIVO");
    expect(classificar(Number.NaN, 70, 99)).toBe("INCONCLUSIVO");
  });

  it("retorna INCONCLUSIVO quando não há referência", () => {
    expect(classificar(80, null, null)).toBe("INCONCLUSIVO");
    expect(classificar(80, undefined, undefined)).toBe("INCONCLUSIVO");
  });

  it("respeita apenas mínimo (sem máximo)", () => {
    expect(classificar(50, 70, null)).toBe("BAIXO");
    expect(classificar(100, 70, null)).toBe("NORMAL");
  });

  it("respeita apenas máximo (sem mínimo)", () => {
    expect(classificar(120, null, 99)).toBe("ALTO");
    expect(classificar(80, null, 99)).toBe("NORMAL");
  });
});

describe("lisService — parseHL7()", () => {
  it("extrai OBX corretamente de mensagem ORU", () => {
    const msg =
      "MSH|^~\\&|LAB|HOSP|PRONTOCLINIC|CLINIC|20250101120000||ORU^R01|MSG001|P|2.5\r" +
      "PID|1||12345^^^HOSP||Doe^John||19800101|M\r" +
      "OBR|1||LAB123|CBC^Hemograma^L|||20250101120000\r" +
      "OBX|1|NM|HGB^Hemoglobina^L||14.2|g/dL|13.0-17.5|N|||F\r" +
      "OBX|2|NM|HCT^Hematócrito^L||42.0|%|40-54|N|||F\r" +
      "OBX|3|NM|WBC^Leucócitos^L||15000|/mm³|4500-11000|H|||F";

    const parsed = parseHL7(msg);

    expect(parsed.obx_list).toHaveLength(3);
    expect(parsed.obx_list[0].description).toBe("Hemoglobina");
    expect(parsed.obx_list[0].value).toBe("14.2");
    expect(parsed.obx_list[0].units).toBe("g/dL");
    expect(parsed.obx_list[0].reference_range).toBe("13.0-17.5");

    expect(parsed.obx_list[2].description).toBe("Leucócitos");
    expect(parsed.obx_list[2].value).toBe("15000");
    expect(parsed.obx_list[2].abnormal_flag).toBe("H");
  });

  it("extrai PID com nome, data de nascimento e sexo", () => {
    const msg = "PID|1||12345^^^HOSP||Silva^Maria^Souza||19850315|F";
    const parsed = parseHL7(msg);
    expect(parsed.pid).not.toBeNull();
    expect(parsed.pid?.name).toBe("Maria Souza Silva");
    expect(parsed.pid?.dob).toBe("1985-03-15");
    expect(parsed.pid?.sex).toBe("F");
  });

  it("extrai OBR id e descrição do exame", () => {
    const msg = "OBR|1||LAB999|GLI^Glicemia^L|||20250101";
    const parsed = parseHL7(msg);
    expect(parsed.obr_id).toBe("LAB999");
    expect(parsed.obr_exame).toBe("Glicemia");
  });

  it("extrai MSH datetime", () => {
    const msg = "MSH|^~\\&|LAB|HOSP|PC|PC|20250101123045||ORU^R01|MSG001|P|2.5";
    const parsed = parseHL7(msg);
    expect(parsed.msg_datetime).toBe("2025-01-01 12:30");
  });

  it("retorna estrutura vazia para mensagem vazia", () => {
    const parsed = parseHL7("");
    expect(parsed.obx_list).toHaveLength(0);
    expect(parsed.pid).toBeNull();
  });

  it("aceita \\n e \\r\\n como separadores de segmento", () => {
    const msg = "OBX|1|NM|GLI^Glicose^L||90|mg/dL|70-99|N\nOBX|2|NM|HGB^Hb^L||14|g/dL|12-16|N";
    const parsed = parseHL7(msg);
    expect(parsed.obx_list).toHaveLength(2);
  });
});

describe("lisService — pedido.create()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejeita pedido sem itens", async () => {
    await expect(
      pedido.create({
        company_id: "00000000-0000-0000-0000-000000000001",
        cd_paciente: 1,
        cd_medico: 1,
        itens: [],
      }),
    ).rejects.toThrow("ao menos um exame");
  });

  it("cria pedido + itens em duas chamadas", async () => {
    // 1ª chamada: insert pedido → single
    // 2ª chamada: insert itens → select (sem single, retorna array)
    const pedidoChain = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 100 }, error: null }),
    };
    const itensChain = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockResolvedValue({
        data: [{ id: 200 }, { id: 201 }],
        error: null,
      }),
    };
    const from = vi.fn()
      .mockReturnValueOnce(pedidoChain)
      .mockReturnValueOnce(itensChain);
    (supabase.from as unknown as ReturnType<typeof vi.fn>) = from;

    const result = await pedido.create({
      company_id: "00000000-0000-0000-0000-000000000001",
      cd_paciente: 1,
      cd_medico: 1,
      itens: [{ cd_exame: 1 }, { cd_exame: 2 }],
    });

    expect(result.pedido_id).toBe(100);
    expect(result.itens_ids).toEqual([200, 201]);
  });
});

describe("lisService — resultado.salvarSeguro()", () => {
  const results = [{
    ds_parametro: "Glicose",
    vl_resultado: 90,
    vl_resultado_texto: null,
    ds_unidade: "mg/dL",
    vl_minimo_referencia: 70,
    vl_maximo_referencia: 99,
    tp_resultado: "NORMAL" as const,
  }];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("salva e libera atomicamente por uma única RPC", async () => {
    const rpcResponse = { success: true, item_id: 42, item_status: "LIBERADO" };
    vi.mocked(supabase.rpc).mockResolvedValue({ data: rpcResponse, error: null } as never);

    await expect(resultado.salvarSeguro({
      itemId: 42,
      results,
      release: true,
      expectedStatus: "EM_ANALISE",
      idempotencyKey: "lab-result-request-1",
    })).resolves.toEqual(rpcResponse);

    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith("save_or_release_lab_result_secure", {
      p_item_id: 42,
      p_expected_status: "EM_ANALISE",
      p_idempotency_key: "lab-result-request-1",
      p_results: results,
      p_release: true,
    });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("normaliza resposta tabular da RPC", async () => {
    const rpcResponse = { success: true, item_id: 42, item_status: "EM_ANALISE" };
    vi.mocked(supabase.rpc).mockResolvedValue({ data: [rpcResponse], error: null } as never);

    await expect(resultado.salvarSeguro({
      itemId: 42,
      results,
      release: false,
      expectedStatus: "COLETADO",
      idempotencyKey: "lab-result-request-2",
    })).resolves.toEqual(rpcResponse);
  });

  it("propaga erro da RPC sem executar escrita alternativa", async () => {
    const rpcError = { code: "P0001", message: "Status do item foi alterado" };
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: rpcError } as never);

    await expect(resultado.salvarSeguro({
      itemId: 42,
      results,
      release: false,
      expectedStatus: "COLETADO",
      idempotencyKey: "lab-result-request-3",
    })).rejects.toBe(rpcError);

    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("rejeita falha de negócio e resposta vazia", async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: { success: false, message: "Item já liberado" },
      error: null,
    } as never);

    const input = {
      itemId: 42,
      results,
      release: true,
      expectedStatus: "EM_ANALISE" as const,
      idempotencyKey: "lab-result-request-4",
    };
    await expect(resultado.salvarSeguro(input)).rejects.toThrow("Item já liberado");

    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: null, error: null } as never);
    await expect(resultado.salvarSeguro(input)).rejects.toThrow("Resposta inválida");
  });

  it("valida resultados e idempotência antes da RPC", async () => {
    await expect(resultado.salvarSeguro({
      itemId: 42,
      results: [],
      release: false,
      expectedStatus: "COLETADO",
      idempotencyKey: "key",
    })).rejects.toThrow("ao menos um parâmetro");

    await expect(resultado.salvarSeguro({
      itemId: 42,
      results,
      release: false,
      expectedStatus: "COLETADO",
      idempotencyKey: " ",
    })).rejects.toThrow("idempotência obrigatória");

    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});

