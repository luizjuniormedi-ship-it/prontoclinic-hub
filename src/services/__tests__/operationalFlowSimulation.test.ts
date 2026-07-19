import { describe, expect, it, vi } from "vitest";
import { supabase } from "@/lib/supabase";
import { appointmentsService } from "@/services/appointmentsService";
import { callCenterService } from "@/services/callCenterService";
import { billingsService } from "@/services/financialService";
import { buildTissXml, transmitTissXml, tissService } from "@/services/tissService";

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

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: { getUser: vi.fn() },
  },
}));

describe("operational flow simulation", () => {
  it("encadeia Call Center -> agenda -> billing -> TISS -> XML mockado", async () => {
    const callCenter = {
      id: 7001,
      appointment_id: 108474,
      patient_id: 9001,
      result: "agendado",
    };
    const appointment = {
      id: callCenter.appointment_id,
      patient_id: callCenter.patient_id,
      company_id: "company-synthetic",
      status: "confirmado",
    };
    const billing = {
      id: 5001,
      appointment_id: appointment.id,
      company_id: appointment.company_id,
      amount: 150,
      status: "em_aberto",
    };

    expect(callCenter.result).toBe("agendado");
    expect(appointment.patient_id).toBe(callCenter.patient_id);
    expect(billing.appointment_id).toBe(appointment.id);
    expect(billing.company_id).toBe(appointment.company_id);

    const { xml, vlTotal } = buildTissXml({
      appointmentId: billing.appointment_id,
      tipoGuia: "SP/SADT",
      nr_carteira: "ASSIM-SYNTH-001",
      cd_atendimento: "ATD-SYNTH-001",
      pacienteNome: "Paciente Sintetico",
      profissionalNome: "Dra. Homologacao",
      professionalLicense: "123456",
      providerCnpj: "00.000.000/0001-00",
      registroAns: "999999",
      ...tiss403Required,
      procedimentos: [
        {
          cd_tuss: "10101012",
          ds_procedimento: "Consulta sintetica",
          qt: 1,
          vl_unitario: billing.amount,
        },
      ],
      agora: new Date("2026-07-15T12:00:00.000Z"),
    });

    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = new TextDecoder("iso-8859-1").decode(init?.body as Uint8Array);
      expect(body).toContain("<ans:loteGuiasWS>");
      expect(body).toContain("ATD-SYNTH-001");
      return {
        ok: true,
        status: 200,
        text: async () => "<retorno><protocolo>HOM-FLOW-001</protocolo></retorno>",
      } as Response;
    });
    const transmission = await transmitTissXml({
      endpoint: "https://homologacao.invalid/tiss",
      xml,
      tipoGuia: "SP/SADT",
      fetchImpl,
    });

    expect(vlTotal).toBe(billing.amount);
    expect(xml).toContain("ATD-SYNTH-001");
    expect(transmission.sent).toBe(true);
    expect(transmission.protocolo).toBe("HOM-FLOW-001");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("executa os services reais com persistencia mockada e transporte controlado", async () => {
    const chain = (result: unknown) => {
      const query: Record<string, any> = {
        select: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(result),
        maybeSingle: vi.fn().mockResolvedValue(result),
      };
      return query;
    };

    (supabase.auth.getUser as any).mockResolvedValue({ data: { user: { id: "operator-synth" } } });

    (supabase.rpc as any).mockResolvedValueOnce({
      data: {
        id: 108475,
        patient_id: 9002,
        professional_id: 3002,
        company_id: "company-synthetic",
        appointment_date: "2026-07-15",
        start_time: "12:00",
        status: "scheduled",
      },
      error: null,
    });
    const recordedAppointment = await appointmentsService.create({
      company_id: "company-synthetic",
      patient_id: "9002",
      professional_id: "3002",
      appointment_date: "2026-07-15",
      start_time: "12:00",
      status: "scheduled",
    });
    expect(recordedAppointment.id).toBe(108475);

    const profile = chain({ data: { id: "operator-synth", company_id: "company-synthetic" }, error: null });
    const contact = chain({
      data: { id: 7002, appointment_id: 108475, patient_id: 9002, result: "agendado" },
      error: null,
    });
    const contactTaskProfile = chain({ data: { id: "operator-synth", company_id: "company-synthetic" }, error: null });
    const task = chain({ data: { id: 8802, appointment_id: 108475, status: "pending" }, error: null });
    (supabase.from as any)
      .mockReturnValueOnce(profile)
      .mockReturnValueOnce(contact)
      .mockReturnValueOnce(contactTaskProfile)
      .mockReturnValueOnce(task);

    const recordedContact = await callCenterService.createContact({
      appointment_id: String(recordedAppointment.id),
      patient_id: "9002",
      channel: "telefone",
      direction: "inbound",
      contact_reason: "Confirmacao de atendimento",
      result: "agendado",
      next_action: "confirmar_documentos",
      create_task: true,
    });
    expect(recordedContact.appointment_id).toBe(108475);

    const lookup = chain({ data: null, error: null });
    const billingInsert = chain({
      data: {
        id: 5002,
        company_id: "company-synthetic",
        patient_id: 9002,
        professional_id: 3002,
        appointment_id: 108475,
        amount: 150,
        total: 150,
        status: "em_aberto",
        created_at: "2026-07-15T12:00:00.000Z",
      },
      error: null,
    });
    (supabase.from as any).mockReturnValueOnce(lookup).mockReturnValueOnce(billingInsert);

    const recordedBilling = await billingsService.createForAppointment({
      appointment_id: "108475",
      company_id: "company-synthetic",
      patient_id: "9002",
      professional_id: "3002",
      gross_amount: 150,
      net_amount: 150,
    });
    expect(recordedBilling.appointment_id).toBe("108475");
    expect(recordedBilling.company_id).toBe("company-synthetic");

    const company = chain({ data: { id: "company-synthetic", cnpj: "00.000.000/0001-00" }, error: null });
    const insurance = chain({ data: { name: "Assim Sintetico", registro_ans: "999999" }, error: null });
    const patient = chain({ data: { full_name: "Paciente Sintetico" }, error: null });
    const professional = chain({ data: { full_name: "Dra. Homologacao", professional_license: "123456" }, error: null });
    const tissInsert = chain({ data: { id: 9902 }, error: null });
    (supabase.from as any)
      .mockReturnValueOnce(company)
      .mockReturnValueOnce(insurance)
      .mockReturnValueOnce(patient)
      .mockReturnValueOnce(professional)
      .mockReturnValueOnce(tissInsert);

    const generated = await tissService.generateXML(108475, {
      tipoGuia: "SP/SADT",
      cd_convenio: 7002,
      cd_paciente: 9002,
      cd_profissional: 3002,
      nr_carteira: "ASSIM-SYNTH-002",
      cd_atendimento: "ATD-SYNTH-002",
      procedimentos: [{ cd_tuss: "10101012", ds_procedimento: "Consulta sintetica", qt: 1, vl_unitario: 150 }],
      ...tiss403Required,
    });
    expect(generated.id).toBe(9902);
    expect(generated.xml).toContain("ATD-SYNTH-002");
    expect(generated.hash).toMatch(/^[A-F0-9]{32}$/);
    expect(generated.hash).not.toBe("00000000000000000000000000000000");
    expect(generated.xml).toContain(`<ans:hash>${generated.hash}</ans:hash>`);
    expect(tissInsert.insert).toHaveBeenCalledWith(
      expect.objectContaining({ appointment_id: 108475, ds_hash_envio: generated.hash })
    );

    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "<retorno><protocolo>HOM-SERVICE-001</protocolo></retorno>",
    }) as Response);
    const tissForSend = chain({
      data: {
        id: 9902,
        cd_convenio: 7002,
        tp_ambiente: "HOMOLOGACAO",
        ds_tipo_guia: "SP/SADT",
        ds_versao_tiss: "4.03.00",
        bl_xml_enviado: generated.xml,
      },
      error: null,
    });
    const protocol = chain({
      data: { ds_endpoint: "https://homologacao.invalid/tiss", ds_versao_tiss: "4.03.00" },
      error: null,
    });
    const tissUpdate = chain({ data: null, error: null });
    (supabase.from as any)
      .mockReturnValueOnce(tissForSend)
      .mockReturnValueOnce(protocol)
      .mockReturnValueOnce(tissUpdate);

    const sent = await tissService.sendToOperadora(9902, { fetchImpl });
    expect(sent.sent).toBe(true);
    expect(sent.protocolo).toBe("HOM-SERVICE-001");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
