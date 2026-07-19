import { useState, useEffect, createContext, useContext, ReactNode, useCallback, useRef } from "react";
import { Session, User as SupabaseUser } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import {
  AUTH_RETURN_PATH_KEY,
  getAuthDeviceId,
  recordAuthSecurityEvent,
  registerAuthDevice,
  rememberAuthReturnPath,
} from "@/lib/authSecurity";

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role_id: string | null;
  role_name: string | null;
  company_id: string | null;
  primary_unit_id: string | null;
  lg_ativo: boolean;
  must_change_password: boolean;
  password_expires_at: string | null;
  mfa_required: boolean;
  blocked_at: string | null;
  access_valid_until: string | null;
}

export interface TwoFactorChallenge {
  factorId: string;
  challengeId: string;
}

interface LoginResult {
  success: boolean;
  error?: string;
  requires2FA?: boolean;
}

interface AuthContextType {
  user: UserProfile | null;
  session: Session | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  companyId: string | null;
  requiresPasswordChange: boolean;
  twoFactor: TwoFactorChallenge | null;
  login: (email: string, password: string) => Promise<LoginResult>;
  verifyTwoFactor: (code: string) => Promise<{ success: boolean; error?: string }>;
  logout: (scope?: "local" | "global") => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);
const PROFILE_TIMEOUT_MS = 12_000;
const IDLE_TIMEOUT_MS = Math.max(5, Number(import.meta.env.VITE_AUTH_IDLE_TIMEOUT_MINUTES || 30)) * 60_000;

type ProfileResult = { profile: UserProfile | null; requires2FA: boolean; error?: string };

