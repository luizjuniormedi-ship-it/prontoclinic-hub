export const APPOINTMENT_PATIENT_SEARCH_TIMEOUT_MS = 8_000;

export class AppointmentPatientSearchTimeoutError extends Error {
  constructor() {
    super("A busca de pacientes excedeu o tempo limite. Tente novamente.");
    this.name = "AppointmentPatientSearchTimeoutError";
  }
}

export async function searchAppointmentPatients<T>(
  search: () => Promise<T>,
  timeoutMs = APPOINTMENT_PATIENT_SEARCH_TIMEOUT_MS,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      search(),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new AppointmentPatientSearchTimeoutError()),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
