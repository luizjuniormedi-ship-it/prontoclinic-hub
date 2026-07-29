import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

  it("materializa a fila de confirmações pelo RPC seguro somente quando solicitado", async () => {
    (supabase.rpc as any).mockResolvedValue({ data: 4, error: null });

    await expect(callCenterService.materializeConfirmationQueue(3)).resolves.toBe(4);
    expect(supabase.rpc).toHaveBeenCalledWith("refresh_confirmation_queue_secure", { p_days_ahead: 3 });
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });

  it("cria contato e tarefa quando proxima acao é informada", async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: { id: 77, result: "recado" },
      error: null,
    });

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
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith(
      "record_call_center_contact_secure",
      expect.objectContaining({
        p_patient_id: 10,
        p_contact_reason: "Retorno pendente",
        p_next_action: "retornar_ligacao",
        p_create_task: true,
      }),
    );
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("rejeita contato sem motivo", async () => {
    await expect(callCenterService.createContact({
      patient_id: "10",
      channel: "telefone",
      direction: "inbound",
      contact_reason: " ",
      result: "recado",
    })).rejects.toThrow(/Motivo do contato/);
  });

  it("conclui tarefa", async () => {
    (supabase.rpc as any).mockResolvedValue({ data: { id: 5, status: "done" }, error: null });

    await expect(callCenterService.completeTask(5)).resolves.toBeUndefined();
    expect(supabase.rpc).toHaveBeenCalledWith("complete_call_center_task_secure", {
      p_task_id: 5,
    });
    expect(supabase.from).not.toHaveBeenCalled();
  });
});

describe("Call Center atomic command migration", () => {
  const migration = readFileSync(
    resolve(
      process.cwd(),
      "supabase/migrations/20260729225000_call_center_atomic_commands.sql",
    ),
    "utf8",
  );

  it("usa o owner restrito existente e mantém RLS forçado", () => {
    expect(migration).toContain("prontomedic_reception_rpc_owner");
    expect(migration).toContain("FORCE ROW LEVEL SECURITY");
    expect(migration).toMatch(/SECURITY DEFINER[\s\S]*SET search_path = public, pg_temp/i);
    expect(migration).toContain("SET row_security = on");
    expect(migration).toContain("Call Center RPC owner must not own command tables");
    expect(migration).not.toMatch(/\bALTER ROLE\b[^\n]*\bBYPASSRLS\b/i);
  });

  it("fecha escrita direta e expõe somente comandos seguros", () => {
    expect(migration).toMatch(
      /REVOKE INSERT, UPDATE, DELETE, TRUNCATE[\s\S]*ON TABLE public\.scheduling_contact_logs[\s\S]*FROM PUBLIC, anon, authenticated, app_prontomedic/i,
    );
    expect(migration).toMatch(
      /REVOKE INSERT, UPDATE, DELETE, TRUNCATE[\s\S]*ON TABLE public\.scheduling_call_center_tasks[\s\S]*FROM PUBLIC, anon, authenticated, app_prontomedic/i,
    );
    expect(migration).toContain("record_call_center_contact_secure");
    expect(migration).toContain("complete_call_center_task_secure");
  });

  it("valida empresa, paciente e agendamento antes da transação", () => {
    expect(migration).toContain("v_company_id := public.active_company_id()");
    expect(migration).toContain("v_unit_id := public.active_unit_id()");
    expect(migration).toContain("Paciente indisponivel no contexto atual");
    expect(migration).toContain("Agendamento nao pertence ao paciente informado");
    expect(migration).toMatch(
      /INSERT INTO public\.scheduling_contact_logs[\s\S]*IF p_create_task THEN[\s\S]*INSERT INTO public\.scheduling_call_center_tasks/i,
    );
  });
});
