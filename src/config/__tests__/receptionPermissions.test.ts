import { describe, expect, it } from "vitest";
import {
  canOverrideReceptionCheckin,
  receptionExceptionReasonLength,
} from "@/config/receptionPermissions";

describe("canOverrideReceptionCheckin", () => {
  it.each(["admin", "Administrador", "GESTOR", "gerente", "supervisor_recepcao"])(
    "permite o conjunto administrativo e supervisor (%s)",
    (role) => {
      expect(canOverrideReceptionCheckin(role)).toBe(true);
    },
  );

  it.each(["recepcao", "recepção", "reception", "faturista", "", null])(
    "nega perfis operacionais e valores vazios (%s)",
    (role) => {
      expect(canOverrideReceptionCheckin(role)).toBe(false);
    },
  );
});

describe("receptionExceptionReasonLength", () => {
  it("conta caracteres Unicode como o PostgreSQL", () => {
    expect(receptionExceptionReasonLength("  motivo válido  ")).toBe(13);
    expect(receptionExceptionReasonLength("😀".repeat(10))).toBe(10);
  });
});
