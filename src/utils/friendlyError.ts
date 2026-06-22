/**
 * friendlyError.ts
 *
 * Converte erros brutos (Supabase / JS) em mensagens amigáveis em PT-BR.
 * Use em toasts, Alerts e ErrorState para que o usuário entenda o que
 * aconteceu e o que pode fazer.
 *
 * Exemplo:
 *   toast({ title: friendlyError(err, "Salvar paciente"), variant: "destructive" });
 */

export interface FriendlyErrorOptions {
  /** Quando verdadeiro, suprime a frase final "Tente novamente..." */
  silent?: boolean;
}

const FRIENDLY_PATTERNS: Array<{ test: RegExp; message: (ctx: string) => string }> = [
  {
    test: /duplicate key|already exists|unique constraint|23505/i,
    message: (ctx) => `${ctx}: já existe um registro com esses dados.`,
  },
  {
    test: /foreign key|violates foreign key|23503/i,
    message: (ctx) => `${ctx}: este registro está sendo usado e não pode ser modificado.`,
  },
  {
    test: /network|fetch failed|failed to fetch|net::ERR/i,
    message: (ctx) => `${ctx}: falha de conexão. Verifique sua internet.`,
  },
  {
    test: /permission|not allowed|unauthorized|forbidden|42501/i,
    message: (ctx) => `${ctx}: você não tem permissão para esta ação.`,
  },
  {
    test: /row-level security|RLS/i,
    message: (ctx) => `${ctx}: acesso negado pela política de segurança.`,
  },
  {
    test: /invalid (login|credentials)|invalid_grant/i,
    message: () => "E-mail ou senha incorretos.",
  },
  {
    test: /email not confirmed/i,
    message: () => "Confirme seu e-mail antes de fazer login.",
  },
  {
    test: /jwt|expired|invalid token/i,
    message: (ctx) => `${ctx}: sua sessão expirou. Faça login novamente.`,
  },
  {
    test: /timeout|ETIMEDOUT/i,
    message: (ctx) => `${ctx}: a operação demorou demais. Tente novamente.`,
  },
  {
    test: /validation|invalid input|400\b/i,
    message: (ctx) => `${ctx}: dados inválidos. Revise os campos e tente novamente.`,
  },
];

/**
 * Retorna uma mensagem amigável para o usuário final.
 *
 * @param error  Erro original (Error, string, objeto com .message, etc.)
 * @param context Frase curta descrevendo a operação (ex: "Salvar paciente").
 */
export function friendlyError(
  error: unknown,
  context = "Operação",
  options: FriendlyErrorOptions = {},
): string {
  const raw = extractMessage(error);

  for (const pattern of FRIENDLY_PATTERNS) {
    if (pattern.test.test(raw)) {
      return pattern.message(context);
    }
  }

  // Fallback: usa a mensagem original (limitada) + chamada de ação
  const cleaned = raw.replace(/^(error|erro):\s*/i, "").trim();
  const base = cleaned
    ? `${context}: ${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}`
    : `${context}: erro desconhecido`;
  if (options.silent) return base.endsWith(".") ? base : `${base}.`;
  return `${base}. Tente novamente ou contate o suporte.`;
}

function extractMessage(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message ?? "";
  if (typeof error === "object") {
    const anyErr = error as { message?: string; error_description?: string; hint?: string };
    return anyErr.message ?? anyErr.error_description ?? anyErr.hint ?? JSON.stringify(error);
  }
  return String(error);
}

/**
 * Hook-like helper para usar com try/catch:
 *
 *   const err = useFriendlyError();
 *   try { await service.x(); } catch (e) { err(e, "Salvar"); }
 */
export function useFriendlyError() {
  return (error: unknown, context?: string, options?: FriendlyErrorOptions) =>
    friendlyError(error, context, options);
}