/**
 * Validação tipada de variáveis de ambiente.
 *
 * Por que isso existe: o projeto tinha SUPABASE_URL e SUPABASE_ANON_KEY
 * hardcoded em src/lib/supabase.ts. Migramos para .env com validação Zod
 * para falhar rápido se alguma variável faltar, e tipar tudo.
 *
 * Uso:
 *   import { env } from "@/lib/env";
 *   console.log(env.SUPABASE_URL);
 */

import { z } from "zod";

const envSchema = z.object({
  VITE_SUPABASE_URL: z
    .string()
    .url("VITE_SUPABASE_URL deve ser uma URL válida")
    .refine(
      (u) => {
        const { hostname } = new URL(u);
        return hostname.endsWith("supabase.co")
          || hostname === "localhost"
          || hostname === "127.0.0.1"
          || hostname === "191.252.196.6"
          || hostname === "vps68804.publiccloud.com.br"
          || hostname === "prontomedic.191-252-196-6.sslip.io";
      },
      "VITE_SUPABASE_URL deve apontar para um projeto Supabase ou servidor local"
    ),
  VITE_SUPABASE_ANON_KEY: z
    .string()
    .min(5, "VITE_SUPABASE_ANON_KEY inválida"),
  VITE_APP_NAME: z.string().default("ProntoMedic"),
  VITE_APP_ENV: z.enum(["development", "staging", "production"]).default("development"),
  VITE_APP_URL: z.string().url().optional(),
  VITE_RESEND_API_KEY: z.string().optional(),
  VITE_EMAIL_FROM: z.string().email().optional(),
  VITE_EMAIL_REPLY_TO: z.string().email().optional(),
  VITE_TEMPLATES_PATH: z.string().optional(),
  VITE_ZAPI_INSTANCE_ID: z.string().optional(),
  VITE_ZAPI_TOKEN: z.string().optional(),
  VITE_TWILIO_ACCOUNT_SID: z.string().optional(),
  VITE_TWILIO_AUTH_TOKEN: z.string().optional(),
  VITE_TWILIO_FROM_NUMBER: z.string().optional(),
  VITE_DAILY_DOMAIN: z.string().optional(),
  VITE_S3_BUCKET: z.string().optional(),
  VITE_S3_REGION: z.string().default("us-east-1"),
  VITE_ENABLE_TELEMEDICINE: z.string().transform((v) => v === "true").default("false"),
  VITE_ENABLE_WHATSAPP: z.string().transform((v) => v === "true").default("false"),
  VITE_ENABLE_MODULE_19: z.string().transform((v) => v === "true").default("true"),
  VITE_ENABLE_MODULE_20: z.string().transform((v) => v === "true").default("false"),
  VITE_ENABLE_MODULE_21: z.string().transform((v) => v === "true").default("false"),
  VITE_ENABLE_MODULE_22: z.string().transform((v) => v === "true").default("false"),
  VITE_ENABLE_MODULE_23: z.string().transform((v) => v === "true").default("false"),
  VITE_ENABLE_MODULE_24: z.string().transform((v) => v === "true").default("false"),
  VITE_DICOM_BUCKET: z.string().optional(),
  VITE_TISS_VERSION: z.literal("4.03.00").default("4.03.00"),
  VITE_TISS_AMBIENTE: z.enum(["HOMOLOGACAO", "PRODUCAO"]).default("HOMOLOGACAO"),
});

function validateEnv() {
  const parsed = envSchema.safeParse(import.meta.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    const helpText = `\n=========================================================================\n  ProntoMedic — Configuração inválida de variáveis de ambiente\n=========================================================================\n${issues}\n\n  Como corrigir:\n  1. Copie o arquivo .env.example para .env:\n     $ cp .env.example .env\n  2. Preencha os valores reais do seu projeto Supabase.\n  3. Reinicie o servidor de desenvolvimento (npm run dev).\n\n  Para criar um projeto Supabase novo:\n  https://supabase.com/dashboard\n=========================================================================\n`;
    throw new Error(helpText);
  }
  return parsed.data;
}

export const env = validateEnv();
export const isProduction = env.VITE_APP_ENV === "production";
export const isDevelopment = env.VITE_APP_ENV === "development";
export const isStaging = env.VITE_APP_ENV === "staging";
export const features = {
  telemedicine: env.VITE_ENABLE_TELEMEDICINE,
  whatsapp: env.VITE_ENABLE_WHATSAPP,
  module19: env.VITE_ENABLE_MODULE_19,
  module20: env.VITE_ENABLE_MODULE_20,
  module21: env.VITE_ENABLE_MODULE_21,
  module22: env.VITE_ENABLE_MODULE_22,
  module23: env.VITE_ENABLE_MODULE_23,
  module24: env.VITE_ENABLE_MODULE_24,
} as const;
