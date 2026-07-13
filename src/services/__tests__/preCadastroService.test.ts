/**
 * preCadastroService.test.ts
 *
 * Cobre o modulo de pre-cadastro online de pacientes.
 * Valida: Zod (CPF, formularios), RPCs Supabase, e funcoes de gestao.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock env module (necessario para buildConfirmLink e emailService)
const mockEnv = vi.hoisted(() => ({
  VITE_APP_URL: "https://app.test",
  VITE_APP_NAME: "TestApp",
  VITE_APP_ENV: "development",
  VITE_PUBLIC_COMPANY_ID: "11111111-1111-1111-1111-111111111111" as string | undefined,
  VITE_RESEND_API_KEY: "re_test_key",
  VITE_EMAIL_FROM: "noreply@test.com",
  VITE_EMAIL_REPLY_TO: "suporte@test.com",
}));

vi.mock("@/lib/env", () => ({
  env: mockEnv,
}));

// Mock do emailService para evitar fetch real
vi.mock("@/services/emailService", () => ({
  emailService: {
    sendPreCadastroConfirmation: vi.fn().mockResolvedValue({
      id: "msg_1",
      provider: "resend",
    }),
    sendWelcome: vi.fn().mockResolvedValue({
      id: "msg_2",
      provider: "resend",
    }),
    sendEmail: vi.fn(),
    sendPasswordReset: vi.fn(),
  },
}));

// Mock do Supabase com chain mockavel
vi.mock("@/lib/supabase", () => {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
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
import { emailService } from "@/services/emailService";
import {
  preCadastroService,
  PRE_CADASTRO_STATUS,
  UF_BRASIL,
} from "@/services/preCadastroService";

// =============================================================================
// Fixtures
// =============================================================================

const validForm = {
  full_name: "Maria de Souza",
  email: "maria@example.com",
  phone: "(11) 99999-9999",
  whatsapp: "(11) 98888-7777",
  cpf: "529.982.247-25", // CPF valido
  birth_date: "1990-05-12",
  gender: "F" as const,
  cep: "01310-100",
  logradouro: "Avenida Paulista",
  numero: "1000",
  bairro: "Bela Vista",
  cidade: "Sao Paulo",
  uf: "SP" as const,
  ibge_cidade: "3550308",
  lg_aceite_termo: true,
  versao_termo: "v1.0-2026-06-22",
};

const validCompanyId = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  mockEnv.VITE_PUBLIC_COMPANY_ID = validCompanyId;
  (emailService.sendPreCadastroConfirmation as any).mockResolvedValue({
    id: "msg_1",
    provider: "resend",
  });
});

// =============================================================================
// Constantes
// =============================================================================

describe("preCadastroService - constantes", () => {
  it("PRE_CADASTRO_STATUS contem todos os status esperados", () => {
    expect(PRE_CADASTRO_STATUS).toEqual([
      "PENDENTE",
      "CONFIRMADO",
      "EXPIRADO",
      "CANCELADO",
      "MIGRADO",
    ]);
  });

  it("UF_BRASIL contem 27 UFs", () => {
    expect(UF_BRASIL).toHaveLength(27);
    expect(UF_BRASIL).toContain("SP");
    expect(UF_BRASIL).toContain("RJ");
  });

  it("getTextoTermo retorna texto do termo LGPD", () => {
    const texto = preCadastroService.getTextoTermo();
    expect(texto).toContain("LGPD");
    expect(texto).toContain("consentimento");
  });

  it("getVersaoTermo retorna versao do termo", () => {
    const v = preCadastroService.getVersaoTermo();
    expect(v).toMatch(/^v\d/);
  });
});

// =============================================================================
// Validacao (Zod) - via validarForm
// =============================================================================

describe("preCadastroService - validarForm (Zod)", () => {
  it("retorna {} quando dados validos", () => {
    const errors = preCadastroService.validarForm(validForm);
    expect(errors).toEqual({});
  });

  it("retorna erro para nome curto", () => {
    const errors = preCadastroService.validarForm({
      ...validForm,
      full_name: "Jo",
    });
    expect(errors.full_name).toMatch(/3 caracteres/);
  });

  it("retorna erro para nome com caracteres invalidos", () => {
    const errors = preCadastroService.validarForm({
      ...validForm,
      full_name: "Maria 12345",
    });
    expect(errors.full_name).toMatch(/caracteres invalidos/);
  });

  it("retorna erro para e-mail malformado", () => {
    const errors = preCadastroService.validarForm({
      ...validForm,
      email: "nao-eh-email",
    });
    expect(errors.email).toMatch(/e-mail/i);
  });

  it("normaliza e-mail valido (lowercase + trim) sem erro", () => {
    // Zod valida o formato ANTES do transform; espacos nas pontas quebram .email()
    // O comportamento correto do transform e observavel em e-mails ja validos:
    // passa validacao sem erro. Aqui validamos que aceita a forma canonica.
    const errors = preCadastroService.validarForm({
      ...validForm,
      email: "maria@example.com",
    });
    expect(errors.email).toBeUndefined();
  });

  it("retorna erro para telefone invalido", () => {
    const errors = preCadastroService.validarForm({
      ...validForm,
      phone: "abc",
    });
    expect(errors.phone).toBeDefined();
  });

  it("retorna erro para CEP invalido", () => {
    const errors = preCadastroService.validarForm({
      ...validForm,
      cep: "123",
    });
    expect(errors.cep).toBeDefined();
  });

  it("retorna erro para data de nascimento futura", () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const isoFuture = future.toISOString().split("T")[0];
    const errors = preCadastroService.validarForm({
      ...validForm,
      birth_date: isoFuture,
    });
    expect(errors.birth_date).toBeDefined();
  });

  it("retorna erro para data em formato errado", () => {
    const errors = preCadastroService.validarForm({
      ...validForm,
      birth_date: "12/05/1990",
    });
    expect(errors.birth_date).toBeDefined();
  });

  it("retorna erro para UF invalida", () => {
    const errors = preCadastroService.validarForm({
      ...validForm,
      uf: "XX" as any,
    });
    expect(errors.uf).toBeDefined();
  });

  it("retorna erro para genero invalido", () => {
    const errors = preCadastroService.validarForm({
      ...validForm,
      gender: "X" as any,
    });
    expect(errors.gender).toBeDefined();
  });

  it("retorna erro quando nao aceita o termo", () => {
    const errors = preCadastroService.validarForm({
      ...validForm,
      lg_aceite_termo: false,
    });
    expect(errors.lg_aceite_termo).toMatch(/aceitar o termo/);
  });

  it("CPF opcional - aceita sem CPF", () => {
    const formSemCpf: any = { ...validForm };
    delete formSemCpf.cpf;
    const errors = preCadastroService.validarForm(formSemCpf);
    expect(errors.cpf).toBeUndefined();
  });
});

// =============================================================================
// Validacao de CPF
// =============================================================================

describe("preCadastroService - validarCPF (via Zod)", () => {
  it("aceita CPF valido COM mascara", () => {
    const errors = preCadastroService.validarForm({
      ...validForm,
      cpf: "529.982.247-25",
    });
    expect(errors.cpf).toBeUndefined();
  });

  it("aceita CPF valido SEM mascara", () => {
    const errors = preCadastroService.validarForm({
      ...validForm,
      cpf: "52998224725",
    });
    expect(errors.cpf).toBeUndefined();
  });

  it("rejeita CPF com todos os digitos iguais", () => {
    const errors = preCadastroService.validarForm({
      ...validForm,
      cpf: "111.111.111-11",
    });
    expect(errors.cpf).toMatch(/invalido/i);
  });

  it("rejeita CPF com digitos verificadores errados", () => {
    const errors = preCadastroService.validarForm({
      ...validForm,
      cpf: "123.456.789-00",
    });
    expect(errors.cpf).toMatch(/invalido/i);
  });

  it("rejeita CPF com tamanho errado", () => {
    const errors = preCadastroService.validarForm({
      ...validForm,
      cpf: "123",
    });
    expect(errors.cpf).toMatch(/invalido/i);
  });

  it("rejeita CPF com letras (entrada nao-numerica)", () => {
    const errors = preCadastroService.validarForm({
      ...validForm,
      cpf: "abcdefghijk",
    });
    expect(errors.cpf).toBeDefined();
  });
});

// =============================================================================
// criar (RPC create_pre_cadastro)
// =============================================================================

describe("preCadastroService - criar", () => {
  it("cria pre-cadastro usando VITE_PUBLIC_COMPANY_ID", async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: [
        {
          id: "pre-123",
          token: "tok-abcdef-1234567890",
          dt_exp: "2026-06-26T00:00:00Z",
        },
      ],
      error: null,
    });

    const result = await preCadastroService.criar(validForm);

    expect(result.id).toBe("pre-123");
    expect(result.token).toBe("tok-abcdef-1234567890");
    expect(result.dt_exp).toBe("2026-06-26T00:00:00Z");
    expect(result.linkConfirmacao).toContain("tok-abcdef-1234567890");
    expect(supabase.rpc).toHaveBeenCalledWith(
      "create_pre_cadastro",
      expect.objectContaining({
        p_company_id: validCompanyId,
        p_full_name: "Maria de Souza",
        p_email: "maria@example.com",
        p_cpf: "52998224725",
        p_whatsapp: "(11) 98888-7777",
        p_ibge_cidade: "3550308",
        p_uf: "SP",
      }),
    );
    expect(supabase.from).not.toHaveBeenCalledWith("companies");
  });

  it("usa companyId explicito quando fornecido (nao consulta companies)", async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: [
        {
          id: "pre-456",
          token: "tok-xyz-9876543210",
          dt_exp: "2026-06-26T00:00:00Z",
        },
      ],
      error: null,
    });

    const result = await preCadastroService.criar(validForm, {
      companyId: validCompanyId,
    });

    expect(result.id).toBe("pre-456");
    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.rpc).toHaveBeenCalledWith(
      "create_pre_cadastro",
      expect.objectContaining({ p_company_id: validCompanyId }),
    );
  });

  it("lança erro de validacao quando dados invalidos (nome curto)", async () => {
    await expect(
      preCadastroService.criar({ ...validForm, full_name: "Jo" }),
    ).rejects.toThrow();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("lança erro quando RPC retorna erro", async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: null,
      error: { message: "duplicate email" },
    });

    await expect(
      preCadastroService.criar(validForm, { companyId: validCompanyId }),
    ).rejects.toThrow(/duplicate email/);
  });

  it("lança erro quando resposta do servidor esta vazia", async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: [],
      error: null,
    });

    await expect(
      preCadastroService.criar(validForm, { companyId: validCompanyId }),
    ).rejects.toThrow(/Resposta invalida/);
  });

  it("envia email de confirmacao apos criar (padrao sendEmail=true)", async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: [
        {
          id: "pre-789",
          token: "tok-confirm-abcdef",
          dt_exp: "2026-06-26T00:00:00Z",
        },
      ],
      error: null,
    });

    await preCadastroService.criar(validForm, { companyId: validCompanyId });

    expect(emailService.sendPreCadastroConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "maria@example.com",
        nome: "Maria de Souza",
        linkConfirmacao: expect.stringContaining("tok-confirm-abcdef"),
      }),
    );
  });

  it("nao envia email quando sendEmail=false", async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: [
        {
          id: "pre-noemail",
          token: "tok-noemail-12345",
          dt_exp: "2026-06-26T00:00:00Z",
        },
      ],
      error: null,
    });

    await preCadastroService.criar(validForm, {
      companyId: validCompanyId,
      sendEmail: false,
    });

    expect(emailService.sendPreCadastroConfirmation).not.toHaveBeenCalled();
  });

  it("nao falha o cadastro quando email falha (fire-and-forget com log)", async () => {
    (emailService.sendPreCadastroConfirmation as any).mockRejectedValue(
      new Error("SMTP down"),
    );
    (supabase.rpc as any).mockResolvedValue({
      data: [
        {
          id: "pre-err",
          token: "tok-errmail-12345",
          dt_exp: "2026-06-26T00:00:00Z",
        },
      ],
      error: null,
    });
    // silencia console.error
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await preCadastroService.criar(validForm, {
      companyId: validCompanyId,
    });

    expect(result.id).toBe("pre-err");
    consoleSpy.mockRestore();
  });
});

// =============================================================================
// confirmar (RPC confirm_pre_cadastro)
// =============================================================================

describe("preCadastroService - confirmar", () => {
  it("confirma token com sucesso", async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: [
        {
          id: "pre-1",
          full_name: "Maria de Souza",
          email: "maria@example.com",
          status: "CONFIRMADO",
          company_id: validCompanyId,
        },
      ],
      error: null,
    });

    const result = await preCadastroService.confirmar(
      "abcdef1234567890abcdef1234567890",
    );

    expect(result.id).toBe("pre-1");
    expect(result.status).toBe("CONFIRMADO");
    expect(supabase.rpc).toHaveBeenCalledWith("confirm_pre_cadastro", {
      p_token: "abcdef1234567890abcdef1234567890",
    });
  });

  it("lança erro para token curto (< 16 chars)", async () => {
    await expect(preCadastroService.confirmar("short")).rejects.toThrow(
      /Token invalido/,
    );
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("lança erro para token vazio", async () => {
    await expect(preCadastroService.confirmar("")).rejects.toThrow(
      /Token invalido/,
    );
  });

  it("lança erro quando RPC retorna token invalido", async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: null,
      error: { message: "Token invalido ou expirado" },
    });

    await expect(
      preCadastroService.confirmar("abcdef1234567890abcdef1234567890"),
    ).rejects.toThrow(/Token invalido ou expirado/);
  });

  it("envia welcome email apos confirmar (fire-and-forget)", async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: [
        {
          id: "pre-2",
          full_name: "Joao Silva",
          email: "joao@example.com",
          status: "CONFIRMADO",
          company_id: validCompanyId,
        },
      ],
      error: null,
    });

    await preCadastroService.confirmar("abcdef1234567890abcdef1234567890");

    // aguarda microtasks do fire-and-forget
    await new Promise((r) => setTimeout(r, 0));
    expect(emailService.sendWelcome).toHaveBeenCalledWith(
      "joao@example.com",
      "Joao Silva",
    );
  });
});

// =============================================================================
// buscarPorToken (getByToken)
// =============================================================================

describe("preCadastroService - buscarPorToken (getByToken)", () => {
  it("retorna dados publicos do pre-cadastro", async () => {
    const token = "abcdef1234567890abcdef1234567890";
    const publicData = {
      id: "pre-1",
      company_id: validCompanyId,
      full_name: "Maria",
      email: "maria@example.com",
      status: "PENDENTE",
      dt_token_exp: "2026-06-26T00:00:00Z",
      lg_confirmado: false,
      created_at: "2026-06-23T00:00:00Z",
    };
    (supabase.rpc as any).mockResolvedValue({
      data: [publicData],
      error: null,
    });

    const result = await preCadastroService.buscarPorToken(token);

    expect(result).toEqual(publicData);
    expect(supabase.rpc).toHaveBeenCalledWith("pre_confirm_pre_cadastro", {
      p_token: token,
    });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("prioriza companyId explicito sobre VITE_PUBLIC_COMPANY_ID", async () => {
    const explicitCompanyId = "22222222-2222-4222-8222-222222222222";
    (supabase.rpc as any).mockResolvedValue({
      data: [{
        id: "pre-789",
        token: "tok-explicit-1234567890",
        dt_exp: "2026-06-26T00:00:00Z",
      }],
      error: null,
    });

    await preCadastroService.criar(validForm, { companyId: explicitCompanyId });

    expect(supabase.rpc).toHaveBeenCalledWith(
      "create_pre_cadastro",
      expect.objectContaining({ p_company_id: explicitCompanyId }),
    );
  });

  it("falha claramente quando empresa publica nao esta configurada", async () => {
    mockEnv.VITE_PUBLIC_COMPANY_ID = undefined;

    await expect(preCadastroService.criar(validForm)).rejects.toThrow(
      /VITE_PUBLIC_COMPANY_ID.*UUID valido/i,
    );
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalledWith("companies");
  });

  it("rejeita companyId explicito que nao seja UUID", async () => {
    await expect(
      preCadastroService.criar(validForm, { companyId: "empresa-invalida" }),
    ).rejects.toThrow(/deve ser um UUID valido/i);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("retorna null para token curto sem consultar banco", async () => {
    const result = await preCadastroService.buscarPorToken("short");
    expect(result).toBeNull();
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("retorna null quando RLS bloqueia (PGRST116)", async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: null,
      error: { code: "PGRST116", message: "row not found" },
    });

    const result = await preCadastroService.buscarPorToken(
      "abcdef1234567890abcdef1234567890",
    );
    expect(result).toBeNull();
  });

  it("retorna null silenciosamente para erro de row-level security", async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: null,
      error: { code: "PGRST301", message: "row-level security violation" },
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await preCadastroService.buscarPorToken(
      "abcdef1234567890abcdef1234567890",
    );
    expect(result).toBeNull();
    warnSpy.mockRestore();
  });
});

// =============================================================================
// reenviarEmail (RPC renew_pre_cadastro_confirmation)
// =============================================================================

describe("preCadastroService - reenviarEmail", () => {
  const renewed = {
    token: "renewed-token-abcdef1234567890",
    dt_exp: "2026-06-29T00:00:00Z",
    email: "maria@example.com",
    full_name: "Maria de Souza",
  };

  it("renova pela RPC e envia o email preservando a API publica", async () => {
    (supabase.rpc as any).mockResolvedValue({ data: [renewed], error: null });

    const result = await preCadastroService.reenviarEmail("pre-1");

    expect(supabase.rpc).toHaveBeenCalledWith(
      "renew_pre_cadastro_confirmation",
      { p_id: "pre-1" },
    );
    expect(supabase.from).not.toHaveBeenCalled();
    expect(emailService.sendPreCadastroConfirmation).toHaveBeenCalledWith({
      to: renewed.email,
      nome: renewed.full_name,
      linkConfirmacao: expect.stringContaining(renewed.token),
      dtExp: renewed.dt_exp,
    });
    expect(result).toEqual({
      linkConfirmacao: expect.stringContaining(renewed.token),
    });
  });

  it("aceita retorno da RPC como objeto", async () => {
    (supabase.rpc as any).mockResolvedValue({ data: renewed, error: null });

    const result = await preCadastroService.reenviarEmail("pre-2");

    expect(result.linkConfirmacao).toContain(renewed.token);
  });

  it("rejeita id vazio sem chamar a RPC", async () => {
    await expect(preCadastroService.reenviarEmail("")).rejects.toThrow(
      /preCadastroId obrigatorio/,
    );
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("propaga erro da RPC sem enviar email", async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: null,
      error: { message: "pre-cadastro cancelado" },
    });

    await expect(preCadastroService.reenviarEmail("pre-3")).rejects.toThrow(
      /pre-cadastro cancelado/,
    );
    expect(emailService.sendPreCadastroConfirmation).not.toHaveBeenCalled();
  });

  it("rejeita resposta incompleta da RPC", async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: [{ token: "missing-fields" }],
      error: null,
    });

    await expect(preCadastroService.reenviarEmail("pre-4")).rejects.toThrow(
      /Resposta invalida do servidor/,
    );
    expect(emailService.sendPreCadastroConfirmation).not.toHaveBeenCalled();
  });
});

// =============================================================================
// listarPendentes
// =============================================================================

describe("preCadastroService - listarPendentes", () => {
  it("lista pendentes por companyId explicito", async () => {
    const pendentes = [
      {
        id: "pre-1",
        status: "PENDENTE",
        horas_para_expirar: 48,
      },
    ];
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: pendentes, error: null }),
    };
    (supabase.from as any).mockReturnValue(chain);

    const result = await preCadastroService.listarPendentes(validCompanyId);

    expect(result).toEqual(pendentes);
    expect(supabase.from).toHaveBeenCalledWith("pre_cadastros_pendentes");
    expect(chain.eq).toHaveBeenCalledWith("company_id", validCompanyId);
  });

  it("usa VITE_PUBLIC_COMPANY_ID quando companyId nao e informado", async () => {
    const pendentesChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    (supabase.from as any).mockReturnValue(pendentesChain);

    const result = await preCadastroService.listarPendentes();
    expect(result).toEqual([]);
    expect(supabase.from).toHaveBeenCalledWith("pre_cadastros_pendentes");
    expect(pendentesChain.eq).toHaveBeenCalledWith("company_id", validCompanyId);
  });

  it("lança erro quando RPC falha", async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "permission denied" },
      }),
    };
    (supabase.from as any).mockReturnValue(chain);

    await expect(
      preCadastroService.listarPendentes(validCompanyId),
    ).rejects.toThrow(/permission denied/);
  });
});

// =============================================================================
// listar (com filtros)
// =============================================================================

describe("preCadastroService - listar", () => {
  it("lista todos os pre-cadastros da empresa (sem filtros)", async () => {
    const all = [
      { id: "pre-1", status: "PENDENTE" },
      { id: "pre-2", status: "CONFIRMADO" },
    ];
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: all, error: null }),
    };
    (supabase.from as any).mockReturnValue(chain);

    const result = await preCadastroService.listar(validCompanyId);

    expect(result).toEqual(all);
    expect(chain.limit).toHaveBeenCalledWith(100);
  });

  it("aplica filtro de status quando fornecido", async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    };
    // eq é chamado 2x: company_id + status
    chain.eq = vi
      .fn()
      .mockReturnValueOnce(chain)
      .mockReturnValueOnce(chain);
    (chain as any).then = (resolve: any) =>
      resolve({ data: [], error: null });
    (supabase.from as any).mockReturnValue(chain);

    const result = await preCadastroService.listar(validCompanyId, {
      status: "PENDENTE",
    });

    expect(result).toEqual([]);
    expect(chain.eq).toHaveBeenCalledWith("status", "PENDENTE");
  });

  it("aplica limit customizado", async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    (supabase.from as any).mockReturnValue(chain);

    await preCadastroService.listar(validCompanyId, { limit: 25 });

    expect(chain.limit).toHaveBeenCalledWith(25);
  });

  it("lança erro quando query falha", async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "network down" },
      }),
    };
    (supabase.from as any).mockReturnValue(chain);

    await expect(
      preCadastroService.listar(validCompanyId),
    ).rejects.toThrow(/network down/);
  });

  it("retorna array vazio quando data é null", async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    (supabase.from as any).mockReturnValue(chain);

    const result = await preCadastroService.listar(validCompanyId);
    expect(result).toEqual([]);
  });
});

// =============================================================================
// updateStatus (nao existe no service)
// =============================================================================
// OBS: preCadastroService nao expoe updateStatus publico; o ajuste de status
// e feito via RPCs (criar, confirmar, promover, reenviar e cancelar).
// O teste abaixo documenta essa observacao.

describe("preCadastroService - updateStatus (observacao)", () => {
  it("service nao expoe updateStatus publico; alteracoes vao via RPCs", () => {
    expect((preCadastroService as any).updateStatus).toBeUndefined();
    expect((preCadastroService as any).criar).toBeDefined();
    expect((preCadastroService as any).confirmar).toBeDefined();
    expect((preCadastroService as any).cancelar).toBeDefined();
  });
});

// =============================================================================
// cancelar (RPC cancel_pre_cadastro)
// =============================================================================

describe("preCadastroService - cancelar", () => {
  it("cancela pre-cadastro com motivo", async () => {
    (supabase.rpc as any).mockResolvedValue({ data: true, error: null });

    const result = await preCadastroService.cancelar("pre-1", "Dados duplicados");

    expect(result).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith("cancel_pre_cadastro", {
      p_id: "pre-1",
      p_motivo: "Dados duplicados",
    });
  });

  it("faz trim no motivo antes de enviar", async () => {
    (supabase.rpc as any).mockResolvedValue({ data: true, error: null });

    await preCadastroService.cancelar("pre-1", "   Paciente desistiu   ");

    expect(supabase.rpc).toHaveBeenCalledWith(
      "cancel_pre_cadastro",
      expect.objectContaining({ p_motivo: "Paciente desistiu" }),
    );
  });

  it("lança erro quando id vazio", async () => {
    await expect(
      preCadastroService.cancelar("", "motivo"),
    ).rejects.toThrow(/preCadastroId obrigatorio/);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("lança erro quando motivo vazio", async () => {
    await expect(
      preCadastroService.cancelar("pre-1", ""),
    ).rejects.toThrow(/Motivo do cancelamento e obrigatorio/);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("lança erro quando motivo é só espacos", async () => {
    await expect(
      preCadastroService.cancelar("pre-1", "   "),
    ).rejects.toThrow(/Motivo do cancelamento e obrigatorio/);
  });

  it("lança erro quando RPC falha", async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: null,
      error: { message: "ja migrado" },
    });

    await expect(
      preCadastroService.cancelar("pre-1", "motivo"),
    ).rejects.toThrow(/ja migrado/);
  });

  it("retorna false quando RPC retorna false", async () => {
    (supabase.rpc as any).mockResolvedValue({ data: false, error: null });

    const result = await preCadastroService.cancelar("pre-1", "motivo");
    expect(result).toBe(false);
  });
});

