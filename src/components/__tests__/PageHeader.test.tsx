import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { PageBreadcrumb, PageHeader } from "@/components/PageHeader";

describe("PageHeader", () => {
  it("shows workspace and current screen in the breadcrumb", () => {
    render(
      <MemoryRouter initialEntries={["/reception"]}>
        <PageHeader title="Recepção" description="Jornada administrativa do paciente." />
      </MemoryRouter>,
    );

    const breadcrumb = screen.getByRole("navigation", { name: "Localização da página" });
    expect(breadcrumb).toHaveTextContent("Operação e atendimento");
    expect(breadcrumb).toHaveTextContent("Recepção");
    expect(screen.getByRole("heading", { level: 1, name: "Recepção" })).toBeVisible();
  });

  it("maps a contextual attendance route back to its owning screen", () => {
    render(
      <MemoryRouter initialEntries={["/attendance/123"]}>
        <PageHeader title="Atendimento de Maria" />
      </MemoryRouter>,
    );

    expect(screen.getByRole("navigation", { name: "Localização da página" }))
      .toHaveTextContent("Assistência clínica");
  });

  it("adds only the breadcrumb to legacy screens that keep their own title", () => {
    render(
      <MemoryRouter initialEntries={["/admin/tiss"]}>
        <PageBreadcrumb currentTitle="TISS" />
        <h1>Faturamento TISS</h1>
      </MemoryRouter>,
    );

    expect(screen.getByRole("navigation", { name: "Localização da página" }))
      .toHaveTextContent("Faturamento e financeiro");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});
