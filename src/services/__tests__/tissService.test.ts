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

describe("tissService.listFaturas", () => {
  beforeEach(() => vi.clearAllMocks());

  it("usa a RPC tenant-safe sem receber company_id do navegador", async () => {
    (supabase.rpc as any).mockResolvedValue({ data: [], error: null });

    await tissService.listFaturas({
      mes: 7,
      ano: 2026,
      insurance_company_id: 15,
    });

    expect(supabase.rpc).toHaveBeenCalledWith("list_tiss_read_model_secure", {
      p_year: 2026,
      p_month: 7,
      p_insurance_company_id: 15,
    });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("mapeia somente o DTO canonico e elimina cd_convenio da projecao", async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: [{
        tiss_xml_id: 10,
        billing_id: 20,
        appointment_id: null,
        patient_id: null,
        insurance_plan_id: 30,
        insurance_company_id: 40,
        insurance_company_name: "Operator A",
        insurance_plan_name: "Plan A",
        billing_amount: "125.50",
        tiss_created_at: "2026-07-10T12:00:00Z",
        cd_convenio: 999,
        dt_fatura: "2026-07-10",
        status: "PENDENTE",
      }],
      error: null,
    });

    const [row] = await tissService.listFaturas();

    expect(row.billing_amount).toBe(125.5);
    expect(row.insurance_company_name).toBe("Operator A");
    expect(row).not.toHaveProperty("cd_convenio");
    expect(row).not.toHaveProperty("dt_fatura");
    expect(row).not.toHaveProperty("status");
  });

  it("propaga erro do banco para a camada de interface", async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: null,
      error: { message: "DB indisponivel" },
    });

    await expect(tissService.listFaturas()).rejects.toMatchObject({
      message: "DB indisponivel",
    });
  });

  it("rejeita DTO de guia com ID, valor ou data essencial invalida sem ecoar o payload", async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: [{
        tiss_xml_id: 0,
        billing_id: 20,
        appointment_id: null,
        patient_id: null,
        insurance_plan_id: 30,
        insurance_company_id: 40,
        insurance_company_name: "Operator A",
        insurance_plan_name: "Plan A",
        billing_amount: "valor-secreto-invalido",
        tiss_created_at: "data-invalida",
      }],
      error: null,
    });

    await expect(tissService.listFaturas()).rejects.toThrow("Resposta TISS invalida para guias.");
    await expect(tissService.listFaturas()).rejects.not.toThrow("valor-secreto-invalido");
  });
});

describe("tissService tenant-safe read models", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lista glosas por RPC sem company_id e descarta campos extras", async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: [{
        id: 1,
        tiss_xml_id: 2,
        billing_id: 3,
        denial_code: "7101",
        denial_reason: "Motivo",
        denial_amount: "12.50",
        denial_date: "2026-07-12",
        appeal_sent: false,
        appeal_date: null,
        appeal_protocol: null,
        appeal_status: "PENDENTE",
        procedure_code: null,
        executor_code: null,
        created_at: "2026-07-12T12:00:00Z",
        updated_at: "2026-07-12T12:00:00Z",
        company_id: "tenant-canary",
        bl_xml_recurso: "secret-canary",
      }],
      error: null,
    });

    const [row] = await tissService.listGlosas(2);

    expect(supabase.rpc).toHaveBeenCalledWith("list_tiss_glosas_read_secure", {
      p_tiss_xml_id: 2,
    });
    expect(row.denial_amount).toBe(12.5);
    expect(row).not.toHaveProperty("company_id");
    expect(row).not.toHaveProperty("bl_xml_recurso");
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("lista protocolos sem argumentos e elimina todos os canarios secretos", async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: [{
        id: 10,
        insurance_company_id: 20,
        insurance_company_name: "Operator A",
        tiss_version: "3.05.00",
        environment: "HOMOLOGACAO",
        active: true,
        last_test_at: null,
        last_test_status: null,
        created_at: "2026-07-12T12:00:00Z",
        updated_at: "2026-07-12T12:00:00Z",
        company_id: "tenant-canary",
        ds_endpoint: "https://secret.invalid",
        ds_certificado_senha: "secret-canary",
        ds_observacao: "private-note",
      }],
      error: null,
    });

    const [row] = await tissService.listProtocols();

    expect(supabase.rpc).toHaveBeenCalledWith("list_tiss_protocols_read_secure");
    expect(row.insurance_company_name).toBe("Operator A");
    expect(row).not.toHaveProperty("company_id");
    expect(row).not.toHaveProperty("ds_endpoint");
    expect(row).not.toHaveProperty("ds_certificado_senha");
    expect(row).not.toHaveProperty("ds_observacao");
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("rejeita glosa com valor, data ou status fora do contrato", async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: [{
        id: 1,
        tiss_xml_id: 2,
        billing_id: null,
        denial_code: null,
        denial_reason: null,
        denial_amount: -1,
        denial_date: "2026-02-30",
        appeal_sent: false,
        appeal_date: null,
        appeal_protocol: null,
        appeal_status: "DESCONHECIDO",
        procedure_code: null,
        executor_code: null,
        created_at: "2026-07-12T12:00:00Z",
        updated_at: "2026-07-12T12:00:00Z",
      }],
      error: null,
    });

    await expect(tissService.listGlosas()).rejects.toThrow("Resposta TISS invalida para glosas.");
  });

  it("rejeita protocolo com IDs, ambiente ou datas essenciais invalidos", async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: [{
        id: 10,
        insurance_company_id: -20,
        insurance_company_name: "Operator A",
        tiss_version: "3.05.00",
        environment: "SANDBOX",
        active: true,
        last_test_at: "ontem",
        last_test_status: null,
        created_at: "2026-07-12T12:00:00Z",
        updated_at: "2026-07-12T12:00:00Z",
      }],
      error: null,
    });

    await expect(tissService.listProtocols()).rejects.toThrow("Resposta TISS invalida para protocolos.");
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

  it("bloqueia a geracao de XML de recurso antes de qualquer leitura direta", async () => {
    await expect(tissService.gerarXMLRecurso(10)).rejects.toThrow(
      "Geracao de recurso TISS bloqueada no navegador"
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
