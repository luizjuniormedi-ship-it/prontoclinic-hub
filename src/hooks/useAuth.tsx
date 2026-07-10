import { useState, useEffect, createContext, useContext, ReactNode, useCallback, useRef } from "react";
import { Session, User as SupabaseUser } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role_id: string | null;
  role_name: string | null;
  company_id: string | null;
  primary_unit_id: string | null;
}

interface AuthContextType {
  user: UserProfile | null;
  session: Session | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  companyId: string | null;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

async function fetchUserProfile(supabaseUser: SupabaseUser): Promise<UserProfile | null> {
  try {
    const { data, error } = await supabase
      .from("user_profiles")
      .select("id, full_name, role_id, role_name, company_id, primary_unit_id")
      .eq("id", supabaseUser.id)
      .maybeSingle();

    if (error) {
      console.error("Error fetching user profile:", error);
      return null;
    }

    if (!data) {
      // No profile row — return minimal info from auth
      return {
        id: supabaseUser.id,
        email: supabaseUser.email || "",
        full_name: supabaseUser.email || "Usuário",
        role_id: null,
        role_name: null,
        company_id: null,
        primary_unit_id: null,
      };
    }

    // Try to fetch role name
    let role_name: string | null = data.role_name ?? null;
    if (data.role_id) {
      const { data: roleData } = await supabase
        .from("roles")
        .select("name")
        .eq("id", data.role_id)
        .maybeSingle();
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
    };
  } catch (err) {
    console.error("Failed to fetch user profile:", err);
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
        timeoutId = setTimeout(
          () => reject(new Error("Tempo limite excedido ao carregar o perfil do usuário")),
          PROFILE_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const profileRequestId = useRef(0);

  const loadProfile = useCallback(async (sess: Session | null) => {
    const requestId = ++profileRequestId.current;
    if (!sess?.user) {
      setUser(null);
      setSession(null);
      setIsLoading(false);
      return;
    }
    setSession(sess);
    setIsLoading(true);
    try {
      const profile = await fetchUserProfileWithTimeout(sess.user);
      if (requestId !== profileRequestId.current) return null;
      setUser(profile);
      return profile;
    } catch (error) {
      if (requestId !== profileRequestId.current) return null;
      console.error("Failed to initialize authenticated user:", error);
      setUser(null);
      setSession(null);
      return null;
    } finally {
      if (requestId === profileRequestId.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, sess) => {
        if (active) void loadProfile(sess);
      }
    );

    const initializationTimeout = setTimeout(() => {
      if (!active) return;
      console.error("Authentication initialization timed out");
      setIsLoading(false);
    }, PROFILE_TIMEOUT_MS + 3_000);

    void supabase.auth.getSession()
      .then(({ data: { session: sess } }) => active && loadProfile(sess))
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
  }, [loadProfile]);

  const login = async (email: string, password: string) => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setIsLoading(false);
        console.error("Login error:", error.message);
        return { success: false, error: error.message };
      }
      const profile = await loadProfile(data.session);
      if (!profile) {
        await supabase.auth.signOut();
        return { success: false, error: "Não foi possível carregar o perfil e as permissões do usuário." };
      }
      return { success: true };
    } catch (err) {
      console.error("Login exception:", err);
      return { success: false, error: "Erro inesperado ao fazer login" };
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
  };

  return (
    <AuthContext.Provider value={{ user, session, isAuthenticated: !!user, isLoading, companyId: user?.company_id ?? null, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
