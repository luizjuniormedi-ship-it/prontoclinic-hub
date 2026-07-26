import { describe, expect, it } from "vitest";
import type { CallCenterContactLog } from "@/services/callCenterService";
import { matchesCallCenterContactSearch } from "@/utils/callCenterSearch";

const contact = {
  patient_name: "Maria Souza",
  patient_cpf: "123.456.789-00",
  patient_phone: "(21) 99999-0000",
  contact_reason: "Retorno de exame",
} as CallCenterContactLog;

describe("matchesCallCenterContactSearch", () => {
  it("não transforma busca textual em correspondência universal por CPF vazio", () => {
    expect(matchesCallCenterContactSearch(contact, "joão")).toBe(false);
  });

  it("encontra nome, CPF, telefone e motivo normalizados", () => {
    expect(matchesCallCenterContactSearch(contact, "maria")).toBe(true);
    expect(matchesCallCenterContactSearch(contact, "456789")).toBe(true);
    expect(matchesCallCenterContactSearch(contact, "99999-0000")).toBe(true);
    expect(matchesCallCenterContactSearch(contact, "exame")).toBe(true);
  });
});

