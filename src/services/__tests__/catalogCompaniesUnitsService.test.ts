import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/lib/supabase";
import { companiesService, roomsService, unitsService } from "@/services/catalogService";

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));

describe("companies and units catalog mutations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("checks management against the company already filtered by the active context", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: true, error: null } as never);
    await expect(companiesService.canManage("8d517284-7fc2-4ad7-a562-f2a1c72e1762")).resolves.toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith("current_context_is_company_admin", {
      p_company_id: "8d517284-7fc2-4ad7-a562-f2a1c72e1762",
    });
  });

  it("updates only the active company through the secured RPC", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: {}, error: null } as never);
    await companiesService.updateActive({ name: "Clínica QA", cnpj: "12345678000199", phone: "", email: "" });
    expect(supabase.rpc).toHaveBeenCalledWith("update_active_company_admin", {
      p_name: "Clínica QA", p_cnpj: "12345678000199", p_phone: null, p_email: null,
    });
  });

  it("creates a unit without accepting a company id from the browser", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: {}, error: null } as never);
    await unitsService.save({ code: "QA01", name: "Unidade QA", type: "filial", active: true });
    expect(supabase.rpc).toHaveBeenCalledWith("upsert_active_company_unit_admin", {
      p_unit_id: null, p_code: "QA01", p_name: "Unidade QA", p_type: "filial", p_cnpj: null, p_active: true,
    });
  });

  it("does not hide authorization errors returned by the RPC", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: { message: "AAL2 required" } } as never);
    await expect(unitsService.save({ code: "QA01", name: "Unidade QA", type: "filial", active: true }))
      .rejects.toThrow("AAL2 required");
  });

  it("does not turn a rooms query failure into an empty catalog", async () => {
    const chain = {
      order: vi.fn(),
      eq: vi.fn().mockResolvedValue({ data: null, error: { message: "RLS denied" } }),
    };
    chain.order.mockReturnValue(chain);
    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnValue(chain),
    } as never);

    await expect(roomsService.getAll()).rejects.toThrow("Erro ao listar salas: RLS denied");
  });
});
