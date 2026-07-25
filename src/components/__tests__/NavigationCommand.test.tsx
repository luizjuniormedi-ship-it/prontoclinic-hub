import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { NavigationCommand } from "@/components/NavigationCommand";

function CurrentLocation() {
  return <output aria-label="Rota atual">{useLocation().pathname}</output>;
}

function NavigationHarness({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const [open, setOpen] = useState(true);

  return (
    <>
      <NavigationCommand
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          onOpenChange(nextOpen);
        }}
        roleName="recepcao"
      />
      <CurrentLocation />
    </>
  );
}

describe("NavigationCommand", () => {
  it("lists only authorized modules and navigates from a keyword search", async () => {
    const onOpenChange = vi.fn();
    render(
      <MemoryRouter initialEntries={["/"]}>
        <NavigationHarness onOpenChange={onOpenChange} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("dialog", { name: "Todos os módulos" })).toBeVisible();
    expect(screen.getByText("Recepção")).toBeVisible();
    expect(screen.queryByText("Usuários")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Buscar telas e funções" }), {
      target: { value: "elegibilidade" },
    });
    fireEvent.click(await screen.findByText("Recepção"));

    expect(await screen.findByRole("status", { name: "Rota atual" })).toHaveTextContent("/reception");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("includes DPO compliance modules without exposing clinical modules", () => {
    render(
      <MemoryRouter>
        <NavigationCommand open onOpenChange={vi.fn()} roleName="dpo" />
      </MemoryRouter>,
    );

    expect(screen.getByText("LGPD e privacidade")).toBeVisible();
    expect(screen.getByText("Auditoria")).toBeVisible();
    expect(screen.queryByText("Atendimento clínico")).not.toBeInTheDocument();
  });
});
