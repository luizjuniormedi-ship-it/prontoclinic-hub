import { describe, expect, it, vi } from "vitest";
import {
  assertM20PrescriptionConsumable,
  createModule19NursingService,
  resolveModule19TriageRequest,
  type CompleteModule19TriageInput,
} from "@/services/module19NursingService";
import { medicalAttendanceService } from "@/services/medicalAttendanceService";
import { supabase } from "@/lib/supabase";

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: vi.fn() },
}));

function validInput(): CompleteModule19TriageInput {
  return {
    unitId: 7,
    patientId: 42,
    appointmentId: 100,
    queueId: 200,
    classificationId: 3,
    classificationReason: "Dor moderada documentada",
    clinical: {
      chiefComplaint: " Dor abdominal ",
      systolicBloodPressure: 120,
      diastolicBloodPressure: 80,
      heartRate: 82,
      respiratoryRate: 18,
      temperature: 36.8,
      oxygenSaturation: 98,
      painScale: 5,
    },
    news2: {
      respiratoryRateScore: 0,
      oxygenSaturationScore: 0,
      temperatureScore: 0,
      systolicBloodPressureScore: 0,
      heartRateScore: 0,
      consciousnessScore: 0,
      risk: "BAIXO",
    },
  };
}

describe("resolveModule19TriageRequest", () => {
  it("normaliza o payload sem aceitar empresa ou ator do frontend", () => {
    const result = resolveModule19TriageRequest(validInput());
    expect(result.clinical.chiefComplaint).toBe("Dor abdominal");
    expect(result.classificationReason).toBe("Dor moderada documentada");
    expect(result.unitId).toBe(7);
  });

  it("recusa unidade, paciente e classificação inválidos", () => {
    expect(() => resolveModule19TriageRequest({ ...validInput(), unitId: 0 })).toThrow(/Unidade/);
    expect(() => resolveModule19TriageRequest({ ...validInput(), patientId: -1 })).toThrow(/Paciente/);
    expect(() => resolveModule19TriageRequest({ ...validInput(), classificationId: 0 })).toThrow(/Classificação/);
  });

  it("recusa sinais vitais fora das constraints do banco", () => {
    expect(() =>
      resolveModule19TriageRequest({
        ...validInput(),
        clinical: { ...validInput().clinical, oxygenSaturation: 120 },
      }),
    ).toThrow(/Saturação/);
    expect(() =>
      resolveModule19TriageRequest({
        ...validInput(),
        clinical: { ...validInput().clinical, painScale: 11 },
      }),
    ).toThrow(/dor/);
  });

  it("recusa NEWS2 fora de 0 a 3", () => {
    const input = validInput();
    expect(() =>
      resolveModule19TriageRequest({
        ...input,
        news2: { ...input.news2!, heartRateScore: 4 },
      }),
    ).toThrow(/NEWS2/);
  });
});

describe("module19NursingService", () => {
  it("aceita handoff somente quando fila, paciente, agendamento e unidade estão correlacionados", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        queue: { id: 200, appointment_id: 100, cd_paciente: 42, unit_id: 7, tp_status: "AGUARDANDO" },
        idempotent: false,
      },
      error: null,
    });
    const service = createModule19NursingService({ rpc, from: vi.fn() } as never);

    await expect(service.prepareHandoff(100, 42, 7, "Dor abdominal")).resolves.toMatchObject({
      queue: { id: 200, appointment_id: 100, cd_paciente: 42, unit_id: 7 },
    });
    expect(rpc).toHaveBeenCalledWith("m19_prepare_triage_handoff_secure", {
      p_appointment_id: 100,
      p_complaint: "Dor abdominal",
    });
  });

  it("recusa handoff retornado com correlação divergente", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        queue: { id: 200, appointment_id: 100, cd_paciente: 99, unit_id: 7, tp_status: "AGUARDANDO" },
        idempotent: false,
      },
      error: null,
    });
    const service = createModule19NursingService({ rpc, from: vi.fn() } as never);

    await expect(service.prepareHandoff(100, 42, 7)).rejects.toThrow(/não corresponde/);
  });

  it("conclui triagem exclusivamente pelo RPC atômico", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        triage: { id: 501 },
        news2: { id: 601 },
        idempotent: false,
      },
      error: null,
    });
    const from = vi.fn();
    const service = createModule19NursingService({ rpc, from } as never);

    const result = await service.completeTriage(validInput());

    expect(result.triage.id).toBe(501);
    expect(rpc).toHaveBeenCalledWith("m19_complete_triage_secure", {
      p_unit_id: 7,
      p_patient_id: 42,
      p_appointment_id: 100,
      p_queue_id: 200,
      p_classification_id: 3,
      p_classification_reason: "Dor moderada documentada",
      p_payload: expect.objectContaining({ chiefComplaint: "Dor abdominal" }),
      p_news2: expect.objectContaining({ risk: "BAIXO" }),
    });
    const params = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(params).not.toHaveProperty("company_id");
    expect(params).not.toHaveProperty("actor_user_id");
    expect(from).not.toHaveBeenCalled();
  });

  it("propaga erro do backend sem simular sucesso", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "Unidade fora do escopo autorizado" },
    });
    const service = createModule19NursingService({ rpc, from: vi.fn() } as never);

    await expect(service.completeTriage(validInput())).rejects.toThrow(
      /Unidade fora do escopo autorizado/,
    );
  });

  it("retoma a mesma triagem de forma idempotente sem trocar appointment_id", async () => {
    const first = {
      triage: { id: 501, cd_appointment: 100, triagem_fila_id: 200 },
      news2: null,
      idempotent: false,
    };
    const resumed = { ...first, idempotent: true };
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: first, error: null })
      .mockResolvedValueOnce({ data: resumed, error: null });
    const from = vi.fn();
    const service = createModule19NursingService({ rpc, from } as never);

    const created = await service.completeTriage(validInput());
    const retried = await service.completeTriage(validInput());

    expect(created.idempotent).toBe(false);
    expect(retried.idempotent).toBe(true);
    expect(retried.triage).toMatchObject({
      id: 501,
      cd_appointment: 100,
      triagem_fila_id: 200,
    });
    expect(rpc).toHaveBeenCalledTimes(2);
    for (const [, params] of rpc.mock.calls) {
      expect(params).toMatchObject({
        p_appointment_id: 100,
        p_queue_id: 200,
        p_patient_id: 42,
        p_unit_id: 7,
      });
    }
    expect(from).not.toHaveBeenCalled();
  });

  it("reclassifica com motivo e sem escrita direta", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        triage: { id: 501 },
        reclassification: { id: 701 },
      },
      error: null,
    });
    const from = vi.fn();
    const service = createModule19NursingService({ rpc, from } as never);

    const result = await service.reclassify({
      triageId: 501,
      classificationId: 2,
      reason: "Piora respiratória",
    });

    expect(result.reclassification.id).toBe(701);
    expect(rpc).toHaveBeenCalledWith("m19_reclassify_triage_secure", {
      p_triage_id: 501,
      p_classification_id: 2,
      p_reason: "Piora respiratória",
    });
    expect(from).not.toHaveBeenCalled();
  });
});

