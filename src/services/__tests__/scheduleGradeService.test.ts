import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { supabase } from "@/lib/supabase";
import {
  normalizeScheduleTime,
  scheduleGradeService,
  validateScheduleExceptionInput,
  validateScheduleGradeInput,
  type ScheduleGradeBundle,
  type ScheduleGradeInput,
} from "@/services/scheduleGradeService";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
  },
}));

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260725090000_module9_professional_schedule_grades.sql",
  ),
  "utf8",
);

const baseInput = (unitId = 11): ScheduleGradeInput => ({
  unitId,
  professionalId: 31,
  specialtyId: 7,
  name: "Grade ambulatorial",
  modality: "in_person",
  validFrom: "2026-08-01",
  validUntil: "2026-12-31",
  defaultDurationMinutes: 30,
  defaultCapacity: 1,
  rules: [
    {
      dayOfWeek: 1,
      startsAt: "08:00",
      endsAt: "12:00",
      breakStartsAt: "10:00",
      breakEndsAt: "10:15",
      serviceId: 51,
    },
  ],
});

const bundle: ScheduleGradeBundle = {
  grade: {
    id: 90,
    company_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    unit_id: 11,
    professional_id: 31,
    sector_id: null,
    specialty_id: 7,
    name: "Grade ambulatorial",
    modality: "in_person",
    timezone: "America/Sao_Paulo",
    valid_from: "2026-08-01",
    valid_until: "2026-12-31",
    status: "draft",
    version: 1,
    default_duration_minutes: 30,
    default_capacity: 1,
    default_room_id: null,
    default_equipment_id: null,
    generation_window_days: 90,
    published_at: null,
    published_by: null,
    created_at: "2026-07-25T09:00:00Z",
    updated_at: "2026-07-25T09:00:00Z",
  },
  rules: [],
};

