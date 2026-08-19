import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { ExamRequestWorkflow } from "@/components/exams/m22/ExamRequestWorkflow";
import { clinicalPermissionsFor } from "@/config/clinicalModulePermissions";
import CareProtocolsPage from "@/pages/CareProtocolsPage";
import ElectronicPrescriptionsPage from "@/pages/ElectronicPrescriptionsPage";
import ExamRequestsPage from "@/pages/ExamRequestsPage";
import type { ExamRequest } from "@/types/examRequests";
import { examRequestService } from "@/services/examRequestService";

const authState = vi.hoisted(() => ({ roleName: "admin", companyId: "00000000-0000-4000-8000-000000000001", unitId: 7 }));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: {
      id: "00000000-0000-4000-8000-000000000001",
      role_name: authState.roleName,
    },
    companyId: authState.companyId,
    activeUnitId: authState.unitId,
  }),
}));

vi.mock("@/services/careProtocolService", () => ({
  careProtocolService: {
    listDefinitions: vi.fn().mockResolvedValue([]),
    listVersions: vi.fn().mockResolvedValue([]),
    listExecutions: vi.fn().mockResolvedValue([]),
    getExecutionBundle: vi.fn(),
    createDefinition: vi.fn(),
    publishVersion: vi.fn(),
    startExecution: vi.fn(),
    transitionExecution: vi.fn(),
    transitionStep: vi.fn(),
    addObservation: vi.fn(),
    addTask: vi.fn(),
    addAlert: vi.fn(),
    addEscalation: vi.fn(),
    addOverride: vi.fn(),
  },
}));

vi.mock("@/services/examRequestService", () => ({
  examRequestService: {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    sign: vi.fn(),
    cancel: vi.fn(),
    dispatch: vi.fn(),
    transition: vi.fn(),
  },
}));

function renderWithQueryClient(node: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      {node}
    </QueryClientProvider>,
  );
}

const REQUEST_FIXTURE = {
  id: "00000000-0000-4000-8000-000000000022",
  company_id: "00000000-0000-4000-8000-000000000001",
  unit_id: 1,
  patient_id: 19,
  encounter_id: null,
  appointment_id: null,
  requester_professional_id: 20,
  clinical_indication: "Exame sintético de homologação",
  diagnosis_code: null,
  priority: "ROUTINE",
  status: "SIGNED",
  idempotency_key: "ui-guard-fixture",
  signed_by: null,
  signed_at: null,
  cancelled_by: null,
  cancelled_at: null,
  cancellation_reason: null,
  created_by: "00000000-0000-4000-8000-000000000001",
  created_at: "2026-07-24T00:00:00.000Z",
  updated_at: "2026-07-24T00:00:00.000Z",
  exam_request_items: [{
    id: "00000000-0000-4000-8000-000000000023",
    company_id: "00000000-0000-4000-8000-000000000001",
    request_id: "00000000-0000-4000-8000-000000000022",
    domain: "IMAGING",
    code_system: "LOCAL",
    catalog_code: "QA-M22",
    description: "Imagem sintética",
    quantity: 1,
    preparation_required: false,
    preparation_instructions: null,
    authorization_required: false,
    authorization_id: null,
    tiss_guide_id: null,
    details: {},
    status: "READY",
    failure_reason: null,
    completed_at: null,
    created_at: "2026-07-24T00:00:00.000Z",
    updated_at: "2026-07-24T00:00:00.000Z",
  }],
} as ExamRequest;

describe("matriz UI M19-M22", () => {
  it("oculta criação de prescrição para farmácia e mantém para médico", () => {
    authState.roleName = "Farmacêutico";
    const pharmacy = render(<ElectronicPrescriptionsPage />);
    expect(screen.queryByRole("button", { name: "Nova prescrição" })).not.toBeInTheDocument();
    pharmacy.unmount();

    authState.roleName = "Médico";
    render(<ElectronicPrescriptionsPage />);
    expect(screen.getByRole("button", { name: "Nova prescrição" })).toBeInTheDocument();
  });

  it("oculta gerenciamento de definições para enfermagem e mantém para gestor", async () => {
    authState.roleName = "Enfermagem";
    const nursing = renderWithQueryClient(<CareProtocolsPage />);
    expect(screen.queryByRole("button", { name: "Nova definição" })).not.toBeInTheDocument();
    nursing.unmount();

    authState.roleName = "Gestor";
    renderWithQueryClient(<CareProtocolsPage />);
    expect(screen.getByRole("button", { name: "Nova definição" })).toBeInTheDocument();
  });

  it("oculta criação de pedido para diagnóstico e mantém para enfermagem", () => {
    authState.roleName = "Radiologia";
    const diagnostic = renderWithQueryClient(<ExamRequestsPage />);
    expect(screen.queryByRole("heading", { name: "Nova requisição" })).not.toBeInTheDocument();
    diagnostic.unmount();

    authState.roleName = "Enfermagem";
    renderWithQueryClient(<ExamRequestsPage />);
    expect(screen.getByRole("heading", { name: "Nova requisição" })).toBeInTheDocument();
  });

  it("consulta requisições somente no contexto ativo", async () => {
    authState.roleName = "Enfermagem";
    renderWithQueryClient(<ExamRequestsPage />);

    await waitFor(() => expect(examRequestService.list).toHaveBeenCalledWith({
      unitId: 7,
      status: undefined,
    }));
  });

  it("mantém despacho para diagnóstico sem expor assinatura ou cancelamento", () => {
    const permissions = clinicalPermissionsFor("Laboratório").m22;
    render(
      <ExamRequestWorkflow
        request={REQUEST_FIXTURE}
        isWorking={false}
        onSign={vi.fn()}
        onCancel={vi.fn()}
        onDispatch={vi.fn()}
        onTransition={vi.fn()}
        canSign={permissions.canSign}
        canCancel={permissions.canCancel}
        canDispatch={permissions.canDispatch}
        canTransition={permissions.canTransition}
      />,
    );

    expect(screen.queryByRole("button", { name: "Assinar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar requisição" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Despachar" })).toBeInTheDocument();
  });

  it("não oferece despacho enquanto a requisição estiver em rascunho", () => {
    const permissions = clinicalPermissionsFor("Laboratório").m22;
    render(
      <ExamRequestWorkflow
        request={{ ...REQUEST_FIXTURE, status: "DRAFT" }}
        isWorking={false}
        onSign={vi.fn()}
        onCancel={vi.fn()}
        onDispatch={vi.fn()}
        onTransition={vi.fn()}
        canSign={permissions.canSign}
        canCancel={permissions.canCancel}
        canDispatch={permissions.canDispatch}
        canTransition={permissions.canTransition}
      />,
    );

    expect(screen.queryByRole("button", { name: "Despachar" })).not.toBeInTheDocument();
  });
});
