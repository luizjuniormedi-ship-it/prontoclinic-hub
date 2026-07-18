import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: mocks.rpc },
}));

import { secureDraftService } from "@/services/secureDraftService";

describe("secureDraftService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockResolvedValue({ data: null, error: null });
  });

  it("envia o conteúdo apenas ao RPC de cifragem do servidor", async () => {
    const localStorageSpy = vi.spyOn(Storage.prototype, "setItem");
    const saved = {
      id: "40000000-0000-0000-0000-000000000004",
      expires_at: "2026-07-17T00:00:00Z",
    };
    mocks.rpc.mockResolvedValueOnce({ data: saved, error: null });

    await expect(secureDraftService.save({
      sessionId: "10000000-0000-0000-0000-000000000001",
      clientDeviceId: "30000000-0000-0000-0000-000000000003",
      unitId: 7,
      contextType: "encounter",
      contextId: "9001",
      content: { anamnesis: "conteúdo clínico sensível" },
      ttlMinutes: 30,
    })).resolves.toEqual(saved);

    expect(mocks.rpc).toHaveBeenCalledWith("save_secure_clinical_draft", {
      p_session_id: "10000000-0000-0000-0000-000000000001",
      p_client_device_id: "30000000-0000-0000-0000-000000000003",
      p_draft_id: null,
      p_unit_id: 7,
      p_context_type: "encounter",
      p_context_id: "9001",
      p_content: { anamnesis: "conteúdo clínico sensível" },
      p_ttl_minutes: 30,
    });
    expect(localStorageSpy).not.toHaveBeenCalled();
    localStorageSpy.mockRestore();
  });

  it("carrega plaintext somente pelo RPC autorizado do servidor", async () => {
    const draft = {
      id: "40000000-0000-0000-0000-000000000004",
      content: { anamnesis: "texto" },
    };
    mocks.rpc.mockResolvedValueOnce({ data: draft, error: null });

    await expect(secureDraftService.get({
      sessionId: "10000000-0000-0000-0000-000000000001",
      clientDeviceId: "30000000-0000-0000-0000-000000000003",
      draftId: "40000000-0000-0000-0000-000000000004",
    })).resolves.toEqual(draft);
  });

  it("não devolve conteúdo quando o servidor rejeita sessão, tenant ou contexto", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "Sessão inválida" } });

    await expect(secureDraftService.get({
      sessionId: "10000000-0000-0000-0000-000000000001",
      clientDeviceId: "30000000-0000-0000-0000-000000000003",
      draftId: "40000000-0000-0000-0000-000000000004",
    })).rejects.toThrow("Sessão inválida");
  });

  it("exclui o rascunho no servidor", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: true, error: null });

    await expect(secureDraftService.remove({
      sessionId: "10000000-0000-0000-0000-000000000001",
      clientDeviceId: "30000000-0000-0000-0000-000000000003",
      draftId: "40000000-0000-0000-0000-000000000004",
    })).resolves.toBeUndefined();

    expect(mocks.rpc).toHaveBeenCalledWith("delete_secure_clinical_draft", {
      p_session_id: "10000000-0000-0000-0000-000000000001",
      p_client_device_id: "30000000-0000-0000-0000-000000000003",
      p_draft_id: "40000000-0000-0000-0000-000000000004",
    });
  });
});
