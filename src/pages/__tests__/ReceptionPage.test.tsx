import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ReceptionPage from "@/pages/ReceptionPage";
import { TooltipProvider } from "@/components/ui/tooltip";
import { supabase } from "@/lib/supabase";

const mocks = vi.hoisted(() => ({
  getByDate: vi.fn(),
  updateStatus: vi.fn(),
  getProfessionals: vi.fn(),
  getSpecialties: vi.fn(),
  getAppointmentTypes: vi.fn(),
  listPending: vi.fn(),
  getReadiness: vi.fn(),
  checkin: vi.fn(),
  updateAuthorization: vi.fn(),
  updateEligibility: vi.fn(),
  toast: vi.fn(),
  activeRole: vi.fn(() => "recepcao"),
}));

vi.mock("@/services/appointmentsService", () => ({
  appointmentsService: {
    getByDate: mocks.getByDate,
    updateStatus: mocks.updateStatus,
  },
  professionalsLookup: { getAll: mocks.getProfessionals },
  specialtiesLookup: { getAll: mocks.getSpecialties },
  appointmentTypesLookup: { getAll: mocks.getAppointmentTypes },
}));

vi.mock("@/services/receptionService", () => ({
  receptionService: {
    listPending: mocks.listPending,
    getReadiness: mocks.getReadiness,
    checkin: mocks.checkin,
    updateAuthorization: mocks.updateAuthorization,
    updateEligibility: mocks.updateEligibility,
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/hooks/useActiveAccessRole", () => ({
  useActiveAccessRole: mocks.activeRole,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: {
      id: "user-1",
      email: "recepcao@prontomedic.test",
      full_name: "Recepção Teste",
      role_name: "admin",
      company_id: "company-1",
      primary_unit_id: 1,
    },
  }),
}));

const professional = {
  id: "11",
  company_id: "company-1",
  full_name: "Dra. Ana",
  category: "medico",
  council_type: "CRM",
  council_number: "123",
  cpf: null,
  phone: null,
  email: null,
  status: "active",
  lg_ativo: true,
  default_duration_minutes: 30,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const specialty = {
  id: "21",
  name: "Cardiologia",
  code: "CARD",
  status: "active",
  created_at: "2026-01-01T00:00:00Z",
};

const appointmentType = {
  id: "31",
  name: "Consulta",
  category: "consulta",
  default_duration_minutes: 30,
  status: "active",
  created_at: "2026-01-01T00:00:00Z",
};

const appointmentBase = {
  company_id: "company-1",
  unit_id: "1",
  professional_id: "11",
  specialty_id: "21",
  service_id: null,
  insurance_company_id: null,
  insurance_plan_id: null,
  appointment_type_id: "31",
  appointment_date: "2026-07-25",
  end_time: "09:30:00",
  is_return: false,
  notes: null,
  service_name: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/reception"]}>
      <TooltipProvider delayDuration={0}>
        <ReceptionPage />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

async function activateTab(name: string) {
  const tab = await screen.findByRole("tab", { name });
  fireEvent.mouseDown(tab, { button: 0, ctrlKey: false });
  await waitFor(() => expect(tab).toHaveAttribute("data-state", "active"));
}

beforeEach(() => {
  mocks.getProfessionals.mockResolvedValue([professional]);
  mocks.getSpecialties.mockResolvedValue([specialty]);
  mocks.getAppointmentTypes.mockResolvedValue([appointmentType]);
  mocks.getByDate.mockResolvedValue([
    {
      ...appointmentBase,
      id: "101",
      patient_id: "1",
      start_time: "09:00:00",
      status: "scheduled",
    },
    {
      ...appointmentBase,
      id: "102",
      patient_id: "2",
      start_time: "10:00:00",
      end_time: "10:30:00",
      status: "waiting",
    },
  ]);
  mocks.listPending.mockResolvedValue([
    {
      id: "auth-1",
      kind: "authorization",
      appointment_id: 101,
      patient_id: 1,
      status: "pendente",
      protocol_number: null,
      description: "Consulta cardiológica",
      created_at: "2026-07-25T08:00:00Z",
      patient_name: "Maria Souza",
    },
  ]);
  mocks.getReadiness.mockResolvedValue({
    appointment_id: 101,
    patient_id: 1,
    ready: false,
    issues: [
      {
        type: "authorization",
        severity: "blocking",
        description: "Autorização pendente ou inválida",
      },
    ],
    has_authorization_pending: true,
    has_document_pending: false,
  });
  mocks.updateStatus.mockResolvedValue(undefined);
  mocks.checkin.mockResolvedValue({
    checkin_id: 1,
    ticket_id: 1,
    ticket: "C001",
    released_by_exception: false,
    issues: [],
  });

  const patientChain = {
    select: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue({
      data: [
        {
          id: "1",
          full_name: "Maria Souza",
          cpf: "12345678900",
          birth_date: "1980-01-01",
          phone: "21999999999",
          allergies: "Dipirona",
          insurance_plan_id: null,
        },
        {
          id: "2",
          full_name: "José Lima",
          cpf: "98765432100",
          birth_date: "1975-01-01",
          phone: "21888888888",
          allergies: null,
          insurance_plan_id: null,
        },
      ],
      error: null,
    }),
  };
  vi.mocked(supabase.from).mockReturnValue(patientChain as never);
});

describe("ReceptionPage", () => {
  it("separa chegada, sala de espera e pendências em áreas distintas", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "Recepção do dia" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Chegadas (1)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Sala de espera (1)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Pendências (1)" })).toBeInTheDocument();

    await activateTab("Sala de espera (1)");
    expect(await screen.findByText("José Lima")).toBeInTheDocument();
    expect(screen.getByText("Encaminhado à fila")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /abrir atendimento/i })).not.toBeInTheDocument();
  });

  it("abre o check-in como jornada e explica o bloqueio", async () => {
    renderPage();

    const checkinButton = await screen.findByRole("button", { name: /Fazer check-in\./i });
    fireEvent.click(checkinButton);

    expect(await screen.findByRole("heading", { name: "Jornada do check-in" })).toBeInTheDocument();
    expect(screen.getByText(/Cadastro e documentos/)).toBeInTheDocument();
    expect(screen.getByText(/Pagador e convênio/)).toBeInTheDocument();
    expect(
      (await screen.findAllByText("Autorização pendente ou inválida")).length,
    ).toBeGreaterThanOrEqual(1);

    const blockedAction = screen.getByRole("button", {
      name: /Liberar por exceção\. Existem pendências bloqueantes e seu perfil não pode liberar por exceção\./i,
    });
    expect(blockedAction).toBeDisabled();
  });

  it("abre a pendência administrativa sem misturar com a fila", async () => {
    renderPage();

    await activateTab("Pendências (1)");
    expect(await screen.findByText("Consulta cardiológica")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Resolver\./i }));
    expect(await screen.findByRole("heading", { name: "Atualizar autorização" })).toBeInTheDocument();
    expect(screen.getByLabelText("Status")).toBeInTheDocument();
    expect(screen.getByLabelText("Protocolo")).toBeInTheDocument();

    expect(mocks.updateAuthorization).not.toHaveBeenCalled();
  });
});

