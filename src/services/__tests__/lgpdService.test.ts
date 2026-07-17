import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  lgpdService,
  CANAL,
  POLITICA_PADRAO,
  TEXTO_TERMO_CONSENTIMENTO,
  TIPO_SOLICITACAO,
} from "@/services/lgpdService";

vi.mock("@/lib/supabase", () => {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(),
    single: vi.fn(),
  };
  return {
    supabase: {
      from: vi.fn(() => chain),
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
      },
      rpc: vi.fn(),
    },
  };
});

import { supabase } from "@/lib/supabase";

describe("lgpdService — updateConsentimento", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("aceita canais válidos (1=SMS, 2=EMAIL, 3=WHATSAPP, 4=PUSH)", async () => {
    (supabase.from as any).mockImplementation(() => ({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockImplementation((query: any) => {
        // O canal é injetado via payload.insert, não via select — simulamos
        // que o `select().single()` devolve o registro que acabou de ser
        // inserido. Capturamos via spy no insert.
        return Promise.resolve({
          data: {
            id: 1,
            cd_paciente: 1,
            cd_canal: 0,
            lg_optin: true,
            dt_optin: "2026-06-22T00:00:00Z",
            versao_termo: "v1.0-2026-06-22",
            texto_termo_hash: "abc",
          },
          error: null,
        });
      }),
    }));

    // Verificamos via spy do insert que o cd_canal correto foi enviado
    const insertSpy = vi.fn().mockReturnThis();
    (supabase.from as any).mockImplementation(() => ({
      insert: insertSpy,
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 1, cd_paciente: 1, lg_optin: true },
        error: null,
      }),
    }));

    for (const canal of [CANAL.SMS, CANAL.EMAIL, CANAL.WHATSAPP, CANAL.PUSH]) {
      insertSpy.mockClear();
      await lgpdService.updateConsentimento(
        1,
        canal,
        true,
        "127.0.0.1",
        "Mozilla/5.0",
      );
      const payload = insertSpy.mock.calls[0][0];
      expect(payload.cd_canal).toBe(canal);
    }
  });

  it("rejeita canal inválido (ex: 99)", async () => {
    await expect(
      lgpdService.updateConsentimento(1, 99 as any, true),
    ).rejects.toThrow();
  });

  it("captura ip e user_agent quando fornecidos", async () => {
    const insertSpy = vi.fn().mockReturnThis();
    (supabase.from as any).mockReturnValue({
      insert: insertSpy,
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 1, cd_canal: CANAL.EMAIL, lg_optin: true },
        error: null,
      }),
    });

    await lgpdService.updateConsentimento(
      1,
      CANAL.EMAIL,
      true,
      "192.168.1.1",
      "Chrome/120",
    );
    const payload = insertSpy.mock.calls[0][0];
    expect(payload.ip_origem).toBe("192.168.1.1");
    expect(payload.user_agent).toBe("Chrome/120");
  });

  it("marca dt_revocacao quando optin=false", async () => {
    const insertSpy = vi.fn().mockReturnThis();
    (supabase.from as any).mockReturnValue({
      insert: insertSpy,
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 1, lg_optin: false },
        error: null,
      }),
    });

    await lgpdService.updateConsentimento(1, CANAL.SMS, false);
    const payload = insertSpy.mock.calls[0][0];
    expect(payload.dt_revocacao).toBeDefined();
    expect(payload.motivo_revocacao).toBe("OPT_OUT_PELO_TITULAR");
  });
});

describe("lgpdService — requestAcesso (prazo 15 dias)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cria solicitação com dt_prazo 15 dias após dt_solicitacao", async () => {
    // user_profiles lookup
    const profileChain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { company_id: "company-uuid" },
        error: null,
      }),
    };
    const insertSpy = vi.fn().mockReturnThis();
    const solicitacaoChain: any = {
      insert: insertSpy,
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: 1,
          cd_paciente: 1,
          tipo: "ACESSO",
          status: "PENDENTE",
          dt_solicitacao: new Date().toISOString(),
          dt_prazo: new Date(Date.now() + 15 * 86400_000).toISOString(),
        },
        error: null,
      }),
    };
    (supabase.from as any)
      .mockReturnValueOnce(profileChain) // user_profiles
      .mockReturnValueOnce(solicitacaoChain); // lgpd_solicitacoes

    const result = await lgpdService.requestAcesso(1, "10.0.0.1");
    expect(result.tipo).toBe("ACESSO");
    expect(result.status).toBe("PENDENTE");
    const payload = insertSpy.mock.calls[0][0];
    const dtSolicitacao = new Date(payload.dt_solicitacao).getTime();
    const dtPrazo = new Date(payload.dt_prazo).getTime();
    const diffDays = Math.round((dtPrazo - dtSolicitacao) / 86400_000);
    expect(diffDays).toBe(15);
    expect(payload.ip_origem).toBe("10.0.0.1");
  });

  it("rejeita patientId inválido (negativo/zero)", async () => {
    await expect(lgpdService.requestAcesso(0)).rejects.toThrow(/patientId/);
    await expect(lgpdService.requestAcesso(-1)).rejects.toThrow(/patientId/);
  });
});

