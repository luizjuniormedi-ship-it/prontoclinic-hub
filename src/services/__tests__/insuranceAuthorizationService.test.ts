import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));

vi.mock("@/lib/supabase", () => ({ supabase: { rpc, from } }));

import { insuranceAuthorizationService } from "@/services/insuranceAuthorizationService";

const authorization = {
  id: "authorization-1",
  company_id: "company-1",
  status: "pendente",
  quantity_requested: 2,
  quantity_authorized: 0,
  quantity_used: 0,
};

describe("insuranceAuthorizationService", () => {
  beforeEach(() => {
    rpc.mockReset();
    from.mockReset();
  });

  it("solicita autorização sem aceitar company_id vindo do frontend", async () => {
    rpc.mockResolvedValue({ data: authorization, error: null });

    await insuranceAuthorizationService.create({
      patientId: 10,
      appointmentId: 20,
      requestReference: "PED-20",
      diagnosisCode: "M25.5",
      justification: "Procedimento solicitado pelo profissional",
      quantityRequested: 2,
    });

    expect(rpc).toHaveBeenCalledWith("create_insurance_authorization_secure", expect.objectContaining({
      p_patient_id: 10,
      p_appointment_id: 20,
      p_request_reference: "PED-20",
      p_diagnosis_code: "M25.5",
      p_quantity_requested: 2,
    }));
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_company_id");
  });

  it("lista o contrato canônico incluindo o vínculo de unidade", async () => {
    const select = vi.fn().mockReturnThis();
    const order = vi.fn().mockReturnThis();
    const limit = vi.fn().mockReturnThis();
    const chain = {
      select,
      order,
      limit,
      then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null }),
    };
    from.mockReturnValue(chain);

    await insuranceAuthorizationService.list();

    expect(from).toHaveBeenCalledWith("insurance_authorizations");
    const selectedColumns = String(select.mock.calls[0][0]);
    expect(selectedColumns).toContain("insurance_plan_id");
    expect(selectedColumns).toContain("procedure_code");
    expect(selectedColumns).toContain("requested_professional_id");
    expect(selectedColumns).toContain("diagnosis_code");
    expect(selectedColumns.split(",")).toContain("unit_id");
  });

  it("usa RPC protegido para transição, renovação e anexo", async () => {
    rpc.mockResolvedValue({ data: authorization, error: null });

    await insuranceAuthorizationService.transition({
      authorizationId: "authorization-1",
      status: "parcialmente_autorizada",
      authorizationNumber: "AUTH-1",
      quantityAuthorized: 1,
      quantityUsed: 0,
    });
    await insuranceAuthorizationService.createFollowup({
      authorizationId: "authorization-1",
      type: "prorrogacao",
      justification: "Prazo do tratamento prorrogado",
    });
    await insuranceAuthorizationService.addAttachment({
      authorizationId: "authorization-1",
      storagePath: "authorizations/authorization-1/pedido.pdf",
      fileName: "pedido.pdf",
      mimeType: "application/pdf",
    });

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "transition_insurance_authorization_secure",
      "create_insurance_authorization_followup_secure",
      "add_insurance_authorization_attachment_secure",
    ]);
  });

  it("propaga erro do backend sem converter falha em sucesso", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Motivo da negativa e obrigatorio" } });

    await expect(insuranceAuthorizationService.transition({
      authorizationId: "authorization-1",
      status: "negada",
      reason: "",
    })).rejects.toThrow("Motivo da negativa e obrigatorio");
  });
});
