import { describe, expect, it } from "vitest";
import { parseSelectProjection } from "../../../local-auth-projection.mjs";

describe("local auth projection parser", () => {
  it("preserva colunas simples e descarta relações embutidas aninhadas", () => {
    expect(
      parseSelectProjection(
        "id, full_name, insurance_plan_id, insurance_plan:insurance_plans(insurance_company:insurance_companies(name))",
      ),
    ).toBe('"id", "full_name", "insurance_plan_id"');
  });

  it("preserva select geral quando relações são solicitadas em conjunto", () => {
    expect(
      parseSelectProjection("*, insurance_plan:insurance_plans(id, name)"),
    ).toBe("*");
  });

  it.each([
    "id, (SELECT secret FROM auth.users)",
    "id, relation(name",
    "id, relation(name))",
    "id, relation(name);DROP TABLE patients",
    "id, invalid-column",
  ])("rejeita projeção malformada ou não segura: %s", (projection) => {
    expect(() => parseSelectProjection(projection)).toThrow();
  });
});