describe("lgpdService — requestEsquecimento", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("valida motivo válido", async () => {
    const profileChain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { company_id: "company-uuid" },
        error: null,
      }),
    };
    const insertChain: any = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 1, tipo: "ESQUECIMENTO", status: "PENDENTE" },
        error: null,
      }),
    };
    (supabase.from as any)
      .mockReturnValueOnce(profileChain)
      .mockReturnValueOnce(insertChain);
    (supabase.rpc as any).mockResolvedValue({
      data: { ok: true, paciente_anonimizado: true },
      error: null,
    });

    const result = await lgpdService.requestEsquecimento(
      1,
      "EXERCICIO_DIREITO_ESQUECIMENTO",
    );
    expect(result.solicitacao.tipo).toBe("ESQUECIMENTO");
    expect(result.anonimizacao).toBeDefined();
  });

  it("rejeita motivo inválido", async () => {
    await expect(
      lgpdService.requestEsquecimento(1, "MOTIVO_INEXISTENTE" as any),
    ).rejects.toThrow();
  });
});

describe("lgpdService — exportarDados", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna payload JSON estruturado com seções vazias quando paciente sem dados", async () => {
    const emptyChain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      then: undefined,
    };
    (emptyChain as any).then = (resolve: any) =>
      resolve({ data: [], error: null });
    // Para a query principal do paciente (maybeSingle) e as outras (array)
    let callCount = 0;
    (supabase.from as any).mockImplementation(() => {
      if (callCount === 0) {
        callCount++;
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }
      return emptyChain;
    });

    const payload = await lgpdService.exportarDados(1);
    expect(payload.versao).toBe("1.0");
    expect(payload.gerado_em).toBeDefined();
    expect(payload.agendamentos).toEqual([]);
    expect(payload.prontuarios).toEqual([]);
    expect(payload.exames).toEqual([]);
    expect(payload.financeiro).toEqual([]);
    expect(payload.consentimentos).toEqual([]);
    expect(payload.logs_auditoria).toEqual([]);
  });

  it("rejeita patientId inválido", async () => {
    await expect(lgpdService.exportarDados(0)).rejects.toThrow(/patientId/);
  });
});

describe("lgpdService — política de retenção", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getPoliticaRetencao retorna [] quando vazio", async () => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
    };
    (chain as any).then = (resolve: any) => resolve({ data: [], error: null });
    (supabase.from as any).mockReturnValue(chain);

    const result = await lgpdService.getPoliticaRetencao("company-uuid");
    expect(result).toEqual([]);
  });

  it("setPoliticaRetencao rejeita dias > 100 anos (36500)", async () => {
    await expect(
      lgpdService.setPoliticaRetencao(
        "company-uuid",
        "patients",
        99999,
        "ARQUIVAR",
      ),
    ).rejects.toThrow();
  });

  it("setPoliticaRetencao rejeita companyId inválido (não-UUID)", async () => {
    await expect(
      lgpdService.setPoliticaRetencao(
        "not-a-uuid",
        "patients",
        1825,
        "ARQUIVAR",
      ),
    ).rejects.toThrow(/uuid/i);
  });

  it("seedPoliticaPadrao insere 5 entradas (audit, appointments, records, financial, notifications)", async () => {
    const upsertSpy = vi.fn().mockReturnThis();
    (supabase.from as any).mockReturnValue({
      upsert: upsertSpy,
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 1, dias_retencao: 1825 },
        error: null,
      }),
    });

    // UUID válido (Zod exige formato UUID v4)
    const validUuid = "550e8400-e29b-41d4-a716-446655440000";
    await lgpdService.seedPoliticaPadrao(validUuid);
    expect(upsertSpy).toHaveBeenCalledTimes(POLITICA_PADRAO.length);
    expect(POLITICA_PADRAO.length).toBe(5);
    // 5 anos = 1825 dias em audit_logs
    const auditCall = upsertSpy.mock.calls.find(
      (c: any[]) => c[0]?.tabela === "audit_logs",
    );
    expect(auditCall).toBeDefined();
    expect(auditCall?.[0]?.dias_retencao).toBe(1825);
  });
});

