import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  formatReceptionQueueTicketLabel,
  receptionService,
  type ReceptionQueueTicket,
} from "@/services/receptionService";

vi.mock("@/lib/supabase", () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
}));

import { supabase } from "@/lib/supabase";

describe("receptionService — contrato local dos RPCs de check-in", () => {
  beforeEach(() => vi.clearAllMocks());

  const queueTicket = (
    overrides: Partial<ReceptionQueueTicket> = {},
  ): ReceptionQueueTicket => ({
    id: 1,
    unit_id: 2,
    issued_unit_id: 2,
    patient_id: 10,
    appointment_id: 20,
    prefix: "C",
    number: 1,
    priority: "normal",
    sector: "Recepção",
    status: "waiting",
    ticket_date: "2026-07-26",
    issued_at: "2026-07-26T10:00:00Z",
    called_at: null,
    completed_at: null,
    transferred_at: null,
    transferred_to_unit_id: null,
    sla_minutes: 30,
    sla_due_at: "2026-07-26T10:30:00Z",
    ...overrides,
  });

  it("consulta prontidão com o ID numérico do agendamento", async () => {
    (supabase.rpc as any).mockResolvedValue({ data: { appointment_id: 12, ready: true, issues: [] }, error: null });

    const result = await receptionService.getReadiness("12");

    expect(result.ready).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith("get_reception_checkin_readiness", { p_appointment_id: 12 });
  });

  it("realiza check-in com prioridade e exceção opcionais", async () => {
    (supabase.rpc as any).mockResolvedValue({ data: { ticket: "A-12", released_by_exception: true }, error: null });

    const result = await receptionService.checkin(
      "11111111-1111-4111-8111-111111111111",
      "12",
      "urgent",
      "Autorizado pela coordenação",
    );

    expect(result.ticket).toBe("A-12");
    expect(supabase.rpc).toHaveBeenCalledWith("perform_reception_checkin_secure", {
      p_workflow_id: "11111111-1111-4111-8111-111111111111",
      p_appointment_id: 12,
      p_priority: "urgent",
      p_exception_reason: "Autorizado pela coordenação",
    });
  });

  it("consulta o contexto documental e de consentimento do pré-check-in", async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: { appointment_id: 12, patient_id: 8, unit_id: 2, ready: false, has_document_pending: true, has_consent_pending: false, issues: [{ type: "document", severity: "blocking", description: "Documento expirado" }] },
      error: null,
    });

    const result = await receptionService.getPrecheckinContext("12");

    expect(result.has_document_pending).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith("get_reception_precheckin_context", { p_appointment_id: 12 });
  });

  it("lista o histórico do paciente pela RPC protegida e limita a consulta", async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: [{
        id: "32",
        appointmentDate: "2026-07-26",
        startTime: "10:00:00",
        endTime: "10:30:00",
        status: "scheduled",
        unitId: 2,
        professionalId: 4,
        appointmentTypeId: 6,
      }],
      error: null,
    });

    const result = await receptionService.listPatientAppointments("8", 200);

    expect(result).toHaveLength(1);
    expect(supabase.rpc).toHaveBeenCalledWith(
      "get_reception_patient_appointments_secure",
      { p_patient_id: 8, p_limit: 50 },
    );
  });

  it("rejeita resposta inválida do histórico do paciente", async () => {
    (supabase.rpc as any).mockResolvedValue({ data: null, error: null });

    await expect(receptionService.listPatientAppointments("8")).rejects.toThrow(
      /Resposta inválida/,
    );
  });

  it("consulta no backend a capacidade efetiva de liberação por exceção", async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: { appointment_id: 12, unit_id: 2, allowed: true },
      error: null,
    });

    await expect(receptionService.getExceptionCapability("12")).resolves.toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith("get_reception_exception_capability", {
      p_appointment_id: 12,
    });
  });

  it("rejeita resposta de capacidade associada a outro agendamento", async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: { appointment_id: 99, unit_id: 2, allowed: true },
      error: null,
    });

    await expect(receptionService.getExceptionCapability("12")).rejects.toThrow(
      /Resposta inválida/,
    );
  });

  it("preserva a senha quando o backend informa que a tentativa foi idempotente", async () => {
    (supabase.rpc as any).mockResolvedValue({ data: { ticket: "C-012", idempotent: true }, error: null });

    const result = await receptionService.checkin(
      "11111111-1111-4111-8111-111111111111",
      "12",
      "normal",
    );

    expect(result.ticket).toBe("C-012");
    expect(result.idempotent).toBe(true);
  });

  it("rejeita identificador de agendamento fora do contrato bigint seguro", async () => {
    await expect(
      receptionService.checkin(
        "11111111-1111-4111-8111-111111111111",
        "não-numérico",
        "normal",
      ),
    ).rejects.toThrow(/Identificador do agendamento inválido/);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("rejeita workflow vazio ou fora do contrato UUID", async () => {
    await expect(
      receptionService.checkin("workflow-inválido", "12", "normal"),
    ).rejects.toThrow(/Identificador do workflow inválido/);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("rejeita IDs inválidos antes de consultar prontidão ou pré-check-in", async () => {
    await expect(receptionService.getReadiness("9007199254740992")).rejects.toThrow(
      /Identificador do agendamento inválido/,
    );
    await expect(receptionService.getPrecheckinContext("0")).rejects.toThrow(
      /Identificador do agendamento inválido/,
    );
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("propaga erro do RPC para o estado de erro da recepção", async () => {
    (supabase.rpc as any).mockResolvedValue({ data: null, error: { message: "permission denied" } });

    await expect(receptionService.getReadiness("12")).rejects.toThrow(/permission denied/);
  });

  it("usa a RPC protegida para transicionar uma senha da recepção", async () => {
    (supabase.rpc as any).mockResolvedValue({ data: { ticket_id: 12, to_status: "called" }, error: null });

    await receptionService.transitionQueueTicket(12, "called", "Chamado no painel");

    expect(supabase.rpc).toHaveBeenCalledWith("transition_reception_queue_ticket_secure", {
      p_ticket_id: 12,
      p_to_status: "called",
      p_reason: "Chamado no painel",
      p_destination_unit_id: null,
    });
  });

  it("atualiza autorização somente pela RPC canônica protegida", async () => {
    (supabase.rpc as any).mockResolvedValue({ data: {}, error: null });

    await receptionService.updateAuthorization("11111111-1111-4111-8111-111111111111", {
      status: "autorizada",
      protocol: "PROTO-1",
      authorizationNumber: "AUTH-1",
      password: "PASS-1",
      validUntil: "2026-08-31",
      quantity: 2,
      reason: "Autorizado pelo convênio",
    });

    expect(supabase.rpc).toHaveBeenCalledWith(
      "transition_insurance_authorization_secure",
      {
        p_authorization_id: "11111111-1111-4111-8111-111111111111",
        p_status: "autorizada",
        p_protocol_number: "PROTO-1",
        p_authorization_number: "AUTH-1",
        p_password_number: "PASS-1",
        p_valid_until: "2026-08-31",
        p_quantity_authorized: 2,
        p_quantity_used: null,
        p_reason: "Autorizado pelo convênio",
      },
    );
  });

  it("atualiza elegibilidade somente pela RPC canônica protegida", async () => {
    (supabase.rpc as any).mockResolvedValue({ data: {}, error: null });

    await receptionService.updateEligibility(
      "22222222-2222-4222-8222-222222222222",
      {
        status: "bloqueado",
        protocol: "PROTO-2",
        blockReason: "Carteira suspensa",
      },
    );

    expect(supabase.rpc).toHaveBeenCalledWith(
      "update_insurance_eligibility_check_secure",
      {
        p_eligibility_id: "22222222-2222-4222-8222-222222222222",
        p_status: "bloqueado",
        p_request_channel: null,
        p_protocol_number: "PROTO-2",
        p_valid_from: null,
        p_valid_until: null,
        p_result_code: null,
        p_result_detail: null,
        p_proof_reference: null,
        p_proof_sha256: null,
        p_proof_content_type: null,
        p_exception_reason: null,
        p_block_reason: "Carteira suspensa",
      },
    );
  });

  it("não reutiliza o resultado clínico como justificativa de exceção", async () => {
    (supabase.rpc as any).mockResolvedValue({ data: {}, error: null });

    await receptionService.updateEligibility(
      "33333333-3333-4333-8333-333333333333",
      {
        status: "liberado_excecao",
        protocol: "PROTO-3",
        resultDetail: "Resposta clínica do portal",
        exceptionReason: "Liberação aprovada pela supervisão",
      },
    );

    expect(supabase.rpc).toHaveBeenCalledWith(
      "update_insurance_eligibility_check_secure",
      expect.objectContaining({
        p_result_detail: "Resposta clínica do portal",
        p_exception_reason: "Liberação aprovada pela supervisão",
        p_block_reason: null,
      }),
    );
  });

  it("mantém compacta a senha emitida na unidade atual", () => {
    expect(formatReceptionQueueTicketLabel(queueTicket())).toBe("C001");
  });

  it("diferencia visualmente a origem de uma senha transferida", () => {
    const transferred = queueTicket({ unit_id: 9, issued_unit_id: 2 });

    expect(formatReceptionQueueTicketLabel(transferred)).toBe("C001 · origem U2");
    expect(formatReceptionQueueTicketLabel(transferred, "accessible")).toBe(
      "C001, origem unidade 2",
    );
  });

  it("inclui issued_unit_id na leitura da fila", async () => {
    const rows = [queueTicket({ unit_id: 9, issued_unit_id: 2 })];
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.order.mockReturnValue(query);
    vi.mocked(supabase.from).mockReturnValue(query as never);

    const result = await receptionService.listQueue(9, "2026-07-26");

    expect(supabase.from).toHaveBeenCalledWith("reception_queue_tickets");
    expect(query.select).toHaveBeenCalledWith(expect.stringContaining("issued_unit_id"));
    expect(query.eq).toHaveBeenCalledWith("ticket_date", "2026-07-26");
    expect(query.eq).toHaveBeenCalledWith("unit_id", 9);
    expect(result[0].issued_unit_id).toBe(2);
  });

  it("rejeita leitura da fila sem unidade operacional válida", async () => {
    await expect(receptionService.listQueue(0, "2026-07-26")).rejects.toThrow(
      "Unidade operacional inválida",
    );
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
