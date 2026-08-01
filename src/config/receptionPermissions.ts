const RECEPTION_OVERRIDE_ROLES = new Set([
  "admin",
  "administrador",
  "gestor",
  "gerente",
  "supervisor_recepcao",
]);

function normalizeRole(role?: string | null): string {
  return (role ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function canOverrideReceptionCheckin(role?: string | null): boolean {
  return RECEPTION_OVERRIDE_ROLES.has(normalizeRole(role));
}

export function receptionExceptionReasonLength(reason: string): number {
  return Array.from(reason.trim()).length;
}
