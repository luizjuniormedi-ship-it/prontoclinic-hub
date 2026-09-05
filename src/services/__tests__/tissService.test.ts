import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  tissService,
  validateTissTransmissionPrerequisites,
} from "@/services/tissService";
import { supabase } from "@/lib/supabase";

afterEach(() => {
  vi.clearAllMocks();
});

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: { getUser: vi.fn() },
  },
}));

describe("tissService numeric boundary", () => {
  it("normaliza DECIMAL string e null das faturas em números finitos", async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: [{
        id: 10,
        ds_versao_tiss: "4.03.00",
        tp_ambiente: "HOMOLOGACAO",
        status: "PENDENTE",
        created_at: "2026-07-26T00:00:00.000Z",
        updated_at: "2026-07-26T00:00:00.000Z",
        vl_informado: "150.75",
        vl_processado: null,
        vl_liberado: "100.25",
        vl_glosa: undefined,
      }],
      error: null,
    } as never);

    const [row] = await tissService.listFaturas("company-1");

    expect(row).toMatchObject({
      vl_informado: 150.75,
      vl_processado: 0,
      vl_liberado: 100.25,
      vl_glosa: 0,
    });
    expect(
      [row.vl_informado, row.vl_processado, row.vl_liberado, row.vl_glosa].every(
        (value) => typeof value === "number" && Number.isFinite(value)
      )
    ).toBe(true);
  });

  it("normaliza agregados PostgreSQL e nunca retorna NaN no dashboard", async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: [
        {
          cd_convenio: 1,
          convenio_name: "Assim Saúde",
          total_guias: "2",
          total_enviado: "100.50",
          total_processado: null,
          total_liberado: "80.25",
          total_glosado: "20.25",
          total_pago: "40.125",
          taxa_glosa_percent: "20.15",
          taxa_recebimento_percent: null,
        },
        {
          cd_convenio: 2,
          convenio_name: "Outro",
          total_guias: null,
          total_enviado: null,
          total_processado: "0",
          total_liberado: "0",
          total_glosado: null,
          total_pago: null,
          taxa_glosa_percent: null,
          taxa_recebimento_percent: null,
        },
      ],
      error: null,
    } as never);

    const result = await tissService.getEstatisticas("company-1", 2026);
    const numericValues = [
      result.total_guias,
      result.total_enviado,
      result.total_processado,
      result.total_liberado,
      result.total_glosado,
      result.total_pago,
      result.taxa_glosa_percent,
      result.taxa_recebimento_percent,
      ...result.por_convenio.flatMap((row) => [
        row.guias,
        row.informado,
        row.liberado,
        row.glosa,
        row.taxa_glosa,
      ]),
    ];

    expect(result).toMatchObject({
      total_guias: 2,
      total_enviado: 100.5,
      total_processado: 0,
      total_liberado: 80.25,
      total_glosado: 20.25,
      total_pago: 40.125,
      taxa_glosa_percent: 20.15,
      taxa_recebimento_percent: 50,
    });
    expect(numericValues.every(Number.isFinite)).toBe(true);
  });

  it("falha fechado quando um total agregado é inválido", async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: [
        {
          convenio_name: "Assim Saúde",
          total_guias: "1",
          total_enviado: "valor-corrompido",
          total_processado: "0",
          total_liberado: "0",
          total_glosado: "0",
          total_pago: "0",
          taxa_glosa_percent: "0",
        },
      ],
      error: null,
    } as never);

    await expect(tissService.getEstatisticas("company-1", 2026)).rejects.toThrow(
      /tiss_get_stats\[0\]\.total_enviado/
    );
  });

  it("falha fechado quando uma fatura contém DECIMAL inválido", async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: [{
        id: 11,
        vl_informado: "NaN",
        vl_processado: null,
        vl_liberado: null,
        vl_glosa: null,
      }],
      error: null,
    } as never);

    await expect(tissService.listFaturas("company-1")).rejects.toThrow(
      /m16_list_xml_secure\[0\]\.vl_informado/
    );
  });

  it("usa a leitura segura e filtra o mês sem consultar a tabela", async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: [
        { id: 1, dt_fatura: "2026-07-10", status: "PENDENTE" },
        { id: 2, dt_fatura: "2026-08-10", status: "PENDENTE" },
      ],
      error: null,
    } as never);

    const result = await tissService.listFaturas("company-1", { mes: 7, ano: 2026 });

    expect(result.map((row) => row.id)).toEqual([1]);
    expect(supabase.rpc).toHaveBeenCalledWith("m16_list_xml_secure", {
      p_year: 2026,
      p_limit: 500,
    });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("bloqueia qualquer retorno no cliente antes de RPC ou persistência", async () => {
    await expect(
      tissService.processReturn(
        10,
        "<retorno><protocolo>HOM-001</protocolo><valorProcessado>150</valorProcessado></retorno>"
      )
    ).rejects.toThrow(/XSD oficial.*gateway servidor homologado/);
    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});

