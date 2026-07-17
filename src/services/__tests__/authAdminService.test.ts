import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/lib/supabase";
import { authAdminService } from "@/services/authAdminService";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: vi.fn() },
  },
}));

describe("authAdminService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("envia convite somente pela Edge Function privilegiada", async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: { ok: true, userId: "user-1" },
      error: null,
    } as never);

    await expect(authAdminService.inviteUser({
      email: "nova@example.test",
      fullName: "Nova Pessoa",
      companyId: "company-1",
      roleId: 3,
      primaryUnitId: 1,
      redirectTo: "https://app.example.test/reset-password",
    })).resolves.toEqual({ userId: "user-1" });

    expect(supabase.functions.invoke).toHaveBeenCalledWith("auth-admin", {
      body: expect.objectContaining({ action: "invite-user", email: "nova@example.test" }),
    });
  });

  it("não vaza detalhes internos retornados pela função", async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: { error: "detalhe interno" },
      error: { message: "function failed" },
    } as never);

    await expect(authAdminService.sendRecovery(
      "user-1",
      "company-1",
      "https://app.example.test/reset-password",
    ))
      .rejects.toThrow("Não foi possível concluir a operação administrativa.");
  });

  it("envia a empresa ativa nas alterações de acesso", async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { ok: true }, error: null } as never);

    await authAdminService.setActive("user-1", "company-2", false);

    expect(supabase.functions.invoke).toHaveBeenCalledWith("auth-admin", {
      body: { action: "set-active", userId: "user-1", companyId: "company-2", active: false },
    });
  });
});
