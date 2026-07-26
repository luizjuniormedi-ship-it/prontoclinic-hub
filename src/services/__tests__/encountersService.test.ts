import { beforeEach, describe, expect, it, vi } from "vitest";
import { encountersService } from "@/services/encountersService";
import { auditService } from "@/services/auditService";
import { supabase } from "@/lib/supabase";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
  },
}));

vi.mock("@/services/auditService", () => ({
  auditService: {
    logApiAccess: vi.fn(),
  },
}));

describe("encountersService — compatibilidade canônica", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deriva a fila de appointments e nunca consulta a tabela encounters", async () => {
    const appointmentsChain = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({
        data: [{
          id: 55,
          patient_id: 12,
          professional_id: 8,
          appointment_date: "2026-07-25",
          start_time: "10:30:00",
          status: "waiting",
          service_name: "Consulta",
          tipo: null,
          created_at: "2026-07-25T09:00:00Z",
        }],
        error: null,
      }),
      eq: vi.fn().mockReturnThis(),
    };
    const patientsChain = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({
        data: [{ id: 12, full_name: "Paciente QA" }],
        error: null,
      }),
    };
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "appointments") return appointmentsChain as never;
      if (table === "patients") return patientsChain as never;
      throw new Error(`Tabela inesperada: ${table}`);
    });

    const result = await encountersService.list({ status: "waiting" });

    expect(supabase.from).toHaveBeenCalledWith("appointments");
    expect(supabase.from).not.toHaveBeenCalledWith("encounters");
    expect(appointmentsChain.eq).toHaveBeenCalledWith("status", "waiting");
    expect(result).toEqual([
      expect.objectContaining({
        id: "55",
        appointment_id: "55",
        patient_id: "12",
        patient_name: "Paciente QA",
        status: "waiting",
        encounter_type: "Consulta",
      }),
    ]);
  });

  it("monta a timeline a partir de medical_records", async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({
        data: [{
          id: 91,
          record_date: "2026-07-25T11:00:00Z",
          anamnesis: "Queixa",
          evolution: "Evolução",
          professional_id: 8,
        }],
        error: null,
      }),
    };
    vi.mocked(supabase.from).mockReturnValue(chain as never);

    const result = await encountersService.timeline("12");

    expect(supabase.from).toHaveBeenCalledWith("medical_records");
    expect(result[0]).toEqual(expect.objectContaining({
      event_type: "medical_record",
      event_id: "91",
      detail: "Evolução",
    }));
  });

  it("registra acesso pelo contrato de auditoria existente", async () => {
    await encountersService.logAccess("12", "consultou_prontuario", {
      encounter_id: "55",
      emergency: false,
    });

    expect(auditService.logApiAccess).toHaveBeenCalledWith(
      "patients",
      "12",
      "consultou_prontuario",
      expect.objectContaining({ appointment_id: "55", emergency: false }),
    );
  });
});