describe("scheduleGradeService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("normaliza horários e mantém vigência, intervalo e defaults explícitos", () => {
    const result = validateScheduleGradeInput(baseInput());

    expect(normalizeScheduleTime("08:30")).toBe("08:30:00");
    expect(result.timezone).toBe("America/Sao_Paulo");
    expect(result.generationWindowDays).toBe(90);
    expect(result.rules[0]).toEqual(
      expect.objectContaining({
        startsAt: "08:00:00",
        endsAt: "12:00:00",
        breakStartsAt: "10:00:00",
        breakEndsAt: "10:15:00",
      }),
    );
  });

  it("rejeita overlap recorrente no mesmo dia antes de chamar o banco", () => {
    const input = baseInput();
    input.rules.push({
      dayOfWeek: 1,
      startsAt: "11:30",
      endsAt: "13:00",
    });

    expect(() => validateScheduleGradeInput(input)).toThrow(
      "se sobrepõem no mesmo dia",
    );
  });

  it("rejeita intervalo incompleto e exceção fora do contrato", () => {
    const input = baseInput();
    input.rules[0].breakEndsAt = null;
    expect(() => validateScheduleGradeInput(input)).toThrow(
      "informe início e fim do intervalo",
    );

    expect(() =>
      validateScheduleExceptionInput({
        gradeId: 90,
        exceptionDate: "2026-08-10",
        exceptionType: "extra_availability",
        reason: "Plantão adicional",
        isAllDay: true,
      }),
    ).toThrow("Disponibilidade extra exige horário");
  });

  it("encaminha A1 e A2 separadamente e nunca aceita company_id do cliente", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: bundle,
      error: null,
    } as never);

    await scheduleGradeService.save(baseInput(11), "save-grade-a1-001");
    await scheduleGradeService.save(baseInput(12), "save-grade-a2-001");

    const firstPayload = vi.mocked(supabase.rpc).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    const secondPayload = vi.mocked(supabase.rpc).mock.calls[1][1] as Record<
      string,
      unknown
    >;
    expect(firstPayload).toEqual(
      expect.objectContaining({
        p_grade: expect.objectContaining({ unitId: 11 }),
        p_idempotency_key: "save-grade-a1-001",
      }),
    );
    expect(secondPayload).toEqual(
      expect.objectContaining({
        p_grade: expect.objectContaining({ unitId: 12 }),
        p_idempotency_key: "save-grade-a2-001",
      }),
    );
    expect(firstPayload).not.toHaveProperty("p_company_id");
    expect(secondPayload).not.toHaveProperty("p_company_id");
  });

  it("publica com chave idempotente e exige motivo em transições destrutivas", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: { ...bundle, grade: { ...bundle.grade, status: "active" } },
      error: null,
    } as never);

    await scheduleGradeService.transition(90, "publish", "publish-grade-090");
    expect(supabase.rpc).toHaveBeenCalledWith(
      "m9_publish_schedule_grade_secure",
      {
        p_grade_id: 90,
        p_action: "publish",
        p_reason: null,
        p_idempotency_key: "publish-grade-090",
      },
    );

    await expect(
      scheduleGradeService.transition(90, "end", "end-grade-090"),
    ).rejects.toThrow("Motivo é obrigatório");
  });

  it("registra exceção parcial sem ocultar impacto retornado pelo banco", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: {
        id: 7,
        affected_appointments_count: 2,
        requires_reschedule: true,
      },
      error: null,
    } as never);

    const result = await scheduleGradeService.addException(
      {
        gradeId: 90,
        exceptionDate: "2026-08-10",
        exceptionType: "unavailable",
        reason: "Ausência programada",
        startsAt: "09:00",
        endsAt: "11:00",
      },
      "exception-grade-090-20260810",
    );

    expect(supabase.rpc).toHaveBeenCalledWith(
      "m9_add_schedule_exception_secure",
      expect.objectContaining({
        p_grade_id: 90,
        p_starts_at: "09:00:00",
        p_ends_at: "11:00:00",
        p_idempotency_key: "exception-grade-090-20260810",
      }),
    );
    expect(result.requires_reschedule).toBe(true);
    expect(result.affected_appointments_count).toBe(2);
  });

  it("mantém A/B e A1/A2 isolados no contrato SQL, sem bypass de app role", () => {
    expect(migration).toContain(
      "ALTER TABLE public.professional_schedule_grades FORCE ROW LEVEL SECURITY",
    );
    expect(migration).toContain(
      "ALTER TABLE public.professional_schedule_operation_keys FORCE ROW LEVEL SECURITY",
    );
    expect(migration).toMatch(
      /company_id = public\.audit_current_company_id\(\)/,
    );
    expect(migration).toMatch(
      /public\.org_can_access_unit\(company_id, unit_id\)/,
    );
    expect(migration).toMatch(
      /profile\.company_id = p_company_id[\s\S]*profile\.lg_ativo = TRUE/,
    );
    expect(migration).not.toMatch(/\bcurrent_user\b/i);
    expect(migration).not.toMatch(/USING\s*\(\s*TRUE\s*\)/i);
  });

  it("versiona publicação, impede overlap e preserva agendamentos nas exceções", () => {
    expect(migration).toContain("version INTEGER NOT NULL DEFAULT 1");
    expect(migration).toContain("M9 published grade content is immutable");
    expect(migration).toContain("M9 grade conflicts with another published grade");
    expect(migration).toContain("affected_appointments_count");
    expect(migration).toContain("requires_reschedule");
    expect(migration).not.toMatch(
      /(?:DELETE\s+FROM|UPDATE)\s+public\.appointments\b/i,
    );
  });

  it("falha fechado quando o RPC recusa tenant, unidade ou perfil", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: null,
      error: { message: "M9 schedule unit is not authorized" },
    } as never);

    await expect(
      scheduleGradeService.save(baseInput(12), "save-grade-denied-001"),
    ).rejects.toThrow("M9 schedule unit is not authorized");
  });
});
