import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import AdminUsersPage from "@/pages/AdminUsersPage";
import { userProfilesService } from "@/services/userProfilesService";
import { authAdminService } from "@/services/authAdminService";

vi.mock("@/services/userProfilesService", () => ({
  userProfilesService: { getAll: vi.fn(), getProfiles: vi.fn(), update: vi.fn() },
}));
vi.mock("@/services/authAdminService", () => ({
  authAdminService: { inviteUser: vi.fn(), sendRecovery: vi.fn(), setActive: vi.fn(), logoutGlobal: vi.fn() },
}));
vi.mock("@/services/applicationSessionStorage", () => ({
  readStoredAccessContext: () => ({ companyId: "company-1", unitId: 7 }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useConfirm", () => ({ useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true) }) }));

const user = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "qa@example.test",
  full_name: "Usuário QA",
  role_id: 1,
  role_name: "admin",
  company_id: "company-1",
  primary_unit_id: 7,
  phone: null,
  cpf: null,
  lg_ativo: true,
  membership_status: "active" as const,
  role_names: ["admin"],
  unit_ids: [7],
  created_at: "2026-08-05T00:00:00Z",
  updated_at: "2026-08-05T00:00:00Z",
};

describe("AdminUsersPage", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(userProfilesService.getAll).mockResolvedValue([user]);
    vi.mocked(userProfilesService.getProfiles).mockResolvedValue([
      { id: "recepcao", databaseId: 3, name: "Recepção", description: "" },
    ]);
    vi.mocked(authAdminService.inviteUser).mockResolvedValue({ userId: "new-user" });
    vi.mocked(authAdminService.logoutGlobal).mockResolvedValue();
  });

  it("convida usuário no contexto ativo usando o contrato administrativo", async () => {
    render(<AdminUsersPage />);
    fireEvent.click(await screen.findByRole("button", { name: /convidar usuário/i }));
    fireEvent.change(screen.getByLabelText(/nome completo/i), { target: { value: "Nova Pessoa" } });
    fireEvent.change(screen.getByLabelText(/e-mail/i), { target: { value: "NOVA@EXAMPLE.TEST" } });
    fireEvent.click(screen.getByRole("combobox", { name: /perfil/i }));
    fireEvent.click(await screen.findByRole("option", { name: "Recepção" }));
    fireEvent.click(screen.getByRole("button", { name: /enviar convite/i }));

    await waitFor(() => expect(authAdminService.inviteUser).toHaveBeenCalledWith(expect.objectContaining({
      email: "nova@example.test",
      companyId: "company-1",
      roleId: 3,
      primaryUnitId: 7,
    })));
  });

  it("encerra globalmente as sessões após confirmação", async () => {
    render(<AdminUsersPage />);
    fireEvent.click(await screen.findByTitle("Encerrar todas as sessões"));
    await waitFor(() => expect(authAdminService.logoutGlobal).toHaveBeenCalledWith(user.id, "company-1"));
  });
});
