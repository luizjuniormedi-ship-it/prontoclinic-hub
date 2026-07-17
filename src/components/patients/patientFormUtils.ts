export function normalizeInsurancePlanId(value: unknown): string {
  return value == null ? "" : String(value);
}
