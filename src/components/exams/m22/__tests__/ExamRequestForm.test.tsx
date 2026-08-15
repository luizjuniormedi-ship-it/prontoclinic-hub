import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { ExamRequestForm } from "@/components/exams/m22/ExamRequestForm";

describe("ExamRequestForm", () => {
  it("mantém a chave na falha e gera outra somente após sucesso", async () => {
    const onSubmit = vi.fn()
      .mockRejectedValueOnce(new Error("falha transitória"))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    render(<ExamRequestForm unitId={7} isSubmitting={false} onSubmit={onSubmit} />);

    const fillAndSubmit = () => {
      fireEvent.change(screen.getByLabelText("Paciente ID"), { target: { value: "19" } });
      fireEvent.change(screen.getByLabelText("Profissional solicitante ID"), { target: { value: "20" } });
      fireEvent.change(screen.getByLabelText("Indicação clínica"), { target: { value: "Controle sintético" } });
      fireEvent.change(screen.getByLabelText("Descrição"), { target: { value: "Hemograma" } });
      fireEvent.click(screen.getByRole("button", { name: "Criar requisição" }));
    };

    fillAndSubmit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const firstKey = onSubmit.mock.calls[0][0].idempotencyKey;

    fillAndSubmit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.calls[1][0].idempotencyKey).toBe(firstKey);
    await waitFor(() => expect(screen.getByLabelText("Descrição")).toHaveValue(""));

    fillAndSubmit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(3));
    expect(onSubmit.mock.calls[2][0].idempotencyKey).not.toBe(firstKey);
  });
});
