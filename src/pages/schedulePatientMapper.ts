import type { Patient } from "@/types";
import type { PatientDbRow } from "@/types/missing";

export function mapSchedulePatient(row: PatientDbRow): Patient {
  return {
    id: String(row.id),
    companyId: row.company_id,
    name: row.full_name || "",
    cpf: row.cpf || "",
    birthDate: row.birth_date || "",
    phone: row.phone || "",
    email: row.email || "",
    gender: row.sex || "O",
    healthInsurance: row.insurance_plan?.insurance_company?.name ?? undefined,
    healthInsuranceNumber: row.insurance_card_number ?? undefined,
    allergies: row.allergies ?? undefined,
    clinicalAlerts: row.clinical_alerts ?? undefined,
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
}
