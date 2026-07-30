import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const backendSource = readFileSync("local-auth-server.mjs", "utf8");
const enrollmentPageSource = readFileSync("src/pages/MfaEnrollmentPage.tsx", "utf8");

describe("MFA enrollment runtime contract", () => {
  it("returns the TOTP secret that was actually persisted", () => {
    expect(backendSource).toContain(
      "pgp_sym_decrypt(secret_ciphertext, $4) AS persisted_secret",
    );
    expect(backendSource).toContain(
      "totp: { secret: persistedSecret, uri: otpauth",
    );
    expect(backendSource).not.toContain(
      "totp: { secret, uri: otpauth",
    );
  });

  it("does not delete a newly verified factor during page unmount", () => {
    expect(enrollmentPageSource).not.toContain(
      "useEffect(() => () =>",
    );
    expect(enrollmentPageSource).toContain(
      "await unenrollTotpFactor(supabase.auth.mfa, activeFactor.current)",
    );
  });
});
