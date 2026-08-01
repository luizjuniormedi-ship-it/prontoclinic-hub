import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: rpcMock,
  },
}));

import {
  acknowledgeCriticalAlert,
  collectSpecimen,
  createLabOrder,
  deliverOrder,
  LisGatewayError,
  recordQcRun,
  recordResults,
  transitionSpecimen,
  upsertEquipment,
  upsertExamCatalog,
  upsertReferenceRange,
  validateResult,
} from "../api/lisGateway";

describe("lisGateway", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ data: { ok: true }, error: null });
  });

  it.each([
    {
      name: "upsert_exam_catalog",
      call: () =>
        upsertExamCatalog({
          payload: {
            ds_exame: "Hemograma",
            ds_sigla: "HEM",
            cd_tuss: "40304361",
            lg_ativo: true,
          },
        }),
      rpc: "m23_upsert_exam_catalog_secure",
      payload: {
        p_exam_id: null,
        p_payload: {
          ds_exame: "Hemograma",
          ds_sigla: "HEM",
          cd_tuss: "40304361",
          lg_ativo: true,
        },
      },
    },
    {
      name: "upsert_reference_range",
      call: () =>
        upsertReferenceRange({
          referenceId: 9,
          examId: 30,
          payload: {
            parameter: "Hemoglobina",
            minimumValue: 12,
            maximumValue: 16,
            unit: "g/dL",
            sex: "A",
            minimumAge: 18,
            maximumAge: 120,
            active: true,
          },
        }),
      rpc: "m23_upsert_reference_range_secure",
      payload: {
        p_reference_id: 9,
        p_exam_id: 30,
        p_payload: {
          parameter: "Hemoglobina",
          minimumValue: 12,
          maximumValue: 16,
          unit: "g/dL",
          sex: "A",
          minimumAge: 18,
          maximumAge: 120,
          active: true,
        },
      },
    },
    {
      name: "upsert_equipment",
      call: () =>
        upsertEquipment({
          equipmentId: "10000000-0000-4000-8000-000000000001",
          unitId: 2,
          payload: {
            code: "EQ-01",
            name: "Analisador",
            integration_kind: "HL7",
            status: "ACTIVE",
          },
        }),
      rpc: "m23_upsert_equipment_secure",
      payload: {
        p_equipment_id: "10000000-0000-4000-8000-000000000001",
        p_unit_id: 2,
        p_payload: {
          code: "EQ-01",
          name: "Analisador",
          integration_kind: "HL7",
          status: "ACTIVE",
        },
      },
    },
    {
      name: "create_lab_order",
      call: () =>
        createLabOrder({
          unitId: 2,
          patientId: 10,
          professionalId: 20,
          priority: "ROTINA",
          clinicalHypothesis: "Anemia",
          items: [
            {
              exam_id: 30,
              source_exam_request_item_id:
                "20000000-0000-4000-8000-000000000001",
            },
          ],
        }),
      rpc: "m23_create_lab_order_secure",
      payload: {
        p_unit_id: 2,
        p_patient_id: 10,
        p_professional_id: 20,
        p_appointment_id: null,
        p_priority: "ROTINA",
        p_clinical_hypothesis: "Anemia",
        p_notes: null,
        p_items: [
          {
            exam_id: 30,
            source_exam_request_item_id:
              "20000000-0000-4000-8000-000000000001",
          },
        ],
      },
    },
    {
      name: "collect_specimen",
      call: () =>
        collectSpecimen({
          orderId: 40,
          specimenType: "SANGUE",
          containerType: "EDTA",
          orderItemIds: [41, 42],
          accessionNumber: "ACC-001",
        }),
      rpc: "m23_collect_specimen_secure",
      payload: {
        p_order_id: 40,
        p_specimen_type: "SANGUE",
        p_container_type: "EDTA",
        p_order_item_ids: [41, 42],
        p_accession_number: "ACC-001",
      },
    },
    {
      name: "transition_specimen",
      call: () =>
        transitionSpecimen({
          specimenId: "30000000-0000-4000-8000-000000000001",
          status: "RECEIVED",
        }),
      rpc: "m23_transition_specimen_secure",
      payload: {
        p_specimen_id: "30000000-0000-4000-8000-000000000001",
        p_status: "RECEIVED",
        p_reason: null,
      },
    },
    {
      name: "record_qc_run",
      call: () =>
        recordQcRun({
          equipmentId: "40000000-0000-4000-8000-000000000001",
          controlName: "Controle glicose",
          controlLot: "LOT-01",
          controlLevel: "NORMAL",
          measuredValue: 99,
          targetValue: 100,
          minimumValue: 95,
          maximumValue: 105,
        }),
      rpc: "m23_record_qc_run_secure",
      payload: {
        p_equipment_id: "40000000-0000-4000-8000-000000000001",
        p_control_name: "Controle glicose",
        p_control_lot: "LOT-01",
        p_control_level: "NORMAL",
        p_measured_value: 99,
        p_target_value: 100,
        p_minimum_value: 95,
        p_maximum_value: 105,
        p_notes: null,
      },
    },
    {
      name: "record_results",
      call: () =>
        recordResults({
          orderItemId: 50,
          results: [
            {
              parameter: "Hemoglobina",
              numeric_value: 13.5,
              unit: "g/dL",
              reference_min: 12,
              reference_max: 16,
            },
          ],
        }),
      rpc: "m23_record_results_secure",
      payload: {
        p_order_item_id: 50,
        p_results: [
          {
            parameter: "Hemoglobina",
            numeric_value: 13.5,
            unit: "g/dL",
            reference_min: 12,
            reference_max: 16,
          },
        ],
        p_equipment_id: null,
      },
    },
    {
      name: "validate_result",
      call: () =>
        validateResult({
          orderItemId: 50,
          action: "RELEASE",
          note: "Conferido",
        }),
      rpc: "m23_validate_result_secure",
      payload: {
        p_order_item_id: 50,
        p_action: "RELEASE",
        p_note: "Conferido",
      },
    },
    {
      name: "acknowledge_critical_alert",
      call: () =>
        acknowledgeCriticalAlert({
          alertId: 60,
          communicationMethod: "TELEFONE",
        }),
      rpc: "m23_acknowledge_critical_alert_secure",
      payload: {
        p_alert_id: 60,
        p_communication_method: "TELEFONE",
        p_note: null,
      },
    },
    {
      name: "deliver_order",
      call: () =>
        deliverOrder({
          orderId: 40,
          deliveryMethod: "PORTAL",
          recipient: "Paciente",
          metadata: { protocol: "DEL-001" },
        }),
      rpc: "m23_deliver_order_secure",
      payload: {
        p_order_id: 40,
        p_delivery_method: "PORTAL",
        p_recipient: "Paciente",
        p_metadata: { protocol: "DEL-001" },
      },
    },
  ])("envia o payload exato para $name", async ({ call, rpc, payload }) => {
    const expected = { ok: true };
    rpcMock.mockResolvedValueOnce({ data: expected, error: null });

    await expect(call()).resolves.toEqual(expected);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith(rpc, payload);
  });

  it("converte erro retornado pelo Supabase em LisGatewayError", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: {
        message: "access denied",
        code: "42501",
        details: "RLS",
        hint: "check role",
      },
    });

    const request = deliverOrder({
      orderId: 40,
      deliveryMethod: "PORTAL",
    });

    await expect(request).rejects.toMatchObject({
      name: "LisGatewayError",
      rpcName: "m23_deliver_order_secure",
      code: "42501",
      details: "RLS",
      hint: "check role",
      message:
        "Falha na operacao LIS m23_deliver_order_secure: access denied",
    });
  });

  it("normaliza falha inesperada da chamada sem incluir o payload no erro", async () => {
    rpcMock.mockRejectedValueOnce(new Error("network unavailable"));

    const request = upsertExamCatalog({
      examId: 70,
      payload: {
        ds_exame: "Glicemia",
        ds_sigla: "GLI",
      },
    });

    await expect(request).rejects.toEqual(
      expect.objectContaining({
        name: "LisGatewayError",
        rpcName: "m23_upsert_exam_catalog_secure",
        message:
          "Falha na operacao LIS m23_upsert_exam_catalog_secure: network unavailable",
      }),
    );

    try {
      await request;
    } catch (error) {
      expect(error).toBeInstanceOf(LisGatewayError);
      expect(String(error)).not.toContain("Glicemia");
    }
  });
});
