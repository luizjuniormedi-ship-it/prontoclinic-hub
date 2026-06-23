import { describe, it, expect, vi, beforeEach } from "vitest";
import { auditService } from "@/services/auditService";

// Mock do Supabase com chain mockável
vi.mock("@/lib/supabase", () => {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
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

// ── Helpers ──
function rowLog(over: Partial<any> = {}) {
  return {
    id: 1,
    company_id: "company-uuid",
    dt_evento: "2026-06-22T12:00:00Z",
    cd_usuario: "user-1",
    cd_usuario_nome: "Dr. House",
    role_name: "doctor",
    acao: "INSERT",
    tabela: "patients",
    registro_id: "p-123",
    operacao: "INSERT",
    dados_anteriores: null,
    dados_novos: { name: "João" },
    ip_origem: "10.0.0.1",
    user_agent: "Chrome/120",
    request_id: "req-abc",
    dt_retencao: "2031-06-22T12:00:00Z",
    ...over,
  };
}

// ── logAcao / logDataAccess / logLogin ──
// O service expõe `logApiAccess(tabela, registroId, acao, contexto)` que cobre
// os três cenários solicitados via RPC `log_data_access`.
describe("auditService — logAcao (insert em audit_logs via logApiAccess)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logAcao: registra ação genérica com campos corretos (RPC)", async () => {
    (supabase.rpc as any).mockResolvedValue({ data: null, error: null });

    await auditService.logApiAccess(
      "patients",
      "p-123",
      "INSERT",
      { origem: "UI", ip: "10.0.0.1" },
    );

    expect(supabase.rpc).toHaveBeenCalledWith("log_data_access", {
      p_tabela: "patients",
      p_registro_id: "p-123",
      p_acao: "INSERT",
      p_contexto: { origem: "UI", ip: "10.0.0.1" },
    });
  });

  it("logAcao: aceita contexto vazio (default {})", async () => {
    (supabase.rpc as any).mockResolvedValue({ data: null, error: null });

    await auditService.logApiAccess("appointments", "a-1", "UPDATE");

    expect(supabase.rpc).toHaveBeenCalledWith("log_data_access", {
      p_tabela: "appointments",
      p_registro_id: "a-1",
      p_acao: "UPDATE",
      p_contexto: {},
    });
  });

  it("logAcao: NÃO lança erro quando Supabase retorna error (não-bloqueante)", async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: null,
      error: { message: "RPC falhou" },
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      auditService.logApiAccess("patients", "p-1", "VIEW_RECORD"),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("logAcao: NÃO lança erro quando RPC rejeita (try/catch)", async () => {
    (supabase.rpc as any).mockRejectedValue(new Error("network down"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      auditService.logApiAccess("patients", "p-1", "VIEW_RECORD"),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("auditService — logDataAccess (LGPD: VIEW_RECORD em prontuário/paciente)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logDataAccess: chama RPC com tabela=pacientes e ação=VIEW_RECORD", async () => {
    (supabase.rpc as any).mockResolvedValue({ data: null, error: null });

    await auditService.logApiAccess("patients", "p-123", "VIEW_RECORD", {
      motivo: "consulta_rotina",
    });

    expect(supabase.rpc).toHaveBeenCalledWith("log_data_access", {
      p_tabela: "patients",
      p_registro_id: "p-123",
      p_acao: "VIEW_RECORD",
      p_contexto: { motivo: "consulta_rotina" },
    });
  });

  it("logDataAccess: registra motivo/contexto LGPD no payload", async () => {
    (supabase.rpc as any).mockResolvedValue({ data: null, error: null });

    await auditService.logApiAccess("medical_records", "r-9", "VIEW_RECORD", {
      motivo: "auditoria_DPO",
      base_legal: "Art. 37 LGPD",
    });

    const call = (supabase.rpc as any).mock.calls[0];
    expect(call[1].p_contexto.motivo).toBe("auditoria_DPO");
    expect(call[1].p_contexto.base_legal).toBe("Art. 37 LGPD");
  });
});

describe("auditService — logLogin (ação LOGIN)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logLogin: chama RPC com acao=LOGIN e contexto contendo ip", async () => {
    (supabase.rpc as any).mockResolvedValue({ data: null, error: null });

    await auditService.logApiAccess("auth", "user-1", "LOGIN", {
      ip: "203.0.113.5",
      user_agent: "Mozilla/5.0",
    });

    expect(supabase.rpc).toHaveBeenCalledWith("log_data_access", {
      p_tabela: "auth",
      p_registro_id: "user-1",
      p_acao: "LOGIN",
      p_contexto: { ip: "203.0.113.5", user_agent: "Mozilla/5.0" },
    });
  });
});

// ── getAll com paginação cobre getAcoesPorTabela/getAcoesPorUsuario/getAcoesPorPeriodo ──
describe("auditService — getAcoesPorTabela (getAll + filtro tabela + paginação)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getAcoesPorTabela: aplica filtro eq(tabela) e calcula range(page, pageSize)", async () => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
    };
    (chain as any).then = (resolve: any) =>
      resolve({ data: [rowLog()], error: null, count: 1 });
    (supabase.from as any).mockReturnValue(chain);

    // page 2, pageSize 10 → range(10, 19)
    const result = await auditService.getAll({
      tabela: "patients",
      page: 2,
      pageSize: 10,
    });

    expect(supabase.from).toHaveBeenCalledWith("audit_logs");
    expect(chain.eq).toHaveBeenCalledWith("tabela", "patients");
    expect(chain.range).toHaveBeenCalledWith(10, 19);
    expect(result).toHaveLength(1);
    expect(result[0].entity).toBe("patients");
  });

  it("getAcoesPorTabela: limit/offset derivados de pageSize e page default", async () => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
    };
    (chain as any).then = (resolve: any) =>
      resolve({ data: [], error: null });
    (supabase.from as any).mockReturnValue(chain);

    await auditService.getAll({ tabela: "appointments" });
    // default page=1, pageSize=50 → range(0, 49)
    expect(chain.range).toHaveBeenCalledWith(0, 49);
    expect(chain.eq).toHaveBeenCalledWith("tabela", "appointments");
  });

  it("getAcoesPorTabela: lança erro quando Supabase retorna error", async () => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
    };
    (chain as any).then = (resolve: any) =>
      resolve({ data: null, error: { message: "DB offline" } });
    (supabase.from as any).mockReturnValue(chain);

    await expect(
      auditService.getAll({ tabela: "patients" }),
    ).rejects.toThrow(/DB offline/);
  });
});

