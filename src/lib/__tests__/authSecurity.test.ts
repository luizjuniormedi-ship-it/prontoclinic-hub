import { describe, expect, it } from "vitest";
import { PASSWORD_POLICY, validatePassword } from "@/lib/authSecurity";

describe("Module 1 password policy", () => {
  it("rejects passwords that miss required classes", () => {
    expect(validatePassword("123456")).toEqual([
      `Use pelo menos ${PASSWORD_POLICY.minLength} caracteres.`,
      "Inclua uma letra maiúscula.",
      "Inclua uma letra minúscula.",
      "Inclua um símbolo.",
    ]);
  });

  it("accepts a strong password without exposing its value", () => {
    expect(validatePassword("ClinicaSegura#2026")).toEqual([]);
  });

  it("rejects a password with no symbol even when long", () => {
    expect(validatePassword("ClinicaSegura2026")).toContain("Inclua um símbolo.");
  });
});
