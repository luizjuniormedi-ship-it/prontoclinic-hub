import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke },
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

import { preCadastroService } from "@/services/preCadastroService";

const validForm = {
  full_name: "Maria de Souza",
  email: "MARIA@example.com",
  phone: "(11) 99999-9999",
  cpf: "529.982.247-25",
  birth_date: "1990-05-12",
  gender: "F" as const,
  cep: "01310-100",
  logradouro: "Avenida Paulista",
  numero: "1000",
  bairro: "Bela Vista",
  cidade: "Sao Paulo",
  uf: "SP" as const,
  lg_aceite_termo: true,
  versao_termo: "v1.0-2026-06-22",
};

describe("preCadastroService Edge contract", () => {
  beforeEach(() => {
    invoke.mockReset();
    sessionStorage.clear();
  });

  it("envia dados validados sem company_id, IP, token ou link", async () => {
    invoke.mockResolvedValue({ data: { accepted: true }, error: null });
    await expect(preCadastroService.criar(validForm, { companyId: "nao-deve-vazar" }))
      .resolves.toEqual({ accepted: true });
    expect(invoke).toHaveBeenCalledWith("pre-cadastro", {
      headers: { "Idempotency-Key": expect.stringMatching(/^[0-9a-f-]{36}$/i) },
      body: expect.objectContaining({
        action: "request",
        email: "maria@example.com",
        texto_termo_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    });
    const body = invoke.mock.calls[0][1].body;
    expect(body).not.toHaveProperty("company_id");
    expect(body).not.toHaveProperty("token");
    expect(body).not.toHaveProperty("linkConfirmacao");
    expect(body).not.toHaveProperty("ip_origem");
  });

  it("nao aceita resposta que exponha apenas payload legado", async () => {
    invoke.mockResolvedValue({ data: { r_token: "a".repeat(64) }, error: null });
    await expect(preCadastroService.criar(validForm)).rejects.toThrow("Resposta inválida");
  });

  it("reutiliza a chave de idempotencia depois de falha de entrega", async () => {
    invoke
      .mockResolvedValueOnce({ data: null, error: new Error("provider unavailable") })
      .mockResolvedValueOnce({ data: { accepted: true }, error: null });
    await expect(preCadastroService.criar(validForm)).rejects.toThrow("Tente novamente");
    await expect(preCadastroService.criar(validForm)).resolves.toEqual({ accepted: true });
    expect(invoke.mock.calls[0][1].headers["Idempotency-Key"])
      .toBe(invoke.mock.calls[1][1].headers["Idempotency-Key"]);
  });

  it("consulta e confirma pelo contrato Edge sem SELECT/RPC publico", async () => {
    invoke
      .mockResolvedValueOnce({ data: { status: "PENDENTE", expiresAt: "2030-01-01T00:00:00Z" }, error: null })
      .mockResolvedValueOnce({ data: { status: "CONFIRMADO" }, error: null });
    await expect(preCadastroService.buscarPorToken("a".repeat(64))).resolves.toEqual({
      status: "PENDENTE",
      dt_token_exp: "2030-01-01T00:00:00Z",
    });
    await expect(preCadastroService.confirmar("a".repeat(64))).resolves.toEqual({ status: "CONFIRMADO" });
    expect(invoke).toHaveBeenNthCalledWith(1, "pre-cadastro", { body: { action: "status", token: "a".repeat(64) } });
    expect(invoke).toHaveBeenNthCalledWith(2, "pre-cadastro", { body: { action: "confirm", token: "a".repeat(64) } });
  });

  it("reenvia no Edge autenticado e preserva a chave quando o provedor falha", async () => {
    invoke
      .mockResolvedValueOnce({ data: null, error: new Error("provider unavailable") })
      .mockResolvedValueOnce({ data: { accepted: true }, error: null });
    const id = "10000000-0000-4000-8000-000000000001";
    await expect(preCadastroService.reenviarEmail(id)).rejects.toThrow("Falha ao reenviar");
    await expect(preCadastroService.reenviarEmail(id)).resolves.toEqual({ accepted: true });
    expect(invoke.mock.calls[0][1].body).toEqual({ action: "resend", pre_cadastro_id: id });
    expect(invoke.mock.calls[0][1].headers["Idempotency-Key"])
      .toBe(invoke.mock.calls[1][1].headers["Idempotency-Key"]);
  });
});
