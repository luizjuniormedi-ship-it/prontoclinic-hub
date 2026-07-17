import { describe, expect, it, vi } from "vitest";
import {
  enrollTotpFactor,
  getMfaNextStep,
  unenrollTotpFactor,
  verifyTotpFactor,
  type MfaClient,
} from "@/services/authMfaService";

function createClient(options: {
  currentLevel?: "aal1" | "aal2" | null;
  nextLevel?: "aal1" | "aal2" | null;
  factors?: Array<{ id: string; status: "verified" | "unverified" }>;
} = {}) {
  const challenge = vi.fn().mockResolvedValue({ data: { id: "challenge-1" }, error: null });
  const verify = vi.fn().mockResolvedValue({ data: {}, error: null });
  const enroll = vi.fn().mockResolvedValue({
    data: { id: "factor-new", totp: { qr_code: "data:image/svg+xml;base64,qr", secret: "SECRET" } },
    error: null,
  });
  const unenroll = vi.fn().mockResolvedValue({ data: {}, error: null });
  const client: MfaClient = {
    getAuthenticatorAssuranceLevel: vi.fn().mockResolvedValue({
      data: {
        currentLevel: options.currentLevel ?? "aal1",
        nextLevel: options.nextLevel ?? "aal2",
      },
      error: null,
    }),
    listFactors: vi.fn().mockResolvedValue({
      data: { totp: options.factors ?? [] },
      error: null,
    }),
    challenge,
    verify,
    enroll,
    unenroll,
  };
  return { client, challenge, verify, enroll, unenroll };
}

describe("getMfaNextStep", () => {
  it("libera a sessão quando já está em AAL2", async () => {
    const { client } = createClient({ currentLevel: "aal2" });
    await expect(getMfaNextStep(client)).resolves.toEqual({ kind: "verified" });
  });

  it("exige desafio quando existe fator TOTP verificado", async () => {
    const { client } = createClient({ factors: [{ id: "factor-1", status: "verified" }] });
    await expect(getMfaNextStep(client)).resolves.toEqual({ kind: "challenge", factorId: "factor-1" });
  });

  it("exige cadastro quando não existe fator TOTP verificado", async () => {
    const { client } = createClient();
    await expect(getMfaNextStep(client)).resolves.toEqual({ kind: "enroll" });
  });
});

describe("verifyTotpFactor", () => {
  it("cria e verifica um desafio real para o fator informado", async () => {
    const { client, challenge, verify } = createClient();
    await verifyTotpFactor(client, "factor-1", "123456");
    expect(challenge).toHaveBeenCalledWith({ factorId: "factor-1" });
    expect(verify).toHaveBeenCalledWith({
      factorId: "factor-1",
      challengeId: "challenge-1",
      code: "123456",
    });
  });
});

describe("enrollTotpFactor", () => {
  it("cadastra TOTP e devolve os dados necessários para o autenticador", async () => {
    const { client, enroll } = createClient();
    await expect(enrollTotpFactor(client, "ProntoMedic")).resolves.toEqual({
      factorId: "factor-new",
      qrCode: "data:image/svg+xml;base64,qr",
      secret: "SECRET",
    });
    expect(enroll).toHaveBeenCalledWith({ factorType: "totp", friendlyName: "ProntoMedic" });
  });
});

describe("unenrollTotpFactor", () => {
  it("remove o fator solicitado pela API real", async () => {
    const { client, unenroll } = createClient();
    await unenrollTotpFactor(client, "factor-1");
    expect(unenroll).toHaveBeenCalledWith({ factorId: "factor-1" });
  });
});
