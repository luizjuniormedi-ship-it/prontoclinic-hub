import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ExplainedActionButton } from "@/components/actions/ExplainedActionButton";

function renderButton(props: React.ComponentProps<typeof ExplainedActionButton>) {
  return render(
    <TooltipProvider delayDuration={0}>
      <ExplainedActionButton {...props} />
    </TooltipProvider>,
  );
}

describe("ExplainedActionButton", () => {
  it("expõe nome e efeito da ação para tecnologias assistivas", () => {
    renderButton({
      label: "Concluir check-in",
      description: "Gera a senha e encaminha o paciente para a fila.",
      onClick: vi.fn(),
    });

    expect(screen.getByRole("button", {
      name: "Concluir check-in. Gera a senha e encaminha o paciente para a fila.",
    })).toBeEnabled();
  });

  it("explica por que a ação está desabilitada", () => {
    renderButton({
      label: "Concluir check-in",
      description: "Gera a senha e encaminha o paciente para a fila.",
      disabled: true,
      disabledReason: "A autorização obrigatória ainda está pendente.",
      onClick: vi.fn(),
    });

    expect(screen.getByRole("button", {
      name: "Concluir check-in. A autorização obrigatória ainda está pendente.",
    })).toBeDisabled();
    expect(screen.getByRole("group", {
      name: "Concluir check-in. A autorização obrigatória ainda está pendente.",
    })).toHaveAttribute("tabindex", "0");
  });

  it("executa a ação quando está disponível", () => {
    const onClick = vi.fn();
    renderButton({
      label: "Atualizar",
      description: "Atualiza os dados da tela.",
      onClick,
    });

    fireEvent.click(screen.getByRole("button", { name: "Atualizar. Atualiza os dados da tela." }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
