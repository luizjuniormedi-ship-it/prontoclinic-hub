/**
 * nursingService.test.ts — Testes do módulo de Enfermagem/Triagem
 *
 * Cobre:
 * - RPCs seguras e idempotentes de fila/triagem
 * - calcularNEWS2 (BAIXO 0-4, MEDIO 5-6, ALTO 7+)
 * - classificarManchester (dispneia -> VERMELHO, dor severa -> LARANJA)
 * - fila.chamar (status CHAMADO)
 * - validateTriagem
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  nursingService,
  calcularNEWS2,
  classificarManchester,
  validateTriagem,
  calcularPontuacaoNews2,
} from "@/services/nursingService";

// Mock do Supabase
vi.mock("@/lib/supabase", () => {
  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(),
    single: vi.fn(),
  };
  return {
    supabase: {
      from: vi.fn(() => chain),
      auth: { getUser: vi.fn() },
      rpc: vi.fn(),
    },
  };
});

import { supabase } from "@/lib/supabase";

const filaItem = {
  id: 42,
  company_id: "tenant-server",
  cd_paciente: 7,
  dt_chegada: "2026-06-22T10:00:00Z",
  dt_chamada: null,
  cd_senha: "T001",
  cd_classificacao_id: 2,
  tp_status: "AGUARDANDO",
  ds_queixa_inicial: "Dor",
  created_at: "2026-06-22T10:00:00Z",
};

describe("nursingService — fila segura", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enfileira por RPC sem enviar company_id nem ator", async () => {
    (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { queue_item: filaItem },
      error: null,
    });
    const result = await nursingService.fila.adicionar("company-uuid", 7, "Dor", 2, "enqueue-key");
    expect(result.cd_senha).toBe("T001");
    expect(supabase.rpc).toHaveBeenCalledWith("enqueue_nursing_triage_secure", {
      p_patient_id: 7,
      p_initial_complaint: "Dor",
      p_classification_id: 2,
      p_idempotency_key: "enqueue-key",
    });
    expect(JSON.stringify((supabase.rpc as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1])).not.toMatch(/company|actor/i);
  });

  it("falha fechado quando a RPC de fila retorna payload inválido", async () => {
    (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null,
      error: null,
    });
    await expect(
      nursingService.fila.adicionar("company-uuid", 7, "Dor", null, "enqueue-key"),
    ).rejects.toThrow(/resposta inválida/i);
  });

  it("reutiliza a chave gerada quando o enqueue sem chave explícita é repetido", async () => {
    (supabase.rpc as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: null, error: { message: "temporário" } })
      .mockResolvedValueOnce({ data: { queue_item: filaItem }, error: null });

    await expect(nursingService.fila.adicionar("company-uuid", 7, "Dor")).rejects.toThrow(/temporário/);
    await nursingService.fila.adicionar("company-uuid", 7, "Dor");

    const firstKey = (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].p_idempotency_key;
    const secondKey = (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mock.calls[1][1].p_idempotency_key;
    expect(firstKey).toMatch(/^[0-9a-f-]{36}$/i);
    expect(secondKey).toBe(firstKey);
  });
});

describe("nursingService — calcularNEWS2", () => {
  it("retorna BAIXO quando score 0-4 (todos os parâmetros normais)", () => {
    const result = calcularNEWS2({
      frequenciaRespiratoria: 16,
      saturacaoO2: 98,
      temperatura: 36.8,
      pressaoSistolica: 120,
      frequenciaCardiaca: 75,
      nivelConsciencia: 0,
    });
    expect(result.score).toBe(0);
    expect(result.classificacao).toBe("BAIXO");
  });

  it("retorna MEDIO quando score 5-6 (resposta única)", () => {
    // FR 22→2, SpO2 94→1, Temp 36.8→0, PAS 95→2, FC 80→0, Consc 0→0 => total=5 (MEDIO)
    const result = calcularNEWS2({
      frequenciaRespiratoria: 22,
      saturacaoO2: 94,
      temperatura: 36.8,
      pressaoSistolica: 95,
      frequenciaCardiaca: 80,
      nivelConsciencia: 0,
    });
    expect(result.score).toBe(5);
    expect(result.classificacao).toBe("MEDIO");
  });

  it("retorna ALTO quando score >= 7", () => {
    const result = calcularNEWS2({
      frequenciaRespiratoria: 26, // 3
      saturacaoO2: 90,            // 3
      temperatura: 39.5,          // 2
      pressaoSistolica: 85,       // 3
      frequenciaCardiaca: 135,    // 3
      nivelConsciencia: 0,        // 0
    });
    expect(result.score).toBeGreaterThanOrEqual(7);
    expect(result.classificacao).toBe("ALTO");
  });

  it("promove para MEDIO quando qualquer parâmetro isolado é 3 (regra clínica)", () => {
    // 0+0+0+0+0+3 = 3, mas regra NEWS2 = MEDIO
    const result = calcularNEWS2({
      frequenciaRespiratoria: 16,
      saturacaoO2: 98,
      temperatura: 36.8,
      pressaoSistolica: 120,
      frequenciaCardiaca: 75,
      nivelConsciencia: 1, // V/P/U = 3
    });
    expect(result.detalhes.consciencia).toBe(3);
    expect(result.score).toBe(3);
    expect(result.classificacao).toBe("MEDIO");
  });

  it("trata valores ausentes como 0 (sem pontos)", () => {
    const result = calcularNEWS2({});
    expect(result.score).toBe(0);
    expect(result.classificacao).toBe("BAIXO");
  });
});

describe("nursingService — classificarManchester", () => {
  it("dispneia grave → VERMELHO", () => {
    const cor = classificarManchester(
      {
        pressaoSistolica: 120,
        saturacaoO2: 95,
        temperatura: 36.8,
        escalaDor: 3,
      },
      "Paciente com dispneia intensa",
    );
    expect(cor).toBe("VERMELHO");
  });

  it("SpO2 < 85 → VERMELHO", () => {
    const cor = classificarManchester(
      {
        pressaoSistolica: 120,
        saturacaoO2: 80,
        temperatura: 36.8,
        escalaDor: 3,
      },
      "Mal estar geral",
    );
    expect(cor).toBe("VERMELHO");
  });

  it("PAS < 80 → VERMELHO (choque)", () => {
    const cor = classificarManchester(
      {
        pressaoSistolica: 70,
        saturacaoO2: 95,
        temperatura: 36.8,
        escalaDor: 3,
      },
      "Hipotensão",
    );
    expect(cor).toBe("VERMELHO");
  });

  it("dor torácica → LARANJA", () => {
    const cor = classificarManchester(
      {
        pressaoSistolica: 130,
        saturacaoO2: 95,
        temperatura: 36.8,
        escalaDor: 5,
      },
      "Dor torácica há 30 min",
    );
    expect(cor).toBe("LARANJA");
  });

  it("escala de dor >= 7 → LARANJA", () => {
    const cor = classificarManchester(
      {
        pressaoSistolica: 120,
        saturacaoO2: 95,
        temperatura: 36.8,
        escalaDor: 8,
      },
      "Cefaleia",
    );
    expect(cor).toBe("LARANJA");
  });

  it("febre >= 39°C + sinais estáveis → AMARELO", () => {
    const cor = classificarManchester(
      {
        pressaoSistolica: 120,
        saturacaoO2: 95,
        temperatura: 39.5,
        escalaDor: 2,
      },
      "Febre e tosse",
    );
    expect(cor).toBe("AMARELO");
  });

  it("sinais normais sem queixa → AZUL (default)", () => {
    const cor = classificarManchester(
      {
        pressaoSistolica: 120,
        saturacaoO2: 98,
        temperatura: 36.5,
        escalaDor: 0,
      },
      "Renovação de receita",
    );
    expect(cor).toBe("AZUL");
  });
});

describe("nursingService — fila.chamar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("muda status para CHAMADO e seta dt_chamada", async () => {
    const itemChamado = {
      ...filaItem,
      tp_status: "CHAMADO",
      dt_chamada: "2026-06-22T10:30:00Z",
    };
    (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { queue_item: itemChamado },
      error: null,
    });

    const result = await nursingService.fila.chamar(42, "call-key");
    expect(result.tp_status).toBe("CHAMADO");
    expect(result.dt_chamada).toBeDefined();
    expect(supabase.rpc).toHaveBeenCalledWith("call_nursing_triage_secure", {
      p_queue_id: 42,
      p_idempotency_key: "call-key",
    });
  });
});

describe("nursingService — conclusão atômica", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const triagemInput = {
    company_id: "tenant-client",
    cd_paciente: 7,
    cd_appointment: 99,
    cd_classificacao_id: 2,
    sinaisVitais: {
      pressaoSistolica: 120,
      pressaoDiastolica: 80,
      frequenciaCardiaca: 75,
      frequenciaRespiratoria: 16,
      temperatura: 36.8,
      saturacaoO2: 98,
    },
    glasgow: { ocular: 4, verbal: 5, motor: 6 },
    queixa_principal: "Dor",
  };

  it("conclui triagem e NEWS2 em uma única RPC sem company_id nem ator", async () => {
    (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        triage: { id: 81, cd_paciente: 7, tp_status: "TRIADO" },
        news2: { nr_score_total: 0, cd_classificacao_risco: "BAIXO" },
        queue_item: { ...filaItem, tp_status: "TRIADO" },
      },
      error: null,
    });

    const result = await nursingService.triagem.create(triagemInput, {
      filaId: 42,
      idempotencyKey: "complete-key",
    });

    expect(result.id).toBe(81);
    expect(supabase.rpc).toHaveBeenCalledWith("complete_nursing_triage_secure", {
      p_queue_id: 42,
      p_appointment_id: 99,
      p_classification_id: 2,
      p_triage: {
        queixa_principal: "Dor",
        historia_doenca_atual: null,
        medicamentos_uso: null,
        alergias: null,
        observacoes_enfermagem: null,
        sinais_vitais: triagemInput.sinaisVitais,
        antropometria: null,
        glasgow: triagemInput.glasgow,
        nivel_consciencia: "A",
        status: "TRIADO",
      },
      p_idempotency_key: "complete-key",
    });
    const payload = (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(Object.keys(payload)).toEqual([
      "p_queue_id",
      "p_appointment_id",
      "p_classification_id",
      "p_triage",
      "p_idempotency_key",
    ]);
    expect(payload).not.toHaveProperty("p_patient_id");
    expect(payload).not.toHaveProperty("p_news2");
    expect(payload).not.toHaveProperty("p_company_id");
    expect(payload).not.toHaveProperty("p_actor_id");
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("deriva consciência C quando Glasgow é menor que 15", async () => {
    (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        triage: { id: 82, cd_paciente: 7, tp_status: "TRIADO" },
        news2: { nr_score_total: 3, cd_classificacao_risco: "MEDIO" },
        queue_item: { ...filaItem, tp_status: "TRIADO" },
      },
      error: null,
    });
    await nursingService.triagem.create({
      ...triagemInput,
      glasgow: { ocular: 3, verbal: 5, motor: 6 },
    }, { filaId: 42, idempotencyKey: "complete-key-c" });

    expect((supabase.rpc as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].p_triage)
      .toEqual(expect.objectContaining({ nivel_consciencia: "C" }));
  });

  it("propaga erro da RPC e não tenta writes parciais", async () => {
    (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null,
      error: { message: "fila mudou de estado" },
    });

    await expect(nursingService.triagem.create(triagemInput, {
      filaId: 42,
      idempotencyKey: "complete-key",
    })).rejects.toThrow(/fila mudou de estado/);
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("rejeita resposta vazia mesmo sem erro declarado", async () => {
    (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: null, error: null });
    await expect(nursingService.triagem.create(triagemInput, {
      filaId: 42,
      idempotencyKey: "complete-key",
    })).rejects.toThrow(/resposta inválida/i);
  });
});

describe("nursingService — validateTriagem", () => {
  const sinaisCompletos = {
    pressaoSistolica: 120,
    pressaoDiastolica: 80,
    frequenciaCardiaca: 75,
    frequenciaRespiratoria: 16,
    temperatura: 36.8,
    saturacaoO2: 98,
  };

  it("retorna erro se company_id ausente", () => {
    const err = validateTriagem({
      company_id: "",
      cd_paciente: 1,
      sinaisVitais: {},
    });
    expect(err).toMatch(/company_id/i);
  });

  it("retorna erro se paciente ausente", () => {
    const err = validateTriagem({
      company_id: "uuid",
      cd_paciente: 0,
      sinaisVitais: {},
    });
    expect(err).toMatch(/paciente/i);
  });

  it("retorna erro se escala de dor fora de 0-10", () => {
    const err = validateTriagem({
      company_id: "uuid",
      cd_paciente: 1,
      cd_classificacao_id: 2,
      sinaisVitais: { ...sinaisCompletos, escalaDor: 15 },
    });
    expect(err).toMatch(/dor/i);
  });

  it("retorna erro se Glasgow ocular inválido", () => {
    const err = validateTriagem({
      company_id: "uuid",
      cd_paciente: 1,
      cd_classificacao_id: 2,
      sinaisVitais: sinaisCompletos,
      glasgow: { ocular: 6, verbal: 4, motor: 5 },
    });
    expect(err).toMatch(/ocular/i);
  });

  it("retorna null para triagem válida", () => {
    const err = validateTriagem({
      company_id: "uuid",
      cd_paciente: 1,
      cd_classificacao_id: 2,
      sinaisVitais: { ...sinaisCompletos, escalaDor: 3 },
      glasgow: { ocular: 4, verbal: 5, motor: 6 },
    });
    expect(err).toBeNull();
  });

  it("exige classificação e todos os sinais necessários ao NEWS2", () => {
    expect(validateTriagem({
      company_id: "uuid",
      cd_paciente: 1,
      sinaisVitais: sinaisCompletos,
    })).toMatch(/classificação.*obrigatória/i);

    const requiredSignals = [
      ["pressaoSistolica", /PAS.*obrigatória/i],
      ["pressaoDiastolica", /PAD.*obrigatória/i],
      ["frequenciaCardiaca", /FC.*obrigatória/i],
      ["frequenciaRespiratoria", /FR.*obrigatória/i],
      ["temperatura", /temperatura.*obrigatória/i],
      ["saturacaoO2", /SpO2.*obrigatória/i],
    ] as const;

    for (const [field, message] of requiredSignals) {
      const sinais = { ...sinaisCompletos } as Record<string, number | undefined>;
      sinais[field] = undefined;
      expect(validateTriagem({
        company_id: "uuid",
        cd_paciente: 1,
        cd_classificacao_id: 2,
        sinaisVitais: sinais,
      })).toMatch(message);
    }
  });
});

describe("nursingService — calcularPontuacaoNews2 (unidade)", () => {
  it("FR: <=8 → 3, 9-11 → 1, 12-20 → 0, 21-24 → 2, >24 → 3", () => {
    expect(calcularPontuacaoNews2("FR", 7)).toBe(3);
    expect(calcularPontuacaoNews2("FR", 10)).toBe(1);
    expect(calcularPontuacaoNews2("FR", 18)).toBe(0);
    expect(calcularPontuacaoNews2("FR", 22)).toBe(2);
    expect(calcularPontuacaoNews2("FR", 30)).toBe(3);
  });

  it("SpO2: <=91 → 3, 92-93 → 2, 94-95 → 1, >=96 → 0", () => {
    expect(calcularPontuacaoNews2("SPO2", 85)).toBe(3);
    expect(calcularPontuacaoNews2("SPO2", 92)).toBe(2);
    expect(calcularPontuacaoNews2("SPO2", 94)).toBe(1);
    expect(calcularPontuacaoNews2("SPO2", 98)).toBe(0);
  });

  it("PAS: <=90 → 3, 91-100 → 2, 101-110 → 1, 111-219 → 0, >=220 → 3", () => {
    expect(calcularPontuacaoNews2("PAS", 80)).toBe(3);
    expect(calcularPontuacaoNews2("PAS", 95)).toBe(2);
    expect(calcularPontuacaoNews2("PAS", 105)).toBe(1);
    expect(calcularPontuacaoNews2("PAS", 120)).toBe(0);
    expect(calcularPontuacaoNews2("PAS", 230)).toBe(3);
  });

  it("consciência: 0=alerta (0pts), 1=V/P/U (3pts)", () => {
    expect(calcularPontuacaoNews2("CONSCIENCIA", 0)).toBe(0);
    expect(calcularPontuacaoNews2("CONSCIENCIA", 1)).toBe(3);
  });

  it("retorna 0 para valor null/undefined", () => {
    expect(calcularPontuacaoNews2("FR", null)).toBe(0);
    expect(calcularPontuacaoNews2("FR", undefined)).toBe(0);
  });
});

