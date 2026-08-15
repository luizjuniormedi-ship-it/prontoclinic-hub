import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LabPage from "@/pages/LabPage";

const mocks = vi.hoisted(() => ({
  auth: {
    companyId: "company-lis-qa" as string | null,
    activeUnitId: 23 as number | null,
    user: { role_name: "laboratorio" } as { role_name: string | null } | null,
  },
  orders: vi.fn(() => <section>Gestão de pedidos LIS</section>),
  operations: vi.fn(() => <section>Operações LIS</section>),
  configuration: vi.fn(() => <section>Configuração LIS</section>),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => mocks.auth,
}));

vi.mock("@/components/lis/LabOrdersManager", () => ({
  LabOrdersManager: mocks.orders,
}));

vi.mock("@/features/lis/components/LisOperationsPanel", () => ({
  LisOperationsPanel: mocks.operations,
}));

vi.mock("@/features/lis/components/LisConfigurationPanel", () => ({
  LisConfigurationPanel: mocks.configuration,
}));

describe("LabPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.companyId = "company-lis-qa";
    mocks.auth.activeUnitId = 23;
    mocks.auth.user = { role_name: "laboratorio" };
  });

  it("integra pedidos, operações e configuração na rota canônica", () => {
    render(<LabPage />);

    expect(screen.getByText("Gestão de pedidos LIS")).toBeInTheDocument();
    expect(mocks.orders).toHaveBeenCalledTimes(1);

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Operações" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(screen.getByText("Operações LIS")).toBeInTheDocument();
    expect(mocks.operations).toHaveBeenLastCalledWith(
      expect.objectContaining({
        companyId: "company-lis-qa",
        unitId: 23,
        roleName: "laboratorio",
      }),
      {},
    );

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Configuração" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(screen.getByText("Configuração LIS")).toBeInTheDocument();
    expect(mocks.configuration).toHaveBeenLastCalledWith(
      expect.objectContaining({
        companyId: "company-lis-qa",
        unitId: 23,
        roleName: "laboratorio",
      }),
      {},
    );
  });

  it.each([
    [null, 23],
    ["company-lis-qa", null],
    ["company-lis-qa", 0],
  ])("não monta painéis sem contexto válido (%s, %s)", (companyId, activeUnitId) => {
    mocks.auth.companyId = companyId;
    mocks.auth.activeUnitId = activeUnitId;

    render(<LabPage />);

    expect(screen.getByRole("alert")).toHaveTextContent("Contexto de acesso indisponível");
    expect(mocks.orders).not.toHaveBeenCalled();
    expect(mocks.operations).not.toHaveBeenCalled();
    expect(mocks.configuration).not.toHaveBeenCalled();
  });
});
