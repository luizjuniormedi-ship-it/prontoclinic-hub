import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ReceptionTermCatalogItem } from "@/services/receptionCompletionService";
import { ReceptionPatientOperationsPanel } from "../ReceptionPatientOperationsPanel";

const serviceMocks = vi.hoisted(() => ({
  listActiveTerms: vi.fn(),
  acceptTerm: vi.fn(),
  requestDocumentPickup: vi.fn(),
  releaseDocumentPickup: vi.fn(),
  createWalkin: vi.fn(),
  resolveDocumentIssue: vi.fn(),
}));

const toastMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/receptionCompletionService", () => ({
  receptionCompletionService: serviceMocks,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

const term: ReceptionTermCatalogItem = {
  id: "4b8917b2-8f95-4fe4-98f3-7e5900093170",
  code: "atendimento",
  version: "2.1",
  title: "Termo de atendimento",
  content: "O paciente declara ciência do atendimento.\nSegunda cláusula.",
  contentHash: "hash-do-catalogo",
  purpose: "CLINICA",
  publishedAt: "2026-07-26T12:00:00.000Z",
};

describe("ReceptionPatientOperationsPanel — integridade do aceite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (!HTMLElement.prototype.hasPointerCapture) {
      HTMLElement.prototype.hasPointerCapture = () => false;
      HTMLElement.prototype.setPointerCapture = () => {};
      HTMLElement.prototype.releasePointerCapture = () => {};
    }
    if (!HTMLElement.prototype.scrollIntoView) {
      HTMLElement.prototype.scrollIntoView = () => {};
    }
    serviceMocks.listActiveTerms.mockResolvedValue([term]);
    serviceMocks.acceptTerm.mockResolvedValue(
      "4c564f6b-3522-45a5-92fb-c5268e966126",
    );
    serviceMocks.resolveDocumentIssue.mockResolvedValue(null);
  });

  it("remove entradas livres e exige seleção, leitura e manifestação", async () => {
    render(
      <ReceptionPatientOperationsPanel
        patientId="42"
        appointmentId="91"
        mode="checkin"
      />,
    );

    const termSelect = await screen.findByRole("combobox", {
      name: "Termo versionado do catálogo",
    });
    const acceptButton = screen.getByRole("button", {
      name: "Registrar aceite",
    });

    expect(
      screen.queryByPlaceholderText("Código do termo"),
    ).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Versão")).not.toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText("Hash do conteúdo"),
    ).not.toBeInTheDocument();
    expect(acceptButton).toBeDisabled();

    fireEvent.keyDown(termSelect, { key: "Enter", code: "Enter" });
    fireEvent.click(
      await screen.findByRole("option", { name: /Termo de atendimento/ }),
    );

    expect(
      screen.getByRole("document", {
        name: "Conteúdo do termo Termo de atendimento",
      }).textContent,
    ).toBe(term.content);
    expect(
      screen.getByText("Código atendimento · versão 2.1"),
    ).toBeInTheDocument();
    expect(acceptButton).toBeDisabled();

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /o conteúdo foi apresentado.*manifestou concordância/i,
      }),
    );
    expect(acceptButton).toBeEnabled();

    fireEvent.click(acceptButton);

    await waitFor(() =>
      expect(serviceMocks.acceptTerm).toHaveBeenCalledWith(
        "42",
        term,
        "91",
        "manifestacao_presencial_confirmada",
      ),
    );
    await waitFor(() => expect(acceptButton).toBeDisabled());
    expect(toastMock).toHaveBeenCalledWith({
      title: "Termo aceito e auditado",
    });
  });

  it("expõe falha do catálogo e permite tentar novamente", async () => {
    serviceMocks.listActiveTerms
      .mockRejectedValueOnce(new Error("Catálogo indisponível"))
      .mockResolvedValueOnce([term]);

    render(<ReceptionPatientOperationsPanel patientId="42" mode="checkin" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Catálogo indisponível",
    );

    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));

    expect(
      await screen.findByRole("combobox", {
        name: "Termo versionado do catálogo",
      }),
    ).toBeEnabled();
    expect(serviceMocks.listActiveTerms).toHaveBeenCalledTimes(2);
  });

  it("regulariza documento pendente dentro do check-in e atualiza a prontidão", async () => {
    const completed = vi.fn();
    render(
      <ReceptionPatientOperationsPanel
        patientId="42"
        appointmentId="91"
        mode="checkin"
        documentIssues={[{
          type: "document",
          severity: "blocking",
          description: "Documento expirado",
          document_id: "4b8917b2-8f95-4fe4-98f3-7e5900093170",
          document_type: "identidade",
        }]}
        onOperationCompleted={completed}
      />,
    );

    const issueSelect = await screen.findByRole("combobox", {
      name: "Regularizar documento pendente",
    });
    fireEvent.keyDown(issueSelect, { key: "Enter", code: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: /identidade/i }));
    fireEvent.change(screen.getByLabelText("Número conferido"), {
      target: { value: "DOC-2026-001" },
    });
    fireEvent.change(screen.getByLabelText("Nova validade"), {
      target: { value: "2027-07-30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar regularização" }));

    await waitFor(() =>
      expect(serviceMocks.resolveDocumentIssue).toHaveBeenCalledWith(
        "91",
        "4b8917b2-8f95-4fe4-98f3-7e5900093170",
        "DOC-2026-001",
        "2027-07-30",
      ),
    );
    expect(completed).toHaveBeenCalled();
  });
});
