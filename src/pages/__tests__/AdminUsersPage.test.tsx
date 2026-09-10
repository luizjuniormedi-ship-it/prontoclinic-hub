import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import AdminUsersPage from "@/pages/AdminUsersPage";
import { userProfilesService } from "@/services/userProfilesService";
import { authAdminService } from "@/services/authAdminService";

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));

vi.mock("@/services/userProfilesService", () => ({
  userProfilesService: { getAll: vi.fn(), getProfiles: vi.fn(), update: vi.fn() },
}));
vi.mock("@/services/authAdminService", () => ({
  authAdminService: { inviteUser: vi.fn(), sendRecovery: vi.fn(), setActive: vi.fn(), logoutGlobal: vi.fn() },
}));
vi.mock("@/services/applicationSessionStorage", () => ({
  readStoredAccessContext: () => ({ companyId: "company-1", unitId: 7 }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
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
    vi.mocked(authAdminService.logoutGlobal).mockImplementation(() => new Promise<void>(() => undefined));
    render(<AdminUsersPage />);
    const logoutButton = await screen.findByTitle("Encerrar todas as sessões");
    fireEvent.click(logoutButton);
    await waitFor(() => expect(logoutButton).toBeDisabled());
    await waitFor(() => expect(authAdminService.logoutGlobal).toHaveBeenCalledWith(user.id, "company-1"));
  });

  it("distingue falha de lista vazia e recupera com nova tentativa", async () => {
    vi.mocked(userProfilesService.getAll).mockRejectedValueOnce(new Error("internal database detail"));
    render(<AdminUsersPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível carregar os usuários.");
    expect(screen.queryByText("internal database detail")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /convidar usuário/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByText("Usuário QA")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(userProfilesService.getAll).toHaveBeenCalledTimes(2);
  });

  it("libera nova tentativa sem anunciar sucesso quando logout falha", async () => {
    vi.mocked(authAdminService.logoutGlobal).mockRejectedValue(new Error("Operação indisponível"));
    render(<AdminUsersPage />);
    const button = await screen.findByTitle("Encerrar todas as sessões");
    fireEvent.click(button);
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" })));
    expect(button).not.toBeDisabled();
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Sessões encerradas" }));
  });

  it("anuncia encerramento apenas depois do retorno do serviço", async () => {
    render(<AdminUsersPage />);
    fireEvent.click(await screen.findByTitle("Encerrar todas as sessões"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: "Sessões encerradas" }));
    expect(authAdminService.logoutGlobal).toHaveBeenCalledWith(user.id, "company-1");
  });

  it("bloqueia repeticao da recuperacao pendente e libera apos falha", async () => {
    let rejectRecovery!: (reason: Error) => void;
    vi.mocked(authAdminService.sendRecovery).mockImplementation(() => new Promise<void>((_, reject) => { rejectRecovery = reject; }));
    render(<AdminUsersPage />);
    const button = await screen.findByTitle("Enviar recuperação de senha");
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button);
    expect(authAdminService.sendRecovery).toHaveBeenCalledTimes(1);
    rejectRecovery(new Error("Falha de transporte"));
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Não foi possível enviar a recuperação", variant: "destructive" }));
  });

  it("preserva a edicao e permite retry depois de falha sem duplicar salvamento", async () => {
    let rejectUpdate!: (reason: Error) => void;
    vi.mocked(userProfilesService.update).mockImplementationOnce(() => new Promise((_, reject) => { rejectUpdate = reject; }));
    render(<AdminUsersPage />);
    fireEvent.click(await screen.findByTitle("Editar"));
    fireEvent.change(screen.getByLabelText("Nome completo *"), { target: { value: "Nome corrigido" } });
    const save = screen.getByRole("button", { name: "Salvar" });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(userProfilesService.update).toHaveBeenCalledTimes(1);
    expect(save).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
    rejectUpdate(new Error("Falha de transporte"));
    await waitFor(() => expect(save).not.toBeDisabled());
    expect(screen.getByLabelText("Nome completo *")).toHaveValue("Nome corrigido");
    vi.mocked(userProfilesService.update).mockResolvedValueOnce(undefined as never);
    fireEvent.click(save);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(userProfilesService.update).toHaveBeenCalledTimes(2);
  });
});
