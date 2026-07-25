import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MedicalRecordsPage from "@/pages/MedicalRecordsPage";
import { professionalsLookup } from "@/services/appointmentsService";

vi.mock("@/services/appointmentsService", () => ({
  professionalsLookup: {
    getAll: vi.fn(),
  },
}));

vi.mock("@/services/medicalRecordsService", () => ({
  medicalRecordsService: {
    getByPatient: vi.fn(),
  },
}));

describe("MedicalRecordsPage", () => {
  beforeEach(() => {
    vi.mocked(professionalsLookup.getAll).mockResolvedValue([]);
  });

  it("mantém a busca disponível quando a consulta auxiliar de profissionais falha", async () => {
    vi.mocked(professionalsLookup.getAll).mockRejectedValue(
      new Error("permission denied for table professionals"),
    );

    render(
      <MemoryRouter>
        <MedicalRecordsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByPlaceholderText("Buscar por nome...")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Os nomes dos profissionais não puderam ser carregados",
    );
    expect(screen.queryByRole("heading", { name: "Erro" })).not.toBeInTheDocument();
  });
});
