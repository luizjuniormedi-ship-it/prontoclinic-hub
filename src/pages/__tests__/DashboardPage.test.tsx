import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "@/pages/DashboardPage";

const mocks = vi.hoisted(() => ({
  roleName: "financeiro",
  professionalsGetAll: vi.fn(),
  appointmentsGetByDate: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: {
      id: "55555555-5555-4555-8555-555555555555",
      full_name: "CI User",
      role_name: mocks.roleName,
    },
  }),
}));

vi.mock("@/services/appointmentsService", () => ({
  appointmentsService: { getByDate: mocks.appointmentsGetByDate },
  professionalsLookup: { getAll: mocks.professionalsGetAll },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { from: mocks.from },
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

describe("DashboardPage role-aware loading", () => {
  beforeEach(() => {
    mocks.roleName = "financeiro";
    mocks.professionalsGetAll.mockReset().mockResolvedValue([]);
    mocks.appointmentsGetByDate.mockReset().mockResolvedValue([]);
    mocks.from.mockReset().mockReturnValue({
      select: vi.fn().mockResolvedValue({ count: 0, data: [], error: null }),
    });
  });

  it("nao consulta pacientes ou agenda para perfil financeiro", async () => {
    renderPage();

    await screen.findByText(/Bem-vindo, CI User!/);
    expect(mocks.professionalsGetAll).not.toHaveBeenCalled();
    expect(mocks.appointmentsGetByDate).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("carrega os catalogos operacionais para perfil recepcao", async () => {
    mocks.roleName = "recepcao";
    renderPage();

    await waitFor(() => {
      expect(mocks.professionalsGetAll).toHaveBeenCalledTimes(1);
      expect(mocks.appointmentsGetByDate).toHaveBeenCalledTimes(1);
      expect(mocks.from).toHaveBeenCalledWith("patients");
    });
  });
});

