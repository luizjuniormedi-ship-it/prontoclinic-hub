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
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
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
    expect(chain.select).toHaveBeenCalledWith(expect.stringContaining("id, company_id, patient_id"));
    expect(chain.select).toHaveBeenCalledWith(expect.not.stringContaining("select *"));
    expect(result[0].patient_name).toBe("Maria Souza");
    expect(result[0].patient_phone).toBe("21999999999");
  });

  it("atualiza a fila de confirmações pelo RPC seguro", async () => {
    (supabase.rpc as any).mockResolvedValue({ data: 4, error: null });

    await expect(callCenterService.refreshConfirmationQueue(3)).resolves.toBe(4);
    expect(supabase.rpc).toHaveBeenCalledWith("refresh_confirmation_queue_secure", { p_days_ahead: 3 });
  });

  it("cria contato e tarefa quando proxima acao é informada", async () => {
    (supabase.auth.getUser as any).mockResolvedValue({ data: { user: { id: "user-1" } } });
    const profileChain = chainWith({ data: { company_id: "company-1" }, error: null });
    const contactChain = chainWith({ data: { id: 77, result: "recado" }, error: null });
    const taskChain = chainWith({ data: { id: 88, status: "pending" }, error: null });
    (supabase.from as any)
      .mockReturnValueOnce(profileChain)
      .mockReturnValueOnce(contactChain)
      .mockReturnValueOnce(profileChain)
      .mockReturnValueOnce(taskChain);

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
    expect(contactChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      patient_id: 10,
      company_id: "company-1",
      operator_id: "user-1",
      contact_reason: "Retorno pendente",
    }));
    expect(taskChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      contact_log_id: 77,
      task_type: "retornar_ligacao",
      status: "pending",
    }));
  });

  it("rejeita contato sem motivo", async () => {
    (supabase.auth.getUser as any).mockResolvedValue({ data: { user: { id: "user-1" } } });
    const profileChain = chainWith({ data: { company_id: "company-1" }, error: null });
    (supabase.from as any).mockReturnValue(profileChain);

    await expect(callCenterService.createContact({
      patient_id: "10",
      channel: "telefone",
      direction: "inbound",
      contact_reason: " ",
      result: "recado",
    })).rejects.toThrow(/Motivo do contato/);
  });

  it("conclui tarefa", async () => {
    const chain = chainWith({ data: null, error: null });
    chain.eq.mockResolvedValue({ error: null });
    (supabase.from as any).mockReturnValue(chain);

    await expect(callCenterService.completeTask(5)).resolves.toBeUndefined();
    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ status: "done" }));
    expect(chain.eq).toHaveBeenCalledWith("id", 5);
  });
});
