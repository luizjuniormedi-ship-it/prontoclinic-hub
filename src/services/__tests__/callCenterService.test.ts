import { describe, it, expect, vi, beforeEach } from "vitest";
import { callCenterService } from "@/services/callCenterService";

vi.mock("@/lib/supabase", () => {
  return {
    supabase: {
      auth: { getUser: vi.fn() },
      from: vi.fn(),
      rpc: vi.fn(),
    },
  };
});

import { supabase } from "@/lib/supabase";

function chainWith(result: unknown) {
  const chain: Record<string, any> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  return chain;
}

describe("callCenterService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lista contatos com dados do paciente embutidos", async () => {
    const rows = [{
      id: 1,
      patient_id: 10,
      channel: "telefone",
      direction: "inbound",
      contact_reason: "Marcação",
      result: "agendado",
      patients: { full_name: "Maria Souza", cpf: "123", phone: "21999999999" },
    }];
    const chain = chainWith({ data: rows, error: null });
    chain.limit.mockResolvedValue({ data: rows, error: null });
    (supabase.from as any).mockReturnValue(chain);

    const result = await callCenterService.listContacts();

    expect(supabase.from).toHaveBeenCalledWith("scheduling_contact_logs");
    expect(result[0].patient_name).toBe("Maria Souza");
    expect(result[0].patient_phone).toBe("21999999999");
  });

  it("cria contato e tarefa atomicamente quando proxima acao é informada", async () => {
    const contact = {
      id: 77,
      patient_id: 10,
      result: "recado",
      next_action: "retornar_ligacao",
    };
    (supabase.rpc as any).mockResolvedValue({ data: contact, error: null });

    const result = await callCenterService.createContact({
      patient_id: "10",
      channel: "telefone",
      direction: "inbound",
      contact_reason: "Retorno pendente",
      result: "recado",
      notes: "Ligar amanhã",
      next_action: "retornar_ligacao",
      create_task: true,
    });

    expect(result.id).toBe(77);
    expect(supabase.rpc).toHaveBeenCalledWith(
      "create_call_center_contact_secure",
      expect.objectContaining({
        p_patient_id: 10,
        p_contact_reason: "Retorno pendente",
        p_create_task: true,
      }),
    );
  });

  it("rejeita contato sem motivo antes de chamar o backend", async () => {
    await expect(callCenterService.createContact({
      patient_id: "10",
      channel: "telefone",
      direction: "inbound",
      contact_reason: " ",
      result: "recado",
    })).rejects.toThrow(/Motivo do contato/);

    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("cria tarefa via RPC segura", async () => {
    const task = { id: 88, status: "pending" };
    (supabase.rpc as any).mockResolvedValue({ data: task, error: null });

    const result = await callCenterService.createTask({
      patient_id: "10",
      task_type: "retornar_ligacao",
      description: "Ligar amanhã",
    });

    expect(result).toEqual(task);
    expect(supabase.rpc).toHaveBeenCalledWith(
      "create_call_center_task_secure",
      expect.objectContaining({
        p_patient_id: 10,
        p_task_type: "retornar_ligacao",
        p_description: "Ligar amanhã",
        p_priority: "normal",
      }),
    );
  });

  it("conclui tarefa via RPC segura", async () => {
    (supabase.rpc as any).mockResolvedValue({ data: null, error: null });

    await expect(callCenterService.completeTask(5)).resolves.toBeUndefined();
    expect(supabase.rpc).toHaveBeenCalledWith(
      "complete_call_center_task_secure",
      { p_task_id: 5 },
    );
  });
});
