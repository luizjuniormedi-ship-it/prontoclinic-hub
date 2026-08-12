import { beforeEach, describe, expect, it, vi } from "vitest";
import { medicalRecordsService } from "@/services/medicalRecordsService";
import { supabase } from "@/lib/supabase";

vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));

describe("medicalRecordsService - contrato clínico canônico", () => {
  beforeEach(() => vi.clearAllMocks());

  it("finaliza encontro e conta pelo mesmo appointment_id", async () => {
    const result = {
      encounter: { id: "enc-1", appointment_id: 42, status: "finalizado" },
      billing: { billing_id: 9, billing_account_id: "account-1", billing_type: "convenio", gross_amount: 150, price_found: true },
    };
    vi.mocked(supabase.rpc).mockResolvedValue({ data: result, error: null } as never);

    await expect(medicalRecordsService.finalizeAttendance({
      appointment_id: "42",
      chief_complaint: "Dor",
      prescriptions: [{ text: "Dipirona" }],
      exams: [{ text: "Hemograma" }],
    })).resolves.toEqual(result);

    expect(supabase.rpc).toHaveBeenCalledWith("m18_finalize_appointment_with_billing_secure", {
      p_appointment_id: 42,
      p_payload: {
        chief_complaint: "Dor",
        prescriptions: [{ text: "Dipirona" }],
        exams: [{ text: "Hemograma" }],
      },
      p_disposition: "FINALIZED",
    });
  });

  it("mantém prontuário somente leitura no cliente", () => {
    expect(medicalRecordsService).not.toHaveProperty("create");
    expect(medicalRecordsService).not.toHaveProperty("update");
  });
});