describe("tissService secure lifecycle RPCs", () => {
  it("não reintroduz leitura direta das tabelas protegidas do domínio TISS", () => {
    const serviceSources = [
      "src/services/tissService.ts",
      "src/services/tissGuideService.ts",
    ].map((path) => readFileSync(resolve(process.cwd(), path), "utf8")).join("\n");

    expect(serviceSources).not.toMatch(
      /\.from\("(?:tiss_xml|tiss_glosas|tiss_protocols|tiss_guides)"\)/,
    );
    expect(serviceSources).toContain("m16_list_xml_secure");
    expect(serviceSources).toContain("m16_list_denials_secure");
    expect(serviceSources).toContain("m16_list_protocols_secure");
    expect(serviceSources).toContain("m16_list_guides_secure");
    expect(serviceSources).toContain("m16_get_xml_document_secure");
    expect(serviceSources).not.toContain("buildTissXml");
    expect(serviceSources).not.toContain("buildTissLoteGuiasSoapEnvelope");
    expect(serviceSources).not.toContain("calculateTissTransactionMd5");
    expect(serviceSources.match(/m16_materialize_account_tiss_secure/g)).toHaveLength(1);
  });

  it("registra glosa e lê o resultado somente pelas RPCs seguras", async () => {
    vi.mocked(supabase.rpc)
      .mockResolvedValueOnce({
        data: { id: 91, tiss_xml_id: 10, vl_glosa: 25, status: "GLOSADO" },
        error: null,
      } as never)
      .mockResolvedValueOnce({
        data: [{
          id: 91,
          tiss_xml_id: 10,
          cd_glosa_code: "7101",
          ds_motivo: "Teste",
          vl_glosa: "25.00",
          dt_glosa: "2026-07-26",
          lg_recurso_enviado: false,
          ds_status_recurso: "PENDENTE",
          created_at: "2026-07-26T00:00:00.000Z",
          updated_at: "2026-07-26T00:00:00.000Z",
        }],
        error: null,
      } as never);

    const result = await tissService.registrarGlosa(10, "Teste", 25, "7101");

    expect(result).toMatchObject({ id: 91, vl_glosa: 25 });
    expect(supabase.rpc).toHaveBeenCalledWith(
      "m16_record_manual_denial_secure",
      expect.objectContaining({
        p_operation_id: expect.any(String),
        p_tiss_xml_id: 10,
        p_reason: "Teste",
        p_amount: 25,
        p_code: "7101",
      })
    );
    expect(supabase.rpc).toHaveBeenLastCalledWith(
      "m16_list_denials_secure",
      { p_tiss_xml_id: 10, p_limit: 500 },
    );
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("lista todas as glosas do contexto ativo sem filtro de XML", async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: [{
        id: 92,
        tiss_xml_id: 11,
        vl_glosa: "42.50",
        dt_glosa: "2026-07-29",
        lg_recurso_enviado: false,
        ds_status_recurso: "PENDENTE",
      }],
      error: null,
    } as never);

    await expect(tissService.listGlosas()).resolves.toEqual([
      expect.objectContaining({ id: 92, cd_tiss_xml: 11, vl_glosa: 42.5 }),
    ]);
    expect(supabase.rpc).toHaveBeenCalledWith("m16_list_denials_secure", {
      p_tiss_xml_id: null,
      p_limit: 500,
    });
  });

  it("fecha lote mensal somente pela RPC idempotente", async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: { lote: "123", total_xmls: "2", vl_total: "150.50" },
      error: null,
    } as never);

    await expect(
      tissService.gerarFaturaMensal(7, 2026, "company-1")
    ).resolves.toEqual({ lote: 123, total_xmls: 2, vl_total: 150.5 });
    expect(supabase.rpc).toHaveBeenCalledWith(
      "m16_generate_monthly_batch_secure",
      {
        p_operation_id: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
        ),
        p_competence: "2026-07-01",
      }
    );
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("reutiliza a mesma chave idempotente para empresa e competência", async () => {
    vi.mocked(supabase.rpc)
      .mockResolvedValueOnce({
        data: { lote: "123", total_xmls: "2", vl_total: "150.50" },
        error: null,
      } as never)
      .mockResolvedValueOnce({
        data: { lote: "123", total_xmls: "2", vl_total: "150.50" },
        error: null,
      } as never);

    await tissService.gerarFaturaMensal(7, 2026, "company-1");
    await tissService.gerarFaturaMensal(7, 2026, "company-1");

    const firstPayload = vi.mocked(supabase.rpc).mock.calls[0][1] as {
      p_operation_id: string;
    };
    const secondPayload = vi.mocked(supabase.rpc).mock.calls[1][1] as {
      p_operation_id: string;
    };
    expect(firstPayload.p_operation_id).toBe(secondPayload.p_operation_id);
  });

  it("salva protocolo somente pela RPC e valida o tenant retornado", async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: {
        id: 12,
        company_id: "company-1",
        cd_convenio: 3,
        ds_endpoint: "https://homologacao.invalid/tiss",
        ds_versao_tiss: "4.03.00",
        tp_ambiente: "HOMOLOGACAO",
        lg_active: true,
      },
      error: null,
    } as never);

    const result = await tissService.saveProtocol("company-1", {
      cd_convenio: 3,
      ds_endpoint: "https://homologacao.invalid/tiss",
    });

    expect(result).toMatchObject({ id: 12, company_id: "company-1" });
    expect(supabase.rpc).toHaveBeenCalledWith("m16_save_protocol_secure", {
      p_operation_id: expect.any(String),
      p_payload: expect.objectContaining({
        cd_convenio: 3,
        ds_endpoint: "https://homologacao.invalid/tiss",
      }),
    });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("não expõe transmissor HTTP no serviço cliente", () => {
    expect(tissService).not.toHaveProperty("sendToOperadora");
  });
});

