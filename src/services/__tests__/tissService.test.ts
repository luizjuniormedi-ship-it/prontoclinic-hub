import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TISS_COMMUNICATION_VERSION,
  buildTissLoteGuiasSoapEnvelope,
  buildTissXml,
  calculateTissTransactionMd5,
  transmitTissXml,
  validateTissTransmissionPrerequisites,
} from "@/services/tissService";

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

const servers: Array<ReturnType<typeof createServer>> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
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
      expect(validation.stderr, validation.stderr).toBe("");
      expect(validation.status, validation.stderr).toBe(0);
    }
  );
});

describe("transmitTissXml", () => {
  it("simula aceite de homologação sem rede ou persistência", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      const body = new TextDecoder("iso-8859-1").decode(init?.body as Uint8Array);
      expect(body).toContain("loteGuiasWS");
      expect(init?.headers).toMatchObject({
        "Content-Type": "text/xml; charset=iso-8859-1",
        SOAPAction: '""',
      });

      return {
        ok: true,
        status: 200,
        text: async () => "<ans:protocoloRecebimento xmlns:ans=\"urn:test\"><ans:numeroProtocolo>HOM-TEST-001</ans:numeroProtocolo></ans:protocoloRecebimento>",
      } as Response;
    });

    const result = await transmitTissXml({
      endpoint: "https://homologacao.invalid/tiss",
      xml: transportXml,
      tipoGuia: "SP/SADT",
      fetchImpl,
    });

    expect(result).toEqual({
      sent: true,
      status: 200,
      protocolo: "HOM-TEST-001",
      response: '<ans:protocoloRecebimento xmlns:ans="urn:test"><ans:numeroProtocolo>HOM-TEST-001</ans:numeroProtocolo></ans:protocoloRecebimento>',
      reason: undefined,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("envia para receptor HTTP local de homologação com transporte explicitamente injetado", async () => {
    let received = "";
    const server = createServer((request, response) => {
      request.setEncoding("utf8");
      request.on("data", (chunk) => (received += chunk));
      request.on("end", () => {
        response.writeHead(200, { "Content-Type": "text/xml" });
        response.end("<retorno><protocolo>HOM-LOCAL-403-001</protocolo></retorno>");
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Receptor local indisponível");

    const result = await transmitTissXml({
      endpoint: `http://127.0.0.1:${address.port}/tiss-homologacao`,
      xml: transportXml,
      tipoGuia: "SP/SADT",
      fetchImpl: fetch,
    });

    expect(result.sent).toBe(true);
    expect(result.protocolo).toBe("HOM-LOCAL-403-001");
    expect(received).toContain("loteGuiasWS");
  });

  it("não usa fetch global quando o transporte servidor não foi injetado", async () => {
    const result = await transmitTissXml({ endpoint: "https://operadora.invalid", xml: "<xml />" });
    expect(result).toMatchObject({ sent: false, status: 0 });
    expect(result.reason).toMatch(/direto pelo navegador/);
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
