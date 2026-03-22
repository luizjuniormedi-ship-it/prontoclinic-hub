import { useState, createContext, useContext, ReactNode } from "react";
import { User } from "@/types";

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

const mockUser: User = {
  id: "1",
  name: "Dr. Ricardo Mendes",
  email: "ricardo@prontomedic.com",
  role: "admin",
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const stored = localStorage.getItem("prontomedic_auth");
    return stored ? JSON.parse(stored) : null;
  });

  const login = async (email: string, _password: string) => {
    // Mock login — replace with real auth
    if (email) {
      setUser(mockUser);
      localStorage.setItem("prontomedic_auth", JSON.stringify(mockUser));
      return true;
    }
    return false;
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem("prontomedic_auth");
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
