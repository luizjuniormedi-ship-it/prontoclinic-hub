import { describe, it, expect, vi, beforeEach } from "vitest";
import { validatePatient, stripNonDigits, patientsService } from "@/services/patientsService";

// Mock do Supabase
vi.mock("@/lib/supabase", () => {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(),
    single: vi.fn(),
  };
  return {
    supabase: {
      from: vi.fn(() => chain),
      auth: { getUser: vi.fn() },
      rpc: vi.fn(),
    },
  };
});

import { supabase } from "@/lib/supabase";

describe("patientsService — validatePatient", () => {
  it("retorna erro quando nome curto (< 2 chars)", () => {
    const err = validatePatient({ name: "A" });
    expect(err).toMatch(/mínimo 2 caracteres/i);
  });

  it("retorna null para paciente válido (CPF, nome, data, e-mail)", () => {
    const err = validatePatient({
      name: "Maria de Souza",
      cpf: "123.456.789-09",
      birthDate: "1990-05-12",
      email: "maria@example.com",
    });
    expect(err).toBeNull();
  });

  it("retorna erro quando nome > 200 chars", () => {
    const longName = "A".repeat(201);
    const err = validatePatient({ name: longName });
    expect(err).toMatch(/no máximo 200 caracteres/i);
  });

  it("retorna erro para data de nascimento futura", () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const isoFuture = future.toISOString().split("T")[0];
    const err = validatePatient({
      name: "João Silva",
      birthDate: isoFuture,
    });
    expect(err).toMatch(/data de nascimento inválida/i);
  });

  it("retorna erro para CPF inválido (com letras)", () => {
    const err = validatePatient({
      name: "João Silva",
      cpf: "abc.def.ghi-jk",
    });
    expect(err).toMatch(/cpf/i);
  });

  it("retorna erro para e-mail mal formado", () => {
    const err = validatePatient({
      name: "João Silva",
      email: "nao-eh-email",
    });
    expect(err).toMatch(/e-mail/i);
  });

  it("ignora CPF e e-mail ausentes (campos opcionais)", () => {
    expect(validatePatient({ name: "Maria de Souza" })).toBeNull();
  });
});

describe("patientsService — stripNonDigits", () => {
  it("remove caracteres não numéricos de CPF formatado", () => {
    expect(stripNonDigits("123.456.789-09")).toBe("12345678909");
  });

  it("retorna string vazia quando entrada vazia", () => {
    expect(stripNonDigits("")).toBe("");
  });

  it("preserva números puros", () => {
    expect(stripNonDigits("11999887766")).toBe("11999887766");
  });
});

describe("patientsService — getAll (mapeamento)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mapeia linhas do banco (snake_case) para Patient (camelCase)", async () => {
    const dbRow = {
      id: 42,
      company_id: "company-uuid",
      full_name: "Maria de Souza",
      cpf: "12345678909",
      birth_date: "1990-05-12",
      phone: "11999887766",
      email: "maria@example.com",
      sex: "F",
      insurance_plan_id: 7,
      insurance_card_number: "12345",
      allergies: "nenhuma",
      clinical_alerts: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
    };
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [dbRow], error: null }),
    };
    (supabase.from as any).mockReturnValue(chain);

    const result = await patientsService.getAll();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(42);
    expect(result[0].name).toBe("Maria de Souza");
    expect(result[0].cpf).toBe("12345678909");
    expect(result[0].birthDate).toBe("1990-05-12");
    expect(result[0].gender).toBe("F");
    expect(result[0].healthInsurance).toBe(7);
    expect(result[0].healthInsuranceNumber).toBe("12345");
    expect(result[0].createdAt).toBe("2026-01-01T00:00:00Z");
  });

  it("getById retorna null quando não encontrado", async () => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    (supabase.from as any).mockReturnValue(chain);

    const result = await patientsService.getById("inexistente");
    expect(result).toBeNull();
  });

  it("checkCpfExists retorna true quando já cadastrado", async () => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      then: undefined,
    };
    (chain as any).then = (resolve: any) =>
      resolve({ data: [{ id: 99 }], error: null });
    (supabase.from as any).mockReturnValue(chain);

    const exists = await patientsService.checkCpfExists("123.456.789-09");
    expect(exists).toBe(true);
  });

  it("create normaliza CPF e telefone", async () => {
    const insertSpy = vi.fn().mockReturnThis();
    const chain: any = {
      insert: insertSpy,
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: "p1", full_name: "Ana" }, error: null }),
    };
    (supabase.from as any).mockReturnValue(chain);
    await patientsService.create({ name: "Ana", cpf: "123.456.789-09", phone: "(21) 99999-0000" } as any);
    expect(insertSpy.mock.calls[0][0]).toMatchObject({ cpf: "12345678909", phone: "21999990000" });
  });

  it("create converte duplicidade em erro de domínio", async () => {
    const chain: any = {
      insert: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { code: "23505", message: "duplicate" } }),
    };
    (supabase.from as any).mockReturnValue(chain);
    await expect(patientsService.create({ name: "Ana", cpf: "12345678909" } as any)).rejects.toThrow(/Já existe/);
  });

  it("update e delete propagam operações", async () => {
    const updateChain: any = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { id: "p1", full_name: "Ana" }, error: null }) };
    (supabase.from as any).mockReturnValueOnce(updateChain);
    await patientsService.update("p1", { name: "Ana" });
    expect(updateChain.eq).toHaveBeenCalledWith("id", "p1");
    const deleteChain: any = { delete: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ error: null }) };
    (supabase.from as any).mockReturnValueOnce(deleteChain);
    await patientsService.delete("p1");
    expect(deleteChain.eq).toHaveBeenCalledWith("id", "p1");
  });

  it("search vazio delega para getAll", async () => {
    const chain: any = { select: vi.fn().mockReturnThis(), order: vi.fn().mockResolvedValue({ data: [], error: null }) };
    (supabase.from as any).mockReturnValue(chain);
    await expect(patientsService.search("   ")).resolves.toEqual([]);
  });
});
