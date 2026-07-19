import { describe, expect, it, vi, beforeEach } from "vitest";
import { receptionService } from "@/services/receptionService";

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: vi.fn() },
}));

import { supabase } from "@/lib/supabase";

describe("receptionService — contrato local dos RPCs de check-in", () => {
  beforeEach(() => vi.clearAllMocks());

  it("consulta prontidão com o ID numérico do agendamento", async () => {
    (supabase.rpc as any).mockResolvedValue({ data: { appointment_id: 12, ready: true, issues: [] }, error: null });

    const result = await receptionService.getReadiness("12");

    expect(result.ready).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith("get_reception_checkin_readiness", { p_appointment_id: 12 });
  });

  it("realiza check-in com prioridade e exceção opcionais", async () => {
    (supabase.rpc as any).mockResolvedValue({ data: { ticket: "A-12", released_by_exception: true }, error: null });

    const result = await receptionService.checkin("12", "urgent", "Autorizado pela coordenação");

    expect(result.ticket).toBe("A-12");
    expect(supabase.rpc).toHaveBeenCalledWith("perform_reception_checkin_secure", {
      p_appointment_id: 12,
      p_priority: "urgent",
      p_exception_reason: "Autorizado pela coordenação",
    });
  });

  it("propaga erro do RPC para o estado de erro da recepção", async () => {
    (supabase.rpc as any).mockResolvedValue({ data: null, error: { message: "permission denied" } });

    await expect(receptionService.getReadiness("12")).rejects.toThrow(/permission denied/);
  });
});
