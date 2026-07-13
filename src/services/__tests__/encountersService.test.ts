import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

import { supabase } from "@/lib/supabase";
import {
  ENCOUNTER_MUTATION_BLOCK_REASON,
  encountersService,
  type Encounter,
} from "@/services/encountersService";

const encounter: Encounter = {
  id: "record-20",
  company_id: "company-1",
  patient_id: 10,
  professional_id: 30,
  appointment_id: 40,
  encounter_type: "Consulta",
  status: "signed",
  priority: "normal",
  chief_complaint: "Cefaleia",
  summary: "Evolução estável",
  signed_by_name: "Dra. Ana",
  signed_at: "2026-07-13T12:00:00Z",
  started_at: "2026-07-13T10:00:00Z",
  finished_at: "2026-07-13T12:00:00Z",
  created_at: "2026-07-13T10:00:00Z",
  patient_name: "Maria Souza",
};

function mockListResult(result: { data: Encounter[] | null; error: { message: string } | null }) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(result),
  };
  vi.mocked(supabase.from).mockReturnValue(builder as never);
  return builder;
}

function mockGetResult(result: { data: Encounter | null; error: { message: string } | null }) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  vi.mocked(supabase.from).mockReturnValue(builder as never);
  return builder;
}

describe("encountersService canonical read model", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lista atendimentos diretamente da view canônica", async () => {
    const query = mockListResult({ data: [encounter], error: null });

    await expect(encountersService.list()).resolves.toEqual([encounter]);

    expect(supabase.from).toHaveBeenCalledTimes(1);
    expect(supabase.from).toHaveBeenCalledWith("v_encounters_read_model");
    expect(query.select).toHaveBeenCalledWith("*");
    expect(query.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(query.limit).toHaveBeenCalledWith(200);
  });

  it("aplica filtros de status e paciente na view", async () => {
    const query = mockListResult({ data: [], error: null });

    await encountersService.list({ status: "legacy_locked", patient_id: 10 });

    expect(query.eq).toHaveBeenNthCalledWith(1, "status", "legacy_locked");
    expect(query.eq).toHaveBeenNthCalledWith(2, "patient_id", 10);
  });

  it("propaga erro de listagem com contexto", async () => {
    mockListResult({ data: null, error: { message: "view indisponível" } });

    await expect(encountersService.list()).rejects.toThrow(
      "Erro ao buscar atendimentos: view indisponível",
    );
  });

  it("obtém um atendimento pela mesma view", async () => {
    const query = mockGetResult({ data: encounter, error: null });

    await expect(encountersService.get("record-20")).resolves.toEqual(encounter);

    expect(supabase.from).toHaveBeenCalledWith("v_encounters_read_model");
    expect(query.eq).toHaveBeenCalledWith("id", "record-20");
    expect(query.maybeSingle).toHaveBeenCalledOnce();
  });

  it("retorna null quando o atendimento não existe", async () => {
    mockGetResult({ data: null, error: null });

    await expect(encountersService.get("missing")).resolves.toBeNull();
  });

  it("propaga erro da leitura individual com contexto", async () => {
    mockGetResult({ data: null, error: { message: "acesso negado" } });

    await expect(encountersService.get("record-20")).rejects.toThrow(
      "Erro ao buscar atendimento: acesso negado",
    );
  });
});

describe("encountersService clinical containment", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["create", () => encountersService.create({ patient_id: 10 })],
    ["update", () => encountersService.update("20", { summary: "texto clínico" })],
    ["sign", () => encountersService.sign("20")],
    ["access log", () => encountersService.logAccess(10, "abriu_prontuario")],
  ])("bloqueia %s sem executar DML direto", async (_operation, action) => {
    await expect(action()).rejects.toThrow(ENCOUNTER_MUTATION_BLOCK_REASON);
    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});