async function fetchUserProfile(supabaseUser: SupabaseUser): Promise<UserProfile | null> {
  let { data, error } = await supabase
    .from("user_profiles")
    .select("id, full_name, role_id, role_name, company_id, primary_unit_id, lg_ativo, blocked_at, access_valid_until")
    .eq("id", supabaseUser.id)
    .maybeSingle();
  // Keep local/legacy installations readable until the Module 2 migration is applied.
  if (error) {
    const legacy = await supabase
      .from("user_profiles")
      .select("id, full_name, role_id, role_name, company_id, primary_unit_id, lg_ativo")
      .eq("id", supabaseUser.id)
      .maybeSingle();
    data = legacy.data
      ? { ...legacy.data, blocked_at: null, access_valid_until: null }
      : null;
    error = legacy.error;
  }
  if (error) {
    console.error("Error fetching user profile:", error);
    return null;
  }
  if (!data) return null;

  const { data: security } = await supabase
    .from("auth_account_security")
    .select("must_change_password, password_expires_at, mfa_required")
    .eq("user_id", supabaseUser.id)
    .maybeSingle();

  let role_name: string | null = data.role_name ?? null;
  if (data.role_id) {
    const { data: roleData } = await supabase.from("roles").select("name").eq("id", data.role_id).maybeSingle();
    role_name = roleData?.name || role_name;
  }
  return {
    id: data.id,
    email: supabaseUser.email || "",
    full_name: data.full_name || supabaseUser.email || "Usuário",
    role_id: data.role_id,
    role_name,
    company_id: data.company_id,
    primary_unit_id: data.primary_unit_id,
    lg_ativo: data.lg_ativo ?? true,
    must_change_password: security?.must_change_password ?? false,
    password_expires_at: security?.password_expires_at ?? null,
    mfa_required: security?.mfa_required ?? false,
    blocked_at: (data as { blocked_at?: string | null }).blocked_at ?? null,
    access_valid_until: (data as { access_valid_until?: string | null }).access_valid_until ?? null,
  };
}

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("Tempo limite excedido ao carregar o perfil")), PROFILE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function createMfaChallenge(): Promise<TwoFactorChallenge | null> {
  const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
  if (factorsError) throw factorsError;
  const factor = factors.totp.find((candidate) => candidate.status === "verified");
  if (!factor) return null;
  const { data, error } = await supabase.auth.mfa.challenge({ factorId: factor.id });
  if (error) throw error;
  return { factorId: factor.id, challengeId: data.id };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [twoFactor, setTwoFactor] = useState<TwoFactorChallenge | null>(null);
  const [twoFactorError, setTwoFactorError] = useState<string | undefined>();
  const profileRequestId = useRef(0);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>();

  const loadProfile = useCallback(async (sess: Session | null): Promise<ProfileResult> => {
    const requestId = ++profileRequestId.current;
    if (!sess?.user) {
      setUser(null);
      setSession(null);
      setTwoFactor(null);
      setIsLoading(false);
      return { profile: null, requires2FA: false };
    }
    setSession(sess);
    setIsLoading(true);
    try {
      const profile = await withTimeout(fetchUserProfile(sess.user));
      if (requestId !== profileRequestId.current) return { profile: null, requires2FA: false };
      const accessExpired = profile?.access_valid_until ? new Date(profile.access_valid_until).getTime() <= Date.now() : false;
      if (!profile || !profile.lg_ativo || profile.blocked_at || accessExpired) {
        setUser(null);
        return { profile: null, requires2FA: false, error: "Sua conta está inativa. Procure um administrador." };
      }

      const { data: aal, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aalError) throw aalError;
      const needsMfa = aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2";
      if (needsMfa || profile.mfa_required) {
        const challenge = await createMfaChallenge();
        if (!challenge) {
          setTwoFactor(null);
          setTwoFactorError("Sua conta exige 2FA, mas nenhum autenticador verificado está disponível.");
          setUser(null);
          return { profile: null, requires2FA: false, error: "Sua conta exige 2FA, mas nenhum autenticador verificado está disponível." };
        }
        setTwoFactor(challenge);
        setTwoFactorError(undefined);
        setUser(null);
        await recordAuthSecurityEvent("mfa_challenge", profile.id, profile.company_id);
        return { profile: null, requires2FA: true };
      }

      setTwoFactor(null);
      setTwoFactorError(undefined);
      setUser(profile);
      void registerAuthDevice(profile.id, profile.company_id);
      void recordAuthSecurityEvent("login_success", profile.id, profile.company_id, { device_id: getAuthDeviceId() });
      return { profile, requires2FA: false };
    } catch (error) {
      if (requestId !== profileRequestId.current) return { profile: null, requires2FA: false };
      console.error("Failed to initialize authenticated user:", error);
      setUser(null);
      setSession(null);
      return { profile: null, requires2FA: false, error: "Não foi possível validar sua sessão." };
    } finally {
      if (requestId === profileRequestId.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, sess) => {
      if (active) void loadProfile(sess);
    });
    void supabase.auth.getSession().then(({ data: { session: sess } }) => active && loadProfile(sess));
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  const login = async (email: string, password: string): Promise<LoginResult> => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        setIsLoading(false);
        return { success: false, error: error.message };
      }
      const result = await loadProfile(data.session);
      if (result.requires2FA) return { success: true, requires2FA: true };
      if (!result.profile) {
        await supabase.auth.signOut({ scope: "local" });
        return { success: false, error: result.error || "Não foi possível carregar o perfil e as permissões do usuário." };
      }
      return { success: true };
    } catch (err) {
      setIsLoading(false);
      return { success: false, error: err instanceof Error ? err.message : "Erro inesperado ao fazer login" };
    }
  };

  const verifyTwoFactor = async (code: string) => {
    if (!twoFactor) return { success: false, error: "Desafio 2FA não encontrado. Faça login novamente." };
    const { error } = await supabase.auth.mfa.verify({ ...twoFactor, code });
    if (error) {
      if (session?.user) void recordAuthSecurityEvent("mfa_failure", session.user.id, user?.company_id ?? null);
      return { success: false, error: "Código 2FA inválido ou expirado." };
    }
    const { data: sessionData } = await supabase.auth.getSession();
    const result = await loadProfile(sessionData.session ?? session);
    if (!result.profile) return { success: false, error: result.error || "Não foi possível concluir a autenticação." };
    void recordAuthSecurityEvent("mfa_success", result.profile.id, result.profile.company_id);
    return { success: true };
  };

  const logout = useCallback(async (scope: "local" | "global" = "local") => {
    const current = user;
    rememberAuthReturnPath();
    if (current) void recordAuthSecurityEvent(scope === "global" ? "logout_all" : "logout", current.id, current.company_id);
    await supabase.auth.signOut({ scope });
    setUser(null);
    setSession(null);
    setTwoFactor(null);
  }, [user]);

  const requiresPasswordChange = !!user && (user.must_change_password || (user.password_expires_at ? new Date(user.password_expires_at).getTime() <= Date.now() : false));

  useEffect(() => {
    if (!user) return;
    const resetTimer = () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => {
        rememberAuthReturnPath();
        void recordAuthSecurityEvent("session_expired", user.id, user.company_id);
        void logout("local");
      }, IDLE_TIMEOUT_MS);
    };
    const events = ["pointerdown", "keydown", "touchstart", "mousemove"] as const;
    events.forEach((event) => window.addEventListener(event, resetTimer, { passive: true }));
    resetTimer();
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      events.forEach((event) => window.removeEventListener(event, resetTimer));
    };
  }, [user, logout]);

  return (
    <AuthContext.Provider value={{
      user, session, isAuthenticated: !!user, isLoading, companyId: user?.company_id ?? null,
      requiresPasswordChange, twoFactor, login, verifyTwoFactor, logout,
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