describe("auditService — getAcoesPorUsuario (getByUser com limit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getAcoesPorUsuario: filtra por cd_usuario e últimos 30 dias por padrão", async () => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
    };
    (chain as any).then = (resolve: any) =>
      resolve({ data: [rowLog()], error: null });
    (supabase.from as any).mockReturnValue(chain);

    const result = await auditService.getByUser("user-1");
    expect(chain.eq).toHaveBeenCalledWith("cd_usuario", "user-1");
    expect(chain.gte).toHaveBeenCalledTimes(1);
    expect(chain.order).toHaveBeenCalledWith("dt_evento", { ascending: false });
    expect(result).toHaveLength(1);
    expect(result[0].userId).toBe("user-1");
  });

  it("getAcoesPorUsuario: aceita janela custom (days)", async () => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
    };
    (chain as any).then = (resolve: any) =>
      resolve({ data: [], error: null });
    (supabase.from as any).mockReturnValue(chain);

    await auditService.getByUser("user-2", 7);
    expect(chain.eq).toHaveBeenCalledWith("cd_usuario", "user-2");
    expect(chain.gte).toHaveBeenCalledTimes(1);
  });

  it("getAcoesPorUsuario: lança erro quando Supabase falha", async () => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
    };
    (chain as any).then = (resolve: any) =>
      resolve({ data: null, error: { message: "boom" } });
    (supabase.from as any).mockReturnValue(chain);

    await expect(auditService.getByUser("user-1")).rejects.toThrow(/boom/);
  });
});

