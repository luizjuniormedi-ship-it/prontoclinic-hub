import type { ApplicationSessionRegistration } from "@/services/authSessionService";

const ACCESS_CONTEXT_KEY = "prontomedic-access-context";
const CLIENT_DEVICE_KEY = "prontomedic-client-device-id";
const APPLICATION_SESSION_KEY = "prontomedic-application-session";

export function getClientDeviceId(): string {
  const existing = window.localStorage.getItem(CLIENT_DEVICE_KEY);
  if (existing) return existing;
  const created = window.crypto.randomUUID();
  window.localStorage.setItem(CLIENT_DEVICE_KEY, created);
  return created;
}

export function readStoredAccessContext<T>(): Partial<T> | null {
  try {
    return JSON.parse(window.sessionStorage.getItem(ACCESS_CONTEXT_KEY) ?? "null") as Partial<T> | null;
  } catch {
    window.sessionStorage.removeItem(ACCESS_CONTEXT_KEY);
    return null;
  }
}

export function writeStoredAccessContext(value: unknown): void {
  window.sessionStorage.setItem(ACCESS_CONTEXT_KEY, JSON.stringify(value));
}

export function readApplicationSession(): ApplicationSessionRegistration | null {
  try {
    return JSON.parse(window.sessionStorage.getItem(APPLICATION_SESSION_KEY) ?? "null") as ApplicationSessionRegistration | null;
  } catch {
    window.sessionStorage.removeItem(APPLICATION_SESSION_KEY);
    return null;
  }
}

export function writeApplicationSession(value: ApplicationSessionRegistration): void {
  window.sessionStorage.setItem(APPLICATION_SESSION_KEY, JSON.stringify(value));
}

export function clearApplicationSession(): void {
  window.sessionStorage.removeItem(APPLICATION_SESSION_KEY);
  window.sessionStorage.removeItem(ACCESS_CONTEXT_KEY);
}
