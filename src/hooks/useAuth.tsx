import { useState, useEffect, createContext, useContext, ReactNode, useCallback, useRef } from "react";
import { Session, User as SupabaseUser } from "@supabase/supabase-js";
import { normalizeRoleName } from "@/config/routePermissions";
import { supabase } from "@/lib/supabase";
import { getMfaNextStep, verifyTotpFactor } from "@/services/authMfaService";
import { authSessionService } from "@/services/authSessionService";
import { clearApplicationSession, readApplicationSession } from "@/services/applicationSessionStorage";

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

interface AuthContextType {
  user: UserProfile | null;
  session: Session | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  companyId: string | null;
  mfaStep: MfaStep;
  mfaFactorId: string | null;
  mustChangePassword: boolean;
  passwordRecoveryAuthorized: boolean;
  login: (email: string, password: string) => Promise<AuthResult>;
  verifyMfa: (code: string, factorId?: string) => Promise<AuthResult>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

async function fetchUserProfile(supabaseUser: SupabaseUser): Promise<UserProfile | null> {
  try {
    const { data, error } = await supabase
      .from("user_profiles")
      .select("id, full_name, role_id, role_name, company_id, primary_unit_id, lg_ativo, must_change_password")
      .eq("id", supabaseUser.id)
      .maybeSingle();
    if (error) {
      console.error("Error fetching user profile:", error);
      return null;
    }
    if (!data) return null;

    let role_name: string | null = data.role_name ?? null;
    if (data.role_id) {
      const { data: roleData } = await supabase.from("roles").select("name").eq("id", data.role_id).maybeSingle();
      role_name = roleData?.name || role_name;
    }
    const profile: UserProfile = {
      id: data.id,
      email: supabaseUser.email || "",
      full_name: data.full_name || supabaseUser.email || "Usuário",
      role_id: data.role_id,
      role_name,
      company_id: data.company_id,
      primary_unit_id: data.primary_unit_id,
      lg_ativo: data.lg_ativo === true,
      must_change_password: data.must_change_password === true,
    };
    return isProfileAccessAllowed(profile) ? profile : null;
  } catch (error) {
    console.error("Failed to fetch user profile:", error);
    return null;
  }
}

const PROFILE_TIMEOUT_MS = 12_000;
async function fetchUserProfileWithTimeout(supabaseUser: SupabaseUser): Promise<UserProfile | null> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fetchUserProfile(supabaseUser),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("Tempo limite excedido ao carregar o perfil do usuário")), PROFILE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function actionForMfaStep(step: MfaStep): AuthNextAction {
  return step === "challenge" ? "mfa-challenge" : "mfa-enroll";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [mfaStep, setMfaStep] = useState<MfaStep>("none");
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [passwordRecoveryAuthorized, setPasswordRecoveryAuthorized] = useState(false);
  const profileRequestId = useRef(0);

  const initializeSession = useCallback(async (sess: Session | null): Promise<AuthResult> => {
    const requestId = ++profileRequestId.current;
    if (!sess?.user) {
      setUser(null);
      setSession(null);
      setMfaStep("none");
      setMfaFactorId(null);
      setMustChangePassword(false);
      setIsLoading(false);
      return { success: false };
    }

    setSession(sess);
    setUser(null);
    setIsLoading(true);
    try {
      const nextMfa = await getMfaNextStep(supabase.auth.mfa);
      if (requestId !== profileRequestId.current) return { success: false };
      if (nextMfa.kind !== "verified") {
        setMfaStep(nextMfa.kind);
        setMfaFactorId(nextMfa.kind === "challenge" ? nextMfa.factorId : null);
        return { success: true, next: actionForMfaStep(nextMfa.kind) };
      }

      setMfaStep("verified");
      setMfaFactorId(null);
      const profile = await fetchUserProfileWithTimeout(sess.user);
      if (requestId !== profileRequestId.current) return { success: false };
      if (!profile) {
        await supabase.auth.signOut({ scope: "local" });
        if (requestId !== profileRequestId.current) return { success: false };
        setUser(null);
        setSession(null);
        setMfaStep("none");
        return { success: false, error: "Não foi possível carregar o perfil e as permissões do usuário." };
      }
      setUser(profile);
      const passwordChangeRequired = requiresPasswordChange(profile);
      setMustChangePassword(passwordChangeRequired);
      if (passwordChangeRequired) return { success: true, next: "password-change" };
      return { success: true, next: "authenticated" };
    } catch (error) {
      if (requestId !== profileRequestId.current) return { success: false };
      console.error("Failed to initialize authenticated user:", error);
      setUser(null);
      return { success: false, error: error instanceof Error ? error.message : "Erro ao validar autenticação" };
    } finally {
      if (requestId === profileRequestId.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, sess) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY") setPasswordRecoveryAuthorized(true);
      if (event === "SIGNED_OUT") setPasswordRecoveryAuthorized(false);
      void initializeSession(sess);
    });
    const initializationTimeout = setTimeout(() => {
      if (active) setIsLoading(false);
    }, PROFILE_TIMEOUT_MS + 3_000);
    void supabase.auth.getSession()
      .then(({ data: { session: sess } }) => active && initializeSession(sess))
      .catch((error) => {
        console.error("Failed to restore authentication session:", error);
        if (active) setIsLoading(false);
      })
      .finally(() => clearTimeout(initializationTimeout));
    return () => {
      active = false;
      clearTimeout(initializationTimeout);
      subscription.unsubscribe();
    };
  }, [initializeSession]);

  const login = async (email: string, password: string): Promise<AuthResult> => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { success: false, error: error.message };
      return await initializeSession(data.session);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Erro inesperado ao fazer login" };
    } finally {
      setIsLoading(false);
    }
  };

  const verifyMfa = async (code: string, factorId?: string): Promise<AuthResult> => {
    const selectedFactor = factorId ?? mfaFactorId;
    if (!selectedFactor) return { success: false, error: "Fator MFA não encontrado." };
    try {
      await verifyTotpFactor(supabase.auth.mfa, selectedFactor, code);
      const { data } = await supabase.auth.getSession();
      return await initializeSession(data.session);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Código MFA inválido." };
    }
  };

  const logout = async () => {
    const registration = readApplicationSession();
    if (registration) {
      await authSessionService.logoutLocal(registration.session_id);
    } else {
      await supabase.auth.signOut({ scope: "local" });
    }
    clearApplicationSession();
    profileRequestId.current += 1;
    setUser(null);
    setSession(null);
    setMfaStep("none");
    setMfaFactorId(null);
    setMustChangePassword(false);
    setPasswordRecoveryAuthorized(false);
  };

  return (
    <AuthContext.Provider value={{
      user,
      session,
      isAuthenticated: Boolean(user && mfaStep === "verified" && !mustChangePassword),
      isLoading,
      companyId: user?.company_id ?? null,
      mfaStep,
      mfaFactorId,
      mustChangePassword,
      passwordRecoveryAuthorized,
      login,
      verifyMfa,
      logout,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
