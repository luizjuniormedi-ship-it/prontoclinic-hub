export const TOKEN_PATTERN = /^[0-9a-f]{64}$/;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PHONE_PATTERN = /^\+?[\d\s()-]{10,20}$/;
const CEP_PATTERN = /^\d{5}-?\d{3}$/;
const UF_PATTERN = /^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/;

export type PublicRequestBody = Record<string, unknown> & {
  action?: unknown;
  token?: unknown;
};

export type VerifiedResendClaims = {
  userId: string;
  sessionId: string;
  aal: "aal2";
};

export function verifiedResendClaims(token: string, verifiedUserId: string): VerifiedResendClaims | null {
  try {
    const payloadPart = token.split(".")[1];
    if (!payloadPart) return null;
    const padded = payloadPart.replace(/-/g, "+").replace(/_/g, "/")
      .padEnd(Math.ceil(payloadPart.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded)) as Record<string, unknown>;
    const userId = String(payload.sub ?? "");
    const sessionId = String(payload.session_id ?? "");
    const aal = String(payload.aal ?? "");
    if (userId !== verifiedUserId || !UUID_PATTERN.test(userId)
      || !UUID_PATTERN.test(sessionId) || aal !== "aal2") return null;
    return { userId, sessionId, aal: "aal2" };
  } catch {
    return null;
  }
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function sha256(value: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

export async function confirmationToken(
  secret: string,
  requestKey: string,
  email: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${requestKey}:${email.toLowerCase().trim()}`),
  )));
}

export function fixedConfirmOrigin(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

export function buildConfirmationUrl(baseUrl: string, token: string): string | null {
  const url = fixedConfirmOrigin(baseUrl);
  if (!url || !TOKEN_PATTERN.test(token)) return null;
  url.pathname = "/pre-cadastro/confirmar";
  url.hash = new URLSearchParams({ token }).toString();
  return url.toString();
}

export function companyForRequest(req: Request, tenantMapRaw: string): string | null {
  try {
    const origin = new URL(req.headers.get("origin") ?? "").origin.toLowerCase();
    const mapping = JSON.parse(tenantMapRaw) as Record<string, unknown>;
    const companyId = mapping[origin];
    return typeof companyId === "string" && UUID_PATTERN.test(companyId) ? companyId : null;
  } catch {
    return null;
  }
}

function validCpf(value: string): boolean {
  const cpf = value.replace(/\D/g, "");
  if (!cpf) return true;
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
  const digit = (length: number) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) sum += Number(cpf[index]) * (length + 1 - index);
    const result = (sum * 10) % 11;
    return result === 10 ? 0 : result;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

function validBirthDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return false;
  const today = new Date();
  const oldest = new Date(Date.UTC(today.getUTCFullYear() - 130, today.getUTCMonth(), today.getUTCDate()));
  return date <= today && date >= oldest;
}

export function validPublicForm(body: PublicRequestBody): boolean {
  const bounded = (value: unknown, min: number, max: number) => {
    const text = String(value ?? "").trim();
    return text.length >= min && text.length <= max;
  };
  return PHONE_PATTERN.test(String(body.phone ?? ""))
    && (!body.whatsapp || PHONE_PATTERN.test(String(body.whatsapp)))
    && validCpf(String(body.cpf ?? ""))
    && validBirthDate(String(body.birth_date ?? ""))
    && ["M", "F", "O"].includes(String(body.gender ?? ""))
    && CEP_PATTERN.test(String(body.cep ?? ""))
    && bounded(body.logradouro, 2, 200)
    && bounded(body.numero, 1, 20)
    && bounded(body.bairro, 2, 100)
    && bounded(body.cidade, 2, 100)
    && UF_PATTERN.test(String(body.uf ?? ""))
    && (!body.complemento || bounded(body.complemento, 1, 100))
    && (!body.ibge_cidade || /^\d{6,7}$/.test(String(body.ibge_cidade)));
}
