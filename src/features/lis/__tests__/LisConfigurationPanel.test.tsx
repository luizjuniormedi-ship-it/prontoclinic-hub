import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const gatewayMocks = vi.hoisted(() => ({
  upsertEquipment: vi.fn(),
  upsertReferenceRange: vi.fn(),
}));

vi.stubGlobal(
  "ResizeObserver",
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

vi.mock("@/features/lis/api/lisGateway", () => gatewayMocks);

import { LisConfigurationPanel } from "../components/LisConfigurationPanel";

const companyId = "00000000-0000-4000-8000-000000000023";

function openReferencesTab() {
  const tab = screen.getByRole("tab", { name: "Faixas de referência" });
  fireEvent.mouseDown(tab, { button: 0, ctrlKey: false });
  fireEvent.click(tab);
}

describe("LisConfigurationPanel", () => {
  beforeEach(() => {
    gatewayMocks.upsertEquipment.mockReset();
    gatewayMocks.upsertReferenceRange.mockReset();
    gatewayMocks.upsertEquipment.mockResolvedValue({ equipment_id: "equipment-23" });
    gatewayMocks.upsertReferenceRange.mockResolvedValue({ reference_id: 41 });
  });

  it("cadastra ou edita equipamento usando somente o gateway seguro", async () => {
    render(
      <LisConfigurationPanel
        companyId={companyId}
        unitId={7}
        roleName="Laboratório"
      />,
    );

    fireEvent.change(screen.getByLabelText("ID do equipamento"), {
      target: { value: "equipment-existing" },
    });
    fireEvent.change(screen.getByLabelText("Código"), {
      target: { value: "ANALYZER-01" },
    });
    fireEvent.change(screen.getByLabelText("Nome"), {
      target: { value: "Analisador hematológico" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar equipamento" }));

    await waitFor(() =>
      expect(gatewayMocks.upsertEquipment).toHaveBeenCalledWith({
        equipmentId: "equipment-existing",
        unitId: 7,
        payload: {
          code: "ANALYZER-01",
          name: "Analisador hematológico",
          integration_kind: "MANUAL",
          status: "ACTIVE",
          active: true,
        },
      }),
    );
    expect(await screen.findByText("Equipamento salvo")).toBeInTheDocument();
    expect(gatewayMocks.upsertReferenceRange).not.toHaveBeenCalled();
  });

  it("edita e inativa faixa de referência usando o gateway previsto", async () => {
    render(
      <LisConfigurationPanel companyId={companyId} unitId={7} roleName="admin" />,
    );
    openReferencesTab();

    fireEvent.change(screen.getByLabelText("ID da referência"), {
      target: { value: "41" },
    });
    fireEvent.change(screen.getByLabelText("ID do exame"), {
      target: { value: "12" },
    });
    fireEvent.change(screen.getByLabelText("Parâmetro"), {
      target: { value: "Hemoglobina" },
    });
    fireEvent.change(screen.getByLabelText("Valor mínimo"), {
      target: { value: "12,5" },
    });
    fireEvent.change(screen.getByLabelText("Valor máximo"), {
      target: { value: "17.2" },
    });
    fireEvent.change(screen.getByLabelText("Unidade de medida"), {
      target: { value: "g/dL" },
    });
    fireEvent.change(screen.getByLabelText("Idade mínima"), {
      target: { value: "18" },
    });
    fireEvent.change(screen.getByLabelText("Idade máxima"), {
      target: { value: "99" },
    });
    fireEvent.click(screen.getByRole("switch", { name: "Faixa ativa" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Salvar faixa de referência" }),
    );

    await waitFor(() =>
      expect(gatewayMocks.upsertReferenceRange).toHaveBeenCalledWith({
        referenceId: 41,
        examId: 12,
        payload: {
          parameter: "Hemoglobina",
          minimumValue: 12.5,
          maximumValue: 17.2,
          unit: "g/dL",
          sex: "A",
          minimumAge: 18,
          maximumAge: 99,
          active: false,
        },
      }),
    );
    expect(
      await screen.findByText("Faixa de referência salva"),
    ).toBeInTheDocument();
    expect(gatewayMocks.upsertEquipment).not.toHaveBeenCalled();
  });

  it.each(["Médico", "Gestor"])(
    "mantém o perfil %s em somente leitura",
    (roleName) => {
      render(
        <LisConfigurationPanel
          companyId={companyId}
          unitId={7}
          roleName={roleName}
        />,
      );

      expect(screen.getByText("Somente leitura")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Salvar equipamento" }),
      ).toBeDisabled();

      openReferencesTab();
      expect(
        screen.getByRole("button", { name: "Salvar faixa de referência" }),
      ).toBeDisabled();
      expect(gatewayMocks.upsertEquipment).not.toHaveBeenCalled();
      expect(gatewayMocks.upsertReferenceRange).not.toHaveBeenCalled();
    },
  );
});
