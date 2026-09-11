import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.3";
import { corsDenied, corsHeaders } from "../_shared/cors.ts";
import {
  buildConfirmationUrl,
  companyForRequest,
  confirmationToken,
  EMAIL_PATTERN,
  fixedConfirmOrigin,
  sha256,
  TOKEN_PATTERN,
  type PublicRequestBody,
  validPublicForm,
  verifiedResendClaims,
} from "./contract.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const TENANT_MAP_RAW = Deno.env.get("PRE_CADASTRO_TENANT_MAP") ?? "";
const TOKEN_SECRET = Deno.env.get("PRE_CADASTRO_TOKEN_SECRET") ?? "";
const CONFIRM_BASE_URL = Deno.env.get("PRE_CADASTRO_CONFIRM_BASE_URL") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const EMAIL_FROM = Deno.env.get("PRE_CADASTRO_EMAIL_FROM") ?? "";
const TERM_VERSION = Deno.env.get("PRE_CADASTRO_TERM_VERSION") ?? "";
const TERM_SHA256 = (Deno.env.get("PRE_CADASTRO_TERM_SHA256") ?? "").toLowerCase();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_ACTIONS = new Set(["request", "status", "confirm", "resend"]);

type RequestBody = PublicRequestBody;

function json(data: unknown, status: number, headers: HeadersInit) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

function validConfig(): boolean {
  return Boolean(
    SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && TENANT_MAP_RAW
    && TOKEN_SECRET.length >= 32 && RESEND_API_KEY && EMAIL_PATTERN.test(EMAIL_FROM)
    && fixedConfirmOrigin(CONFIRM_BASE_URL) && TERM_VERSION && TOKEN_PATTERN.test(TERM_SHA256),
  );
}

function clientIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded && /^[0-9a-f:.]+$/i.test(forwarded) ? forwarded : null;
}

