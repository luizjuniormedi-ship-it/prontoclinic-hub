import { describe, it, expect } from "vitest";
import {
  canTransitionAppointment,
  canTransitionImaging,
  canTransitionReport,
  canTransitionBilling,
  getValidAppointmentTransitions,
  getValidImagingTransitions,
  getValidReportTransitions,
  appointmentStatusLabels,
  canStartAppointment,
} from "@/services/statusTransitions";

describe("statusTransitions — appointments", () => {
  it("permite scheduled -> confirmed", () => {
    expect(canTransitionAppointment("scheduled", "confirmed")).toBe(true);
  });

  it("NÃO permite scheduled -> completed (pula estado)", () => {
    expect(canTransitionAppointment("scheduled", "completed")).toBe(false);
  });

  it("só permite iniciar atendimento após o check-in", () => {
    expect(canStartAppointment("waiting")).toBe(true);
    expect(canStartAppointment("confirmed")).toBe(false);
    expect(canStartAppointment("scheduled")).toBe(false);
  });

  it("NÃO permite completed -> in_progress (estado terminal)", () => {
    expect(canTransitionAppointment("completed", "in_progress")).toBe(false);
  });

  it("permite cancelled -> scheduled (reagendar)", () => {
    expect(canTransitionAppointment("cancelled", "scheduled")).toBe(true);
  });

  it("permite in_progress -> completed", () => {
    expect(canTransitionAppointment("in_progress", "completed")).toBe(true);
  });

  it("getValidAppointmentTransitions('confirmed') retorna ['waiting','cancelled','no_show']", () => {
    expect(getValidAppointmentTransitions("confirmed")).toEqual([
      "waiting",
      "cancelled",
      "no_show",
    ]);
  });

  it("retorna [] para estado terminal (completed)", () => {
    expect(getValidAppointmentTransitions("completed")).toEqual([]);
  });

  it("retorna [] para estado desconhecido", () => {
    expect(getValidAppointmentTransitions("inexistente")).toEqual([]);
  });

  it("retorna false para transição a partir de estado desconhecido", () => {
    expect(canTransitionAppointment("foo", "scheduled")).toBe(false);
  });
});

describe("statusTransitions — imaging", () => {
  it("permite agendado -> liberado_worklist", () => {
    expect(canTransitionImaging("agendado", "liberado_worklist")).toBe(true);
  });

  it("NÃO permite entregue -> agendado (estado terminal)", () => {
    expect(canTransitionImaging("entregue", "agendado")).toBe(false);
  });

  it("permite cancelado -> agendado (reagendamento)", () => {
    expect(canTransitionImaging("cancelado", "agendado")).toBe(true);
  });

  it("getValidImagingTransitions('laudando') inclui laudado e cancelado", () => {
    const allowed = getValidImagingTransitions("laudando");
    expect(allowed).toContain("laudado");
    expect(allowed).toContain("cancelado");
  });
});

describe("statusTransitions — radiology reports", () => {
  it("permite draft -> final", () => {
    expect(canTransitionReport("draft", "final")).toBe(true);
  });

  it("NÃO permite final -> draft (não regride)", () => {
    expect(canTransitionReport("final", "draft")).toBe(false);
  });

  it("permite final -> amended (amendment)", () => {
    expect(canTransitionReport("final", "amended")).toBe(true);
  });

  it("permite cancelled -> draft", () => {
    expect(canTransitionReport("cancelled", "draft")).toBe(true);
  });

  it("getValidReportTransitions('preliminary') inclui final e cancelled", () => {
    const allowed = getValidReportTransitions("preliminary");
    expect(allowed).toEqual(expect.arrayContaining(["final", "cancelled"]));
  });
});

describe("statusTransitions — billing & labels", () => {
  it("permite em_aberto -> faturado", () => {
    expect(canTransitionBilling("em_aberto", "faturado")).toBe(true);
  });

  it("NÃO permite voltar de cancelado (terminal)", () => {
    expect(canTransitionBilling("cancelado", "em_aberto")).toBe(false);
  });

  it("labels em PT-BR para todos os estados principais", () => {
    expect(appointmentStatusLabels.scheduled).toBe("Agendado");
    expect(appointmentStatusLabels.confirmed).toBe("Confirmado");
    expect(appointmentStatusLabels.completed).toBe("Finalizado");
    expect(appointmentStatusLabels.cancelled).toBe("Cancelado");
  });
});
