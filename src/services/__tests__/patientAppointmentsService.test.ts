import { beforeEach, describe, expect, it, vi } from "vitest";

import { patientAppointmentsService } from "@/services/patientAppointmentsService";
import { supabase } from "@/lib/supabase";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
  },
}));

const response = (section: "today" | "upcoming" | "history", id: string) => ({
  patient: {
    id: "10",
    name: "Paciente Teste",
    socialName: null,
    birthDate: null,
    cpfMasked: null,
    phone: null,
    insuranceName: null,
  },
  summary: {
    nextAppointment: null,
    todayCount: 1,
    upcomingCount: 1,
    completedCount: 1,
    cancelledCount: 0,
    noShowCount: 0,
    pendingConfirmationCount: 0,
    pendingAuthorizationCount: 0,
    pendingPaymentCount: 0,
    pendingPreparationCount: 0,
  },
  groups: [{ section, date: "2026-07-24", appointments: [{ id }] }],
  pagination: { page: 1, pageSize: 3, total: 1, totalPages: 1 },
  permissions: {
    viewFinancial: false,
    viewAuthorization: true,
    reschedule: true,
    cancel: true,
    overrideConflict: false,
    viewAudit: false,
  },
});

describe("patientAppointmentsService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("encaminha filtros e paginação para a RPC longitudinal", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: response("today", "1"),
      error: null,
    } as never);

    await patientAppointmentsService.getTimeline({
      patientId: "10",
      filters: { section: "upcoming", unitId: 2, paymentStatus: "pending" },
      page: 2,
      pageSize: 20,
    });

    expect(supabase.rpc).toHaveBeenCalledWith(
      "m9_get_patient_appointments_timeline_secure",
      {
        p_patient_id: 10,
        p_filters: { section: "upcoming", unitId: 2, paymentStatus: "pending" },
        p_page: 2,
        p_page_size: 20,
      },
    );
  });

  it("monta a visão rápida com hoje, três próximos e três históricos", async () => {
    vi.mocked(supabase.rpc)
      .mockResolvedValueOnce({ data: response("today", "1"), error: null } as never)
      .mockResolvedValueOnce({ data: response("upcoming", "2"), error: null } as never)
      .mockResolvedValueOnce({ data: response("history", "3"), error: null } as never);

    const result = await patientAppointmentsService.getQuickView("10");

    expect(supabase.rpc).toHaveBeenCalledTimes(3);
    expect(vi.mocked(supabase.rpc).mock.calls.map((call) => call[1])).toEqual([
      expect.objectContaining({ p_filters: { section: "today" }, p_page_size: 20 }),
      expect.objectContaining({ p_filters: { section: "upcoming" }, p_page_size: 3 }),
      expect.objectContaining({ p_filters: { section: "history" }, p_page_size: 3 }),
    ]);
    expect(result.groups.map((group) => group.section)).toEqual([
      "today",
      "upcoming",
      "history",
    ]);
  });

  it("falha fechado quando a RPC retorna erro", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: null,
      error: { message: "tenant denied" },
    } as never);

    await expect(
      patientAppointmentsService.getTimeline({ patientId: "10" }),
    ).rejects.toThrow("tenant denied");
  });
});
