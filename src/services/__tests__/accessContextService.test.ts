import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/lib/supabase";
import { accessContextService } from "@/services/accessContextService";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

describe("accessContextService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lista somente combinações retornadas pelos vínculos autorizados", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: [{
        membership_id: "membership-a",
        company_id: "company-a",
        company_name: "Clínica A",
        role_id: 2,
        role_name: "medico",
        unit_id: 7,
        unit_name: "Unidade Centro",
      }],
      error: null,
    } as never);

    await expect(accessContextService.listAuthorized()).resolves.toEqual([{
      membershipId: "membership-a",
      companyId: "company-a",
      companyName: "Clínica A",
      roleId: 2,
      roleName: "medico",
      unitId: 7,
      unitName: "Unidade Centro",
    }]);
  });

  it("oferece contexto corporativo sem unidade para papel autorizado", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: [{
        membership_id: "membership-admin",
        company_id: "company-b",
        company_name: "Clínica B",
        role_id: 1,
        role_name: "admin",
        unit_id: null,
        unit_name: "Corporativo",
      }],
      error: null,
    } as never);

    await expect(accessContextService.listAuthorized()).resolves.toEqual([{
      membershipId: "membership-admin",
      companyId: "company-b",
      companyName: "Clínica B",
      roleId: 1,
      roleName: "admin",
      unitId: null,
      unitName: "Corporativo",
    }]);
  });

  it("seleciona o contexto somente pela RPC validada", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: {}, error: null } as never);
    await accessContextService.select("membership-a", 2, 7);
    expect(supabase.rpc).toHaveBeenCalledWith("set_access_context", {
      p_membership_id: "membership-a",
      p_role_id: 2,
      p_unit_id: 7,
    });
  });
});
