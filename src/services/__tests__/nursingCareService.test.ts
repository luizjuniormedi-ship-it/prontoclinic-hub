import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, getUser, tables } = vi.hoisted(() => ({
  from: vi.fn(),
  getUser: vi.fn(),
  tables: new Map<string, Record<string, ReturnType<typeof vi.fn>>>(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from,
    auth: { getUser },
    rpc: vi.fn(),
  },
}));

import { nursingCareService } from "@/services/nursingCareService";

function tableChain(name: string) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(),
    single: vi.fn(),
  };
  tables.set(name, chain);
  return chain;
}

describe("nursingCareService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tables.clear();
    getUser.mockResolvedValue({
      data: { user: { id: "11111111-1111-1111-1111-111111111111" } },
      error: null,
    });
    from.mockImplementation((name: string) => tables.get(name) ?? tableChain(name));
  });

  it("grava intercorrencia na unidade principal e sem ator fixo", async () => {
    tableChain("professionals").maybeSingle.mockResolvedValue({ data: { id: 44 }, error: null });
    tableChain("user_profiles").maybeSingle.mockResolvedValue({ data: { primary_unit_id: 7 }, error: null });
    const incident = tableChain("nursing_incidents");
    incident.single.mockResolvedValue({
      data: { id: 1, unit_id: 7, patient_id: 10 },
      error: null,
    });

    await nursingCareService.createIncident({
      patient_id: 10,
      incident_type: "queda",
      severity: "moderada",
      description: "Teste sintetico",
    });

    expect(incident.insert).toHaveBeenCalledWith(expect.objectContaining({
      unit_id: 7,
      reported_by: 44,
      patient_id: 10,
    }));
  });

  it("falha fechado quando o perfil nao possui unidade principal", async () => {
    tableChain("professionals").maybeSingle.mockResolvedValue({ data: { id: 44 }, error: null });
    tableChain("user_profiles").maybeSingle.mockResolvedValue({ data: { primary_unit_id: null }, error: null });

    await expect(nursingCareService.createProcedure({
      patient_id: 10,
      procedure_type: "curativo",
    })).rejects.toThrow("Unidade principal obrigatoria");
  });
});
