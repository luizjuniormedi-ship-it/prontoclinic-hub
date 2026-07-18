type MfaError = { message: string } | null;
type AssuranceLevel = string | null;

interface TotpFactor {
  id: string;
  status: "verified" | "unverified";
}

interface EnrolledTotpFactor {
  id: string;
  totp: { qr_code: string; secret: string };
}

export interface MfaClient {
  getAuthenticatorAssuranceLevel(): Promise<{
    data: { currentLevel: AssuranceLevel; nextLevel: AssuranceLevel } | null;
    error: MfaError;
  }>;
  listFactors(): Promise<{ data: { totp: TotpFactor[] } | null; error: MfaError }>;
  challenge(input: { factorId: string }): Promise<{ data: { id: string } | null; error: MfaError }>;
  verify(input: { factorId: string; challengeId: string; code: string }): Promise<{
    data: unknown;
    error: MfaError;
  }>;
  enroll(input: { factorType: "totp"; friendlyName?: string }): Promise<{
    data: EnrolledTotpFactor | null;
    error: MfaError;
  }>;
  unenroll(input: { factorId: string }): Promise<{ data: unknown; error: MfaError }>;
}

export type MfaNextStep =
  | { kind: "verified" }
  | { kind: "challenge"; factorId: string }
  | { kind: "enroll" };

function throwIfError(error: MfaError): void {
  if (error) throw new Error(error.message);
}

export async function getMfaNextStep(client: MfaClient): Promise<MfaNextStep> {
  const assurance = await client.getAuthenticatorAssuranceLevel();
  throwIfError(assurance.error);
  if (assurance.data?.currentLevel === "aal2") return { kind: "verified" };

  const factors = await client.listFactors();
  throwIfError(factors.error);
  const verifiedFactor = factors.data?.totp.find((factor) => factor.status === "verified");
  return verifiedFactor ? { kind: "challenge", factorId: verifiedFactor.id } : { kind: "enroll" };
}

export async function verifyTotpFactor(client: MfaClient, factorId: string, code: string): Promise<void> {
  const challenge = await client.challenge({ factorId });
  throwIfError(challenge.error);
  if (!challenge.data?.id) throw new Error("Não foi possível criar o desafio MFA.");

  const verification = await client.verify({ factorId, challengeId: challenge.data.id, code });
  throwIfError(verification.error);
}

export interface TotpEnrollment {
  factorId: string;
  qrCode: string;
  secret: string;
}

export async function enrollTotpFactor(client: MfaClient, friendlyName?: string): Promise<TotpEnrollment> {
  const enrollment = await client.enroll({ factorType: "totp", friendlyName });
  throwIfError(enrollment.error);
  if (!enrollment.data?.id || !enrollment.data.totp?.qr_code) {
    throw new Error("Não foi possível iniciar o cadastro MFA.");
  }
  return {
    factorId: enrollment.data.id,
    qrCode: enrollment.data.totp.qr_code,
    secret: enrollment.data.totp.secret,
  };
}

export async function unenrollTotpFactor(client: MfaClient, factorId: string): Promise<void> {
  const result = await client.unenroll({ factorId });
  throwIfError(result.error);
}
