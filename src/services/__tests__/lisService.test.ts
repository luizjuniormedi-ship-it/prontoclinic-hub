/**
 * Testes do módulo LIS — classificar, parseHL7, pedido.create
 *
 * Cobre:
 *  - classificar: NORMAL, ALTO, BAIXO, CRITICO_BAIXO, CRITICO_ALTO, INCONCLUSIVO
 *  - parseHL7: extrai OBX, PID, OBR, MSH
 *  - pedido.create: valida que precisa ter ao menos 1 item
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  alerta,
  catalogo,
  classificar,
  getRelatorio,
  parseHL7,
  pedido,
  resultado,
  valorReferencia,
} from "@/services/lisService";

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

  it("cria pedido e itens em uma única RPC atômica e idempotente", async () => {
    const operationId = "10000000-0000-4000-8000-000000000001";
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: { pedido_id: 100, itens_ids: [200, 201] },
      error: null,
    } as never);

    const result = await pedido.create({
      company_id: "00000000-0000-0000-0000-000000000001",
      cd_paciente: 1,
      cd_medico: 1,
      itens: [{ cd_exame: 1 }, { cd_exame: 2 }],
    }, { operationId });

    expect(result.pedido_id).toBe(100);
    expect(result.itens_ids).toEqual([200, 201]);
    expect(supabase.rpc).toHaveBeenCalledWith("m23_create_lab_order_secure", {
      p_operation_id: operationId,
      p_order: expect.objectContaining({
        company_id: "00000000-0000-0000-0000-000000000001",
        cd_paciente: 1,
        cd_medico: 1,
        cd_tipo_atendimento: "AMBULATORIAL",
        tp_prioridade: "ROTINA",
      }),
      p_items: [{ cd_exame: 1 }, { cd_exame: 2 }],
    });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("reutiliza o operationId do chamador ao repetir o mesmo pedido", async () => {
    const operationId = "10000000-0000-4000-8000-000000000002";
    const input = {
      company_id: "00000000-0000-0000-0000-000000000001",
      cd_paciente: 1,
      cd_medico: 1,
      itens: [{ cd_exame: 1 }],
    };
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: { pedido_id: 100, itens_ids: [200] },
      error: null,
    } as never);

    await pedido.create(input, { operationId });
    await pedido.create(input, { operationId });

    expect(supabase.rpc).toHaveBeenCalledTimes(2);
    for (const [, args] of vi.mocked(supabase.rpc).mock.calls) {
      expect(args).toEqual(expect.objectContaining({
        p_operation_id: operationId,
      }));
    }
  });

  it("rejeita operationId vazio antes de chamar a RPC", async () => {
    await expect(
      pedido.create({
        company_id: "00000000-0000-0000-0000-000000000001",
        cd_paciente: 1,
        cd_medico: 1,
        itens: [{ cd_exame: 1 }],
      }, { operationId: "  " }),
    ).rejects.toThrow("não pode ser vazio");

    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("propaga erro da RPC sem tentar persistência parcial", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: null,
      error: { message: "Paciente fora da empresa" },
    } as never);

    await expect(
      pedido.create({
        company_id: "00000000-0000-0000-0000-000000000001",
        cd_paciente: 9,
        cd_medico: 1,
        itens: [{ cd_exame: 1 }],
      }),
    ).rejects.toMatchObject({ message: "Paciente fora da empresa" });
    expect(supabase.from).not.toHaveBeenCalled();
  });
});

describe("lisService — catálogo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normaliza DECIMAL retornado como string antes de entregar à interface", async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn(),
    };
    query.order
      .mockReturnValueOnce(query)
      .mockResolvedValueOnce({
        data: [{
          id: 1,
          company_id: "00000000-0000-0000-0000-000000000001",
          ds_exame: "Hemograma",
          ds_sigla: "HEM",
          nr_prazo_dias: "2",
          vl_particular: "42.50",
          vl_convenio: "31,25",
          lg_ativo: true,
          created_at: "2026-07-26T12:00:00.000Z",
          updated_at: "2026-07-26T12:00:00.000Z",
        }],
        error: null,
      });
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(query);

    const [exam] = await catalogo.getAll("00000000-0000-0000-0000-000000000001");

    expect(exam.nr_prazo_dias).toBe(2);
    expect(exam.vl_particular).toBe(42.5);
    expect(exam.vl_convenio).toBe(31.25);
  });

  it("converte valores ausentes ou inválidos em null sem produzir NaN", async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn(),
    };
    query.order
      .mockReturnValueOnce(query)
      .mockResolvedValueOnce({
        data: [{
          id: 2,
          company_id: "00000000-0000-0000-0000-000000000001",
          ds_exame: "Glicemia",
          ds_sigla: "GLI",
          nr_prazo_dias: null,
          vl_particular: "valor-invalido",
          vl_convenio: "",
          lg_ativo: true,
          created_at: "2026-07-26T12:00:00.000Z",
          updated_at: "2026-07-26T12:00:00.000Z",
        }],
        error: null,
      });
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(query);

    const [exam] = await catalogo.getAll("00000000-0000-0000-0000-000000000001");

    expect(exam.nr_prazo_dias).toBe(0);
    expect(exam.vl_particular).toBeNull();
    expect(exam.vl_convenio).toBeNull();
    expect(Number.isNaN(exam.vl_particular)).toBe(false);
  });

  it("cria e atualiza catálogo somente por RPC segura", async () => {
    const input = {
      company_id: "00000000-0000-0000-0000-000000000001",
      ds_exame: "Glicemia",
      ds_sigla: "GLI",
      nr_prazo_dias: 1,
      vl_particular: 10,
      vl_convenio: 8,
      lg_ativo: true,
    };
    const row = {
      id: 3,
      ...input,
      nr_prazo_dias: "1",
      vl_particular: "10.00",
      vl_convenio: "8.00",
      created_at: "2026-07-26T12:00:00.000Z",
      updated_at: "2026-07-26T12:00:00.000Z",
    };
    vi.mocked(supabase.rpc).mockResolvedValue({ data: row, error: null } as never);

    await catalogo.create(input);
    await catalogo.update(3, { vl_particular: 12 });
    await catalogo.inactivate(3);

    expect(supabase.rpc).toHaveBeenNthCalledWith(1, "m23_upsert_exam_catalog_secure", {
      p_exam: input,
    });
    expect(supabase.rpc).toHaveBeenNthCalledWith(2, "m23_upsert_exam_catalog_secure", {
      p_exam: { id: 3, vl_particular: 12 },
    });
    expect(supabase.rpc).toHaveBeenNthCalledWith(3, "m23_upsert_exam_catalog_secure", {
      p_exam: { id: 3, lg_ativo: false },
    });
  });
});

describe("lisService — normalização numérica de resultados", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normaliza faixas de referência DECIMAL sem propagar NaN", async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: [{
          id: 1,
          company_id: "00000000-0000-0000-0000-000000000001",
          cd_exame: 3,
          ds_parametro: "Glicose",
          vl_minimo: "70.000000",
          vl_maximo: "valor-invalido",
          nr_idade_min: "0",
          nr_idade_max: "120",
          lg_ativo: true,
          created_at: "2026-07-26T12:00:00.000Z",
        }],
        error: null,
      }),
    };
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(query);

    const [reference] = await valorReferencia.getByExame(3);

    expect(reference.vl_minimo).toBe(70);
    expect(reference.vl_maximo).toBeNull();
    expect(reference.nr_idade_min).toBe(0);
    expect(reference.nr_idade_max).toBe(120);
  });

  it("normaliza resultados DECIMAL retornados como string", async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: [{
          id: 8,
          cd_item_pedido: 5,
          ds_parametro: "Glicose",
          vl_resultado: "90.500000",
          vl_minimo_referencia: "70.000000",
          vl_maximo_referencia: "99.000000",
          dt_resultado: "2026-07-26T12:00:00.000Z",
          created_at: "2026-07-26T12:00:00.000Z",
        }],
        error: null,
      }),
    };
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(query);

    const [result] = await resultado.listarPorItem(5);

    expect(result.vl_resultado).toBe(90.5);
    expect(result.vl_minimo_referencia).toBe(70);
    expect(result.vl_maximo_referencia).toBe(99);
  });
});

describe("lisService — relacionamentos PostgREST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("qualifica paciente, médico e itens do pedido pelas FKs reais", async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
    };
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(query);

    await pedido.listar("00000000-0000-0000-0000-000000000001");

    const select = vi.mocked(query.select).mock.calls[0][0] as string;
    expect(select).toContain("patients!lab_order_company_patient_fk");
    expect(select).toContain("professionals!lab_order_company_professional_fk");
    expect(select).toContain(
      "itens:exames_lab_pedido_itens!lab_item_company_order_fk(count)",
    );
  });

  it("qualifica exame e resultados dos itens pelas FKs reais", async () => {
    const orderQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: 10 },
        error: null,
      }),
    };
    const itemsQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({
        data: [{
          id: 20,
          cd_pedido: 10,
          cd_exame: 30,
          resultados: [{
            id: 40,
            cd_item_pedido: 20,
            ds_parametro: "Glicose",
            vl_resultado: "91.500000",
            vl_minimo_referencia: "70.000000",
            vl_maximo_referencia: "99.000000",
          }],
        }],
        error: null,
      }),
    };
    (supabase.from as unknown as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(orderQuery)
      .mockReturnValueOnce(itemsQuery);

    const order = await pedido.getById(10);

    const orderSelect = vi.mocked(orderQuery.select).mock.calls[0][0] as string;
    const itemSelect = vi.mocked(itemsQuery.select).mock.calls[0][0] as string;
    expect(orderSelect).toContain("patients!lab_order_company_patient_fk");
    expect(orderSelect).toContain(
      "professionals!lab_order_company_professional_fk",
    );
    expect(itemSelect).toContain(
      "exames_lab_catalogo!lab_item_company_exam_fk",
    );
    expect(itemSelect).toContain(
      "resultados:exames_lab_resultado!lab_result_company_item_fk(*)",
    );
    expect(order?.itens[0].resultados[0]).toEqual(expect.objectContaining({
      vl_resultado: 91.5,
      vl_minimo_referencia: 70,
      vl_maximo_referencia: 99,
    }));
  });

  it("qualifica resultado, paciente e médico dos alertas pelas FKs reais", async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: [{
          id: 50,
          cd_resultado: 40,
          cd_paciente: 60,
          cd_medico: 70,
          vl_resultado: "180.000000",
          lg_comunicado: false,
          resultado: {
            id: 40,
            cd_item_pedido: 20,
            ds_parametro: "Glicose",
            vl_resultado: "180.000000",
            vl_minimo_referencia: "70.000000",
            vl_maximo_referencia: "99.000000",
            tp_resultado: "CRITICO_ALTO",
          },
          paciente: { full_name: "Paciente QA" },
          medico: { full_name: "Médico QA" },
        }],
        error: null,
      }),
    };
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(query);

    const [criticalAlert] = await alerta.listarPendentes();

    const select = vi.mocked(query.select).mock.calls[0][0] as string;
    expect(select).toContain(
      "resultado:exames_lab_resultado!lab_alert_company_result_fk(*)",
    );
    expect(select).toContain("patients!lab_alert_company_patient_fk");
    expect(select).toContain(
      "professionals!lab_alert_company_professional_fk",
    );
    expect(select).not.toContain(
      "exames_lab_alerta_critico_cd_paciente_fkey",
    );
    expect(select).not.toContain(
      "exames_lab_alerta_critico_cd_medico_fkey",
    );
    expect(query.eq).toHaveBeenNthCalledWith(1, "tp_status", "PENDENTE");
    expect(query.eq).toHaveBeenNthCalledWith(2, "lg_comunicado", false);
    expect(criticalAlert).toEqual(expect.objectContaining({
      vl_resultado: 180,
      paciente_nome: "Paciente QA",
      medico_nome: "Médico QA",
      resultado: expect.objectContaining({
        vl_resultado: 180,
        vl_minimo_referencia: 70,
        vl_maximo_referencia: 99,
        tp_resultado: "CRITICO_ALTO",
      }),
    }));
  });

  it("qualifica o exame agregado do relatório pela FK composta", async () => {
    const ordersQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    const itemsQuery = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    const totalAlertsQuery = {
      select: vi.fn().mockResolvedValue({ count: 0 }),
    };
    const pendingAlertsQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn(),
    };
    pendingAlertsQuery.eq
      .mockReturnValueOnce(pendingAlertsQuery)
      .mockResolvedValueOnce({ count: 0 });
    (supabase.from as unknown as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(ordersQuery)
      .mockReturnValueOnce(itemsQuery)
      .mockReturnValueOnce(totalAlertsQuery)
      .mockReturnValueOnce(pendingAlertsQuery);

    await getRelatorio(
      "00000000-0000-0000-0000-000000000001",
      {
        dt_inicio: "2026-07-01T00:00:00.000Z",
        dt_fim: "2026-07-31T23:59:59.999Z",
      },
    );

    expect(itemsQuery.select).toHaveBeenCalledWith(
      expect.stringContaining(
        "exames_lab_catalogo!lab_item_company_exam_fk",
      ),
    );
  });
});

describe("lisService — mutações seguras", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejeita coleta sem identificador de amostra antes da RPC", async () => {
    await expect(pedido.marcarColetado(5, "   ")).rejects.toThrow(
      "Identificador da amostra é obrigatório",
    );
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("usa RPCs para referência, coleta, transição, resultado, liberação e alerta", async () => {
    const resultOperationId = "20000000-0000-4000-8000-000000000001";
    vi.mocked(supabase.rpc)
      .mockResolvedValueOnce({
        data: {
          id: 1,
          cd_exame: 3,
          ds_parametro: "Glicose",
          nr_idade_min: 0,
          nr_idade_max: 120,
          lg_ativo: true,
          created_at: "2026-07-26T12:00:00.000Z",
        },
        error: null,
      } as never)
      .mockResolvedValueOnce({ data: {}, error: null } as never)
      .mockResolvedValueOnce({ data: {}, error: null } as never)
      .mockResolvedValueOnce({
        data: [{ id: 7, cd_item_pedido: 5, ds_parametro: "Glicose" }],
        error: null,
      } as never)
      .mockResolvedValueOnce({ data: {}, error: null } as never)
      .mockResolvedValueOnce({ data: {}, error: null } as never);

    await valorReferencia.create({
      cd_exame: 3,
      ds_parametro: "Glicose",
      nr_idade_min: 0,
      nr_idade_max: 120,
      lg_ativo: true,
    });
    await pedido.marcarColetado(5, "AMOSTRA-5");
    await pedido.atualizarStatus(4, "EM_ANALISE");
    await resultado.inserirLote(5, [{
      ds_parametro: "Glicose",
      vl_resultado: 90,
      vl_minimo_referencia: 70,
      vl_maximo_referencia: 99,
    }], { operationId: resultOperationId });
    await resultado.liberarItem(5);
    await alerta.comunicar(6, "TELEFONE", "usuario-ignorado");

    expect(supabase.rpc).toHaveBeenNthCalledWith(1, "m23_upsert_reference_range_secure", {
      p_reference: expect.objectContaining({ cd_exame: 3 }),
    });
    expect(supabase.rpc).toHaveBeenNthCalledWith(2, "m23_collect_specimen_secure", {
      p_item_id: 5,
      p_sample_id: "AMOSTRA-5",
    });
    expect(supabase.rpc).toHaveBeenNthCalledWith(3, "m23_transition_specimen_secure", {
      p_order_id: 4,
      p_status: "EM_ANALISE",
    });
    expect(supabase.rpc).toHaveBeenNthCalledWith(4, "m23_record_results_idempotent_secure", {
      p_item_id: 5,
      p_results: [expect.objectContaining({
        ds_parametro: "Glicose",
      })],
      p_operation_id: resultOperationId,
    });
    const resultRpcArgs = vi.mocked(supabase.rpc).mock.calls[3][1] as {
      p_results: Array<Record<string, unknown>>;
    };
    expect(resultRpcArgs.p_results[0]).not.toHaveProperty("tp_resultado");
    expect(supabase.rpc).toHaveBeenNthCalledWith(5, "m23_validate_result_secure", {
      p_item_id: 5,
    });
    expect(supabase.rpc).toHaveBeenNthCalledWith(6, "m23_acknowledge_critical_alert_secure", {
      p_alert_id: 6,
      p_channel: "TELEFONE",
    });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("remove classificação do cliente e reutiliza operationId no retry do resultado", async () => {
    const operationId = "20000000-0000-4000-8000-000000000002";
    const unsafeParameters = [{
      id: 7,
      ds_parametro: "Glicose",
      vl_resultado: 90,
      vl_minimo_referencia: 70,
      vl_maximo_referencia: 99,
      tp_resultado: "CRITICO_ALTO",
    }, {
      ds_parametro: "Hemoglobina",
      vl_resultado: 14,
      tp_resultado: "CRITICO_BAIXO",
    }] as never;
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: [{
        id: 7,
        cd_item_pedido: 5,
        ds_parametro: "Glicose",
        tp_resultado: "NORMAL",
      }, {
        id: 8,
        cd_item_pedido: 5,
        ds_parametro: "Hemoglobina",
        tp_resultado: "NORMAL",
      }],
      error: null,
    } as never);

    await resultado.inserirLote(5, unsafeParameters, { operationId });
    await resultado.inserirLote(5, unsafeParameters, { operationId });

    expect(supabase.rpc).toHaveBeenCalledTimes(2);
    for (const [, args] of vi.mocked(supabase.rpc).mock.calls) {
      const rpcArgs = args as {
        p_item_id: number;
        p_results: Array<Record<string, unknown>>;
        p_operation_id: string;
      };
      expect(rpcArgs.p_item_id).toBe(5);
      expect(rpcArgs.p_operation_id).toBe(operationId);
      expect(rpcArgs.p_results[0]).toEqual(expect.objectContaining({ id: 7 }));
      expect(rpcArgs.p_results[1]).not.toHaveProperty("id");
      expect(rpcArgs.p_results[0]).not.toHaveProperty("tp_resultado");
      expect(rpcArgs.p_results[1]).not.toHaveProperty("tp_resultado");
    }
  });

  it("envia id na retificação individual sem confiar em tp_resultado", async () => {
    const operationId = "20000000-0000-4000-8000-000000000003";
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: [{
        id: 8,
        cd_item_pedido: 5,
        ds_parametro: "Glicose",
        tp_resultado: "NORMAL",
      }],
      error: null,
    } as never);

    const insertedResult = await resultado.inserir({
      id: 8,
      cd_item_pedido: 5,
      ds_parametro: "Glicose",
      vl_resultado: 90,
      tp_resultado: "CRITICO_ALTO",
    } as never, { operationId });

    const [, args] = vi.mocked(supabase.rpc).mock.calls[0];
    const rpcArgs = args as {
      p_item_id: number;
      p_results: Array<Record<string, unknown>>;
      p_operation_id: string;
    };
    expect(rpcArgs.p_item_id).toBe(5);
    expect(rpcArgs.p_operation_id).toBe(operationId);
    expect(rpcArgs.p_results[0]).toEqual(expect.objectContaining({ id: 8 }));
    expect(rpcArgs.p_results[0]).not.toHaveProperty("tp_resultado");
    expect(insertedResult.tp_resultado).toBe("NORMAL");
  });
});
