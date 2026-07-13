import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

import { supabase } from "@/lib/supabase";
import { clinicalTimelineService } from "@/services/clinicalTimelineService";

interface QueryResult {
  data: unknown[] | null;
  error: { message: string } | null;
}

function mockQuery(result: QueryResult) {
  const query = {
    select: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(result),
  };
  vi.mocked(supabase.from).mockReturnValue(query as never);
  return query;
}

const signedRow = {
  id: "record-20",
  encounter_type: "medical_record",
  status: "signed",
  chief_complaint: "Cefaleia",
  summary: "Evolução estável",
  signed_by_name: "Dra. Ana",
  signed_at: "2026-07-13T12:00:00Z",
  started_at: "2026-07-13T10:00:00Z",
  finished_at: "2026-07-13T12:00:00Z",
  created_at: "2026-07-13T10:00:00Z",
};

describe("clinicalTimelineService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: null } as never);
  });

  it("busca pacientes ativos com um padrão ilike válido", async () => {
    const query = mockQuery({
      data: [{ id: 10, full_name: "Maria Souza" }],
      error: null,
    });

    await expect(clinicalTimelineService.searchPatients("  Maria  ")).resolves.toEqual([
      { id: 10, full_name: "Maria Souza" },
    ]);

    expect(supabase.from).toHaveBeenCalledWith("patients");
    expect(query.ilike).toHaveBeenCalledWith("full_name", "%Maria%");
    expect(query.eq).toHaveBeenCalledWith("lg_ativo", true);
  });

  it("lê somente signed e legacy_locked da fonte canônica antes de auditar", async () => {
    const query = mockQuery({ data: [signedRow], error: null });

    await expect(clinicalTimelineService.getPatientTimeline(10)).resolves.toEqual([
      {
        event_type: "atendimento",
        event_id: "record-20",
        event_date: "2026-07-13T12:00:00Z",
        title: "Cefaleia",
        detail: "Evolução estável",
        professional: "Dra. Ana",
        status: "signed",
      },
    ]);

    expect(supabase.from).toHaveBeenCalledWith("v_encounters_read_model");
    expect(query.eq).toHaveBeenCalledWith("patient_id", 10);
    expect(query.in).toHaveBeenCalledWith("status", ["signed", "legacy_locked"]);
    expect(supabase.rpc).toHaveBeenCalledWith("log_data_access", {
      p_tabela: "v_encounters_read_model",
      p_registro_id: "10",
      p_acao: "VIEW_CLINICAL_TIMELINE",
      p_contexto: {
        record_count: 1,
        statuses: ["signed", "legacy_locked"],
      },
    });
    expect(query.limit.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(supabase.rpc).mock.invocationCallOrder[0],
    );
  });

  it("expõe erro de leitura e não tenta auditar", async () => {
    mockQuery({ data: null, error: { message: "permission denied" } });

    await expect(clinicalTimelineService.getPatientTimeline(10)).rejects.toThrow(
      "Erro ao carregar timeline clínica: permission denied",
    );
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("mantém os eventos quando a auditoria falha", async () => {
    mockQuery({ data: [signedRow], error: null });
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: null,
      error: { message: "audit unavailable" },
    } as never);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(clinicalTimelineService.getPatientTimeline(10)).resolves.toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(
      "[clinicalTimelineService] Falha ao registrar auditoria:",
      "audit unavailable",
    );
    warn.mockRestore();
  });
});

