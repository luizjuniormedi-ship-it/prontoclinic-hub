import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  appointmentsService,
  professionalsLookup,
  specialtiesLookup,
  appointmentTypesLookup,
  servicesCatalogLookup,
} from "@/services/appointmentsService";
import { canTransitionAppointment } from "@/services/statusTransitions";

// Mock do Supabase
vi.mock("@/lib/supabase", () => {
  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(),
    single: vi.fn(),
  };
  (chain as { then: (r: (v: unknown) => unknown) => unknown }).then = (r) =>
    r({ data: [], error: null });
  return {
    supabase: {
      from: vi.fn(() => chain),
      auth: { getUser: vi.fn() },
      rpc: vi.fn(),
    },
  };
});

import { supabase } from "@/lib/supabase";

// ── Fixtures ──

const makeAppointment = (overrides: Partial<any> = {}) => ({
  id: "appt-1",
  company_id: "company-1",
  unit_id: "unit-1",
  patient_id: "patient-1",
  professional_id: "prof-1",
  specialty_id: "spec-1",
  service_id: "svc-1",
  appointment_type_id: "type-1",
  appointment_date: "2026-06-23",
  start_time: "09:00",
  end_time: "09:30",
  status: "scheduled",
  is_return: false,
  notes: null,
  created_at: "2026-06-20T00:00:00Z",
  updated_at: "2026-06-20T00:00:00Z",
  ...overrides,
});

describe("appointmentsService — getByDateRange (getAll sem filtros)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna todos os agendamentos no intervalo (sem filtros)", async () => {
    const rows = [makeAppointment({ id: "a1" }), makeAppointment({ id: "a2" })];
    const chain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
    };
    (chain as { then: (r: (v: unknown) => unknown) => unknown }).then = (r) =>
      r({ data: rows, error: null });
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    const result = await appointmentsService.getByDateRange("2026-06-01", "2026-06-30");
    expect(result).toHaveLength(2);
    expect(supabase.from).toHaveBeenCalledWith("appointments");
  });

  it("retorna lista vazia quando não há agendamentos", async () => {
    const chain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
    };
    (chain as { then: (r: (v: unknown) => unknown) => unknown }).then = (r) =>
      r({ data: [], error: null });
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    const result = await appointmentsService.getByDateRange("2026-06-01", "2026-06-30");
    expect(result).toEqual([]);
  });

  it("lança erro quando o Supabase retorna erro", async () => {
    const chain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
    };
    (chain as { then: (r: (v: unknown) => unknown) => unknown }).then = (r) =>
      r({ data: null, error: { message: "permission denied" } });
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    await expect(
      appointmentsService.getByDateRange("2026-06-01", "2026-06-30")
    ).rejects.toThrow(/permission denied/);
  });
});

describe("appointmentsService — getByDate (filtro por data)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("filtra por uma data específica", async () => {
    const chain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
    };
    (chain as { then: (r: (v: unknown) => unknown) => unknown }).then = (r) =>
      r({ data: [makeAppointment()], error: null });
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    const result = await appointmentsService.getByDate("2026-06-23");
    expect(result).toHaveLength(1);
    expect(result[0].appointment_date).toBe("2026-06-23");
  });
});

describe("appointmentsService — getPatientLastCompleted (filtro por patient_id e status)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna o último agendamento completed do paciente na especialidade", async () => {
    const chain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: makeAppointment({ status: "completed" }), error: null }),
    };
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    const result = await appointmentsService.getPatientLastCompleted("patient-1", "spec-1");
    expect(result).not.toBeNull();
    expect(result?.status).toBe("completed");
  });

  it("retorna null quando não há registro", async () => {
    const chain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    const result = await appointmentsService.getPatientLastCompleted("patient-1", "spec-1");
    expect(result).toBeNull();
  });

  it("retorna null em caso de erro", async () => {
    const chain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } }),
    };
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    const result = await appointmentsService.getPatientLastCompleted("patient-1", "spec-1");
    expect(result).toBeNull();
  });
});

describe("appointmentsService — create", () => {
  beforeEach(() => vi.clearAllMocks());

  it("cria agendamento com status default 'scheduled' quando não informado", async () => {
    const insertSpy = vi.fn().mockReturnThis();
    const chain: Record<string, unknown> = {
      insert: insertSpy,
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: makeAppointment({ status: "scheduled" }),
        error: null,
      }),
    };
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    const result = await appointmentsService.create({
      patient_id: "patient-1",
      professional_id: "prof-1",
      appointment_date: "2026-06-23",
      start_time: "09:00",
    });

    expect(result.status).toBe("scheduled");
    expect(insertSpy).toHaveBeenCalled();
    const inserted = insertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.status).toBe("scheduled");
  });

  it("respeita status customizado quando informado", async () => {
    const insertSpy = vi.fn().mockReturnThis();
    const chain: Record<string, unknown> = {
      insert: insertSpy,
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: makeAppointment({ status: "confirmed" }),
        error: null,
      }),
    };
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    const result = await appointmentsService.create({
      patient_id: "patient-1",
      professional_id: "prof-1",
      appointment_date: "2026-06-23",
      start_time: "09:00",
      status: "confirmed",
    });

    expect(result.status).toBe("confirmed");
    const inserted = insertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.status).toBe("confirmed");
  });

  it("lança erro quando Supabase falha ao inserir", async () => {
    const chain: Record<string, unknown> = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: "FK violation" } }),
    };
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    await expect(
      appointmentsService.create({
        patient_id: "patient-1",
        professional_id: "prof-1",
        appointment_date: "2026-06-23",
        start_time: "09:00",
      })
    ).rejects.toThrow(/FK violation/);
  });
});

