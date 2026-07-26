import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FinancialPage from "@/pages/FinancialPage";

const mocks = vi.hoisted(() => ({
  getTransactions: vi.fn(),
  markPaid: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});

vi.mock("@/services/financialService", () => ({
  financialService: {
    getAll: mocks.getTransactions,
    markPaid: mocks.markPaid,
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({
        data: [{ id: 12, full_name: "Maria Financeiro" }],
        error: null,
      }),
    })),
  },
}));

const receivable = {
  id: "71",
  company_id: "company-1",
  unit_id: 7,
  patient_id: "12",
  billing_id: "41",
  professional_id: "8",
  appointment_id: "55",
  transaction_type: "receivable",
  amount: 250,
  discount: 0,
  payment_method: null,
  status: "pendente",
  canonical_status: "open",
  due_date: "2026-07-25",
  payment_date: null,
  notes: null,
  created_at: "2026-07-25T10:00:00Z",
};

describe("FinancialPage — fluxo canônico de recebimento", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getTransactions.mockResolvedValue([receivable]);
    mocks.markPaid.mockResolvedValue({ ...receivable, status: "pago" });
  });

  it("registra o pagamento com referência externa pelo serviço transacional", async () => {
    render(<FinancialPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Registrar pagamento" }));
    fireEvent.change(screen.getByLabelText(/Comprovante, NSU ou referência/i), {
      target: { value: "PIX-E2E-0001" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => {
      expect(mocks.markPaid).toHaveBeenCalledWith(
        receivable,
        "pix",
        "PIX-E2E-0001",
      );
    });
  });

  it("encaminha a criação e gestão de contas ao módulo canônico", async () => {
    render(<FinancialPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Gerenciar contas" }));
    expect(mocks.navigate).toHaveBeenCalledWith("/billing-accounts");
  });
});
