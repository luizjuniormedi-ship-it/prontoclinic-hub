import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import NursingTriagePage from "@/pages/NursingTriagePage";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: {
      company_id: "company-1",
      id: "user-1",
    },
  }),
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/services/nursingService", () => ({
  nursingService: {
    fila: {
      getFilaAtiva: vi.fn().mockResolvedValue([]),
      chamar: vi.fn(),
      marcarTriado: vi.fn(),
    },
    classificacao: {
      getAll: vi.fn().mockResolvedValue([]),
    },
    triagem: {
      create: vi.fn(),
      salvarNews2: vi.fn(),
    },
  },
  calcularNEWS2: vi.fn(),
}));

describe("NursingTriagePage — hierarquia de títulos", () => {
  it("renderiza exatamente um H1", async () => {
    render(
      <MemoryRouter>
        <NursingTriagePage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", {
      level: 1,
      name: "Triagem de Enfermagem",
    })).toBeVisible();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});