describe("auditService — getAcoesPorPeriodo (getAll com data_inicio/data_fim)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getAcoesPorPeriodo: aplica gte(dt_evento, inicio) e lte(dt_evento, fim)", async () => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
    };
    (chain as any).then = (resolve: any) =>
      resolve({ data: [rowLog()], error: null });
    (supabase.from as any).mockReturnValue(chain);

    const result = await auditService.getAll({
      data_inicio: "2026-06-01T00:00:00Z",
      data_fim: "2026-06-30T23:59:59Z",
    });

    expect(chain.gte).toHaveBeenCalledWith("dt_evento", "2026-06-01T00:00:00Z");
    expect(chain.lte).toHaveBeenCalledWith("dt_evento", "2026-06-30T23:59:59Z");
    expect(result).toHaveLength(1);
  });

  it("getAcoesPorPeriodo: ignora filtros ausentes", async () => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
    };
    (chain as any).then = (resolve: any) =>
      resolve({ data: [], error: null });
    (supabase.from as any).mockReturnValue(chain);

    await auditService.getAll({});
    expect(chain.gte).not.toHaveBeenCalled();
    expect(chain.lte).not.toHaveBeenCalled();
    expect(chain.eq).not.toHaveBeenCalled();
  });
});

// ── exportLGPD → exportar() ──
describe("auditService — exportLGPD (exportar)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exportLGPD: gera relatório com total, filtros e eventos", async () => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    };
    (chain as any).then = (resolve: any) =>
      resolve({ data: [rowLog(), rowLog({ id: 2 })], error: null });
    (supabase.from as any).mockReturnValue(chain);

    const exp = await auditService.exportar({
      tabela: "patients",
      data_inicio: "2026-01-01T00:00:00Z",
      data_fim: "2026-12-31T23:59:59Z",
    });

    expect(exp.geradoEm).toBeDefined();
    expect(exp.filtros.tabela).toBe("patients");
    expect(exp.filtros.pageSize).toBe(5000); // limite de segurança
    expect(exp.total).toBe(2);
    expect(exp.eventos).toHaveLength(2);
  });

  it("exportLGPD: aplica filtros em memória após query", async () => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    };
    (chain as any).then = (resolve: any) =>
      resolve({
        data: [
          rowLog({ id: 1, tabela: "patients", acao: "INSERT" }),
          rowLog({ id: 2, tabela: "appointments", acao: "UPDATE" }),
          rowLog({ id: 3, tabela: "patients", acao: "DELETE" }),
        ],
        error: null,
      });
    (supabase.from as any).mockReturnValue(chain);

    const exp = await auditService.exportar({
      tabela: "patients",
      acao: "DELETE",
    });

    expect(exp.total).toBe(1);
    expect(exp.eventos[0].id).toBe(3);
    expect(exp.eventos[0].tabela).toBe("patients");
    expect(exp.eventos[0].acao).toBe("DELETE");
  });

  it("exportLGPD: retorna total=0 quando Supabase devolve array vazio", async () => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    };
    (chain as any).then = (resolve: any) =>
      resolve({ data: [], error: null });
    (supabase.from as any).mockReturnValue(chain);

    const exp = await auditService.exportar({});
    expect(exp.total).toBe(0);
    expect(exp.eventos).toEqual([]);
  });

  it("exportLGPD: lança erro quando Supabase retorna error", async () => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    };
    (chain as any).then = (resolve: any) =>
      resolve({ data: null, error: { message: "export failed" } });
    (supabase.from as any).mockReturnValue(chain);

    await expect(auditService.exportar({})).rejects.toThrow(/export failed/);
  });

  it("exportLGPD: respeita limite de segurança (5000) mesmo com pageSize maior", async () => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    };
    (chain as any).then = (resolve: any) =>
      resolve({ data: [], error: null });
    (supabase.from as any).mockReturnValue(chain);

    await auditService.exportar({ pageSize: 50000 });
    expect(chain.limit).toHaveBeenCalledWith(5000);
  });
});

// ── Bonus: getTabelasAuditaveis e getAcoesAuditaveis ──
describe("auditService — helpers estáticos", () => {
  it("getTabelasAuditaveis retorna lista canônica", async () => {
    const tabelas = await auditService.getTabelasAuditaveis();
    expect(tabelas).toContain("patients");
    expect(tabelas).toContain("medical_records");
    expect(tabelas.length).toBeGreaterThan(0);
  });

  it("getAcoesAuditaveis inclui VIEW_RECORD (LGPD)", () => {
    const acoes = auditService.getAcoesAuditaveis();
    expect(acoes).toContain("VIEW_RECORD");
    expect(acoes).toContain("LOGIN");
    expect(acoes).toContain("LOGOUT");
  });
});
