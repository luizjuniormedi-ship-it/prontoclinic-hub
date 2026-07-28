import { describe, expect, it } from "vitest";
import {
  canPerformClinicalAction,
  clinicalPermissionsFor,
} from "@/config/clinicalModulePermissions";

describe("clinicalModulePermissions", () => {
  it.each([
    ["Farmácia", "m20.create", false],
    ["Farmacêutico", "m20.review", true],
    ["Médico", "m20.create", true],
    ["Médico", "m20.review", false],
    ["Enfermagem", "m21.manageDefinitions", false],
    ["Técnico de Enfermagem", "m21.execute", true],
    ["Gestor", "m21.manageDefinitions", true],
    ["Diagnóstico", "m22.create", false],
    ["Radiologia", "m22.sign", false],
    ["Laboratório", "m22.cancel", false],
    ["Radiologia", "m22.dispatch", true],
    ["Laboratório", "m22.transition", true],
  ] as const)("aplica %s em %s = %s", (role, action, expected) => {
    expect(canPerformClinicalAction(role, action)).toBe(expected);
  });

  it("falha fechado para papel ausente ou desconhecido", () => {
    expect(clinicalPermissionsFor(null).m20.canCreate).toBe(false);
    expect(clinicalPermissionsFor("papel-inexistente").m22.canDispatch).toBe(false);
  });

  it("mantém administrador autorizado em todas as ações clínicas", () => {
    const permissions = clinicalPermissionsFor("Administrador");
    expect(Object.values(permissions).flatMap(Object.values).every(Boolean)).toBe(true);
  });
});
