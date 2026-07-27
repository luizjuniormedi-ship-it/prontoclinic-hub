import { beforeEach, describe, expect, it, vi } from "vitest";
import { patientPortalService } from "@/services/patientPortalService";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: mocks.rpc,
    from: mocks.from,
  },
}));

const appointment = {
  id: "980403",
  appointment_date: "2026-08-05",
  start_time: "14:00:00",
  end_time: "14:30:00",
  status: "scheduled",
  is_return: false,
  professional_name: "Profissional Portal CI",
  unit_name: "Unidade Sintetica CI",
};

describe("patientPortalService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lista somente pela RPC sem consultar tabelas no cliente", async () => {
    mocks.rpc.mockResolvedValue({ data: [appointment], error: null });

    const result = await patientPortalService.listAppointments();

    expect(mocks.rpc).toHaveBeenCalledWith(
      "patient_portal_list_appointments_secure",
    );
    expect(mocks.from).not.toHaveBeenCalled();
    expect(result[0]).toMatchObject({
      id: "980403",
      professional_name: "Profissional Portal CI",
      unit_name: "Unidade Sintetica CI",
    });
  });

  it("rejeita resposta de listagem inválida em vez de mascará-la como vazia", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });

    await expect(patientPortalService.listAppointments()).rejects.toThrow(
      "Resposta inválida do portal do paciente",
    );
  });

  it("rejeita campos ausentes, tipos inválidos e colunas internas", async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        data: [{ ...appointment, start_time: undefined }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ ...appointment, notes: "não deve sair do banco" }],
        error: null,
      });

    await expect(patientPortalService.listAppointments()).rejects.toThrow(
      "Resposta inválida do portal do paciente",
    );
    await expect(patientPortalService.listAppointments()).rejects.toThrow(
      "Resposta inválida do portal do paciente",
    );
  });

  it("rejeita DTO inválido retornado por mutação", async () => {
    mocks.rpc.mockResolvedValue({
      data: { ...appointment, company_id: "tenant-interno" },
      error: null,
    });

    await expect(
      patientPortalService.confirmAppointment("980401"),
    ).rejects.toThrow("Resposta inválida do portal do paciente");
  });

  it("confirma e cancela somente pelas RPCs próprias do paciente", async () => {
    mocks.rpc.mockResolvedValue({ data: appointment, error: null });

    await patientPortalService.confirmAppointment("980401");
    await patientPortalService.cancelAppointment(
      "980402",
      "Cancelamento sintético",
    );

    expect(mocks.rpc).toHaveBeenNthCalledWith(
      1,
      "patient_portal_confirm_appointment_secure",
      { p_appointment_id: 980401 },
    );
    expect(mocks.rpc).toHaveBeenNthCalledWith(
      2,
      "patient_portal_cancel_appointment_secure",
      {
        p_appointment_id: 980402,
        p_reason: "Cancelamento sintético",
      },
    );
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("reagenda pela RPC persistente com dados normalizados", async () => {
    mocks.rpc.mockResolvedValue({ data: appointment, error: null });

    const result = await patientPortalService.rescheduleAppointment("980403", {
      appointmentDate: "2026-08-05",
      startTime: "14:00",
      reason: "Conflito de horário familiar",
    });

    expect(mocks.rpc).toHaveBeenCalledWith(
      "patient_portal_reschedule_appointment_secure",
      {
        p_appointment_id: 980403,
        p_new_appointment_date: "2026-08-05",
        p_new_start_time: "14:00",
        p_new_end_time: null,
        p_reason: "Conflito de horário familiar",
      },
    );
    expect(result.appointment_date).toBe("2026-08-05");
    expect(result.start_time).toBe("14:00:00");
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("rejeita id e reagendamento incompletos antes da rede", async () => {
    await expect(
      patientPortalService.confirmAppointment("não-numérico"),
    ).rejects.toThrow("Agendamento inválido");
    await expect(
      patientPortalService.rescheduleAppointment("980403", {
        appointmentDate: "",
        startTime: "",
        reason: "",
      }),
    ).rejects.toThrow("Nova data e horário são obrigatórios");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("propaga erro seguro da RPC", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "Horário indisponível para o profissional" },
    });

    await expect(
      patientPortalService.rescheduleAppointment("980403", {
        appointmentDate: "2026-08-05",
        startTime: "14:00",
        reason: "Conflito de horário familiar",
      }),
    ).rejects.toThrow("Horário indisponível");
  });
});
