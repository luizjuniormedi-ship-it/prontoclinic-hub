import { describe, it, expect, vi, beforeEach } from "vitest";
import { callCenterService } from "@/services/callCenterService";

vi.mock("@/lib/supabase", () => {
  return {
    supabase: {
      auth: { getUser: vi.fn() },
      from: vi.fn(),
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
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  return chain;
}

describe("callCenterService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lista contatos e carrega os pacientes em consulta isolada", async () => {
    const rows = [{
      id: 1,
      patient_id: 10,
      channel: "telefone",
      direction: "inbound",
      contact_reason: "Marcação",
      result: "agendado",
    }];
    const contactsChain = chainWith({ data: rows, error: null });
    contactsChain.limit.mockResolvedValue({ data: rows, error: null });
    const patientsChain = chainWith({ data: [], error: null });
    patientsChain.in.mockResolvedValue({
      data: [{ id: 10, full_name: "Maria Souza", cpf: "123", phone: "21999999999" }],
      error: null,
    });
    (supabase.from as any)
      .mockReturnValueOnce(contactsChain)
      .mockReturnValueOnce(patientsChain);

    const result = await callCenterService.listContacts();

    expect(supabase.from).toHaveBeenCalledWith("scheduling_contact_logs");
    expect(contactsChain.select).toHaveBeenCalledWith("*");
    expect(patientsChain.in).toHaveBeenCalledWith("id", [10]);
    expect(result[0].patient_name).toBe("Maria Souza");
    expect(result[0].patient_phone).toBe("21999999999");
  });

  it("não consulta pacientes quando os contatos não têm paciente associado", async () => {
    const rows = [{ id: 2, patient_id: null, contact_reason: "Informação" }];
    const contactsChain = chainWith({ data: rows, error: null });
    contactsChain.limit.mockResolvedValue({ data: rows, error: null });
    (supabase.from as any).mockReturnValue(contactsChain);

    const result = await callCenterService.listContacts();

    expect(supabase.from).toHaveBeenCalledTimes(1);
    expect(result[0].patient_name).toBeNull();
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