async function sendConfirmation(email: string, fullName: string, token: string, expiresAt: string, requestKey: string) {
  const confirmationUrl = buildConfirmationUrl(CONFIRM_BASE_URL, token);
  if (!confirmationUrl) throw new Error("invalid configuration");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `pre-cadastro/${requestKey}`,
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [email],
        subject: "Confirme seu pré-cadastro ProntoMedic",
        text: `Olá, ${fullName}. Confirme seu pré-cadastro até ${expiresAt}: ${confirmationUrl}`,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("provider rejected");
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req);
  if (!cors || !req.headers.get("Origin")) return corsDenied();
  const respond = (data: unknown, status = 200) => json(data, status, cors);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return respond({ error: "Método não permitido." }, 405);
  if (!validConfig()) return respond({ error: "Serviço de pré-cadastro indisponível." }, 503);
  if (req.headers.get("sec-fetch-site") === "cross-site") return respond({ error: "Origem não autorizada." }, 403);

  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 16_384) return respond({ error: "Solicitação muito grande." }, 413);
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return respond({ error: "Content-Type inválido." }, 415);
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return respond({ error: "JSON inválido." }, 400);
  }
  const action = String(body.action ?? "");
  if (!ALLOWED_ACTIONS.has(action)) return respond({ error: "Operação inválida." }, 400);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    if (action === "status" || action === "confirm") {
      const token = String(body.token ?? "").toLowerCase();
      if (!TOKEN_PATTERN.test(token)) return respond({ status: "INVALIDO" }, 404);
      const tokenHash = await sha256(token);
      const rpc = action === "status" ? "pre_cadastro_edge_status" : "pre_cadastro_edge_confirm";
      const { data, error } = await admin.rpc(rpc, { p_token_hash: tokenHash });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.r_status) return respond({ status: "INVALIDO" }, 404);
      return respond({ status: row.r_status, expiresAt: row.r_dt_exp ?? null });
    }

    if (action === "resend") {
      const requestKey = req.headers.get("idempotency-key") ?? "";
      const preCadastroId = String(body.pre_cadastro_id ?? "");
      const authorization = req.headers.get("authorization") ?? "";
      const accessToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
      if (!UUID_PATTERN.test(requestKey) || !UUID_PATTERN.test(preCadastroId) || !accessToken) {
        return respond({ error: "Solicitação de reenvio inválida." }, 400);
      }
      const { data: authData, error: authError } = await admin.auth.getUser(accessToken);
      if (authError || !authData.user) return respond({ error: "Autenticação obrigatória." }, 401);
      const claims = verifiedResendClaims(accessToken, authData.user.id);
      if (!claims) return respond({ error: "Autenticação AAL2 e contexto ativo obrigatórios." }, 403);

      const token = await confirmationToken(TOKEN_SECRET, requestKey, preCadastroId);
      const tokenHash = await sha256(token);
      const { data, error } = await admin.rpc("pre_cadastro_edge_resend", {
        p_actor_id: claims.userId,
        p_session_id: claims.sessionId,
        p_aal: claims.aal,
        p_id: preCadastroId,
        p_request_key: requestKey,
        p_token_hash: tokenHash,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return respond({ error: "Pré-cadastro indisponível para reenvio." }, 409);
      if (row.r_should_send !== true) {
        return respond({
          error: "Aguarde antes de solicitar um novo envio.",
          retryAfterSeconds: Number(row.r_retry_after_seconds ?? 300),
        }, 429);
      }
      await sendConfirmation(String(row.r_email), String(row.r_full_name), token, String(row.r_dt_exp), requestKey);
      return respond({ accepted: true }, 202);
    }

    const requestKey = req.headers.get("idempotency-key") ?? "";
    const companyId = companyForRequest(req, TENANT_MAP_RAW);
    if (!UUID_PATTERN.test(requestKey)) return respond({ error: "Chave de idempotência obrigatória." }, 400);
    if (!companyId) return respond({ error: "Origem sem empresa configurada." }, 403);
    const fullName = String(body.full_name ?? "").trim();
    const email = String(body.email ?? "").toLowerCase().trim();
    if (fullName.length < 3 || fullName.length > 200 || !EMAIL_PATTERN.test(email)
      || !validPublicForm(body)
      || body.lg_aceite_termo !== true
      || body.versao_termo !== TERM_VERSION
      || String(body.texto_termo_hash ?? "").toLowerCase() !== TERM_SHA256) {
      return respond({ error: "Dados de pré-cadastro inválidos." }, 400);
    }
    const token = await confirmationToken(TOKEN_SECRET, requestKey, email);
    const tokenHash = await sha256(token);
    const { data, error } = await admin.rpc("pre_cadastro_edge_request", {
      p_company_id: companyId,
      p_request_key: requestKey,
      p_token_hash: tokenHash,
      p_full_name: fullName,
      p_email: email,
      p_phone: String(body.phone ?? ""),
      p_whatsapp: body.whatsapp ? String(body.whatsapp) : null,
      p_cpf: body.cpf ? String(body.cpf) : null,
      p_birth_date: String(body.birth_date ?? ""),
      p_gender: String(body.gender ?? ""),
      p_cep: String(body.cep ?? ""),
      p_logradouro: String(body.logradouro ?? ""),
      p_numero: String(body.numero ?? ""),
      p_complemento: body.complemento ? String(body.complemento) : null,
      p_bairro: String(body.bairro ?? ""),
      p_cidade: String(body.cidade ?? ""),
      p_uf: String(body.uf ?? ""),
      p_ibge_cidade: body.ibge_cidade ? String(body.ibge_cidade) : null,
      p_versao_termo: TERM_VERSION,
      p_texto_termo_hash: TERM_SHA256,
      p_ip_origem: clientIp(req),
      p_user_agent: req.headers.get("user-agent")?.slice(0, 500) ?? "",
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (row?.r_should_send === true) {
      await sendConfirmation(email, fullName, token, String(row.r_dt_exp), requestKey);
    }
    return respond({ accepted: true }, 202);
  } catch {
    return respond({ error: "Não foi possível processar o pré-cadastro." }, 503);
  }
});
