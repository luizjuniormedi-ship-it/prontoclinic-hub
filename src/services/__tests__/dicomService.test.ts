import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const { rpc } = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc,
    from: vi.fn(),
  },
}));

import { worklistQueueService } from "@/services/dicomService";

describe("worklistQueueService.releaseAppointment", () => {
  beforeEach(() => rpc.mockReset());

  it("usa somente a RPC transacional e preserva a chave de idempotência", async () => {
    rpc.mockResolvedValue({
      data: [{ id: "queue-1", appointment_id: 42 }],
      error: null,
    });

    await expect(
      worklistQueueService.releaseAppointment(42, "reception:42:attempt-1"),
    ).resolves.toHaveLength(1);

    expect(rpc).toHaveBeenCalledWith(
      "release_appointment_to_worklist_secure",
      {
        p_appointment_id: 42,
        p_idempotency_key: "reception:42:attempt-1",
      },
    );
  });

  it("falha fechado para agendamento ou chave inválidos", async () => {
    await expect(
      worklistQueueService.releaseAppointment(0, "reception:42:attempt-1"),
    ).rejects.toThrow("Agendamento inválido");
    await expect(
      worklistQueueService.releaseAppointment(42, "curta"),
    ).rejects.toThrow("Chave de idempotência inválida");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("não considera resposta vazia como liberação concluída", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await expect(
      worklistQueueService.releaseAppointment(42, "reception:42:attempt-1"),
    ).rejects.toThrow("não retornou itens");
  });
});

describe("module 10 worklist migration", () => {
  const migration = readFileSync(
    resolve(
      process.cwd(),
      "supabase/migrations/20260728010000_module10_worklist_contract.sql",
    ),
    "utf8",
  );

  it("mantém a fila sob FORCE RLS e owner sem bypass", () => {
    expect(migration).toContain(
      "ALTER TABLE public.dicom_worklist_queue FORCE ROW LEVEL SECURITY",
    );
    expect(migration).toContain("NOBYPASSRLS");
    expect(migration).toContain("NOSUPERUSER");
    expect(migration).toContain(
      "OWNER TO prontomedic_worklist_rpc_owner",
    );
    expect(migration).toContain(
      "m10_worklist_queue_rpc_access",
    );
  });

  it("preserva unicidade, escopo e idempotência na liberação", () => {
    expect(migration).toContain(
      "UNIQUE (company_id, imaging_order_item_id)",
    );
    expect(migration).toContain(
      "public.org_can_access_unit(company_id, unit_id)",
    );
    expect(migration).toContain(
      "WHERE public.dicom_worklist_queue.idempotency_key = EXCLUDED.idempotency_key",
    );
  });

  it("não permite DML direto do cliente autenticado na fila", () => {
    expect(migration).toMatch(
      /REVOKE INSERT, DELETE, TRUNCATE ON public\.dicom_worklist_queue[\s\S]*FROM authenticated;/,
    );
    expect(migration).not.toMatch(
      /GRANT INSERT[^;]*public\.dicom_worklist_queue[^;]*TO authenticated/i,
    );
  });
});
