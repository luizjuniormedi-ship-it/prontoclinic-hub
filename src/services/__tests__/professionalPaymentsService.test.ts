import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  professionalPaymentsService,
  todayInSaoPaulo,
  type ProfessionalPaymentCreateInput,
} from "@/services/professionalPaymentsService";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
  },
}));

import { supabase } from "@/lib/supabase";

const companyId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";

const commonRow = {
  id: 41,
  company_id: companyId,
  professional_id: 7,
  unit_id: 3,
  reference_date: "2026-07-01",
  reference_description: "Producao de julho",
  total_procedures: 8,
  total_value: 1250.5,
  total_received: 1000,
  remuneration_type: "PERCENTAGE",
  percentage: 30,
  status: "apurado",
  paid_on: null,
  observation: null,
  cancel_reason: null,
  created_by: actorId,
  updated_by: actorId,
  created_at: "2026-07-13T17:00:00Z",
  updated_at: "2026-07-13T17:00:00Z",
} as const;

const listRow = {
  ...commonRow,
  professional_name: "Dra. Ana Souza",
  unit_name: "Unidade Centro",
  total_count: 1,
};

const createRow = {
  ...commonRow,
  idempotent_replay: false,
};

const transitionRow = {
  id: commonRow.id,
  company_id: companyId,
  professional_id: commonRow.professional_id,
  unit_id: commonRow.unit_id,
  reference_date: commonRow.reference_date,
  status: "conferido",
  paid_on: null,
  cancel_reason: null,
  updated_by: actorId,
  updated_at: "2026-07-13T18:00:00Z",
  idempotent_replay: false,
} as const;

const normalizedListRow = {
  id: commonRow.id,
  companyId,
  professionalId: commonRow.professional_id,
  professionalName: "Dra. Ana Souza",
  unitId: commonRow.unit_id,
  unitName: "Unidade Centro",
  referenceDate: commonRow.reference_date,
  referenceDescription: commonRow.reference_description,
  totalProcedures: commonRow.total_procedures,
  totalValue: commonRow.total_value,
  totalReceived: commonRow.total_received,
  remunerationType: commonRow.remuneration_type,
  percentage: commonRow.percentage,
  status: commonRow.status,
  paidOn: commonRow.paid_on,
  observation: commonRow.observation,
  cancelReason: commonRow.cancel_reason,
  createdBy: commonRow.created_by,
  updatedBy: commonRow.updated_by,
  createdAt: commonRow.created_at,
  updatedAt: commonRow.updated_at,
  totalCount: 1,
  idempotentReplay: null,
} as const;

const createInput: ProfessionalPaymentCreateInput = {
  professionalId: 7,
  unitId: 3,
  referenceDate: "2026-07-01",
  referenceDescription: "Producao de julho",
  totalProcedures: 8,
  totalValue: 1250.5,
  totalReceived: 1000,
  remunerationType: "PERCENTAGE",
  percentage: 30,
  observation: null,
};

