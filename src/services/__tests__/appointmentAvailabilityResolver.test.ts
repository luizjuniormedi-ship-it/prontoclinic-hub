import { describe, expect, it } from "vitest";
import {
  findAvailabilityConflicts,
  isAvailabilitySlotFree,
  type AvailabilityRecord,
} from "@/services/appointmentAvailabilityResolver";

const existing: AvailabilityRecord[] = [
  {
    id: "appointment-1",
    companyId: "company-1",
    unitId: "unit-1",
    appointmentDate: "2026-07-21",
    startTime: "09:00",
    endTime: "09:30",
    professionalId: "professional-1",
    roomId: "room-1",
    equipmentId: "equipment-1",
    status: "scheduled",
  },
];

function candidate(overrides: Partial<AvailabilityRecord> = {}): AvailabilityRecord {
  return {
    id: "candidate",
    companyId: "company-1",
    unitId: "unit-1",
    appointmentDate: "2026-07-21",
    startTime: "09:30",
    endTime: "10:00",
    professionalId: "professional-2",
    roomId: "room-2",
    equipmentId: "equipment-2",
    ...overrides,
  };
}

describe("appointmentAvailabilityResolver", () => {
  it("detecta choque de profissional no mesmo intervalo", () => {
    const conflicts = findAvailabilityConflicts(existing, candidate({
      startTime: "09:15",
      endTime: "09:45",
      professionalId: "professional-1",
    }));

    expect(conflicts).toEqual([
      expect.objectContaining({ appointmentId: "appointment-1", scope: "professional" }),
    ]);
  });

  it("detecta choques independentes de sala e equipamento", () => {
    const conflicts = findAvailabilityConflicts(existing, candidate({
      startTime: "09:10",
      endTime: "09:20",
      roomId: "room-1",
      equipmentId: "equipment-1",
    }));

    expect(conflicts.map((conflict) => conflict.scope)).toEqual(["room", "equipment"]);
  });

  it("trata horários adjacentes como disponíveis", () => {
    expect(isAvailabilitySlotFree(existing, candidate())).toBe(true);
  });

  it("ignora cancelados e no-show", () => {
    expect(isAvailabilitySlotFree(existing.map((record) => ({ ...record, status: "no_show" })), candidate({
      startTime: "09:15",
      endTime: "09:45",
      professionalId: "professional-1",
      roomId: "room-1",
      equipmentId: "equipment-1",
    }))).toBe(true);
  });

  it("não cruza empresas diferentes", () => {
    expect(isAvailabilitySlotFree(existing, candidate({
      companyId: "company-2",
      startTime: "09:15",
      endTime: "09:45",
      professionalId: "professional-1",
      roomId: "room-1",
      equipmentId: "equipment-1",
    }))).toBe(true);
  });

  it("permite editar o próprio agendamento sem acusar o registro excluído", () => {
    const conflicts = findAvailabilityConflicts(
      existing,
      candidate({
        id: "appointment-1",
        startTime: "09:00",
        endTime: "09:30",
        professionalId: "professional-1",
        roomId: "room-1",
        equipmentId: "equipment-1",
      }),
    );

    expect(conflicts).toEqual([]);
  });

  it("rejeita intervalo invertido e horário inválido", () => {
    expect(() => findAvailabilityConflicts(existing, candidate({ startTime: "10:00", endTime: "09:00" })))
      .toThrow(/horário final/i);
    expect(() => findAvailabilityConflicts(existing, candidate({ startTime: "25:00" })))
      .toThrow(/horário inválido/i);
  });
});
