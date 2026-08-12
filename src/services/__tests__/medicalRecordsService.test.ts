import { beforeEach, describe, expect, it, vi } from "vitest";
import { medicalRecordsService } from "@/services/medicalRecordsService";
import { supabase } from "@/lib/supabase";

vi.mock("@/lib/supabase", () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
}));

describe("medicalRecordsService - contrato clínico canônico", () => {
  beforeEach(() => vi.clearAllMocks());

  function queryResult(result: unknown) {
    const query = createQuery(result);
    vi.mocked(supabase.from).mockReturnValue(query as never);
    return query;
  }

  function createQuery(result: unknown) {
    const terminal = vi.fn().mockResolvedValue(result);
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      order: terminal,
      maybeSingle: terminal,
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    return query;
  }

  function patientQueries(legacyResult: unknown, encountersResult: unknown) {
    const legacy = createQuery(legacyResult);
    const encounters = createQuery(encountersResult);
    vi.mocked(supabase.from)
      .mockReturnValueOnce(legacy as never)
      .mockReturnValueOnce(encounters as never);
    return { legacy, encounters };
  }

  it("finaliza encontro e conta pelo mesmo appointment_id", async () => {
    const result = {
      encounter: { id: "enc-1", appointment_id: 42, status: "finalizado" },
      billing: {
        billing_id: 9,
        billing_account_id: "account-1",
        billing_type: "convenio",
        gross_amount: 150,
        price_found: true,
      },
    };
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: result,
      error: null,
    } as never);

    await expect(
      medicalRecordsService.finalizeAttendance({
        appointment_id: "42",
        chief_complaint: "Dor",
        prescriptions: [{ text: "Dipirona" }],
        exams: [{ text: "Hemograma" }],
      }),
    ).resolves.toEqual(result);

    expect(supabase.rpc).toHaveBeenCalledWith(
      "m18_finalize_appointment_with_billing_secure",
      {
        p_appointment_id: 42,
        p_payload: {
          chief_complaint: "Dor",
          prescriptions: [{ text: "Dipirona" }],
          exams: [{ text: "Hemograma" }],
        },
        p_disposition: "FINALIZED",
      },
    );
  });

  it("mantém prontuário somente leitura no cliente", () => {
    expect(medicalRecordsService).not.toHaveProperty("create");
    expect(medicalRecordsService).not.toHaveProperty("update");
  });

  it("unifica prontuários legados e encontros canônicos em ordem decrescente", async () => {
    const records = [{ id: "record-1", record_date: "2026-08-10T10:00:00Z" }];
    const encounter = {
      id: "enc-1",
      company_id: "company-1",
      unit_id: 10,
      patient_id: 101,
      professional_id: 20,
      appointment_id: 42,
      chief_complaint: "Queixa E2E persistida fase 0/1",
      anamnesis: "História clínica",
      physical_exam: "Exame físico",
      conduct: "Conduta",
      vital_signs: { temperature: 36.5 },
      finalized_at: "2026-08-12T10:00:00Z",
      created_at: "2026-08-12T09:00:00Z",
    };
    const { legacy, encounters } = patientQueries(
      { data: records, error: null },
      { data: [encounter], error: null },
    );

    await expect(medicalRecordsService.getByPatient("101")).resolves.toEqual([
      expect.objectContaining({
        id: "encounter:enc-1",
        patient_id: "101",
        appointment_id: "42",
        anamnesis: "Queixa E2E persistida fase 0/1\n\nHistória clínica",
        evolution: "Exame físico\n\nConduta",
        record_date: "2026-08-12T10:00:00Z",
      }),
      records[0],
    ]);
    expect(supabase.from).toHaveBeenNthCalledWith(1, "medical_records");
    expect(supabase.from).toHaveBeenNthCalledWith(2, "encounters");
    expect(legacy.eq).toHaveBeenCalledWith("patient_id", "101");
    expect(legacy.order).toHaveBeenCalledWith("record_date", {
      ascending: false,
    });
    expect(encounters.eq).toHaveBeenCalledWith("patient_id", 101);
    expect(encounters.order).toHaveBeenCalledWith("created_at", {
      ascending: false,
    });
  });

  it("normaliza consulta vazia do paciente", async () => {
    patientQueries({ data: null, error: null }, { data: null, error: null });
    await expect(medicalRecordsService.getByPatient("102")).resolves.toEqual(
      [],
    );
  });

  it("propaga falha ao consultar prontuários do paciente", async () => {
    patientQueries(
      { data: null, error: { message: "read denied" } },
      { data: null, error: null },
    );
    await expect(medicalRecordsService.getByPatient("103")).rejects.toThrow(
      "Erro ao buscar prontuários: read denied",
    );
  });

  it("propaga falha ao consultar encontros canônicos", async () => {
    patientQueries(
      { data: null, error: null },
      { data: null, error: { message: "encounter denied" } },
    );
    await expect(medicalRecordsService.getByPatient("104")).rejects.toThrow(
      "Erro ao buscar atendimentos: encounter denied",
    );
  });

  it("busca um prontuário pelo identificador", async () => {
    const record = { id: "record-2" };
    const query = queryResult({ data: record, error: null });

    await expect(medicalRecordsService.getById("record-2")).resolves.toEqual(
      record,
    );
    expect(query.eq).toHaveBeenCalledWith("id", "record-2");
    expect(query.maybeSingle).toHaveBeenCalledOnce();
  });

  it("propaga falhas do RPC e da leitura individual", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: null,
      error: { message: "rpc denied" },
    } as never);
    await expect(
      medicalRecordsService.finalizeAttendance({ appointment_id: "42" }),
    ).rejects.toThrow("Erro ao finalizar atendimento: rpc denied");

    queryResult({ data: null, error: { message: "record denied" } });
    await expect(medicalRecordsService.getById("record-3")).rejects.toThrow(
      "Erro ao buscar prontuário: record denied",
    );
  });
});