describe("validateTissTransmissionPrerequisites", () => {
  it("retorna somente o XML persistido quando versão e transporte servidor são válidos", () => {
    expect(
      validateTissTransmissionPrerequisites({
        xmlBody:
          "  <ans:mensagemTISS><ans:Padrao>4.03.00</ans:Padrao><ans:epilogo><ans:hash>0123456789abcdef0123456789abcdef</ans:hash></ans:epilogo></ans:mensagemTISS>  ",
        xmlVersion: "4.03.00",
        protocolVersion: "4.03.00",
        hasServerTransport: true,
      })
    ).toContain("<ans:Padrao>4.03.00</ans:Padrao>");
  });

  it("bloqueia ausência de XML, versão divergente e transporte do navegador", () => {
    expect(() =>
      validateTissTransmissionPrerequisites({
        xmlVersion: "04.03.00",
        protocolVersion: "4.03.00",
        hasServerTransport: true,
      })
    ).toThrow(/XML TISS ausente/);

    expect(() =>
      validateTissTransmissionPrerequisites({
        xmlBody: "<ans:mensagemTISS><ans:Padrao>3.05.00</ans:Padrao></ans:mensagemTISS>",
        xmlVersion: "3.05.00",
        protocolVersion: "04.03.00",
        hasServerTransport: true,
      })
    ).toThrow(/Versão TISS incompatível/);

    expect(() =>
      validateTissTransmissionPrerequisites({
        xmlBody:
          "<ans:mensagemTISS><ans:Padrao>4.03.00</ans:Padrao><ans:epilogo><ans:hash>0123456789abcdef0123456789abcdef</ans:hash></ans:epilogo></ans:mensagemTISS>",
        xmlVersion: "4.03.00",
        protocolVersion: "4.03.00",
        hasServerTransport: false,
      })
    ).toThrow(/direta pelo navegador está desabilitada/);
  });

  it("bloqueia versão declarada divergente e hash de homologação pendente", () => {
    expect(() =>
      validateTissTransmissionPrerequisites({
        xmlBody: "<ans:mensagemTISS><ans:Padrao>4.02.00</ans:Padrao></ans:mensagemTISS>",
        xmlVersion: "4.03.00",
        protocolVersion: "4.03.00",
        hasServerTransport: true,
      })
    ).toThrow(/Versão declarada no XML/);

    expect(() =>
      validateTissTransmissionPrerequisites({
        xmlBody:
          "<ans:mensagemTISS><ans:Padrao>4.03.00</ans:Padrao><ans:epilogo><ans:hash>00000000000000000000000000000000</ans:hash></ans:epilogo></ans:mensagemTISS>",
        xmlVersion: "4.03.00",
        protocolVersion: "4.03.00",
        hasServerTransport: true,
      })
    ).toThrow(/Hash MD5 TISS ausente ou pendente/);
  });
});
