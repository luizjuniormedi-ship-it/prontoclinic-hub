import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/lib/supabase";
import { rolePermissionsService } from "@/services/rolePermissionsService";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
  },
}));

describe("rolePermissionsService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("salva permissões somente pela RPC administrativa contextual", async () => {
    const saved = {
      id: 7,
      role_id: 3,
      module: "agenda",
      can_view: true,
      can_create: false,
      can_edit: false,
      can_delete: false,
      can_export: false,
    };
    vi.mocked(supabase.rpc).mockResolvedValue({ data: saved, error: null } as never);

    await expect(rolePermissionsService.upsert(saved)).resolves.toEqual(saved);
    expect(supabase.rpc).toHaveBeenCalledWith("upsert_role_permission", {
      p_role_id: 3,
      p_module: "agenda",
      p_can_view: true,
      p_can_create: false,
      p_can_edit: false,
      p_can_delete: false,
      p_can_export: false,
    });
  });

  it("propaga uma mensagem segura quando a RPC nega a alteração", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: null,
      error: { message: "permission denied" },
    } as never);

    await expect(rolePermissionsService.upsert({
      role_id: 3,
      module: "agenda",
      can_view: true,
      can_create: false,
      can_edit: false,
      can_delete: false,
      can_export: false,
    })).rejects.toThrow("Não foi possível atualizar a permissão.");
  });
});
