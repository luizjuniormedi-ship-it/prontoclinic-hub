const RECEPTION_TIME_ZONE = "America/Sao_Paulo";

const operationalDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: RECEPTION_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function getReceptionOperationalDate(now = new Date()): string {
  const parts = operationalDateFormatter.formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("Nao foi possivel determinar a data operacional da recepcao");
  }

  return `${year}-${month}-${day}`;
}