describe("professionalPaymentsService secure RPC contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calcula a data civil de pagamento em America/Sao_Paulo", () => {
    expect(todayInSaoPaulo(new Date("2026-07-14T02:30:00.000Z"))).toBe("2026-07-13");
    expect(todayInSaoPaulo(new Date("2026-07-14T03:30:00.000Z"))).toBe("2026-07-14");
  });

  it("lista somente pela RPC canonica e mapeia nomes retornados pelo contrato", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: [listRow], error: null } as never);

    const result = await professionalPaymentsService.list({
      professionalId: 7,
      unitId: 3,
      status: "apurado",
      search: "  Dra. Ana  ",
      referenceFrom: "2026-07-01",
      referenceTo: "2026-07-31",
      limit: 25,
      offset: 5,
    });

    expect(supabase.rpc).toHaveBeenCalledWith("list_professional_payments", {
      p_professional_id: 7,
      p_unit_id: 3,
      p_status: "apurado",
      p_search: "Dra. Ana",
      p_reference_from: "2026-07-01",
      p_reference_to: "2026-07-31",
      p_limit: 25,
      p_offset: 5,
    });
    expect(result[0]).toMatchObject({
      id: 41,
      professionalId: 7,
      professionalName: "Dra. Ana Souza",
      unitName: "Unidade Centro",
      totalValue: 1250.5,
      status: "apurado",
      totalCount: 1,
    });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("valida a busca antes de chamar a RPC", async () => {
    await expect(professionalPaymentsService.list({ search: " ".repeat(3) })).rejects.toThrow();
    await expect(professionalPaymentsService.list({ search: "x".repeat(201) })).rejects.toThrow();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("falha fechado quando a resposta de listagem diverge do DTO", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: [{ ...listRow, status: "status-inventado" }],
      error: null,
    } as never);

    await expect(professionalPaymentsService.list()).rejects.toThrow("resposta RPC invalida");
  });

  it("aceita resposta de listagem unitaria ja normalizada", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: normalizedListRow, error: null } as never);

    await expect(professionalPaymentsService.list()).resolves.toEqual([normalizedListRow]);
  });

  it("mantem fail-closed para campo obrigatorio em DTO normalizado", async () => {
    const { companyId: _companyId, ...incomplete } = normalizedListRow;
    vi.mocked(supabase.rpc).mockResolvedValue({ data: incomplete, error: null } as never);

    await expect(professionalPaymentsService.list()).rejects.toThrow("resposta RPC invalida");
  });

  it("cria somente pela RPC e preserva a chave gerada durante retry", async () => {
    vi.mocked(supabase.rpc)
      .mockResolvedValueOnce({ data: null, error: { message: "timeout apos commit" } } as never)
      .mockResolvedValueOnce({ data: [{ ...createRow, idempotent_replay: true }], error: null } as never);

    await expect(professionalPaymentsService.create(createInput)).rejects.toThrow("timeout apos commit");
    const firstPayload = vi.mocked(supabase.rpc).mock.calls[0][1] as Record<string, unknown>;

    const result = await professionalPaymentsService.create(createInput);
    const secondPayload = vi.mocked(supabase.rpc).mock.calls[1][1] as Record<string, unknown>;

    expect(firstPayload.p_idempotency_key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(secondPayload.p_idempotency_key).toBe(firstPayload.p_idempotency_key);
    expect(supabase.rpc).toHaveBeenLastCalledWith("create_professional_payment", {
      p_idempotency_key: firstPayload.p_idempotency_key,
      p_professional_id: 7,
      p_unit_id: 3,
      p_reference_date: "2026-07-01",
      p_reference_description: "Producao de julho",
      p_total_procedures: 8,
      p_total_value: 1250.5,
      p_total_received: 1000,
      p_remuneration_type: "PERCENTAGE",
      p_percentage: 30,
      p_observation: null,
    });
    expect(result.idempotentReplay).toBe(true);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("rejeita entrada de criacao inconsistente antes de chamar o backend", async () => {
    await expect(professionalPaymentsService.create({
      ...createInput,
      totalValue: 10,
      totalReceived: 11,
    })).rejects.toThrow();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("transiciona somente pela RPC com chave explicita e payload controlado", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: [transitionRow], error: null } as never);
    const key = "33333333-3333-4333-8333-333333333333";

    const result = await professionalPaymentsService.transition(41, "conferido", {
      idempotencyKey: key,
    });

    expect(supabase.rpc).toHaveBeenCalledWith("transition_professional_payment", {
      p_idempotency_key: key,
      p_payment_id: 41,
      p_target_status: "conferido",
      p_reason: null,
      p_payment_date: null,
    });
    expect(result).toMatchObject({ id: 41, status: "conferido", idempotentReplay: false });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("aceita resposta de transicao ja normalizada", async () => {
    const normalized = {
      id: 41,
      status: "conferido" as const,
      paidOn: null,
      cancelReason: null,
      updatedBy: actorId,
      updatedAt: "2026-07-13T18:00:00Z",
      idempotentReplay: true,
    };
    vi.mocked(supabase.rpc).mockResolvedValue({ data: normalized, error: null } as never);

    await expect(professionalPaymentsService.transition(41, "conferido", {
      idempotencyKey: "55555555-5555-4555-8555-555555555555",
    })).resolves.toEqual(normalized);
  });

  it("preserva a chave de transicao gerada durante retry", async () => {
    const paidRow = { ...transitionRow, id: 42, status: "pago", paid_on: "2026-07-13" };
    vi.mocked(supabase.rpc)
      .mockResolvedValueOnce({ data: null, error: { message: "conexao interrompida" } } as never)
      .mockResolvedValueOnce({ data: [paidRow], error: null } as never);

    const options = { paymentDate: "2026-07-13" };
    await expect(professionalPaymentsService.transition(42, "pago", options)).rejects.toThrow(
      "conexao interrompida",
    );
    await professionalPaymentsService.transition(42, "pago", options);

    const firstPayload = vi.mocked(supabase.rpc).mock.calls[0][1] as Record<string, unknown>;
    const secondPayload = vi.mocked(supabase.rpc).mock.calls[1][1] as Record<string, unknown>;
    expect(secondPayload.p_idempotency_key).toBe(firstPayload.p_idempotency_key);
  });

  it("exige motivo para cancelamento e rejeita DTO de transicao incompleto", async () => {
    await expect(professionalPaymentsService.transition(41, "cancelado", {
      reason: "  ",
    })).rejects.toThrow("Motivo de cancelamento e obrigatorio");
    expect(supabase.rpc).not.toHaveBeenCalled();

    vi.mocked(supabase.rpc).mockResolvedValue({
      data: [{ ...transitionRow, updated_by: null }],
      error: null,
    } as never);
    await expect(professionalPaymentsService.transition(41, "conferido", {
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
    })).rejects.toThrow("resposta RPC invalida");
  });
});

