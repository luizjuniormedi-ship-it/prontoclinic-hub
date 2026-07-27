const CLINIC_TIME_ZONE = "America/Sao_Paulo";
const DAY_IN_MS = 86_400_000;

export function clinicDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CLINIC_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function dateKeyOrdinal(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / DAY_IN_MS;
}

export function diffClinicDays(
  appointmentDate: string,
  now = new Date(),
): number {
  return dateKeyOrdinal(appointmentDate) - dateKeyOrdinal(clinicDateKey(now));
}
