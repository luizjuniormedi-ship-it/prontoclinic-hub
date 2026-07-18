import { describe, expect, it } from "vitest";
import { mapSchedulePatient } from "@/pages/schedulePatientMapper";

it("preserva o nome do convênio derivado do plano cadastral", () => {
  const patient = mapSchedulePatient({
    id: 10,
    full_name: "Paciente Conveniado",
    cpf: null,
    birth_date: null,
    phone: null,
    email: null,
    sex: "F",
    insurance_plan_id: 20,
    insurance_card_number: "CARTEIRA-1",
    insurance_plan: { insurance_company: { name: "Convênio Saúde" } },
    created_at: "2026-07-17T00:00:00Z",
    updated_at: "2026-07-17T00:00:00Z",
  });

  expect(patient.healthInsurance).toBe("Convênio Saúde");
  expect(patient.healthInsuranceNumber).toBe("CARTEIRA-1");
});
