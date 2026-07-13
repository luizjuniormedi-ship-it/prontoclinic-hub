import { beforeEach, describe, expect, it, vi } from "vitest";
import { tissService } from "@/services/tissService";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: { getUser: vi.fn() },
  },
}));

import { supabase } from "@/lib/supabase";

function queryChain(result = { data: [], error: null }) {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(result),
  };
  return chain;
}

describe("tissService.listFaturas", () => {
  beforeEach(() => vi.clearAllMocks());

  it("consulta colunas locais sem relacionamento PostgREST ausente", async () => {
    const chain = queryChain();
    (supabase.from as any).mockReturnValue(chain);

    await tissService.listFaturas("company-1");

    expect(supabase.from).toHaveBeenCalledWith("tiss_xml");
    expect(chain.select).toHaveBeenCalledWith("*");
    expect(chain.eq).toHaveBeenCalledWith("company_id", "company-1");
    expect(chain.eq).toHaveBeenCalledWith("lg_deletado", false);
    expect(chain.limit).toHaveBeenCalledWith(500);
  });

  it("filtra o mes inteiro, inclusive fevereiro bissexto", async () => {
    const chain = queryChain();
    (supabase.from as any).mockReturnValue(chain);

    await tissService.listFaturas("company-1", { mes: 2, ano: 2024 });

    expect(chain.gte).toHaveBeenCalledWith("dt_fatura", "2024-02-01");
    expect(chain.lte).toHaveBeenCalledWith("dt_fatura", "2024-02-29");
  });

  it("filtra o ano completo quando o mes nao e informado", async () => {
    const chain = queryChain();
    (supabase.from as any).mockReturnValue(chain);

    await tissService.listFaturas("company-1", { ano: 2026 });

    expect(chain.gte).toHaveBeenCalledWith("dt_fatura", "2026-01-01");
    expect(chain.lte).toHaveBeenCalledWith("dt_fatura", "2026-12-31");
  });

  it("propaga erro do banco para a camada de interface", async () => {
    const chain = queryChain({ data: null, error: { message: "DB indisponivel" } });
    (supabase.from as any).mockReturnValue(chain);

    await expect(tissService.listFaturas("company-1")).rejects.toMatchObject({
      message: "DB indisponivel",
    });
  });
});

describe("tissService safety gates", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });

  function expectNoBrowserSideEffects() {
    expect(fetchMock).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(supabase.auth.getUser).not.toHaveBeenCalled();
  }

  it("bloqueia transmissao SOAP no navegador antes de qualquer acesso externo", async () => {
    await expect(tissService.sendToOperadora(10)).rejects.toThrow(
      "Transmissao TISS bloqueada"
    );
    expectNoBrowserSideEffects();
  });

  it("bloqueia a geracao mensal legada que nao possui contrato transacional", async () => {
    await expect(tissService.gerarFaturaMensal(7, 2026, "company-1")).rejects.toThrow(
      "Geracao mensal TISS bloqueada"
    );
    expectNoBrowserSideEffects();
  });

  it("bloqueia generateXML antes de qualquer fetch ou acesso Supabase", async () => {
    await expect(
      tissService.generateXML(10, {
        tipoGuia: "CONSULTA",
        cd_convenio: 20,
        cd_paciente: 30,
        cd_profissional: 40,
        nr_carteira: "123",
        procedimentos: [],
      })
    ).rejects.toThrow("Geracao XML TISS bloqueada no navegador");
    expectNoBrowserSideEffects();
  });

  it("bloqueia processReturn antes de qualquer fetch ou acesso Supabase", async () => {
    await expect(tissService.processReturn(10, "<retorno />")).rejects.toThrow(
      "Processamento de retorno TISS bloqueado no navegador"
    );
    expectNoBrowserSideEffects();
  });

  it("bloqueia registrarGlosa antes de qualquer fetch ou acesso Supabase", async () => {
    await expect(tissService.registrarGlosa(10, "Motivo", 100, "7101")).rejects.toThrow(
      "Registro de glosa TISS bloqueado no navegador"
    );
    expectNoBrowserSideEffects();
  });

  it("bloqueia enviarRecurso antes de qualquer fetch ou acesso Supabase", async () => {
    await expect(tissService.enviarRecurso(10, "<recurso />")).rejects.toThrow(
      "Envio de recurso TISS bloqueado no navegador"
    );
    expectNoBrowserSideEffects();
  });

  it("bloqueia saveProtocol antes de qualquer fetch ou acesso Supabase", async () => {
    await expect(
      tissService.saveProtocol("company-1", {
        cd_convenio: 20,
        ds_endpoint: "https://operadora.invalid/tiss",
      })
    ).rejects.toThrow("Configuracao de protocolo TISS bloqueada no navegador");
    expectNoBrowserSideEffects();
  });
});
