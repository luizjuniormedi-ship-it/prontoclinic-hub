import { describe, it, expect, vi, beforeEach } from "vitest";
import { biService, biServiceHelpers } from "@/services/biService";

// Mock do Supabase
vi.mock("@/lib/supabase", () => {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
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

const COMPANY_ID = "11111111-2222-3333-4444-555555555555";

interface ChainMock {
  [k: string]: ReturnType<typeof vi.fn>;
}

function getChain(): ChainMock {
  return (supabase.from as unknown as ReturnType<typeof vi.fn>)() as ChainMock;
}

describe("biService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getKPIsHoje", () => {
    it("retorna estrutura correta quando snapshot existe", async () => {
      const chain = getChain();
      (chain.maybeSingle as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: {
          id: 1,
          company_id: COMPANY_ID,
          dt_referencia: "2026-06-22",
          nr_agendamentos_total: 30,
          nr_agendamentos_confirmados: 20,
          nr_agendamentos_atendidos: 18,
          nr_agendamentos_faltaram: 2,
          nr_agendamentos_cancelados: 1,
          nr_taxa_confirmacao: 66.67,
          nr_taxa_no_show: 6.67,
          vl_faturado_dia: 1500,
          vl_recebido_dia: 1200,
          vl_glosa_dia: 300,
          vl_ticket_medio: 83.33,
          nr_pacientes_novos: 5,
          nr_pacientes_total: 25,
          nr_ocupacao_percent: 75,
        },
        error: null,
      });
      // 2ª chamada (mês anterior): nada
      (chain.limit as ReturnType<typeof vi.fn>).mockReturnThis();
      (chain.order as ReturnType<typeof vi.fn>).mockReturnThis();
      (chain.lt as ReturnType<typeof vi.fn>).mockReturnThis();
      (chain.gte as ReturnType<typeof vi.fn>).mockReturnThis();

      const result = await biService.getKPIsHoje(COMPANY_ID);
      expect(result.agendamentos.total).toBe(30);
      expect(result.agendamentos.taxaConfirmacao).toBe(66.67);
      expect(result.financeiro.faturado).toBe(1500);
      expect(result.operacional.pacientesNovos).toBe(5);
      expect(result).toHaveProperty("comparativo");
    });

    it("cai em fallback realtime quando snapshot ausente", async () => {
      // 1ª chamada: snapshot (bi_kpis_diarios) — maybeSingle retorna null
      (supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValueOnce({ data: null, error: null }),
      });
      // 2ª chamada: appointments (select encadeado com .then)
      const apptsChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        then: (cb: (v: { data: unknown; error: unknown }) => unknown) =>
          cb({
            data: [
              { id: "a1", status: "confirmed", created_at: "2026-06-22T10:00:00Z", patient_id: "p1", billings: [{ amount: 100, paid_amount: 80 }] },
              { id: "a2", status: "no_show", created_at: "2026-06-22T11:00:00Z", patient_id: "p2", billings: null },
            ],
            error: null,
          }),
      };
      (supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce(apptsChain);

      const result = await biService.getKPIsHoje(COMPANY_ID);
      expect(result.agendamentos.total).toBe(2);
      expect(result.agendamentos.faltaram).toBe(1);
      expect(result.financeiro.faturado).toBe(100);
    });
  });

  describe("getSerieTemporal", () => {
    it("filtra por dias e retorna dados mapeados", async () => {
      const chain = getChain();
      (chain.order as ReturnType<typeof vi.fn>).mockReturnThis();
      (chain.gte as ReturnType<typeof vi.fn>).mockReturnThis();

      const since = new Date();
      since.setDate(since.getDate() - 7);

      // Mock do retorno: encadeamento final → array
      const finalChain = {
        ...chain,
        then: (cb: (v: { data: unknown; error: unknown }) => unknown) =>
          cb({
            data: [
              { dt_referencia: "2026-06-16", vl_faturado_dia: 100 },
              { dt_referencia: "2026-06-17", vl_faturado_dia: 200 },
            ],
            error: null,
          }),
      };
      (supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce(finalChain);

      const result = await biService.getSerieTemporal(COMPANY_ID, "faturamento", 7);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ data: "2026-06-16", valor: 100 });
      expect(result[1]).toEqual({ data: "2026-06-17", valor: 200 });
      expect(supabase.from).toHaveBeenCalledWith("bi_kpis_diarios");
      expect(chain.gte).toHaveBeenCalledWith("dt_referencia", expect.any(String));
    });

    it("mapeia corretamente o KPI 'taxa_no_show'", async () => {
      const result = biServiceHelpers.mapKpiToColumn("taxa_no_show");
      expect(result).toBe("nr_taxa_no_show");
    });

    it("mapeia corretamente o KPI 'agendamentos'", () => {
      expect(biServiceHelpers.mapKpiToColumn("agendamentos")).toBe("nr_agendamentos_total");
    });

    it("usa coluna padrão para KPI desconhecido", () => {
      expect(biServiceHelpers.mapKpiToColumn("xyz")).toBe("vl_faturado_dia");
    });
  });

  describe("recalcularKPIs", () => {
    it("chama RPC calcular_kpis_diarios com companyId e data", async () => {
      (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: null,
        error: null,
      });

      await biService.recalcularKPIs(COMPANY_ID, new Date("2026-06-22T00:00:00"));
      expect(supabase.rpc).toHaveBeenCalledWith("calcular_kpis_diarios", {
        p_company_id: COMPANY_ID,
        p_data: "2026-06-22",
      });
    });
  });

  describe("resolverAlerta", () => {
    it("atualiza lg_resolvido e dt_resolvido corretamente", async () => {
      const chain = getChain();
      (chain.eq as ReturnType<typeof vi.fn>).mockReturnThis();
      const updateChain = {
        ...chain,
        then: (cb: (v: { error: unknown }) => unknown) => cb({ error: null }),
      };
      (supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce(updateChain);

      await biService.resolverAlerta(42, "user-abc");

      expect(supabase.from).toHaveBeenCalledWith("bi_alertas");
      expect(chain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          lg_resolvido: true,
          cd_usuario_resolveu: "user-abc",
          dt_resolvido: expect.any(String),
        }),
      );
      expect(chain.eq).toHaveBeenCalledWith("id", 42);
    });
  });

  describe("getAlertasPendentes", () => {
    it("filtra por lg_resolvido=false e ordenação", async () => {
      const chain = getChain();
      (chain.order as ReturnType<typeof vi.fn>).mockReturnThis();
      const finalChain = {
        ...chain,
        then: (cb: (v: { data: unknown; error: unknown }) => unknown) =>
          cb({
            data: [
              {
                id: 1,
                company_id: COMPANY_ID,
                cd_kpi: "TAXA_NO_SHOW",
                ds_alerta: "Taxa alta",
                tp_severidade: "CRITICO",
                vl_atual: 30,
                vl_esperado: 10,
                ds_sugestao: null,
                dt_alerta: "2026-06-22T08:00:00Z",
                lg_resolvido: false,
                dt_resolvido: null,
                cd_usuario_resolveu: null,
                created_at: "2026-06-22T08:00:00Z",
              },
            ],
            error: null,
          }),
      };
      (supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce(finalChain);

      const result = await biService.getAlertasPendentes(COMPANY_ID);
      expect(result).toHaveLength(1);
      expect(result[0].lg_resolvido).toBe(false);
      expect(supabase.from).toHaveBeenCalledWith("bi_alertas");
    });
  });

  describe("createMeta", () => {
    it("insere meta com companyId do contexto", async () => {
      const chain = getChain();
      (chain.single as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: {
          id: 99,
          company_id: COMPANY_ID,
          cd_kpi: "OCUPACAO",
          vl_meta: 80,
          vl_atual: 0,
          tp_periodo: "MENSAL",
          dt_inicio: "2026-06-01",
          dt_fim: null,
          tp_comparacao: "IGUAL_MAIOR",
          ds_observacao: "Teste",
          cd_usuario_criou: null,
          created_at: "2026-06-22T10:00:00Z",
        },
        error: null,
      });

      const result = await biService.createMeta(COMPANY_ID, {
        cd_kpi: "OCUPACAO",
        vl_meta: 80,
        tp_periodo: "MENSAL",
      });
      expect(result.id).toBe(99);
      expect(supabase.from).toHaveBeenCalledWith("bi_metas");
      expect(chain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          company_id: COMPANY_ID,
          cd_kpi: "OCUPACAO",
          vl_meta: 80,
          tp_periodo: "MENSAL",
        }),
      );
    });
  });
});
