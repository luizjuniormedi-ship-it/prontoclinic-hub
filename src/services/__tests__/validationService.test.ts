import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  validateAppointmentFields,
  checkOverlap,
  checkReturnRule,
  handleServiceError,
} from "@/services/validationService";

// Mock do Supabase
vi.mock("@/lib/supabase", () => {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(),
  };
  return {
    supabase: {
      from: vi.fn(() => chain),
      rpc: vi.fn(),
    },
  };
});

import { supabase } from "@/lib/supabase";

describe("validationService — validateAppointmentFields", () => {
  it("retorna [] quando todos os campos são válidos", () => {
    const errors = validateAppointmentFields({
      patient_id: "p1",
      professional_id: "d1",
      appointment_date: "2026-12-01",
      start_time: "10:00",
      end_time: "10:30",
    });
    expect(errors).toEqual([]);
  });

  it("retorna erro quando patient_id está faltando", () => {
    const errors = validateAppointmentFields({
      professional_id: "d1",
      appointment_date: "2026-12-01",
      start_time: "10:00",
    });
    expect(errors.some((e) => e.field === "patient_id")).toBe(true);
  });

  it("retorna erro quando end_time <= start_time", () => {
    const errors = validateAppointmentFields({
      patient_id: "p1",
      professional_id: "d1",
      appointment_date: "2026-12-01",
      start_time: "10:00",
      end_time: "09:30",
    });
    expect(errors.some((e) => e.field === "end_time")).toBe(true);
  });

  it("retorna erro quando appointment_date é inválida", () => {
    const errors = validateAppointmentFields({
      patient_id: "p1",
      professional_id: "d1",
      appointment_date: "data-inexistente",
      start_time: "10:00",
    });
    expect(errors.some((e) => e.field === "appointment_date")).toBe(true);
  });

  it("data no passado NÃO dispara erro (campos opcionais de validação temporal)", () => {
    const errors = validateAppointmentFields({
      patient_id: "p1",
      professional_id: "d1",
      appointment_date: "2020-01-01",
      start_time: "10:00",
    });
    // Apenas valida formato, não se é futuro — apenas `isNaN(d.getTime())`
    expect(errors.some((e) => e.field === "appointment_date")).toBe(false);
  });
});

describe("validationService — checkOverlap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("detecta conflito quando mesmo profissional e mesmo horário", async () => {
    const existingAppt = {
      id: "a1",
      professional_id: "d1",
      appointment_date: "2026-12-01",
      start_time: "10:00",
      end_time: "10:30",
      status: "confirmed",
    };
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      then: undefined,
    };
    // Faz a chain "resolver" para a Promise final
    (chain as any).then = (resolve: any) =>
      resolve({ data: [existingAppt], error: null });
    (supabase.from as any).mockReturnValue(chain);

    const result = await checkOverlap("d1", "2026-12-01", "10:15", "10:45");
    expect(result.hasOverlap).toBe(true);
    expect(result.conflicting).toEqual(existingAppt);
  });

  it("NÃO detecta conflito quando horários não sobrepõem", async () => {
    const existingAppt = {
      id: "a1",
      professional_id: "d1",
      appointment_date: "2026-12-01",
      start_time: "10:00",
      end_time: "10:30",
      status: "confirmed",
    };
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
    };
    (chain as any).then = (resolve: any) =>
      resolve({ data: [existingAppt], error: null });
    (supabase.from as any).mockReturnValue(chain);

    const result = await checkOverlap("d1", "2026-12-01", "11:00", "11:30");
    expect(result.hasOverlap).toBe(false);
  });

  it("retorna hasOverlap=false quando Supabase devolve erro", async () => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
    };
    (chain as any).then = (resolve: any) =>
      resolve({ data: null, error: { message: "boom" } });
    (supabase.from as any).mockReturnValue(chain);

    const result = await checkOverlap("d1", "2026-12-01", "10:00", "10:30");
    expect(result.hasOverlap).toBe(false);
  });
});

describe("validationService — checkReturnRule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna blocked=false quando paciente nunca foi atendido", async () => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    (supabase.from as any).mockReturnValue(chain);

    const result = await checkReturnRule("p1", "s1");
    expect(result.blocked).toBe(false);
  });

  it("bloqueia quando último atendimento foi há 15 dias", async () => {
    const fifteenDaysAgo = new Date();
    fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);
    const lastDate = fifteenDaysAgo.toISOString().split("T")[0];

    const chain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { appointment_date: lastDate },
        error: null,
      }),
    };
    (supabase.from as any).mockReturnValue(chain);

    const result = await checkReturnRule("p1", "s1");
    expect(result.blocked).toBe(true);
    expect(result.daysPassed).toBeGreaterThanOrEqual(15);
    expect(result.daysPassed).toBeLessThan(30);
    expect(result.availableDate).toBeDefined();
  });

  it("NÃO bloqueia quando 30 dias já foram cumpridos", async () => {
    const longAgo = new Date();
    longAgo.setDate(longAgo.getDate() - 60);
    const lastDate = longAgo.toISOString().split("T")[0];

    const chain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { appointment_date: lastDate },
        error: null,
      }),
    };
    (supabase.from as any).mockReturnValue(chain);

    const result = await checkReturnRule("p1", "s1");
    expect(result.blocked).toBe(false);
  });

  it("retorna blocked=false quando patientId ou specialtyId ausentes", async () => {
    const result1 = await checkReturnRule("", "s1");
    expect(result1.blocked).toBe(false);
    const result2 = await checkReturnRule("p1", "");
    expect(result2.blocked).toBe(false);
  });
});

describe("validationService — handleServiceError", () => {
  it("retorna error.message quando presente", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const msg = handleServiceError({ message: "Falha X" }, "Contexto Y");
    expect(msg).toBe("Falha X");
    spy.mockRestore();
  });

  it("retorna fallback quando error não tem message", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const msg = handleServiceError({}, "Contexto Z");
    expect(msg).toBe("Erro em Contexto Z");
    spy.mockRestore();
  });
});