describe("medicalAttendanceService", () => {
  it("finaliza appointment e retorna encounter e conta pelo contrato canônico", async () => {
    const response = {
      encounter: {
        id: "enc-1",
        appointment_id: 100,
        status: "finalizado",
      },
      billing: {
        billing_id: 9,
        billing_account_id: "account-100",
        billing_type: "convenio",
        gross_amount: 150,
        price_found: true,
        appointment_id: 100,
      },
    };
    vi.mocked(supabase.rpc).mockResolvedValue({ data: response, error: null } as never);

    await expect(
      medicalAttendanceService.finalizeAppointmentWithBilling(
        100,
        { chief_complaint: "Dor sintética" },
      ),
    ).resolves.toEqual(response);
    expect(supabase.rpc).toHaveBeenCalledWith(
      "m18_finalize_appointment_with_billing_secure",
      {
        p_appointment_id: 100,
        p_payload: { chief_complaint: "Dor sintética" },
        p_disposition: "FINALIZED",
      },
    );
  });

  it("recusa handoff financeiro de outro appointment", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: {
        encounter: { id: "enc-1", appointment_id: 100, status: "finalizado" },
        billing: {
          billing_id: 9,
          billing_account_id: "account-101",
          billing_type: "convenio",
          gross_amount: 150,
          price_found: true,
          appointment_id: 101,
        },
      },
      error: null,
    } as never);

    await expect(
      medicalAttendanceService.finalizeAppointmentWithBilling(100, {}),
    ).rejects.toThrow(/outro agendamento/);
  });
});

describe("contrato de consumo da prescrição M20", () => {
  const context = {
    companyId: "company-a",
    unitId: 7,
    patientId: 42,
    appointmentId: 100,
  };

  it("aceita somente referência M20 assinada, ativa e no mesmo escopo", () => {
    const prescription = {
      id: "rx-1",
      company_id: "company-a",
      unit_id: 7,
      patient_id: 42,
      appointment_id: 100,
      status: "SIGNED",
      signed_at: "2026-07-24T00:00:00Z",
      revoked_at: null,
    };
    expect(assertM20PrescriptionConsumable(prescription, context)).toBe(prescription);
  });

  it("recusa prescrição não assinada, revogada ou de outra unidade", () => {
    expect(() =>
      assertM20PrescriptionConsumable(
        {
          id: "rx-2",
          company_id: "company-a",
          unit_id: 9,
          patient_id: 42,
          status: "ACTIVE",
          signed_at: "2026-07-24T00:00:00Z",
        },
        context,
      ),
    ).toThrow(/escopo/);
    expect(() =>
      assertM20PrescriptionConsumable(
        {
          id: "rx-3",
          company_id: "company-a",
          unit_id: 7,
          patient_id: 42,
          appointment_id: 100,
          status: "DRAFT",
          signed_at: null,
        },
        context,
      ),
    ).toThrow(/ativa/);
  });

  it("recusa prescrição sem o mesmo vínculo de agendamento", () => {
    expect(() =>
      assertM20PrescriptionConsumable(
        {
          id: "rx-4",
          company_id: "company-a",
          unit_id: 7,
          patient_id: 42,
          appointment_id: null,
          status: "SIGNED",
          signed_at: "2026-07-24T00:00:00Z",
        },
        context,
      ),
    ).toThrow(/outro agendamento/);
  });
});
