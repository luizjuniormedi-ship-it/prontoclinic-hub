import { beforeEach, describe, expect, it, vi } from "vitest";
import { insuranceEligibilityService } from "@/services/insuranceEligibilityService";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
const { rpc, from } = mocks;

vi.mock("@/lib/supabase", () => ({
  supabase: mocks,
}));

describe("insuranceEligibilityService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cria uma consulta manual somente pelo RPC seguro", async () => {
    rpc.mockResolvedValue({ data: { id: "eligibility-1", status: "pendente" }, error: null });

    const result = await insuranceEligibilityService.create({
      patientId: 10,
      appointmentId: 20,
      unitId: 3,
      requestChannel: "manual",
      protocolNumber: "P-2026-10",
      proofReference: "storage://eligibility/P-2026-10.pdf",
    });

    expect(result.id).toBe("eligibility-1");
    expect(rpc).toHaveBeenCalledWith("create_insurance_eligibility_check_secure", expect.objectContaining({
      p_patient_id: 10,
      p_appointment_id: 20,
      p_unit_id: 3,
      p_request_channel: "manual",
      p_proof_reference: "storage://eligibility/P-2026-10.pdf",
    }));
  });

  it("atualiza bloqueio/exceção pelo endpoint seguro e preserva o tenant no backend", async () => {
    rpc.mockResolvedValue({ data: { id: "eligibility-1", status: "bloqueado" }, error: null });

    await insuranceEligibilityService.update("eligibility-1", {
      status: "bloqueado",
      blockReason: "Portal do convenio indisponivel",
      resultDetail: "Retentar apos janela de manutencao",
    });

    expect(rpc).toHaveBeenCalledWith("update_insurance_eligibility_check_secure", expect.objectContaining({
      p_eligibility_id: "eligibility-1",
      p_status: "bloqueado",
      p_block_reason: "Portal do convenio indisponivel",
      p_result_detail: "Retentar apos janela de manutencao",
    }));
  });

  it("consulta o historico por identificador sem expor outro tenant no serviço", async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [{ eligibility_check_id: "eligibility-1" }], error: null }),
    };
    from.mockReturnValue(query);

    const events = await insuranceEligibilityService.listEvents("eligibility-1");

    expect(events).toHaveLength(1);
    expect(from).toHaveBeenCalledWith("insurance_eligibility_events");
    expect(query.eq).toHaveBeenCalledWith("eligibility_check_id", "eligibility-1");
  });
});
