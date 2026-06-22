/**
 * emailService.ts
 *
 * Wrapper de envio de e-mails via Resend (recomendado) com fallback
 * SMTP / dev mode (console).
 *
 * Prove:
 *   - sendEmail({ to, subject, html, from?, replyTo? })  -> POST Resend
 *   - sendPreCadastroConfirmation({ to, nome, linkConfirmacao, dtExp })
 *   - sendWelcome(email, nome)
 *   - sendPasswordReset(email, linkReset)
 *
 * Config (.env):
 *   VITE_RESEND_API_KEY=re_xxxxxxxxxxxx
 *   VITE_EMAIL_FROM=nao-responda@seudominio.com.br
 *   VITE_EMAIL_REPLY_TO=suporte@seudominio.com.br
 *
 * Por que nao usar template engine: simplicidade e zero deps.
 * Os templates ficam aqui (auditaveis no repo).
 *
 * Seguranca:
 *   - API key so fica no bundle cliente se VITE_* (mas isso e INTENCIONAL
 *     para sites estaticos — em prod, mover para Edge Function ou server-side).
 *   - HTTPS para api.resend.com (TLS 1.2+).
 */

import { env } from "@/lib/env";

// =============================================================================
// Tipos
// =============================================================================

export interface SendEmailParams {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  tags?: Array<{ name: string; value: string }>;
}

export interface SendEmailResult {
  id: string;
  provider: "resend" | "console";
}

export interface PreCadastroConfirmationParams {
  to: string;
  nome: string;
  linkConfirmacao: string;
  dtExp: string;            // ISO
}

// =============================================================================
// Constantes
// =============================================================================

const RESEND_API_URL = "https://api.resend.com/emails";

const DEFAULT_FROM = () =>
  env.VITE_EMAIL_FROM ?? "ProntoClinic Hub <nao-responda@prontoclinic.com.br>";
const DEFAULT_REPLY_TO = () =>
  env.VITE_EMAIL_REPLY_TO ?? "suporte@prontoclinic.com.br";

