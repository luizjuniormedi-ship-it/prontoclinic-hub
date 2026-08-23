import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  normalizeProfessionalScheduleGrid,
  scheduleGridsService,
} from "@/services/scheduleGridsService";

const chain = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  then: (resolve: (value: unknown) => unknown) =>
    resolve({ data: [], error: null }),
};

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => chain),
    rpc: vi.fn(),
  },
}));

import { supabase } from "@/lib/supabase";

describe("scheduleGridsService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("salva grade somente pela RPC segura", async () => {
    (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        grade: {
          id: 41,
          company_id: "company-1",
          unit_id: 5,
          professional_id: 11,
          specialty_id: null,
          valid_from: "2026-08-03",
          valid_until: null,
          status: "draft",
          default_duration_minutes: 30,
          default_capacity: 1,
          created_at: "2026-07-26T00:00:00Z",
          updated_at: "2026-07-26T00:00:00Z",
        },
        rules: [{
          id: 7,
          grade_id: 41,
          day_of_week: 1,
          starts_at: "08:00:00",
          ends_at: "12:00:00",
          service_id: null,
          duration_minutes: 30,
          capacity: 1,
          room_id: null,
          equipment_id: null,
          status: "active",
        }],
      },
      error: null,
    });

    const result = await scheduleGridsService.save({
      professionalId: "11",
      unitId: "5",
      dayOfWeek: 1,
      startTime: "08:00",
      endTime: "12:00",
      durationMinutes: 30,
      validFrom: "2026-08-03",
      maxConcurrent: 1,
    });

    expect(result).toMatchObject({ id: 41, status: "draft" });
    expect(supabase.rpc).toHaveBeenCalledWith(
      "m9_save_professional_schedule_grade_secure",
      expect.objectContaining({
        p_grade: expect.objectContaining({
          professionalId: 11,
          unitId: 5,
          validFrom: "2026-08-03",
          defaultDurationMinutes: 30,
        }),
        p_rules: [expect.objectContaining({ dayOfWeek: 1, durationMinutes: 30 })],
        p_idempotency_key: expect.any(String),
      }),
    );
  });

  it("normaliza identificadores bigint retornados como texto", () => {
    const grid = normalizeProfessionalScheduleGrid({
      id: "41" as unknown as number,
      company_id: "company-1",
      unit_id: "5" as unknown as number,
      professional_id: "11" as unknown as number,
      specialty_id: "7" as unknown as number,
      service_id: null,
      room_id: null,
      equipment_id: null,
      day_of_week: "1" as unknown as number,
      start_time: "08:00:00",
      end_time: "12:00:00",
      slot_duration_minutes: "30" as unknown as number,
      valid_from: "2026-08-03",
      valid_until: null,
      status: "published",
      max_concurrent: "1" as unknown as number,
      notes: null,
      created_at: "2026-07-26T00:00:00Z",
      updated_at: "2026-07-26T00:00:00Z",
    });

    expect(grid).toMatchObject({
      id: 41,
      unit_id: 5,
      professional_id: 11,
      specialty_id: 7,
      day_of_week: 1,
      slot_duration_minutes: 30,
      max_concurrent: 1,
    });
  });

  it("publica e suspende somente pela RPC de transição", async () => {
    (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        grade: {
          id: 41,
          company_id: "company-1",
          unit_id: 5,
          professional_id: 11,
          specialty_id: null,
          valid_from: "2026-08-03",
          valid_until: null,
          status: "published",
          default_duration_minutes: 30,
          default_capacity: 1,
          created_at: "2026-07-26T00:00:00Z",
          updated_at: "2026-07-26T00:00:00Z",
        },
        rules: [{
          id: 7,
          grade_id: 41,
          day_of_week: 1,
          starts_at: "08:00:00",
          ends_at: "12:00:00",
          service_id: null,
          duration_minutes: 30,
          capacity: 1,
          room_id: null,
          equipment_id: null,
          status: "active",
        }],
      },
      error: null,
    });

    await scheduleGridsService.setStatus(41, "published");

    expect(supabase.rpc).toHaveBeenCalledWith(
      "m9_publish_schedule_grade_secure",
      {
        p_grade_id: 41,
        p_action: "publish",
        p_reason: null,
        p_idempotency_key: expect.any(String),
      },
    );
  });

  it("rejeita identificadores inválidos antes da chamada remota", async () => {
    await expect(
      scheduleGridsService.save({
        professionalId: "x",
        unitId: "5",
        dayOfWeek: 1,
        startTime: "08:00",
        endTime: "12:00",
        durationMinutes: 30,
        validFrom: "2026-08-03",
        maxConcurrent: 1,
      }),
    ).rejects.toThrow("Identificador inválido");
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("propaga erro seguro da RPC", async () => {
    (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null,
      error: { message: "grade em conflito" },
    });

    await expect(
      scheduleGridsService.setStatus(41, "published"),
    ).rejects.toThrow("grade em conflito");
  });
});
