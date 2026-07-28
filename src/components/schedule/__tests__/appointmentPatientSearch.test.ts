import { describe, expect, it, vi } from "vitest";
import {
  AppointmentPatientSearchTimeoutError,
  searchAppointmentPatients,
} from "../appointmentPatientSearch";

describe("searchAppointmentPatients", () => {
  it("retorna o resultado quando a busca termina dentro do prazo", async () => {
    const rows = [{ id: "1", name: "Paciente QA" }];

    await expect(
      searchAppointmentPatients(() => Promise.resolve(rows), 100),
    ).resolves.toEqual(rows);
  });

  it("encerra uma busca que permanece pendente", async () => {
    vi.useFakeTimers();
    try {
      const request = searchAppointmentPatients(
        () => new Promise<never>(() => undefined),
        8_000,
      );
      const assertion = expect(request).rejects.toBeInstanceOf(
        AppointmentPatientSearchTimeoutError,
      );

      await vi.advanceTimersByTimeAsync(8_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("propaga a falha original da busca", async () => {
    await expect(
      searchAppointmentPatients(
        () => Promise.reject(new Error("permission denied")),
        100,
      ),
    ).rejects.toThrow("permission denied");
  });
});
