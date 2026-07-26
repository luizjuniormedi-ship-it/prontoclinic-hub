import type { CallCenterContactLog } from "@/services/callCenterService";

function onlyDigits(value: string | null | undefined): string {
  return (value || "").replace(/\D/g, "");
}

export function matchesCallCenterContactSearch(
  contact: CallCenterContactLog,
  query: string,
): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;

  const queryDigits = onlyDigits(normalizedQuery);
  return (contact.patient_name || "").toLowerCase().includes(normalizedQuery)
    || (queryDigits.length > 0 && onlyDigits(contact.patient_cpf).includes(queryDigits))
    || (queryDigits.length > 0 && onlyDigits(contact.patient_phone).includes(queryDigits))
    || contact.contact_reason.toLowerCase().includes(normalizedQuery);
}
