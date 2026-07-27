import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NewAppointmentDialog } from "@/components/schedule/NewAppointmentDialog";
import type {
  DbAppointmentType,
  DbProfessional,
  DbSpecialty,
  SchedulingRequirements,
} from "@/services/appointmentsService";
import type { Patient } from "@/types";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  getRequirements: vi.fn(),
  patientSearch: vi.fn(),
  checkOverlap: vi.fn(),
  checkReturnRule: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/services/appointmentsService", () => ({
  appointmentsService: {
    create: mocks.create,
    getRequirements: mocks.getRequirements,
  },
}));

vi.mock("@/services/patientsService", () => ({
  patientsService: {
    search: mocks.patientSearch,
  },
}));

vi.mock("@/services/validationService", () => ({
  validateAppointmentFields: vi.fn(() => []),
  checkOverlap: mocks.checkOverlap,
  checkReturnRule: mocks.checkReturnRule,
  handleServiceError: vi.fn((error: unknown) =>
    error instanceof Error ? error.message : "Falha",
  ),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

const patient: Patient = {
  id: "11",
  name: "Paciente Agenda QA",
  cpf: "12345678901",
  birthDate: "1990-01-01",
  phone: "21999999999",
  email: "agenda.qa@example.test",
  gender: "F",
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
};

const professional = {
  id: 42,
  company_id: 1,
  full_name: "Profissional Agenda QA",
  category: "Médico",
  council_type: "CRM",
  council_number: "12345",
  cpf: null,
  phone: null,
  email: null,
  status: "active",
  lg_ativo: true,
  default_duration_minutes: "30",
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-01T00:00:00Z",
} as unknown as DbProfessional;

const specialty = {
  id: 3,
  name: "Cardiologia",
  code: "CARD",
  status: "active",
  created_at: "2026-07-01T00:00:00Z",
} as unknown as DbSpecialty;

const appointmentType = {
  id: 5,
  name: "Consulta",
  category: "consultation",
  default_duration_minutes: "30",
  status: "active",
  created_at: "2026-07-01T00:00:00Z",
} as unknown as DbAppointmentType;

beforeAll(() => {
  Object.defineProperties(HTMLElement.prototype, {
    hasPointerCapture: {
      configurable: true,
      value: () => false,
    },
    setPointerCapture: {
      configurable: true,
      value: () => undefined,
    },
    releasePointerCapture: {
      configurable: true,
      value: () => undefined,
    },
    scrollIntoView: {
      configurable: true,
      value: () => undefined,
    },
  });
});

async function selectOption(label: string, optionName: string | RegExp) {
  const trigger = screen.getByLabelText(label);
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "ArrowDown", code: "ArrowDown" });
  const option = await screen.findByRole("option", { name: optionName });
  fireEvent.click(option);
}

describe("NewAppointmentDialog", () => {
  beforeEach(() => {
    mocks.create.mockResolvedValue({ id: "9001" });
    mocks.patientSearch.mockResolvedValue([]);
    mocks.checkOverlap.mockResolvedValue({ hasOverlap: false });
    mocks.checkReturnRule.mockResolvedValue({ blocked: false });
  });

  it("preserva profissional e unidade com IDs numéricos durante requisitos assíncronos", async () => {
    let resolveRequirements!: (value: SchedulingRequirements) => void;
    mocks.getRequirements.mockImplementation(
      () =>
        new Promise<SchedulingRequirements>((resolve) => {
          resolveRequirements = resolve;
        }),
    );
    const onCreated = vi.fn();

    render(
      <NewAppointmentDialog
        open
        onOpenChange={vi.fn()}
        professionals={[professional]}
        specialties={[specialty]}
        appointmentTypes={[appointmentType]}
        services={[]}
        insurances={[]}
        units={[{ id: 7, name: "Unidade Agenda QA" }] as unknown as Array<{
          id: string;
          name: string;
        }>}
        patients={[patient]}
        selectedDate="2026-08-03"
        onCreated={onCreated}
      />,
    );

    await selectOption("Selecionar paciente", /Paciente Agenda QA/);
    await selectOption("Selecionar profissional", /Profissional Agenda QA/);
    await selectOption("Selecionar unidade do agendamento", "Unidade Agenda QA");

    await waitFor(() => {
      expect(mocks.getRequirements).toHaveBeenCalledWith(expect.objectContaining({
        patientId: "11",
        professionalId: "42",
      }));
    });

    await selectOption("Selecionar especialidade", "Cardiologia");
    expect(screen.getByLabelText("Selecionar profissional")).toHaveTextContent(
      "Profissional Agenda QA",
    );
    expect(screen.getByLabelText("Selecionar unidade do agendamento")).toHaveTextContent(
      "Unidade Agenda QA",
    );

    await act(async () => {
      resolveRequirements({
        insurance_id: null,
        insurance_name: null,
        card_number: null,
        professional_credentialed: true,
        requires_authorization: false,
        requires_eligibility: false,
        preparation: null,
        service_name: null,
        private_price: null,
        errors: [],
      });
    });

    expect(screen.getByLabelText("Selecionar profissional")).toHaveTextContent(
      "Profissional Agenda QA",
    );
    expect(screen.getByLabelText("Selecionar unidade do agendamento")).toHaveTextContent(
      "Unidade Agenda QA",
    );

    fireEvent.change(screen.getByLabelText("Início *"), {
      target: { value: "09:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Agendar" }));

    await waitFor(() => {
      expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
        patient_id: "11",
        professional_id: "42",
        unit_id: "7",
        specialty_id: "3",
        appointment_date: "2026-08-03",
        start_time: "09:00",
      }));
    });
    expect(onCreated).toHaveBeenCalledTimes(1);
  });
});
