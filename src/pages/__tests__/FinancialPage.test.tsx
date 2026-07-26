import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FinancialPage from "@/pages/FinancialPage";

const mocks = vi.hoisted(() => ({
  getTransactions: vi.fn(),
  getProfessionals: vi.fn(),
  searchPatients: vi.fn(),
}));

vi.mock("@/services/financialService", () => ({
  financialService: {
    getAll: mocks.getTransactions,
    create: vi.fn(),
    markPaid: vi.fn(),
  },
  billingsService: {},
}));

vi.mock("@/services/appointmentsService", () => ({
  professionalsLookup: {
    getAll: mocks.getProfessionals,
  },
}));

vi.mock("@/services/patientsService", () => ({
  patientsService: {
    search: mocks.searchPatients,
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: {
      company_id: "company-1",
      primary_unit_id: 7,
    },
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

describe("FinancialPage — seletor corporativo de pacientes", () => {
  beforeEach(() => {
    mocks.getTransactions.mockResolvedValue([]);
    mocks.getProfessionals.mockResolvedValue([]);
    mocks.searchPatients.mockResolvedValue([
      {
        id: "patient-42",
        name: "Maria Sem Transação",
        cpf: "12345678901",
      },
    ]);
  });

  it("busca no cadastro da empresa em vez de depender das transações carregadas", async () => {
    render(<FinancialPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Nova Cobrança" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Buscar paciente da empresa" }), {
      target: { value: "Maria" },
    });

    await waitFor(() => expect(mocks.searchPatients).toHaveBeenCalledWith("Maria"), {
      timeout: 1_500,
    });
    expect(await screen.findByRole("combobox", { name: "Selecionar paciente da empresa" }))
      .toBeEnabled();
  });
});
