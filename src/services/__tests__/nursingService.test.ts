/**
 * nursingService.test.ts — Testes do módulo de Enfermagem/Triagem
 *
 * Cobre:
 * - gerarSenha (formato T001, T002)
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

describe("nursingService — gerarSenha", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna senha no formato T001 quando chamada via RPC com sucesso", async () => {
    (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: "T001",
      error: null,
    });
    const senha = await nursingService.fila.gerarSenha("company-uuid");
    expect(senha).toBe("T001");
    expect(supabase.rpc).toHaveBeenCalledWith("gerar_senha_triagem", {
      p_company_id: "company-uuid",
    });
  });

  it("gera senha sequencial T002 quando RPC retorna T002", async () => {
    (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: "T002",
      error: null,
    });
    const senha = await nursingService.fila.gerarSenha("company-uuid");
    expect(senha).toBe("T002");
    expect(senha).toMatch(/^T\d{3}$/);
  });

  it("usa fallback local quando RPC falha", async () => {
    (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("offline"),
    );
    const senha = await nursingService.fila.gerarSenha("company-uuid");
    expect(senha).toMatch(/^T\d+$/);
    expect(senha.length).toBeGreaterThan(0);
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
      id: 42,
      tp_status: "CHAMADO",
      dt_chamada: "2026-06-22T10:30:00Z",
    };
    const chain: Record<string, unknown> = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: itemChamado, error: null }),
    };
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    const result = await nursingService.fila.chamar(42);
    expect(result.tp_status).toBe("CHAMADO");
    expect(result.dt_chamada).toBeDefined();
    expect(chain.update).toHaveBeenCalled();
    expect(chain.eq).toHaveBeenCalledWith("id", 42);
  });
});

describe("nursingService — validateTriagem", () => {
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
      sinaisVitais: { escalaDor: 15 },
    });
    expect(err).toMatch(/dor/i);
  });

  it("retorna erro se Glasgow ocular inválido", () => {
    const err = validateTriagem({
      company_id: "uuid",
      cd_paciente: 1,
      sinaisVitais: {},
      glasgow: { ocular: 6, verbal: 4, motor: 5 },
    });
    expect(err).toMatch(/ocular/i);
  });

  it("retorna null para triagem válida", () => {
    const err = validateTriagem({
      company_id: "uuid",
      cd_paciente: 1,
      sinaisVitais: {
        pressaoSistolica: 120,
        escalaDor: 3,
      },
      glasgow: { ocular: 4, verbal: 5, motor: 6 },
    });
    expect(err).toBeNull();
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