describe("lgpdService — hash SHA-256 do termo", () => {
  it("hash de TEXTO_TERMO_CONSENTIMENTO é determinístico e 64 chars hex", async () => {
    // Testa o hash indiretamente via updateConsentimento (que chama hashTermo)
    const insertSpy = vi.fn().mockReturnThis();
    (supabase.from as any).mockReturnValue({
      insert: insertSpy,
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 1, lg_optin: true, cd_canal: CANAL.EMAIL },
        error: null,
      }),
    });

    await lgpdService.updateConsentimento(1, CANAL.EMAIL, true);
    const payload = insertSpy.mock.calls[0][0];
    expect(payload.texto_termo_hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("lgpdService — constantes", () => {
  it("CANAL exporta 4 códigos", () => {
    expect(Object.keys(CANAL)).toHaveLength(4);
    expect(CANAL.SMS).toBe(1);
    expect(CANAL.EMAIL).toBe(2);
    expect(CANAL.WHATSAPP).toBe(3);
    expect(CANAL.PUSH).toBe(4);
  });

  it("TIPO_SOLICITACAO cobre 5 direitos do art. 18 LGPD", () => {
    expect(TIPO_SOLICITACAO).toEqual([
      "ACESSO",
      "PORTABILIDADE",
      "CORRECAO",
      "ESQUECIMENTO",
      "REVOGACAO",
    ]);
  });

  it("TEXTO_TERMO_CONSENTIMENTO menciona LGPD 13.709/2018", () => {
    expect(TEXTO_TERMO_CONSENTIMENTO).toMatch(/13\.709\/2018/);
  });
});

describe("lgpdService — consultas e anonimização em massa", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("lista consentimentos ordenados e preserva os registros retornados", async () => {
    const consentimentos = [
      { id: 1, cd_paciente: 7, cd_canal: CANAL.EMAIL, lg_optin: true },
    ];
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
    };
    chain.then = (resolve: any) => resolve({ data: consentimentos, error: null });
    (supabase.from as any).mockReturnValue(chain);

    await expect(lgpdService.getConsentimentos(7)).resolves.toEqual(consentimentos);
    expect(chain.eq).toHaveBeenCalledWith("cd_paciente", 7);
    expect(chain.order).toHaveBeenNthCalledWith(1, "cd_canal", { ascending: true });
    expect(chain.order).toHaveBeenNthCalledWith(2, "dt_optin", { ascending: false });
  });

  it("aplica filtro de status ao listar solicitações", async () => {
    const solicitacoes = [{ id: 8, status: "PENDENTE" }];
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    };
    chain.then = (resolve: any) => resolve({ data: solicitacoes, error: null });
    (supabase.from as any).mockReturnValue(chain);

    await expect(lgpdService.getSolicitacoes("PENDENTE")).resolves.toEqual(solicitacoes);
    expect(chain.eq).toHaveBeenCalledWith("status", "PENDENTE");
  });

  it("contabiliza sucessos e falhas da anonimização em massa", async () => {
    vi.spyOn(lgpdService, "getPacientesAnonimizaveis").mockResolvedValue([
      { id: 10 },
      { id: 20 },
      { id: 30 },
    ] as any);
    vi.spyOn(lgpdService, "executeEsquecimento")
      .mockResolvedValueOnce({ anonimizado: true })
      .mockRejectedValueOnce(new Error("bloqueio legal"))
      .mockRejectedValueOnce("falha desconhecida");

    await expect(
      lgpdService.executarAnonimizacaoMassa("INATIVO_5_ANOS", 3),
    ).resolves.toEqual({
      sucesso: 1,
      falha: 2,
      erros: [
        { id: 20, erro: "bloqueio legal" },
        { id: 30, erro: "falha desconhecida" },
      ],
    });
    expect(lgpdService.getPacientesAnonimizaveis).toHaveBeenCalledWith(3);
  });

  it("rejeita consulta de consentimentos com patientId inválido", async () => {
    await expect(lgpdService.getConsentimentos(0)).rejects.toThrow("patientId invalido");
    await expect(lgpdService.getConsentimentos(1.5)).rejects.toThrow("patientId invalido");
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("propaga erro de banco ao listar consentimentos", async () => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
    };
    chain.then = (resolve: any) => resolve({ data: null, error: { message: "indisponível" } });
    (supabase.from as any).mockReturnValue(chain);

    await expect(lgpdService.getConsentimentos(7)).rejects.toThrow(
      "Erro ao listar consentimentos: indisponível",
    );
  });

  it("lista solicitações sem filtro e normaliza resposta nula", async () => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    };
    chain.then = (resolve: any) => resolve({ data: null, error: null });
    (supabase.from as any).mockReturnValue(chain);

    await expect(lgpdService.getSolicitacoes()).resolves.toEqual([]);
    expect(chain.eq).not.toHaveBeenCalled();
  });

  it("distingue conflito de unicidade de outros erros ao registrar consentimento", async () => {
    const resultChain = (error: { code: string; message: string }) => ({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error }),
    });
    (supabase.from as any)
      .mockReturnValueOnce(resultChain({ code: "23505", message: "duplicate" }))
      .mockReturnValueOnce(resultChain({ code: "XX000", message: "offline" }));

    await expect(
      lgpdService.updateConsentimento(7, CANAL.EMAIL, true),
    ).rejects.toThrow("Ja existe um consentimento");
    await expect(
      lgpdService.updateConsentimento(7, CANAL.EMAIL, true),
    ).rejects.toThrow("Erro ao registrar consentimento: offline");
  });
});