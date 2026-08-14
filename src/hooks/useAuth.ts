import { createContext, useContext } from "react";
import type { Session } from "@supabase/supabase-js";
import { normalizeRoleName } from "@/config/routePermissions";

export { AuthProvider } from "@/hooks/AuthProvider";

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role_id: number | null;
  role_name: string | null;
  company_id: string | null;
  primary_unit_id: number | null;
  lg_ativo: boolean;
  must_change_password: boolean;
}

const CORPORATE_ROLES_WITHOUT_UNIT = new Set([
  "admin",
  "gestor",
  "financeiro",
  "auditor",
  "dpo",
]);

export function isProfileAccessAllowed(profile: UserProfile | null): profile is UserProfile {
  if (!profile?.lg_ativo || !profile.company_id || !(profile.role_id || profile.role_name)) return false;
  const roleName = normalizeRoleName(profile.role_name) ?? profile.role_name?.trim().toLowerCase();
  return Boolean(profile.primary_unit_id || (roleName && CORPORATE_ROLES_WITHOUT_UNIT.has(roleName)));
}

export function requiresPasswordChange(profile: UserProfile): boolean {
  return profile.must_change_password === true;
}

export type MfaStep = "none" | "challenge" | "enroll" | "verified";
export type AuthNextAction = "authenticated" | "mfa-challenge" | "mfa-enroll" | "password-change";

export interface AuthResult {
  success: boolean;
  next?: AuthNextAction;
  error?: string;
}

export interface AuthContextType {
  user: UserProfile | null;
  session: Session | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  companyId: string | null;
  activeCompanyId: string | null;
  activeUnitId: number | null;
  mfaStep: MfaStep;
  mfaFactorId: string | null;
  mustChangePassword: boolean;
  passwordRecoveryAuthorized: boolean;
  login: (email: string, password: string) => Promise<AuthResult>;
  verifyMfa: (code: string, factorId?: string) => Promise<AuthResult>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
