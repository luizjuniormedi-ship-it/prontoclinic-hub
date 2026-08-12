import { beforeEach, describe, expect, it, vi } from "vitest";
import { medicalRecordsService } from "@/services/medicalRecordsService";
import { supabase } from "@/lib/supabase";

vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));

describe("medicalRecordsService - contrato clínico canônico", () => {
  beforeEach(() => vi.clearAllMocks());

  function queryResult(result: unknown) {
    const terminal = vi.fn().mockResolvedValue(result);
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      order: terminal,
      maybeSingle: terminal,
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    vi.mocked(supabase.from).mockReturnValue(query as never);
    return query;
  }

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

  it("lista prontuários do paciente em ordem decrescente", async () => {
    const records = [{ id: "record-1" }];
    const query = queryResult({ data: records, error: null });

    await expect(medicalRecordsService.getByPatient("patient-1")).resolves.toEqual(records);
    expect(supabase.from).toHaveBeenCalledWith("medical_records");
    expect(query.eq).toHaveBeenCalledWith("patient_id", "patient-1");
    expect(query.order).toHaveBeenCalledWith("record_date", { ascending: false });
  });

  it("normaliza consulta vazia do paciente", async () => {
    queryResult({ data: null, error: null });
    await expect(medicalRecordsService.getByPatient("patient-2")).resolves.toEqual([]);
  });

  it("propaga falha ao consultar prontuários do paciente", async () => {
    queryResult({ data: null, error: { message: "read denied" } });
    await expect(medicalRecordsService.getByPatient("patient-3")).rejects.toThrow(
      "Erro ao buscar prontuários: read denied",
    );
  });

  it("busca um prontuário pelo identificador", async () => {
    const record = { id: "record-2" };
    const query = queryResult({ data: record, error: null });

    await expect(medicalRecordsService.getById("record-2")).resolves.toEqual(record);
    expect(query.eq).toHaveBeenCalledWith("id", "record-2");
    expect(query.maybeSingle).toHaveBeenCalledOnce();
  });

  it("propaga falhas do RPC e da leitura individual", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: { message: "rpc denied" } } as never);
    await expect(medicalRecordsService.finalizeAttendance({ appointment_id: "42" })).rejects.toThrow(
      "Erro ao finalizar atendimento: rpc denied",
    );

    queryResult({ data: null, error: { message: "record denied" } });
    await expect(medicalRecordsService.getById("record-3")).rejects.toThrow(
      "Erro ao buscar prontuário: record denied",
    );
  });
});
