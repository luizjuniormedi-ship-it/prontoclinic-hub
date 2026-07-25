import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { ExplainedActionButton } from "@/components/ExplainedActionButton";
import { TooltipProvider } from "@/components/ui/tooltip";

function renderAction(props: Partial<ComponentProps<typeof ExplainedActionButton>> = {}) {
  const onClick = props.onClick ?? vi.fn();
  render(
    <TooltipProvider>
      <ExplainedActionButton
        label="Concluir check-in"
        description="Finaliza a validação administrativa e encaminha o paciente."
        onClick={onClick}
        {...props}
      />
    </TooltipProvider>,
  );
  return onClick;
}

describe("ExplainedActionButton", () => {
  it("executes an available action with an accessible description", () => {
    const onClick = renderAction();
    const button = screen.getByRole("button", { name: "Concluir check-in" });
    expect(button).toHaveAttribute("aria-describedby");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("shows the reason when an action is unavailable", () => {
    const onClick = renderAction({
      disabled: true,
      disabledReason: "A autorização obrigatória ainda está pendente.",
    });
    expect(screen.getByText("A autorização obrigatória ainda está pendente.")).toBeVisible();
    expect(screen.getByRole("button")).toBeDisabled();
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("requires confirmation before executing a critical action", () => {
    const onClick = renderAction({
      label: "Estornar pagamento",
      confirmation: {
        title: "Confirmar estorno",
        description: "Cria uma movimentação reversa e preserva o pagamento original.",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Estornar pagamento" }));
    expect(screen.getByRole("alertdialog")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Estornar pagamento" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not render an action the interface is not allowed to offer", () => {
    renderAction({ allowed: false });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
