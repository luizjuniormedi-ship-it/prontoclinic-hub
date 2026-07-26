import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminPermissionsPage from "@/pages/AdminPermissionsPage";

const mocks = vi.hoisted(() => ({
  getPermissions: vi.fn(),
  getProfiles: vi.fn(),
  getUsers: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/services/rolePermissionsService", () => ({
  MODULE_LABELS: { agenda: "Agenda" },
  ACTION_LABELS: {
    can_view: "Visualizar",
    can_create: "Criar",
    can_edit: "Editar",
    can_delete: "Excluir",
    can_export: "Exportar",
  },
  rolePermissionsService: {
    getAll: mocks.getPermissions,
    upsert: vi.fn(),
  },
}));

vi.mock("@/services/userProfilesService", () => ({
  userProfilesService: {
    getProfiles: mocks.getProfiles,
    getAll: mocks.getUsers,
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

describe("AdminPermissionsPage — estados de carregamento", () => {
  beforeEach(() => {
    mocks.getPermissions.mockResolvedValue([]);
    mocks.getUsers.mockResolvedValue([]);
  });

  it("mostra estado vazio claro e recarrega os perfis", async () => {
    mocks.getProfiles
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "admin",
          databaseId: 1,
          name: "Administrador",
          description: "Administração",
        },
      ]);

    render(<AdminPermissionsPage />);

    expect(await screen.findByText("Nenhum perfil disponível")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Recarregar perfis" }));

    expect(await screen.findByRole("tab", { name: /Administrador/ })).toBeVisible();
    expect(mocks.getProfiles).toHaveBeenCalledTimes(2);
  });

  it("mostra o erro e permite tentar novamente", async () => {
    mocks.getProfiles
      .mockRejectedValueOnce(new Error("roles indisponíveis"))
      .mockResolvedValueOnce([]);

    render(<AdminPermissionsPage />);

    expect(await screen.findByText("roles indisponíveis")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));

    await waitFor(() => expect(mocks.getProfiles).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Nenhum perfil disponível")).toBeVisible();
  });
});

