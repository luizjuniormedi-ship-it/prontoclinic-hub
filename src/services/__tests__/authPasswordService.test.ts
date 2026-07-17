import { describe, expect, it, vi } from "vitest";
import { requestPasswordReset, updatePasswordAndLogout } from "@/services/authPasswordService";

describe("requestPasswordReset", () => {
  it("sempre devolve a mesma confirmação para evitar enumeração", async () => {
    const resetPasswordForEmail = vi.fn()
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: "User not found" } });
    const client = { resetPasswordForEmail };

    await expect(requestPasswordReset(client, "known@example.test", "https://app/reset-password"))
      .resolves.toEqual({ accepted: true });
    await expect(requestPasswordReset(client, "unknown@example.test", "https://app/reset-password"))
      .resolves.toEqual({ accepted: true });
  });
});

describe("updatePasswordAndLogout", () => {
  it("troca a senha, limpa a exigência e encerra todas as sessões", async () => {
    const updateUser = vi.fn().mockResolvedValue({ error: null });
    const signOut = vi.fn().mockResolvedValue({ error: null });

    await updatePasswordAndLogout({ updateUser, signOut }, "nova-senha");

    expect(updateUser).toHaveBeenCalledWith({ password: "nova-senha" });
    expect(signOut).toHaveBeenCalledWith({ scope: "global" });
  });

  it("não encerra sessões se a troca de senha falhar", async () => {
    const signOut = vi.fn();
    const client = {
      updateUser: vi.fn().mockResolvedValue({ error: { message: "weak password" } }),
      signOut,
    };
    await expect(updatePasswordAndLogout(client, "fraca")).rejects.toThrow("weak password");
    expect(signOut).not.toHaveBeenCalled();
  });
});
