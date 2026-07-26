import { describe, expect, it } from "vitest";
import {
  canonicalUnitId,
  filterProfessionalsForUnit,
  professionalIdsForUnit,
} from "@/components/schedule/NewAppointmentDialog";
import type { DbProfessional } from "@/services/appointmentsService";

function professional(
  id: string,
  status: string | null = "active",
  lgAtivo: boolean | null = true,
): DbProfessional {
  return {
    id,
    company_id: "company-1",
    full_name: `Profissional ${id}`,
    category: "medico",
    council_type: null,
    council_number: null,
    cpf: null,
    phone: null,
    email: null,
    status,
    lg_ativo: lgAtivo,
    default_duration_minutes: 30,
    created_at: "",
    updated_at: "",
  };
}

describe("NewAppointmentDialog — unidade ativa", () => {
  it("normaliza o identificador da unidade para o formato canônico do RPC", () => {
    expect(canonicalUnitId(7)).toBe("7");
    expect(canonicalUnitId("007")).toBe("7");
    expect(canonicalUnitId(null)).toBeNull();
    expect(canonicalUnitId("unidade-7")).toBeNull();
  });

  it("considera vínculos da agenda principal e dos três turnos", () => {
    const ids = professionalIdsForUnit([
      { professional_id: 10, unit_id: 7 },
      { professional_id: 11, unit_id: 8, slot1_unit_id: 7 },
      { professional_id: 12, slot2_unit_id: 7 },
      { professional_id: 13, slot3_unit_id: 9 },
    ], "7");

    expect([...ids]).toEqual(["10", "11", "12"]);
  });

  it("remove profissionais inativos e sem vínculo com a unidade", () => {
    const result = filterProfessionalsForUnit(
      [
        professional("10"),
        professional("11", "inactive"),
        professional("12"),
      ],
      new Set(["10", "11"]),
    );

    expect(result.map((item) => item.id)).toEqual(["10"]);
  });
});
