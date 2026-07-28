import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createElectronicPrescriptionService,
  normalizePrescriptionDraft,
  normalizePrescriptionItem,
  type ElectronicPrescriptionClient,
} from "@/services/electronicPrescriptionService";

const PRESCRIPTION_ID = "11111111-1111-4111-8111-111111111111";
const ENCOUNTER_ID = "22222222-2222-4222-8222-222222222222";
const ITEM_ID = "33333333-3333-4333-8333-333333333333";

function prescription(overrides: Record<string, unknown> = {}) {
  return {
    id: PRESCRIPTION_ID,
    company_id: "44444444-4444-4444-8444-444444444444",
    unit_id: 2,
    encounter_id: ENCOUNTER_ID,
    patient_id: 10,
    prescriber_id: 20,
    medical_record_id: null,
    current_version: 1,
    status: "draft",
    signature_hash: null,
    signed_at: null,
    signed_by: null,
    ...overrides,
  };
}

describe("electronicPrescriptionService", () => {
  const rpc = vi.fn();
  const client = { rpc, from: vi.fn() } as unknown as ElectronicPrescriptionClient;
  const service = createElectronicPrescriptionService(client);

  beforeEach(() => vi.clearAllMocks());

  it("normaliza contexto e rejeita IDs clínicos inválidos", () => {
    expect(normalizePrescriptionDraft({
      unitId: 2,
      encounterId: ` ${ENCOUNTER_ID} `,
      patientId: 10,
      prescriberId: 20,
      clinicalIndication: "  Dor aguda  ",
    })).toMatchObject({
      unitId: 2,
      encounterId: ENCOUNTER_ID,
      patientId: 10,
      prescriberId: 20,
      clinicalIndication: "Dor aguda",
    });
    expect(() => normalizePrescriptionDraft({
      unitId: 0,
      patientId: 10,
      prescriberId: 20,
    })).toThrow(/unitId/);
  });

  it("aceita UUID PostgreSQL legado sem bits RFC de variante", () => {
    const legacyEncounterId = "11111111-1111-1111-1111-111111111111";

    expect(normalizePrescriptionDraft({
      unitId: 2,
      encounterId: legacyEncounterId,
      patientId: 10,
      prescriberId: 20,
    }).encounterId).toBe(legacyEncounterId);
  });

  it("exige dose, unidade, via e frequência para medicamento", () => {
    expect(() => normalizePrescriptionItem({
      itemType: "medication",
      medicationName: "Dipirona",
      dose: 500,
    })).toThrow(/Unidade da dose/);

    expect(normalizePrescriptionItem({
      itemType: "medication",
      medicationName: " Dipirona ",
      activeIngredient: " dipirona ",
      dose: 500,
      doseUnit: "mg",
      route: "oral",
      frequencyText: "a cada 8 horas",
      scheduleTimes: ["08:00", "16:00"],
    })).toMatchObject({
      medicationName: "Dipirona",
      activeIngredient: "dipirona",
      scheduleTimes: ["08:00:00", "16:00:00"],
    });
  });

  it("cria rascunho sem aceitar company ou ator do cliente", async () => {
    rpc.mockResolvedValueOnce({ data: prescription(), error: null });

    await service.create({
      unitId: 2,
      encounterId: ENCOUNTER_ID,
      patientId: 10,
      prescriberId: 20,
      clinicalIndication: "Dor",
    });

    expect(rpc).toHaveBeenCalledWith("m20_create_prescription_secure", {
      p_unit_id: 2,
      p_encounter_id: ENCOUNTER_ID,
      p_patient_id: 10,
      p_prescriber_id: 20,
      p_medical_record_id: null,
      p_clinical_indication: "Dor",
      p_notes: null,
    });
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_company_id");
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_created_by");
  });

  it("serializa item canônico e usa RPC atômico", async () => {
    rpc.mockResolvedValueOnce({
      data: { id: ITEM_ID, prescription_id: PRESCRIPTION_ID, medication_name: "Dipirona" },
      error: null,
    });

    await service.upsertItem(PRESCRIPTION_ID, {
      itemType: "medication",
      medicationName: "Dipirona",
      dose: 500,
      doseUnit: "mg",
      route: "oral",
      frequencyText: "8/8 horas",
      durationDays: 3,
    });

    expect(rpc).toHaveBeenCalledWith("m20_upsert_prescription_item_secure", {
      p_prescription_id: PRESCRIPTION_ID,
      p_item: expect.objectContaining({
        item_type: "medication",
        medication_name: "Dipirona",
        dose: 500,
        dose_unit: "mg",
        route: "oral",
        frequency_text: "8/8 horas",
        duration_days: 3,
      }),
      p_item_id: null,
    });
  });

  it("não envia hash, ator ou horário ao solicitar assinatura", async () => {
    rpc.mockResolvedValueOnce({
      data: prescription({
        status: "signed",
        signature_hash: "a".repeat(64),
        signed_at: "2026-07-24T01:00:00.000Z",
        signed_by: "55555555-5555-4555-8555-555555555555",
      }),
      error: null,
    });

    await service.sign(PRESCRIPTION_ID);

    expect(rpc).toHaveBeenCalledWith("m20_transition_prescription_secure", {
      p_prescription_id: PRESCRIPTION_ID,
      p_target_status: "signed",
      p_reason: null,
    });
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_signature_hash");
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_signed_at");
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_signed_by");
  });

  it("recusa considerar assinada uma resposta sem atestação do servidor", async () => {
    rpc.mockResolvedValueOnce({ data: prescription({ status: "signed" }), error: null });
    await expect(service.sign(PRESCRIPTION_ID)).rejects.toThrow(/atestação do servidor ausente/);
  });

  it("exige justificativa para override e propaga erro clínico do RPC", async () => {
    await expect(
      service.resolveSafetyEvent(ITEM_ID, "overridden", " "),
    ).rejects.toThrow(/Justificativa/);

    rpc.mockResolvedValueOnce({ data: null, error: { message: "evento crítico pendente" } });
    await expect(service.validate(PRESCRIPTION_ID)).rejects.toThrow(/evento crítico pendente/);
  });
});
