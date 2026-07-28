import { describe, expect, it, vi } from "vitest";
import {
  assertAlertTransition,
  assertExecutionTransition,
  assertStepTransition,
  createCareProtocolService,
  normalizeProtocolContent,
  type CareProtocolClient,
} from "@/services/careProtocolService";

function rpcClient(result: { data: unknown; error: { message: string } | null } = { data: { id: "row-1" }, error: null }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return {
    client: { rpc } as unknown as CareProtocolClient,
    rpc,
  };
}

describe("careProtocolService", () => {
  it("normaliza passos, ordena sequência e preserva somente tipos operacionais", () => {
    const content = normalizeProtocolContent({
      priority: "urgent",
      steps: [
        { key: "task", sequence: 2, title: "Acionar equipe", type: "task", required: false },
        { key: "signal", sequence: 1, title: "Reavaliar sinal", type: "observation", dueMinutes: 10 },
      ],
    });

    expect(content.priority).toBe("URGENT");
    expect(content.steps.map((step) => step.key)).toEqual(["signal", "task"]);
    expect(content.steps[0]).toMatchObject({ type: "OBSERVATION", required: true, dueMinutes: 10 });
  });

  it.each(["PRESCRIPTION", "medication", "drug_order", "auto_prescribe"])(
    "rejeita ação clínica automática proibida: %s",
    (type) => {
      expect(() => normalizeProtocolContent({
        steps: [{ key: "unsafe", title: "Prescrever", type }],
      })).toThrow(/não pode prescrever/);
    },
  );

  it("rejeita chaves e sequências duplicadas", () => {
    expect(() => normalizeProtocolContent({
      steps: [
        { key: "same", sequence: 1, title: "A" },
        { key: "same", sequence: 2, title: "B" },
      ],
    })).toThrow(/duplicada/);
    expect(() => normalizeProtocolContent({
      steps: [
        { key: "a", sequence: 1, title: "A" },
        { key: "b", sequence: 1, title: "B" },
      ],
    })).toThrow(/Sequências/);
  });

  it("valida matrizes de transição e justificativas", () => {
    expect(() => assertExecutionTransition("ACTIVE", "PAUSED", "")).toThrow(/motivo/);
    expect(() => assertExecutionTransition("ACTIVE", "PAUSED", "Instabilidade")).not.toThrow();
    expect(() => assertExecutionTransition("COMPLETED", "ACTIVE")).toThrow(/inválida/);
    expect(() => assertStepTransition("PENDING", "BLOCKED", "")).toThrow(/motivo/);
    expect(() => assertStepTransition("PENDING", "IN_PROGRESS")).not.toThrow();
    expect(() => assertStepTransition("COMPLETED", "IN_PROGRESS")).toThrow(/inválida/);
    expect(() => assertAlertTransition("OPEN", "RESOLVED", "")).toThrow(/motivo/);
    expect(() => assertAlertTransition("OPEN", "ACKNOWLEDGED")).not.toThrow();
    expect(() => assertAlertTransition("RESOLVED", "OPEN")).toThrow(/inválida/);
  });

  it("encaminha sinal do M19 ao RPC sem gerar prescrição", async () => {
    const { client, rpc } = rpcClient({ data: { id: "execution-1", status: "ACTIVE" }, error: null });
    const service = createCareProtocolService(client);

    await service.startExecution({
      protocolVersionId: "version-1",
      unitId: 3,
      patientId: 9,
      encounterId: "encounter-1",
      sourceSignalType: "TRIAGE_RECLASSIFICATION",
      sourceSignalId: "signal-42",
      sourceSignalPayload: { score: 7, classification: "ORANGE" },
    });

    expect(rpc).toHaveBeenCalledWith("m21_start_protocol_execution_secure", {
      p_protocol_version_id: "version-1",
      p_unit_id: 3,
      p_patient_id: 9,
      p_encounter_id: "encounter-1",
      p_source_signal_type: "TRIAGE_RECLASSIFICATION",
      p_source_signal_id: "signal-42",
      p_source_signal_payload: { score: 7, classification: "ORANGE" },
      p_assigned_to: null,
    });
    expect(JSON.stringify(rpc.mock.calls[0])).not.toMatch(/prescri|medication_order/i);
  });

  it("publica conteúdo normalizado e nunca envia campo de prescrição", async () => {
    const { client, rpc } = rpcClient({ data: { id: "version-2", version_number: 2 }, error: null });
    const service = createCareProtocolService(client);

    await service.publishVersion({
      definitionId: "definition-1",
      changeSummary: "Inclui escalonamento",
      content: {
        priority: "IMMEDIATE",
        steps: [{ key: "escalate", title: "Escalar", type: "ESCALATION" }],
      },
    });

    const payload = rpc.mock.calls[0][1];
    expect(payload.p_content.steps[0]).toMatchObject({
      key: "escalate",
      type: "ESCALATION",
      required: true,
    });
    expect(payload.p_content).not.toHaveProperty("prescriptions");
  });

  it("exige motivo para override e propaga erro do backend", async () => {
    const { client } = rpcClient();
    const service = createCareProtocolService(client);
    await expect(service.addOverride({
      executionId: "execution-1",
      type: "OTHER",
      reason: " ",
    })).rejects.toThrow(/Motivo/);

    const failing = createCareProtocolService(rpcClient({
      data: null,
      error: { message: "tenant mismatch" },
    }).client);
    await expect(failing.raiseAlert({
      executionId: "execution-1",
      code: "NEWS2",
      severity: "CRITICAL",
      message: "Reavaliar",
    })).rejects.toThrow(/tenant mismatch/);
  });

  it("valida nível e destino antes de escalar", async () => {
    const service = createCareProtocolService(rpcClient().client);
    await expect(service.escalate({
      executionId: "execution-1",
      level: 6,
      targetRole: "medico",
      reason: "Risco aumentado",
    })).rejects.toThrow(/entre 1 e 5/);
    await expect(service.escalate({
      executionId: "execution-1",
      level: 2,
      reason: "Risco aumentado",
    })).rejects.toThrow(/destino/);
  });
});
