import { useState, useEffect, createContext, useContext, ReactNode, useCallback } from "react";
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
  avatar_url: string | null;
}

interface AuthContextType {
  user: UserProfile | null;
  session: Session | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

async function fetchUserProfile(supabaseUser: SupabaseUser): Promise<UserProfile | null> {
  try {
    const { data, error } = await supabase
      .from("user_profiles")
      .select("id, full_name, role_id, company_id, primary_unit_id, avatar_url")
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
        avatar_url: null,
      };
    }

    // Try to fetch role name
    let role_name: string | null = null;
    if (data.role_id) {
      const { data: roleData } = await supabase
        .from("roles")
        .select("name")
        .eq("id", data.role_id)
        .maybeSingle();
      role_name = roleData?.name || null;
    }

    return {
      id: data.id,
      email: supabaseUser.email || "",
      full_name: data.full_name || supabaseUser.email || "Usuário",
      role_id: data.role_id,
      role_name,
      company_id: data.company_id,
      primary_unit_id: data.primary_unit_id,
      avatar_url: data.avatar_url,
    };
  } catch (err) {
    console.error("Failed to fetch user profile:", err);
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadProfile = useCallback(async (sess: Session | null) => {
    if (!sess?.user) {
      setUser(null);
      setSession(null);
      setIsLoading(false);
      return;
    }
    setSession(sess);
    const profile = await fetchUserProfile(sess.user);
    setUser(profile);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    // Set up listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, sess) => {
        await loadProfile(sess);
      }
    );

    // Then get existing session
    supabase.auth.getSession().then(({ data: { session: sess } }) => {
      loadProfile(sess);
    });

    return () => subscription.unsubscribe();
  }, [loadProfile]);

  const login = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        console.error("Login error:", error.message);
        return { success: false, error: error.message };
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
    <AuthContext.Provider value={{ user, session, isAuthenticated: !!user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
