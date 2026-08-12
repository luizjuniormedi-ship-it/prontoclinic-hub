import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TISS_COMMUNICATION_VERSION,
  buildTissLoteGuiasSoapEnvelope,
  buildTissXml,
  calculateTissTransactionMd5,
  tissService,
  validateTissTransmissionPrerequisites,
} from "@/services/tissService";
import { supabase } from "@/lib/supabase";

const tiss403Required = {
  cnes: "3041379",
  professionalCouncilCode: "06",
  professionalStateCode: "33",
  professionalCbos: "225125",
  atendimentoRN: "N" as const,
  caraterAtendimento: "1" as const,
  tipoAtendimento: "23" as const,
  indicadorAcidente: "9" as const,
  regimeAtendimento: "01" as const,
};

const transportXml = `<ans:mensagemTISS xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas">
  <ans:cabecalho><ans:Padrao>4.03.00</ans:Padrao></ans:cabecalho>
  <ans:prestadorParaOperadora><ans:loteGuias><ans:numeroLote>1</ans:numeroLote></ans:loteGuias></ans:prestadorParaOperadora>
  <ans:epilogo><ans:hash>0123456789abcdef0123456789abcdef</ans:hash></ans:epilogo>
</ans:mensagemTISS>`;

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

describe("buildTissXml", () => {
  it("calcula MD5 TISS conhecido sobre os valores, sem tags", () => {
    expect(calculateTissTransactionMd5("<raiz><valor>abc</valor></raiz>")).toBe(
      "900150983CD24FB0D6963F7D28E17F72"
    );
  });

  it("monta uma guia SP/SADT sintética sem efeitos colaterais", () => {
    const result = buildTissXml({
      appointmentId: 108474,
      tipoGuia: "SP/SADT",
      nr_carteira: "ASSIM-TESTE-001",
      cd_atendimento: "ATD-TESTE-001",
      pacienteNome: "Paciente <Teste> & Homologacao",
      profissionalNome: "Dra. Teste",
      professionalLicense: "123456",
      providerCnpj: "00.000.000/0001-00",
      registroAns: "999999",
      ...tiss403Required,
      procedimentos: [
        {
          cd_tuss: "10101012",
          ds_procedimento: "Consulta <sintetica>",
          qt: 1,
          vl_unitario: 150,
        },
      ],
      agora: new Date("2026-07-15T12:00:00.000Z"),
    });

    expect(result.vlTotal).toBe(150);
    expect(result.xml).toContain('<?xml version="1.0" encoding="ISO-8859-1"?>');
    expect(result.xml).toContain(`<ans:Padrao>${TISS_COMMUNICATION_VERSION}</ans:Padrao>`);
    expect(result.xml).not.toContain('versao="3.05.00"');
    expect(result.xml).toContain("<ans:guiaSP-SADT>");
    expect(result.xml).toContain("<ans:guiasTISS>");
    expect(result.xml).toContain("ATD-TESTE-001");
    expect(result.xml).not.toContain("Paciente &lt;Teste&gt; &amp; Homologacao");
    expect(result.xml).toContain("Consulta &lt;sintetica&gt;");
    expect(result.xml).toContain("<ans:valorTotalGeral>150.00</ans:valorTotalGeral>");
    expect(result.hash).toMatch(/^[A-F0-9]{32}$/);
    expect(result.hash).not.toBe("00000000000000000000000000000000");
    expect(result.xml).toContain(`<ans:hash>${result.hash}</ans:hash>`);
    expect(calculateTissTransactionMd5(result.xml)).toBe(result.hash);
  });

  it("monta o wrapper loteGuiasWS definido pelo WSDL SOAP 1.1", () => {
    const soap = buildTissLoteGuiasSoapEnvelope(transportXml);
    expect(soap).toContain('xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"');
    expect(soap).toContain("<ans:loteGuiasWS>");
    expect(soap).toContain("<ans:hash>0123456789abcdef0123456789abcdef</ans:hash>");
    expect(soap).not.toContain("<ans:mensagemTISS");
  });

  it("falha fechado quando faltam metadados obrigatórios do XSD 04.03.00", () => {
    expect(() =>
      buildTissXml({
        appointmentId: 1,
        tipoGuia: "SP/SADT",
        nr_carteira: "CARTEIRA-1",
        pacienteNome: "Paciente",
        profissionalNome: "Medico",
        professionalLicense: "123",
        providerCnpj: "00000000000100",
        registroAns: "999999",
        procedimentos: [{ cd_tuss: "10101012", ds_procedimento: "Teste", qt: 1, vl_unitario: 1 }],
      })
    ).toThrow(/Dados obrigatórios TISS 04\.03\.00 ausentes/);
  });

  it("falha fechado sem propagar NaN ou Infinity para valores da guia", () => {
    const baseInput = {
      appointmentId: 1,
      tipoGuia: "SP/SADT" as const,
      nr_carteira: "CARTEIRA-1",
      pacienteNome: "Paciente",
      profissionalNome: "Medico",
      professionalLicense: "123",
      providerCnpj: "00000000000100",
      registroAns: "999999",
      ...tiss403Required,
      procedimentos: [{ cd_tuss: "10101012", ds_procedimento: "Teste", qt: 1, vl_unitario: 1 }],
    };

    expect(() =>
      buildTissXml({
        ...baseInput,
        procedimentos: [{ ...baseInput.procedimentos[0], vl_unitario: Number.NaN }],
      })
    ).toThrow(/procedimentos\[0\]\.vl_unitario/);
    expect(() => buildTissXml({ ...baseInput, vl_total: Number.POSITIVE_INFINITY })).toThrow(/vl_total/);
  });

  it.runIf(Boolean(process.env.TISS_XSD_PATH))(
    "valida a guia gerada contra o tissV4_03_00.xsd oficial",
    () => {
      const { xml } = buildTissXml({
        appointmentId: 108474,
        tipoGuia: "SP/SADT",
        nr_carteira: "CARTEIRA-TESTE-1",
        cd_atendimento: "GUIA-TESTE-1",
        pacienteNome: "Paciente Teste",
        profissionalNome: "Medico Teste",
        professionalLicense: "123456",
        providerCnpj: "00000000000100",
        registroAns: "999999",
        ...tiss403Required,
        procedimentos: [{ cd_tuss: "10101012", ds_procedimento: "Procedimento teste", qt: 1, vl_unitario: 150 }],
        agora: new Date("2026-07-15T12:00:00.000Z"),
      });
      const script = [
        "$xml=[Console]::In.ReadToEnd()",
        "$s=[System.Xml.XmlReaderSettings]::new()",
        "$s.ValidationType=[System.Xml.ValidationType]::Schema",
        "$ds=[System.Xml.XmlReaderSettings]::new()",
        "$ds.DtdProcessing=[System.Xml.DtdProcessing]::Parse",
        "$ds.XmlResolver=$null",
        `$dr=[System.Xml.XmlReader]::Create([System.IO.Path]::Combine([System.IO.Path]::GetDirectoryName('${process.env.TISS_XSD_PATH?.replace(/'/g, "''")}'),'xmldsig-core-schema.xsd'),$ds)`,
        "$dx=[System.Xml.Schema.XmlSchema]::Read($dr,$null)",
        "$null=$s.Schemas.Add($dx)",
        `$null=$s.Schemas.Add('http://www.ans.gov.br/padroes/tiss/schemas','${process.env.TISS_XSD_PATH?.replace(/'/g, "''")}')`,
        "$r=[System.Xml.XmlReader]::Create([System.IO.StringReader]::new($xml),$s)",
        "while($r.Read()){}",
        "$r.Close()",
      ].join(";");
      const validation = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
        input: xml,
        encoding: "utf8",
      });
      expect(validation.stderr ?? "", validation.stderr ?? undefined).toBe("");
      expect(validation.status, validation.stderr).toBe(0);
    }
  );
});

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
