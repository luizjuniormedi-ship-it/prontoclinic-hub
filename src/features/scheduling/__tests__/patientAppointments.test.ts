import { describe, expect, it } from "vitest";

import {
  classifyAppointmentSection,
  compareAppointmentAscending,
  dateKeyInTimeZone,
  groupPatientAppointments,
  type PatientAppointmentRecord,
} from "@/features/scheduling/patientAppointments";

function appointment(
  id: string,
  appointmentDate: string,
  startTime: string,
  status = "scheduled",
): PatientAppointmentRecord {
  return {
    id,
    appointmentDate,
    startTime,
    endTime: null,
    timezone: "America/Sao_Paulo",
    status,
    appointmentType: "consulta",
    isReturn: false,
    isWalkin: false,
    isTeleconsult: false,
    unitId: 1,
    unitName: "Centro",
    professionalId: "1",
    professionalName: "Dra. Teste",
    specialtyId: "1",
    specialtyName: "Clínica",
    serviceId: "1",
    serviceName: "Consulta",
    roomName: null,
    equipmentName: null,
    insuranceName: null,
    insuranceId: null,
    insurancePlanName: null,
    cardNumber: null,
    authorizationStatus: null,
    authorizationNumber: null,
    paymentStatus: null,
    preparationStatus: null,
    confirmationStatus: null,
    sourceChannel: "reception",
    operatorName: "Operador Teste",
    rescheduledFromId: null,
    rescheduledToId: null,
    notes: null,
    createdAt: `${appointmentDate}T08:00:00Z`,
    updatedAt: `${appointmentDate}T08:00:00Z`,
    allowedActions: ["view"],
  };
}

describe("patientAppointments", () => {
  it("ordena agendamentos futuros por data, hora e criação", () => {
    const records = [
      appointment("3", "2026-07-26", "08:00"),
      appointment("2", "2026-07-25", "14:00"),
      appointment("1", "2026-07-25", "08:00"),
    ];
    expect([...records].sort(compareAppointmentAscending).map((item) => item.id))
      .toEqual(["1", "2", "3"]);
  });

  it("separa hoje, próximos e histórico e agrupa pelo dia local", () => {
    const groups = groupPatientAppointments(
      [
        appointment("past", "2026-07-23", "10:00", "completed"),
        appointment("future-late", "2026-07-25", "15:00"),
        appointment("today", "2026-07-24", "09:00"),
        appointment("future-early", "2026-07-25", "08:00"),
      ],
      "2026-07-24",
    );
    expect(groups.map((group) => `${group.section}:${group.date}`)).toEqual([
      "today:2026-07-24",
      "upcoming:2026-07-25",
      "history:2026-07-23",
    ]);
    expect(groups[1].appointments.map((item) => item.id)).toEqual([
      "future-early",
      "future-late",
    ]);
  });

  it("mantém realizado no histórico mesmo quando sua data é futura", () => {
    expect(
      classifyAppointmentSection(
        appointment("closed", "2026-07-25", "08:00", "cancelled"),
        "2026-07-24",
      ),
    ).toBe("history");
  });

  it("não mistura agendamentos fechados e ativos do mesmo dia", () => {
    const groups = groupPatientAppointments(
      [
        appointment("active", "2026-07-25", "09:00", "scheduled"),
        appointment("closed", "2026-07-25", "08:00", "cancelled"),
      ],
      "2026-07-24",
    );
    expect(groups.map((group) => `${group.section}:${group.date}`)).toEqual([
      "upcoming:2026-07-25",
      "history:2026-07-25",
    ]);
  });

  it("converte instante para a data da unidade, não para a data UTC", () => {
    expect(
      dateKeyInTimeZone("2026-07-25T01:30:00.000Z", "America/Sao_Paulo"),
    ).toBe("2026-07-24");
  });
});
