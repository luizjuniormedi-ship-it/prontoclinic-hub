import { describe, expect, it } from "vitest";
import {
  formatTissCurrency,
  formatTissErrorMessage,
  formatTissInteger,
  formatTissPercent,
  toFiniteTissNumber,
} from "../tissDisplay";

describe("tissDisplay", () => {
  it("normaliza números retornados como texto pelo PostgreSQL", () => {
    expect(toFiniteTissNumber("120.50")).toBe(120.5);
    expect(formatTissCurrency("120.50")).not.toContain("NaN");
    expect(formatTissInteger("3")).toBe("3");
    expect(formatTissPercent("8.2")).toBe("8.20%");
  });

  it("não produz NaN para valores ausentes ou inválidos", () => {
    expect(formatTissCurrency(undefined)).toBe("—");
    expect(formatTissInteger("inválido")).toBe("—");
    expect(formatTissPercent(null)).toBe("—");
  });

  it("preserva mensagem, detalhes e código de erro PostgREST", () => {
    expect(formatTissErrorMessage({
      code: "42703",
      message: "column tiss_xml.appointment_id does not exist",
      details: "Consulta interrompida.",
    })).toBe(
      "column tiss_xml.appointment_id does not exist Consulta interrompida. (código 42703)",
    );
  });
});
