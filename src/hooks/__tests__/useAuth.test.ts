import { describe, expect, it } from "vitest";
import { normalizeRoleName } from "@/config/routePermissions";
import { isProfileAccessAllowed, requiresPasswordChange, type UserProfile } from "@/hooks/useAuth";

const validProfile: UserProfile = {
  id: "a0000000-0000-0000-0000-000000000001",
  email: "user@example.test",
  full_name: "Usuário",
  role_id: 3,
  role_name: "recepcao",
  company_id: "10000000-0000-0000-0000-000000000001",
  primary_unit_id: 1,
  lg_ativo: true,
  must_change_password: false,
};

describe("isProfileAccessAllowed", () => {
  it("permite apenas perfil ativo com empresa, papel e unidade", () => {
    expect(isProfileAccessAllowed(validProfile)).toBe(true);
  });

  it.each(["admin", "administrador", "superadmin", "super_admin"])(
    "permite o papel corporativo %s sem unidade primária",
    (roleName) => {
      expect(isProfileAccessAllowed({
        ...validProfile,
        role_id: 1,
        role_name: roleName,
        primary_unit_id: null,
      })).toBe(true);
    },
  );

  it.each([
    ["perfil ausente", null],
    ["perfil inativo", { ...validProfile, lg_ativo: false }],
    ["empresa ausente", { ...validProfile, company_id: null }],
    ["papel ausente", { ...validProfile, role_id: null, role_name: null }],
    ["unidade operacional ausente", { ...validProfile, primary_unit_id: null }],
  ])("nega acesso quando %s", (_case, profile) => {
    expect(isProfileAccessAllowed(profile)).toBe(false);
  });
});

describe("normalizeRoleName", () => {
  it.each(["admin", "administrador", "superadmin", "super_admin"])(
    "normaliza o alias administrativo %s",
    (roleName) => expect(normalizeRoleName(roleName)).toBe("admin"),
  );
});

describe("requiresPasswordChange", () => {
  it("confia somente na flag protegida do perfil funcional", () => {
    expect(requiresPasswordChange({ ...validProfile, must_change_password: true })).toBe(true);
    expect(requiresPasswordChange(validProfile)).toBe(false);
  });
});
