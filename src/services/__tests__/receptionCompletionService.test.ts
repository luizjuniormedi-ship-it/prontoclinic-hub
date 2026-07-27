import { createHash, webcrypto } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: supabaseMocks.from,
    rpc: supabaseMocks.rpc,
  },
}));

import {
  receptionCompletionService,
  sha256CanonicalContent,
  type ReceptionTermCatalogItem,
} from "@/services/receptionCompletionService";

function catalogQuery(result: { data: unknown; error: unknown }) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    then: (
      resolve: (value: typeof result) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject),
  };
  return query;
}

const termContent = "Conteúdo canônico\nLinha dois.";
const termContentHash = createHash("sha256")
  .update(termContent, "utf8")
  .digest("hex");

const term: ReceptionTermCatalogItem = {
  id: "4b8917b2-8f95-4fe4-98f3-7e5900093170",
  code: "atendimento",
  version: "2.1",
  title: "Termo de atendimento",
  content: termContent,
  contentHash: termContentHash,
  purpose: "CLINICA",
  publishedAt: "2026-07-26T12:00:00.000Z",
};

describe("receptionCompletionService — catálogo e aceite de termos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (!globalThis.crypto?.subtle) {
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: webcrypto,
      });
    }
  });

  it("carrega somente o catálogo ativo e mapeia o conteúdo canônico", async () => {
    const query = catalogQuery({
      data: [
        {
          id: term.id,
          codigo: term.code,
          versao: term.version,
          titulo: term.title,
          texto: term.content,
          texto_hash: "ABCDEF  ",
          finalidade: term.purpose,
          publicado_em: term.publishedAt,
        },
      ],
      error: null,
    });
    supabaseMocks.from.mockReturnValue(query);

    await expect(receptionCompletionService.listActiveTerms()).resolves.toEqual(
      [
        expect.objectContaining({
          id: term.id,
          code: term.code,
          version: term.version,
          content: term.content,
          contentHash: "abcdef",
        }),
      ],
    );

    expect(supabaseMocks.from).toHaveBeenCalledWith("lgpd_termos");
    expect(query.select).toHaveBeenCalledWith(
      "id,codigo,versao,titulo,texto,texto_hash,finalidade,publicado_em",
    );
    expect(query.eq).toHaveBeenCalledWith("lg_ativo", true);
  });

  it("propaga falha do catálogo sem inventar termo local", async () => {
    supabaseMocks.from.mockReturnValue(
      catalogQuery({
        data: null,
        error: { message: "policy denied" },
      }),
    );

    await expect(receptionCompletionService.listActiveTerms()).rejects.toThrow(
      "Erro ao carregar catálogo de termos: policy denied",
    );
  });

  it("calcula SHA-256 dos bytes UTF-8 exatos do conteúdo", async () => {
    const expected = createHash("sha256")
      .update(term.content, "utf8")
      .digest("hex");

    await expect(sha256CanonicalContent(term.content)).resolves.toBe(expected);
  });

  it("não aceita hash do chamador e envia à RPC o hash calculado do conteúdo", async () => {
    const expected = createHash("sha256")
      .update(term.content, "utf8")
      .digest("hex");
    supabaseMocks.rpc.mockResolvedValue({
      data: "4c564f6b-3522-45a5-92fb-c5268e966126",
      error: null,
    });

    await receptionCompletionService.acceptTerm(
      "42",
      term,
      "91",
      "manifestacao_presencial_confirmada",
    );

    expect(supabaseMocks.rpc).toHaveBeenCalledWith(
      "record_reception_term_acceptance_secure",
      {
        p_patient_id: 42,
        p_term_code: term.code,
        p_term_version: term.version,
        p_content_hash: expected,
        p_appointment_id: 91,
        p_signature_reference: "manifestacao_presencial_confirmada",
      },
    );
    expect(expected).toBe(term.contentHash);
  });

  it("bloqueia no cliente catálogo cujo hash não corresponde ao conteúdo", async () => {
    await expect(
      receptionCompletionService.acceptTerm("42", {
        ...term,
        contentHash: "0".repeat(64),
      }),
    ).rejects.toThrow(
      "Conteúdo do termo não corresponde ao hash publicado no catálogo",
    );
    expect(supabaseMocks.rpc).not.toHaveBeenCalled();
  });

  it("expõe o erro de rejeição devolvido pela RPC", async () => {
    supabaseMocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "Conteudo apresentado diverge do termo ativo" },
    });

    await expect(
      receptionCompletionService.acceptTerm("42", term),
    ).rejects.toThrow(
      "Erro ao registrar aceite do termo: Conteudo apresentado diverge do termo ativo",
    );
  });
});
