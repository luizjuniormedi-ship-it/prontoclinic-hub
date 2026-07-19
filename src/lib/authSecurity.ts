import { supabase } from "@/lib/supabase";

export const PASSWORD_POLICY = {
  minLength: 10,
  requiresUppercase: true,
  requiresLowercase: true,
  requiresNumber: true,
  requiresSymbol: true,
} as const;

export function validatePassword(password: string): string[] {
  const errors: string[] = [];
  if (password.length < PASSWORD_POLICY.minLength) errors.push(`Use pelo menos ${PASSWORD_POLICY.minLength} caracteres.`);
  if (PASSWORD_POLICY.requiresUppercase && !/[A-Z]/.test(password)) errors.push("Inclua uma letra maiúscula.");
  if (PASSWORD_POLICY.requiresLowercase && !/[a-z]/.test(password)) errors.push("Inclua uma letra minúscula.");
  if (PASSWORD_POLICY.requiresNumber && !/\d/.test(password)) errors.push("Inclua um número.");
  if (PASSWORD_POLICY.requiresSymbol && !/[^\w\s]/.test(password)) errors.push("Inclua um símbolo.");
  return errors;
}

export function getAuthDeviceId(): string {
  if (typeof window === "undefined") return "server-device";
  const key = "prontomedic.auth.device_id";
  const existing = window.localStorage.getItem(key);
  if (existing && /^[a-f0-9-]{16,128}$/i.test(existing)) return existing;
  const value = typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.localStorage.setItem(key, value);
  return value;
}

export function getAuthDeviceLabel(): string {
  if (typeof navigator === "undefined") return "Navegador";
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return "Microsoft Edge";
  if (/Chrome\//.test(ua)) return "Google Chrome";
  if (/Firefox\//.test(ua)) return "Mozilla Firefox";
  if (/Safari\//.test(ua)) return "Safari";
  return "Navegador";
}

export type AuthSecurityEventType =
  | "login_success" | "login_failure" | "logout" | "logout_all"
  | "mfa_challenge" | "mfa_success" | "mfa_failure" | "password_changed"
  | "password_recovery_requested" | "session_expired" | "device_revoked" | "account_blocked";

export async function recordAuthSecurityEvent(
  eventType: AuthSecurityEventType,
  userId: string | null,
  companyId: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  if (!userId) return;
  const { error } = await supabase.from("auth_security_events").insert({
    event_type: eventType,
    user_id: userId,
    company_id: companyId,
    success: !eventType.endsWith("failure"),
    metadata,
    user_agent: typeof navigator === "undefined" ? null : navigator.userAgent.slice(0, 1000),
  });
  if (error) console.warn("Não foi possível registrar evento de segurança", error.message);
}

export async function registerAuthDevice(userId: string, companyId: string | null): Promise<void> {
  const { error } = await supabase.from("auth_session_devices").upsert({
    user_id: userId,
    company_id: companyId,
    device_id: getAuthDeviceId(),
    device_label: getAuthDeviceLabel(),
    user_agent: typeof navigator === "undefined" ? null : navigator.userAgent.slice(0, 1000),
    last_seen_at: new Date().toISOString(),
    revoked_at: null,
  }, { onConflict: "user_id,device_id" });
  if (error) console.warn("Não foi possível registrar este dispositivo", error.message);
}

export async function listAuthDevices() {
  const { data, error } = await supabase
    .from("auth_session_devices")
    .select("id, device_id, device_label, user_agent, last_seen_at, created_at, revoked_at")
    .order("last_seen_at", { ascending: false });
  if (error) throw new Error(`Não foi possível carregar dispositivos: ${error.message}`);
  return data ?? [];
}

export async function revokeAuthDevice(id: string): Promise<void> {
  const { error } = await supabase
    .from("auth_session_devices")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`Não foi possível revogar o dispositivo: ${error.message}`);
}

export const AUTH_RETURN_PATH_KEY = "prontomedic.auth.return_path";

export function rememberAuthReturnPath(): void {
  if (typeof window === "undefined") return;
  const path = `${window.location.pathname}${window.location.search}`;
  if (path !== "/login" && path !== "/forgot-password" && path !== "/reset-password") {
    window.sessionStorage.setItem(AUTH_RETURN_PATH_KEY, path);
  }
}

export function consumeAuthReturnPath(): string {
  if (typeof window === "undefined") return "/";
  const value = window.sessionStorage.getItem(AUTH_RETURN_PATH_KEY) || "/";
  window.sessionStorage.removeItem(AUTH_RETURN_PATH_KEY);
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}
