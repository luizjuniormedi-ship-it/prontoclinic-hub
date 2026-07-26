import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LabOrdersManager } from "@/components/lis/LabOrdersManager";

const mocks = vi.hoisted(() => ({
  catalogGetAll: vi.fn(),
  orderList: vi.fn(),
  orderCreate: vi.fn(),
  orderUpdateStatus: vi.fn(),
  alertsList: vi.fn(),
  patientsSearch: vi.fn(),
  professionalsGetAll: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/services/lisService", () => ({
  catalogo: {
    getAll: mocks.catalogGetAll,
    create: vi.fn(),
    update: vi.fn(),
  },
  pedido: {
    listar: mocks.orderList,
    create: mocks.orderCreate,
    atualizarStatus: mocks.orderUpdateStatus,
  },
  alerta: {
    listarPendentes: mocks.alertsList,
    comunicar: vi.fn(),
  },
  formatLabCurrency: (value: number | null) => (value == null ? "—" : `R$ ${value}`),
  LAB_CATEGORIAS: ["HEMATOLOGIA"],
  LAB_MATERIAIS: ["SANGUE"],
  LAB_STATUS_OPTIONS: ["PENDENTE", "COLETADO"],
}));

vi.mock("@/services/patientsService", () => ({
  patientsService: {
    search: mocks.patientsSearch,
  },
}));

vi.mock("@/services/appointmentsService", () => ({
  professionalsLookup: {
    getAll: mocks.professionalsGetAll,
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    companyId: "company-1",
    user: { id: "user-1" },
  }),
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/components/lis/CriticalAlertsBanner", () => ({
  CriticalAlertsBanner: () => null,
}));

vi.mock("@/components/lis/LabResultForm", () => ({
  LabResultForm: () => null,
}));

const exam = {
  id: 501,
  company_id: "company-1",
  ds_exame: "Hemograma completo",
  ds_sigla: "HEM",
  cd_tuss: "40304361",
  cd_loinc: null,
  ds_categoria: "HEMATOLOGIA",
  ds_material: "SANGUE",
  ds_metodo: null,
  nr_prazo_dias: 1,
  vl_particular: 50,
  vl_convenio: 40,
  lg_ativo: true,
  cd_origem_sigh: null,
  created_at: "2026-07-25T00:00:00Z",
  updated_at: "2026-07-25T00:00:00Z",
};

const patient = {
  id: "101",
  companyId: "company-1",
  name: "Maria da Silva",
  cpf: "12345678901",
  birthDate: "1985-04-10",
  phone: "21999999999",
  email: "maria@example.test",
  gender: "F" as const,
  createdAt: "2026-07-25T00:00:00Z",
  updatedAt: "2026-07-25T00:00:00Z",
};

const professional = {
  id: "202",
  company_id: "company-1",
  full_name: "Dra. Ana Costa",
  category: "Médica",
  council_type: "CRM",
  council_number: "12345",
  cpf: null,
  phone: null,
  email: null,
  status: "active",
  lg_ativo: true,
  default_duration_minutes: 30,
  created_at: "2026-07-25T00:00:00Z",
  updated_at: "2026-07-25T00:00:00Z",
};

function renderManager() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <LabOrdersManager />
    </QueryClientProvider>,
  );
}

async function openOrderDialog() {
  renderManager();
  fireEvent.click(await screen.findByRole("button", { name: "Novo pedido" }));
  expect(await screen.findByRole("heading", { name: "Novo pedido de exame" })).toBeInTheDocument();
}

beforeEach(() => {
  mocks.catalogGetAll.mockResolvedValue([exam]);
  mocks.orderList.mockResolvedValue([]);
  mocks.orderCreate.mockResolvedValue({ id: 9001 });
  mocks.orderUpdateStatus.mockResolvedValue(undefined);
  mocks.alertsList.mockResolvedValue([]);
  mocks.patientsSearch.mockResolvedValue([patient]);
  mocks.professionalsGetAll.mockResolvedValue([professional]);
});

describe("LabOrdersManager — novo pedido", () => {
  it("seleciona paciente e profissional por nome e envia os IDs internos selecionados", async () => {
    await openOrderDialog();

    expect(screen.queryByLabelText(/ID Paciente/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/ID Médico/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Paciente*"), {
      target: { value: "Maria" },
    });
    expect(mocks.patientsSearch).not.toHaveBeenCalled();

    const patientOption = await screen.findByRole("option", {
      name: /Maria da Silva.*CPF 123\.456\.789-01/i,
    });
    fireEvent.click(patientOption);

    fireEvent.change(screen.getByLabelText("Médico ou profissional solicitante*"), {
      target: { value: "Ana" },
    });
    const professionalOption = await screen.findByRole("option", {
      name: /Dra\. Ana Costa.*Médica.*CRM 12345/i,
    });
    fireEvent.click(professionalOption);

    fireEvent.click(screen.getByRole("checkbox", { name: /HEM.*Hemograma completo/i }));
    fireEvent.click(screen.getByRole("button", { name: "Criar pedido" }));

    await waitFor(() => expect(mocks.orderCreate).toHaveBeenCalledTimes(1));
    expect(mocks.orderCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        company_id: "company-1",
        cd_paciente: 101,
        cd_medico: 202,
        itens: [{ cd_exame: 501 }],
      }),
    );
  });

  it("pagina resultados autorizados e não exibe registros de outra empresa", async () => {
    const patients = Array.from({ length: 10 }, (_, index) => ({
      ...patient,
      id: String(101 + index),
      name: `Paciente Teste ${String(index + 1).padStart(2, "0")}`,
      cpf: `12345678${String(index + 10).padStart(3, "0")}`.slice(0, 11),
    }));
    const outsiderPatient = {
      ...patient,
      id: "999",
      companyId: "company-2",
      name: "Paciente Outra Empresa",
    };
    const outsiderProfessional = {
      ...professional,
      id: "998",
      company_id: "company-2",
      full_name: "Dr. Outra Empresa",
    };
    mocks.patientsSearch.mockResolvedValue([...patients, outsiderPatient]);
    mocks.professionalsGetAll.mockResolvedValue([professional, outsiderProfessional]);

    await openOrderDialog();

    fireEvent.change(screen.getByLabelText("Paciente*"), {
      target: { value: "Paciente" },
    });
    expect(mocks.patientsSearch).not.toHaveBeenCalled();

    const patientList = await screen.findByRole("listbox", {
      name: "Resultados da busca de pacientes",
    });
    await waitFor(() => expect(within(patientList).getAllByRole("option")).toHaveLength(8));
    expect(screen.queryByText("Paciente Outra Empresa")).not.toBeInTheDocument();
    expect(screen.getByText("Página 1 de 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Próxima página de pacientes" }));
    expect(await screen.findByRole("option", { name: /Paciente Teste 09/i })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Médico ou profissional solicitante*"), {
      target: { value: "Dr" },
    });
    expect(await screen.findByRole("option", { name: /Dra\. Ana Costa/i })).toBeInTheDocument();
    expect(screen.queryByText("Dr. Outra Empresa")).not.toBeInTheDocument();
  });
});
