import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PatientForm } from "@/components/patients/PatientForm";

vi.mock("@/lib/supabase", () => {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: [], error: null }),
  };
  return {
    supabase: {
      from: vi.fn(() => query),
    },
  };
});

describe("PatientForm — data de nascimento controlada", () => {
  it("preserva a data preenchida e a entrega ao callback de criação", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <PatientForm
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        saving={false}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Nome Completo/), {
      target: { value: "Paciente Data Válida" },
    });
    fireEvent.change(screen.getByLabelText(/CPF/), {
      target: { value: "12345678901" },
    });
    const birthDate = screen.getByLabelText(/Data de Nascimento/);
    fireEvent.change(birthDate, { target: { value: "1990-01-15" } });
    fireEvent.change(screen.getByLabelText(/Telefone Principal/), {
      target: { value: "21999998888" },
    });

    expect(birthDate).toHaveValue("1990-01-15");
    fireEvent.click(screen.getByRole("button", { name: "Salvar Paciente" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      full_name: "Paciente Data Válida",
      birth_date: "1990-01-15",
    });
  });
});

