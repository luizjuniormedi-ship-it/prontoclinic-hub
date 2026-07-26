import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PatientCreatePage from "@/pages/PatientCreatePage";

const mocks = vi.hoisted(() => ({
  insertPatient: vi.fn(),
  navigate: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...original,
    useNavigate: () => mocks.navigate,
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { company_id: "company-1" },
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === "insurance_plans") {
        const insuranceQuery = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
        return insuranceQuery;
      }
      const patientQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        insert: mocks.insertPatient,
      };
      return patientQuery;
    }),
  },
}));

describe("PatientCreatePage — persistência da data de nascimento", () => {
  beforeEach(() => {
    mocks.insertPatient.mockResolvedValue({ error: null });
  });

  it("envia ao insert exatamente a data válida preenchida no formulário", async () => {
    render(<PatientCreatePage />);

    fireEvent.change(screen.getByLabelText(/Nome Completo/), {
      target: { value: "Paciente Criado" },
    });
    fireEvent.change(screen.getByLabelText(/CPF/), {
      target: { value: "12345678901" },
    });
    fireEvent.change(screen.getByLabelText(/Data de Nascimento/), {
      target: { value: "1990-01-15" },
    });
    fireEvent.change(screen.getByLabelText(/Telefone Principal/), {
      target: { value: "21999998888" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar Paciente" }));

    await waitFor(() => expect(mocks.insertPatient).toHaveBeenCalledTimes(1));
    expect(mocks.insertPatient.mock.calls[0][0]).toMatchObject({
      birth_date: "1990-01-15",
      company_id: "company-1",
    });
    expect(mocks.navigate).toHaveBeenCalledWith("/patients");
  });
});