describe("appointmentsService — update", () => {
  beforeEach(() => vi.clearAllMocks());

  it("atualiza agendamento com sucesso", async () => {
    const updateSpy = vi.fn().mockReturnThis();
    const chain: Record<string, unknown> = {
      update: updateSpy,
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: makeAppointment({ notes: "Atualizado" }),
        error: null,
      }),
    };
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    const result = await appointmentsService.update("appt-1", { notes: "Atualizado" });
    expect(result.notes).toBe("Atualizado");
    const updated = updateSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(updated.notes).toBe("Atualizado");
    expect(updated.updated_at).toBeDefined();
  });

  it("lança erro quando Supabase falha", async () => {
    const chain: Record<string, unknown> = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } }),
    };
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    await expect(
      appointmentsService.update("appt-1", { notes: "x" })
    ).rejects.toThrow(/not found/);
  });
});

describe("appointmentsService — cancel (updateStatus para cancelled)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("marca agendamento como cancelled com motivo", async () => {
    // 1ª chamada: select status atual
    const fetchChain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { status: "scheduled" },
        error: null,
      }),
    };
    // 2ª chamada: update
    const updateSpy = vi.fn().mockReturnThis();
    const updateChain: Record<string, unknown> = {
      update: updateSpy,
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: makeAppointment({ status: "cancelled", notes: "Paciente desmarcou" }),
        error: null,
      }),
    };
    const fromMock = supabase.from as unknown as ReturnType<typeof vi.fn>;
    fromMock.mockReturnValueOnce(fetchChain).mockReturnValueOnce(updateChain);

    const result = await appointmentsService.updateStatus(
      "appt-1",
      "cancelled",
      "Paciente desmarcou"
    );
    expect(result.status).toBe("cancelled");
    expect(result.notes).toBe("Paciente desmarcou");
    const updated = updateSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(updated.status).toBe("cancelled");
    expect(updated.notes).toBe("Paciente desmarcou");
    expect(updated.updated_at).toBeDefined();
  });

  it("rejeita transição inválida (ex: completed → cancelled)", async () => {
    const fetchChain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { status: "completed" },
        error: null,
      }),
    };
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(fetchChain);

    await expect(
      appointmentsService.updateStatus("appt-1", "cancelled", "motivo")
    ).rejects.toThrow(/Transição inválida/);
  });
});

describe("appointmentsService — canTransitionAppointment (validação de conflito de status)", () => {
  it("permite scheduled → confirmed", () => {
    expect(canTransitionAppointment("scheduled", "confirmed")).toBe(true);
  });

  it("permite scheduled → cancelled", () => {
    expect(canTransitionAppointment("scheduled", "cancelled")).toBe(true);
  });

  it("rejeita completed → cancelled (estado terminal)", () => {
    expect(canTransitionAppointment("completed", "cancelled")).toBe(false);
  });

  it("rejeita status desconhecido como origem", () => {
    expect(canTransitionAppointment("inexistente", "scheduled")).toBe(false);
  });

  it("permite re-agendar de cancelled para scheduled", () => {
    expect(canTransitionAppointment("cancelled", "scheduled")).toBe(true);
  });
});

describe("appointmentsService — delete", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deleta agendamento sem erro", async () => {
    const chain: Record<string, unknown> = {
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    };
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    await expect(appointmentsService.delete("appt-1")).resolves.toBeUndefined();
  });

  it("lança erro quando Supabase falha", async () => {
    const chain: Record<string, unknown> = {
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: { message: "FK constraint" } }),
    };
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    await expect(appointmentsService.delete("appt-1")).rejects.toThrow(/FK constraint/);
  });
});

describe("professionalsLookup — getAll", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lista profissionais ordenados por nome", async () => {
    const chain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
    };
    (chain as { then: (r: (v: unknown) => unknown) => unknown }).then = (r) =>
      r({ data: [{ id: "p1", full_name: "Dr. House" }], error: null });
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    const result = await professionalsLookup.getAll();
    expect(result).toHaveLength(1);
    expect(supabase.from).toHaveBeenCalledWith("professionals");
  });
});

describe("specialtiesLookup — getAll", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lista especialidades ordenadas por nome", async () => {
    const chain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
    };
    (chain as { then: (r: (v: unknown) => unknown) => unknown }).then = (r) =>
      r({ data: [{ id: "s1", name: "Cardiologia" }], error: null });
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    const result = await specialtiesLookup.getAll();
    expect(result).toHaveLength(1);
    expect(supabase.from).toHaveBeenCalledWith("specialties");
  });
});

describe("appointmentTypesLookup — getAll", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lista tipos de atendimento ordenados por nome", async () => {
    const chain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
    };
    (chain as { then: (r: (v: unknown) => unknown) => unknown }).then = (r) =>
      r({ data: [{ id: "t1", name: "Consulta" }], error: null });
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    const result = await appointmentTypesLookup.getAll();
    expect(result).toHaveLength(1);
    expect(supabase.from).toHaveBeenCalledWith("appointment_types");
  });
});

describe("servicesCatalogLookup — getAll", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lista serviços do catálogo ordenados por nome", async () => {
    const chain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
    };
    (chain as { then: (r: (v: unknown) => unknown) => unknown }).then = (r) =>
      r({ data: [{ id: "svc1", name: "Eletrocardiograma" }], error: null });
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    const result = await servicesCatalogLookup.getAll();
    expect(result).toHaveLength(1);
    expect(supabase.from).toHaveBeenCalledWith("services_catalog");
  });
});
