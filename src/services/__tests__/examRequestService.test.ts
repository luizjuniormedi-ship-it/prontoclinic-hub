import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  examRequestService,
  validateCreateExamRequest,
  validateDispatchInput,
} from "@/services/examRequestService";
import { EXAM_DOMAINS, type CreateExamRequestInput } from "@/types/examRequests";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

import { supabase } from "@/lib/supabase";

const validInput: CreateExamRequestInput = {
  unitId: 2,
  patientId: 10,
  encounterId: "3f5c3c2a-4a90-4bb0-b2e3-57244021b96e",
  appointmentId: 20,
  requesterProfessionalId: 30,
  clinicalIndication: "Investigação de dor persistente",
  diagnosisCode: "R52",
  priority: "URGENT",
  items: [
    {
      domain: "LABORATORY",
      codeSystem: "LOINC",
      catalogCode: "58410-2",
      description: "Hemograma completo",
      preparationRequired: true,
      preparationInstructions: "Jejum de oito horas",
    },
  ],
};

describe("examRequestService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("aceita os cinco domínios clínicos do Módulo 22", () => {
    expect(() => validateCreateExamRequest({
      ...validInput,
      items: EXAM_DOMAINS.map((domain) => ({
        domain,
        description: `Exame ${domain}`,
      })),
    })).not.toThrow();
  });

  it("rejeita requisição sem indicação, sem itens ou sem preparo obrigatório", () => {
    expect(() => validateCreateExamRequest({
      ...validInput,
      clinicalIndication: " ",
    })).toThrow(/Indicação clínica/);

    expect(() => validateCreateExamRequest({
      ...validInput,
      items: [],
    })).toThrow(/entre 1 e 50/);

    expect(() => validateCreateExamRequest({
      ...validInput,
      items: [{
        domain: "ENDOSCOPY",
        description: "Colonoscopia",
        preparationRequired: true,
      }],
    })).toThrow(/Instruções de preparo/);
  });

  it("normaliza o payload e cria pela RPC transacional", async () => {
    const rpc = vi.mocked(supabase.rpc);
    rpc.mockResolvedValue({
      data: { id: "request-1", status: "DRAFT" },
      error: null,
    } as never);

    const result = await examRequestService.create({
      ...validInput,
      idempotencyKey: " attendance-20-exams ",
    });

    expect(result.id).toBe("request-1");
    expect(rpc).toHaveBeenCalledWith(
      "m22_create_exam_request_secure",
      expect.objectContaining({
        p_unit_id: 2,
        p_patient_id: 10,
        p_requester_professional_id: 30,
        p_idempotency_key: "attendance-20-exams",
        p_items: [
          expect.objectContaining({
            domain: "LABORATORY",
            code_system: "LOINC",
            preparation_required: true,
          }),
        ],
      }),
    );
  });

  it("assina e cancela exclusivamente pelas RPCs seguras", async () => {
    const rpc = vi.mocked(supabase.rpc);
    rpc
      .mockResolvedValueOnce({
        data: { id: "request-1", status: "SIGNED" },
        error: null,
      } as never)
      .mockResolvedValueOnce({
        data: { id: "request-1", status: "CANCELLED" },
        error: null,
      } as never);

    await examRequestService.sign("request-1");
    await examRequestService.cancel("request-1", "Pedido substituído");

    expect(rpc).toHaveBeenNthCalledWith(1, "m22_sign_exam_request_secure", {
      p_request_id: "request-1",
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "m22_cancel_exam_request_secure", {
      p_request_id: "request-1",
      p_reason: "Pedido substituído",
    });
  });

  it("exige referências fortes para os executores LIS e DICOM", () => {
    expect(() => validateDispatchInput({
      requestItemId: "item-1",
      executorKind: "LIS",
    })).toThrow(/labOrderId/);

    expect(() => validateDispatchInput({
      requestItemId: "item-1",
      executorKind: "DICOM",
      imagingOrderId: "order-1",
    })).toThrow(/imagingOrderId e imagingOrderItemId/);

    expect(() => validateDispatchInput({
      requestItemId: "item-1",
      executorKind: "SPECIALTY",
    })).not.toThrow();
  });

  it("despacha para o LIS sem duplicar o pedido executor", async () => {
    const rpc = vi.mocked(supabase.rpc);
    rpc.mockResolvedValue({
      data: {
        id: "dispatch-1",
        executor_kind: "LIS",
        lab_order_id: 81,
        lab_order_item_id: 82,
      },
      error: null,
    } as never);

    const result = await examRequestService.dispatch({
      requestItemId: "item-1",
      executorKind: "LIS",
      labOrderId: 81,
      labOrderItemId: 82,
    });

    expect(result.id).toBe("dispatch-1");
    expect(rpc).toHaveBeenCalledWith(
      "m22_dispatch_exam_request_item_secure",
      expect.objectContaining({
        p_request_item_id: "item-1",
        p_executor_kind: "LIS",
        p_lab_order_id: 81,
        p_lab_order_item_id: 82,
      }),
    );
  });

  it("exige motivo local antes de transição para falha", async () => {
    await expect(examRequestService.transition({
      requestItemId: "item-1",
      toStatus: "FAILED",
      reason: " ",
    })).rejects.toThrow(/Motivo/);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("propaga erro da RPC sem retornar falso sucesso", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: null,
      error: { message: "permission denied" },
    } as never);

    await expect(examRequestService.create(validInput)).rejects.toThrow(
      /permission denied/,
    );
  });
});
