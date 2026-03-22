import { useState, createContext, useContext, ReactNode } from "react";
import { User } from "@/types";

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);
const AUTH_STORAGE_KEY = "prontomedic_auth";

const mockUser: User = {
  id: "1",
  name: "Dr. Ricardo Mendes",
  email: "ricardo@prontomedic.com",
  role: "admin",
};

function safeGetStorageValue(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetStorageValue(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // storage may be blocked by browser privacy settings
  }
}

function safeRemoveStorageValue(key: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // storage may be blocked by browser privacy settings
  }
}

function getStoredUser(): User | null {
  const stored = safeGetStorageValue(AUTH_STORAGE_KEY);
  if (!stored) return null;

  try {
    const parsed = JSON.parse(stored) as Partial<User>;

    if (!parsed || typeof parsed !== "object" || !parsed.email) {
      safeRemoveStorageValue(AUTH_STORAGE_KEY);
      return null;
    }

    return parsed as User;
  } catch {
    safeRemoveStorageValue(AUTH_STORAGE_KEY);
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(getStoredUser);

  const login = async (email: string, _password: string) => {
    // Mock login — replace with real auth
    if (email) {
      setUser(mockUser);
      safeSetStorageValue(AUTH_STORAGE_KEY, JSON.stringify(mockUser));
      return true;
    }
    return false;
  };

  const logout = () => {
    setUser(null);
    safeRemoveStorageValue(AUTH_STORAGE_KEY);
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
