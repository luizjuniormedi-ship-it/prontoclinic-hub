/**
 * Cliente Supabase singleton.
 *
 * IMPORTANTE: Este arquivo NÃO deve conter credenciais hardcoded.
 * As credenciais vêm de variáveis de ambiente validadas em src/lib/env.ts.
 *
 * Migração de credenciais hardcoded (commit 5911625) para .env:
 * - Criar .env na raiz com VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
 * - Copiar .env.example para ter um template seguro
 * - Adicionar .env no .gitignore (já está)
 *
 * Referência: AUDIT_PROMPT.md §13 Problemas de Segurança
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

export const supabase: SupabaseClient = createClient(
  env.VITE_SUPABASE_URL,
  env.VITE_SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: typeof window !== "undefined" ? window.localStorage : undefined,
    },
    realtime: { params: { eventsPerSecond: 2 } },
    global: { headers: { "x-application-name": env.VITE_APP_NAME } },
  }
);

export async function checkSupabaseConnection(): Promise<boolean> {
  try {
    const { error } = await supabase.from("companies").select("id").limit(1);
    return !error;
  } catch {
    return false;
  }
}