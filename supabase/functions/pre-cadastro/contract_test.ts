import {
  buildConfirmationUrl,
  companyForRequest,
  confirmationToken,
  sha256,
  validPublicForm,
  verifiedResendClaims,
} from "./contract.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("confirmation credential stays in URL fragment", () => {
  const token = "a".repeat(64);
  const value = buildConfirmationUrl("https://prontomedic.example", token);
  assert(value === `https://prontomedic.example/pre-cadastro/confirmar#token=${token}`, "unexpected link");
  assert(!new URL(value).search, "token leaked into query string");
});

Deno.test("tenant comes only from the allowlisted request origin", () => {
  const company = "10000000-0000-4000-8000-000000000001";
  const map = JSON.stringify({ "https://prontomedic.example": company });
  assert(companyForRequest(new Request("https://edge.test", {
    headers: { Origin: "https://prontomedic.example" },
  }), map) === company, "allowlisted tenant not resolved");
  assert(companyForRequest(new Request("https://edge.test", {
    headers: { Origin: "https://attacker.example" },
  }), map) === null, "unknown origin resolved a tenant");
});

Deno.test("HMAC is normalized, deterministic and stored as a hash", async () => {
  const secret = "s".repeat(32);
  const key = "20000000-0000-4000-8000-000000000001";
  const first = await confirmationToken(secret, key, " Patient@Example.Test ");
  const second = await confirmationToken(secret, key, "patient@example.test");
  assert(first === second && first.length === 64, "HMAC is not deterministic");
  assert(await sha256(first) !== first, "database hash must differ from the credential");
});

Deno.test("public clinical fields are validated server-side", () => {
  const valid = {
    phone: "(11) 99999-9999", cpf: "52998224725", birth_date: "1990-05-12",
    gender: "F", cep: "01310100", logradouro: "Avenida Paulista", numero: "1000",
    bairro: "Bela Vista", cidade: "Sao Paulo", uf: "SP",
  };
  assert(validPublicForm(valid), "valid form rejected");
  assert(!validPublicForm({ ...valid, cpf: "11111111111" }), "invalid CPF accepted");
  assert(!validPublicForm({ ...valid, birth_date: "2999-01-01" }), "future birth date accepted");
});

Deno.test("resend accepts only verified AAL2 claims for the same user", () => {
  const userId = "30000000-0000-4000-8000-000000000001";
  const sessionId = "32000000-0000-4000-8000-000000000001";
  const jwt = (payload: Record<string, unknown>) => ["e30", btoa(JSON.stringify(payload))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"), "signature"].join(".");
  assert(verifiedResendClaims(jwt({ sub: userId, session_id: sessionId, aal: "aal2" }), userId)
    ?.sessionId === sessionId, "valid AAL2 claims rejected");
  assert(verifiedResendClaims(jwt({ sub: userId, session_id: sessionId, aal: "aal1" }), userId) === null,
    "AAL1 accepted");
  assert(verifiedResendClaims(jwt({ sub: userId, session_id: sessionId, aal: "aal2" }),
    "30000000-0000-4000-8000-000000000002") === null, "different verified user accepted");
});
