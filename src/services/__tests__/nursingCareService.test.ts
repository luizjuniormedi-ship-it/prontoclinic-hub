import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

import { supabase } from "@/lib/supabase";
import { nursingCareService } from "@/services/nursingCareService";

const rpc = vi.mocked(supabase.rpc);
const from = vi.mocked(supabase.from);

const keys = {
  createMedication: "00000000-0000-4000-8000-000000000001",
  administer: "00000000-0000-4000-8000-000000000002",
  refuse: "00000000-0000-4000-8000-000000000003",
  incident: "00000000-0000-4000-8000-000000000004",
  procedure: "00000000-0000-4000-8000-000000000005",
  handoff: "00000000-0000-4000-8000-000000000006",
};

describe("nursingCareService secure mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockResolvedValue({ data: { id: 1 }, error: null } as never);
  });

  it("usa somente as seis RPCs seguras e encaminha idempotencia", async () => {
    await nursingCareService.createMedication({
      patient_id: 10,
      medication: " Dipirona ",
      dose: "500 mg",
      via: "VO",
      scheduled_at: "2026-07-13T10:00:00.000Z",
      idempotencyKey: keys.createMedication,
    });
    await nursingCareService.administer(20, 10, keys.administer);
    await nursingCareService.refuse(21, "Paciente recusou", keys.refuse);
    await nursingCareService.createIncident({
      patient_id: 10,
      incident_type: "queda",
      severity: "grave",
      description: "Queda sem trauma aparente",
      idempotencyKey: keys.incident,
    });
    await nursingCareService.createProcedure({
      patient_id: 10,
      procedure_type: "curativo",
      description: "Curativo simples",
      faturavel: true,
      idempotencyKey: keys.procedure,
    });
    await nursingCareService.createHandoff({
      shift_date: "2026-07-13",
      shift_type: "noturno",
      summary: "Plantao sem eventos adicionais",
      pending_items: ["Reavaliar dor as 22h"],
      critical_patients: [10],
      idempotencyKey: keys.handoff,
    });

    expect(rpc.mock.calls).toEqual([
      ["create_nursing_medication_secure", {
        p_patient_id: 10,
        p_medication: "Dipirona",
        p_dose: "500 mg",
        p_via: "VO",
        p_scheduled_at: "2026-07-13T10:00:00.000Z",
        p_idempotency_key: keys.createMedication,
      }],
      ["administer_nursing_medication_secure", {
        p_admin_id: 20,
        p_patient_confirmed_id: 10,
        p_idempotency_key: keys.administer,
      }],
      ["refuse_nursing_medication_secure", {
        p_admin_id: 21,
        p_reason: "Paciente recusou",
        p_idempotency_key: keys.refuse,
      }],
      ["report_nursing_incident_secure", {
        p_patient_id: 10,
        p_incident_type: "queda",
        p_severity: "grave",
        p_description: "Queda sem trauma aparente",
        p_idempotency_key: keys.incident,
      }],
      ["record_nursing_procedure_secure", {
        p_patient_id: 10,
        p_procedure_type: "curativo",
        p_description: "Curativo simples",
        p_faturavel: true,
        p_idempotency_key: keys.procedure,
      }],
      ["create_nursing_shift_handoff_secure", {
        p_shift_date: "2026-07-13",
        p_shift_type: "noturno",
        p_summary: "Plantao sem eventos adicionais",
        p_pending_items: ["Reavaliar dor as 22h"],
        p_critical_patients: [10],
        p_notes: null,
        p_idempotency_key: keys.handoff,
      }],
    ]);
    expect(from).not.toHaveBeenCalled();

    const forbiddenPayloadKeys = /company|actor|prepared_by|administered_by|reported_by|performed_by|created_by|user_id/i;
    for (const [, payload] of rpc.mock.calls) {
      expect(Object.keys(payload ?? {})).not.toEqual(expect.arrayContaining([
        expect.stringMatching(forbiddenPayloadKeys),
      ]));
    }
  });

  it("rejeita company_id e IDs de ator antes de chamar o Supabase", async () => {
    await expect(nursingCareService.createMedication({
      patient_id: 10,
      medication: "Dipirona",
      prepared_by: 999,
    } as never)).rejects.toThrow(/controlado pelo servidor.*prepared_by/);

    await expect(nursingCareService.createIncident({
      patient_id: 10,
      incident_type: "queda",
      severity: "leve",
      description: "Sem lesao",
      company_id: "empresa-alheia",
    } as never)).rejects.toThrow(/controlado pelo servidor.*company_id/);

    await expect(nursingCareService.createProcedure({
      patient_id: 10,
      procedure_type: "curativo",
      performed_by: 999,
    } as never)).rejects.toThrow(/controlado pelo servidor.*performed_by/);

    await expect(nursingCareService.createHandoff({
      shift_date: "2026-07-13",
      shift_type: "diurno",
      summary: "Resumo",
      actor_id: 999,
    } as never)).rejects.toThrow(/controlado pelo servidor.*actor_id/);

    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("valida IDs, textos, datas e idempotencia antes da RPC", async () => {
    await expect(nursingCareService.createMedication({
      patient_id: 0,
      medication: "Dipirona",
      idempotencyKey: keys.createMedication,
    })).rejects.toThrow(/patient_id/);

    await expect(nursingCareService.refuse(1, "   ", keys.refuse)).rejects.toThrow(/reason/);

    await expect(nursingCareService.createHandoff({
      shift_date: "data-invalida",
      shift_type: "noturno",
      summary: "Resumo",
      idempotencyKey: keys.handoff,
    })).rejects.toThrow(/shift_date/);

    await expect(nursingCareService.administer(1, 10, "   ")).rejects.toThrow(/idempotencyKey/);
    await expect(nursingCareService.administer(1, 10, undefined as never)).rejects.toThrow(/idempotencyKey/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("propaga erro da RPC sem fallback para DML direto", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied" } } as never);

    await expect(nursingCareService.administer(20, 10, keys.administer)).rejects.toThrow("permission denied");

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(from).not.toHaveBeenCalled();
  });
});

