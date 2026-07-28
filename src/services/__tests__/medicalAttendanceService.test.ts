import { describe, expect, it, vi, beforeEach } from "vitest";
import { medicalAttendanceService } from "@/services/medicalAttendanceService";
import { supabase } from "@/lib/supabase";

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));

describe("medicalAttendanceService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("abre, salva e finaliza pelo contrato RPC M18", async () => {
    const rpc = vi.mocked(supabase.rpc);
    rpc
      .mockResolvedValueOnce({ data: { id: "enc-1", status: "IN_PROGRESS" }, error: null } as never)
      .mockResolvedValueOnce({ data: { id: "enc-1", status: "IN_PROGRESS" }, error: null } as never)
      .mockResolvedValueOnce({ data: { id: "enc-1", status: "FINALIZED" }, error: null } as never);

    await medicalAttendanceService.open(10, 2, 3);
    await medicalAttendanceService.save("enc-1", { chief_complaint: "Dor", diagnoses: [{ code: "R10" }] });
    await medicalAttendanceService.finalize("enc-1");

    expect(rpc).toHaveBeenNthCalledWith(1, "m18_open_attendance_secure", { p_appointment_id: 10, p_unit_id: 2, p_professional_id: 3 });
    expect(rpc).toHaveBeenNthCalledWith(2, "m18_save_attendance_secure", { p_encounter_id: "enc-1", p_payload: { chief_complaint: "Dor", diagnoses: [{ code: "R10" }] } });
    expect(rpc).toHaveBeenNthCalledWith(3, "m18_finalize_attendance_secure", { p_encounter_id: "enc-1", p_disposition: "FINALIZED" });
  });

  it("propaga erro de autorização sem mascarar falha", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: { message: "permission denied" } } as never);
    await expect(medicalAttendanceService.open(10)).rejects.toThrow(/permission denied/);
  });

  it("conclui o núcleo clínico por RPC atômico com o destino informado", async () => {
    const rpc = vi.mocked(supabase.rpc);
    rpc.mockResolvedValueOnce({ data: { id: "enc-1", status: "alta_ambulatorial" }, error: null } as never);

    await medicalAttendanceService.complete("enc-1", {
      chief_complaint: "Dor",
      discharge_summary: "Alta com orientações",
    }, "DISCHARGED");

    expect(rpc).toHaveBeenCalledWith("m18_complete_attendance_secure", {
      p_encounter_id: "enc-1",
      p_payload: { chief_complaint: "Dor", discharge_summary: "Alta com orientações" },
      p_disposition: "DISCHARGED",
    });
  });
});