// =============================================================================
// Helpers internos
// =============================================================================

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateBR(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// =============================================================================
// Templates HTML
// =============================================================================

function wrapHtml(content: string, preheader?: string): string {
  const ph = preheader
    ? `<span style="display:none;font-size:1px;color:#fff;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(preheader)}</span>`
    : "";
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <title>${env.VITE_APP_NAME ?? "ProntoClinic Hub"}</title>
</head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  ${ph}
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f8fafc;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background-color:#ffffff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
          <tr>
            <td style="padding:32px 32px 16px;text-align:center;border-bottom:1px solid #e2e8f0;">
              <h1 style="margin:0;font-size:20px;color:#2563eb;font-weight:700;">${env.VITE_APP_NAME ?? "ProntoMedic"}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">${content}</td>
          </tr>
          <tr>
            <td style="padding:24px 32px;border-top:1px solid #e2e8f0;background-color:#f8fafc;border-radius:0 0 8px 8px;">
              <p style="margin:0;color:#64748b;font-size:12px;text-align:center;">
                Este e-mail foi enviado automaticamente. Em caso de duvidas, responda este e-mail ou entre em contato com a clinica.
              </p>
              <p style="margin:8px 0 0;color:#94a3b8;font-size:11px;text-align:center;">
                ${env.VITE_APP_NAME ?? "ProntoMedic"} &copy; ${new Date().getFullYear()}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function primaryButton(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:24px auto;">
  <tr>
    <td style="border-radius:6px;background-color:#2563eb;">
      <a href="${href}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 28px;font-size:15px;color:#ffffff;text-decoration:none;font-weight:600;border-radius:6px;">
        ${escapeHtml(label)}
      </a>
    </td>
  </tr>
</table>`;
}

// =============================================================================
// Envio (Resend)
// =============================================================================

async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const apiKey = env.VITE_RESEND_API_KEY;

  // Sem API key: fallback dev (console)
  if (!apiKey) {
    if (env.VITE_APP_ENV === "production") {
      console.error(
        "[emailService] VITE_RESEND_API_KEY ausente — e-mail NAO enviado em producao!",
        { to: params.to, subject: params.subject },
      );
      throw new Error("Servico de e-mail nao configurado");
    }

    console.info("[emailService:DEV] E-mail (nao enviado):", {
      from: params.from ?? DEFAULT_FROM(),
      to: params.to,
      subject: params.subject,
      preview: params.text ?? htmlToText(params.html).slice(0, 200),
    });
    return { id: `dev-${Date.now()}`, provider: "console" };
  }

  // Resend API
  const recipients = Array.isArray(params.to) ? params.to : [params.to];
  const payload = {
    from: params.from ?? DEFAULT_FROM(),
    to: recipients,
    subject: params.subject,
    html: params.html,
    text: params.text ?? htmlToText(params.html),
    reply_to: params.replyTo ?? DEFAULT_REPLY_TO(),
    tags: params.tags,
  };

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "User-Agent": `${env.VITE_APP_NAME ?? "ProntoMedic"}/1.0`,
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const body = await res.text();
      console.error("[emailService] Resend erro", res.status, body);
      throw new Error(`Resend HTTP ${res.status}: ${body.slice(0, 200)}`);
    }

    const json = (await res.json()) as { id?: string };
    return { id: json.id ?? "unknown", provider: "resend" };
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new Error("Timeout ao enviar e-mail (10s)");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// =============================================================================
// Templates especificos
// =============================================================================

/**
 * Confirmacao de pre-cadastro (sign-up publico).
 * Enviado apos criar pre-cadastro; o paciente clica no botao para confirmar.
 */
async function sendPreCadastroConfirmation(
  params: PreCadastroConfirmationParams,
): Promise<SendEmailResult> {
  const html = wrapHtml(
    `
      <p style="margin:0 0 16px;font-size:16px;">Ola, <strong>${escapeHtml(params.nome)}</strong>,</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:24px;">
        Recebemos seu pre-cadastro na ${env.VITE_APP_NAME ?? "clinica"}. Para concluir, confirme seu e-mail clicando no botao abaixo:
      </p>
      ${primaryButton(params.linkConfirmacao, "Confirmar pre-cadastro")}
      <p style="margin:24px 0 8px;font-size:14px;color:#475569;">
        Ou copie e cole este link no seu navegador:
      </p>
      <p style="margin:0;padding:12px;background-color:#f1f5f9;border-radius:6px;word-break:break-all;font-size:12px;color:#475569;">
        ${escapeHtml(params.linkConfirmacao)}
      </p>
      <p style="margin:24px 0 0;padding:16px;background-color:#fef3c7;border-left:3px solid #f59e0b;border-radius:4px;font-size:13px;color:#78350f;">
        <strong>Atencao:</strong> este link expira em
        <strong>${formatDateBR(params.dtExp)}</strong>. Apos a confirmacao,
        a clinica ira revisar seus dados e finalizar seu cadastro.
      </p>
      <p style="margin:24px 0 0;font-size:14px;color:#475569;line-height:22px;">
        Se voce nao fez este pre-cadastro, ignore este e-mail — nenhum dado sera armazenado.
      </p>
    `,
    `Confirme seu pre-cadastro na ${env.VITE_APP_NAME ?? "clinica"}`,
  );

  return sendEmail({
    to: params.to,
    subject: `Confirme seu pre-cadastro — ${env.VITE_APP_NAME ?? "ProntoMedic"}`,
    html,
    tags: [
      { name: "category", value: "pre_cadastro" },
      { name: "stage", value: "confirmation" },
    ],
  });
}

/** Boas-vindas apos confirmacao */
async function sendWelcome(email: string, nome: string): Promise<SendEmailResult> {
  const html = wrapHtml(
    `
      <p style="margin:0 0 16px;font-size:16px;">Ola, <strong>${escapeHtml(nome)}</strong>,</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:24px;">
        Seu e-mail foi confirmado com sucesso! Em breve a clinica ${env.VITE_APP_NAME ?? "ProntoMedic"}
        ira revisar seus dados e finalizar seu cadastro.
      </p>
      <p style="margin:0 0 16px;font-size:15px;line-height:24px;">
        Quando seu cadastro definitivo for concluido, voce recebera suas credenciais de acesso e podera:
      </p>
      <ul style="margin:0 0 16px;padding-left:24px;font-size:15px;line-height:28px;color:#334155;">
        <li>Agendar consultas e exames</li>
        <li>Consultar resultados e prontuario</li>
        <li>Receber lembretes por e-mail, SMS ou WhatsApp</li>
        <li>Solicitar seus dados (LGPD art. 18)</li>
      </ul>
      <p style="margin:24px 0 0;font-size:14px;color:#64748b;">
        Caso tenha duvidas, entre em contato com a recepcao da clinica.
      </p>
    `,
    `Bem-vindo(a) a ${env.VITE_APP_NAME ?? "clinica"}!`,
  );

  return sendEmail({
    to: email,
    subject: `Bem-vindo(a) a ${env.VITE_APP_NAME ?? "ProntoMedic"}!`,
    html,
    tags: [
      { name: "category", value: "welcome" },
      { name: "stage", value: "post_confirmation" },
    ],
  });
}

/** Reset de senha (link temporario) */
async function sendPasswordReset(
  email: string,
  linkReset: string,
): Promise<SendEmailResult> {
  const html = wrapHtml(
    `
      <p style="margin:0 0 16px;font-size:16px;">Ola,</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:24px;">
        Recebemos uma solicitacao de redefinicao de senha para sua conta na
        ${env.VITE_APP_NAME ?? "clinica"}. Clique no botao abaixo para criar uma nova senha:
      </p>
      ${primaryButton(linkReset, "Redefinir senha")}
      <p style="margin:24px 0 0;padding:16px;background-color:#fef3c7;border-left:3px solid #f59e0b;border-radius:4px;font-size:13px;color:#78350f;">
        <strong>Atencao:</strong> este link expira em <strong>1 hora</strong>.
        Se voce nao solicitou a redefinicao, ignore este e-mail — sua senha permanecera a mesma.
      </p>
    `,
    `Redefinicao de senha — ${env.VITE_APP_NAME ?? "ProntoMedic"}`,
  );

  return sendEmail({
    to: email,
    subject: `Redefinicao de senha — ${env.VITE_APP_NAME ?? "ProntoMedic"}`,
    html,
    tags: [
      { name: "category", value: "auth" },
      { name: "stage", value: "password_reset" },
    ],
  });
}

// =============================================================================
// Public API
// =============================================================================

export const emailService = {
  sendEmail,
  sendPreCadastroConfirmation,
  sendWelcome,
  sendPasswordReset,
};

export default emailService;