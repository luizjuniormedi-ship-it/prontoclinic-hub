import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: vi.fn(), from: vi.fn() },
}));

import { supabase } from "@/lib/supabase";
import { imagingJourneyService } from "@/services/imagingJourneyService";
import { reportsService } from "@/services/reportsService";

describe("imagingJourneyService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("cria pedido estruturado pelo RPC transacional do atendimento", async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: { order_id: "order-1", item_id: "item-1", accession_number: "PM-1" },
      error: null,
    } as never);

    const result = await imagingJourneyService.createFromAttendance({
      appointmentId: "42",
      examName: "Ultrassonografia de abdome",
      modalityType: "US",
      clinicalIndication: "Dor abdominal",
      priority: "urgent",
    });

    expect(result.accession_number).toBe("PM-1");
    expect(supabase.rpc).toHaveBeenCalledWith("create_imaging_order_from_attendance", expect.objectContaining({
      p_appointment_id: "42",
      p_exam_name: "Ultrassonografia de abdome",
      p_modality_type: "US",
      p_priority: "urgent",
    }));
  });

  it("não aceita pedido sem descrição do exame", async () => {
    await expect(imagingJourneyService.createFromAttendance({
      appointmentId: "42", examName: "  ", modalityType: "US",
    })).rejects.toThrow(/Informe o exame/);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});

describe("reportsService.signAndRelease", () => {
  it("usa somente o RPC que resolve identidade e CRM no servidor", async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: { id: "report-1", status: "liberado", signed_by_name: "Dra. Teste", signed_by_crm: "CRM 123" },
      error: null,
    } as never);
    const report = await reportsService.signAndRelease("report-1");
    expect(report.status).toBe("liberado");
    expect(supabase.rpc).toHaveBeenCalledWith("sign_and_release_radiology_report", { p_report_id: "report-1" });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("retifica somente pelo RPC transacional", async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: { id: "report-1", status: "em_digitacao" }, error: null } as never);
    await reportsService.rectify({ id: "report-1", version: 2 } as never, "Correção técnica");
    expect(supabase.rpc).toHaveBeenCalledWith("rectify_radiology_report", {
      p_report_id: "report-1", p_motivo: "Correção técnica",
    });
  });

  it("registra entrega somente pelo RPC transacional", async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: { id: "report-1", status: "entregue" }, error: null } as never);
    await reportsService.logDelivery("report-1", "portal", "paciente");
    expect(supabase.rpc).toHaveBeenCalledWith("deliver_radiology_report", {
      p_report_id: "report-1", p_canal: "portal", p_destinatario: "paciente",
    });
  });
});
