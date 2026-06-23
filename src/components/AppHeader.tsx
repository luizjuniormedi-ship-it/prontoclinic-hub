import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { NotificationBell } from "./NotificationBell";
import { UserMenu } from "./UserMenu";
import { CompanySwitcher } from "./CompanySwitcher";

const STORAGE_KEY = "prontomedic-theme";
type Theme = "light" | "dark";

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function useTheme() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    try { window.localStorage.setItem(STORAGE_KEY, theme); } catch { /* ignore */ }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === "light" ? "dark" : "light"))] as const;
}

export function AppHeader() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [theme, toggleTheme] = useTheme();

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <header
      className="h-14 border-b bg-card flex items-center px-4 gap-4 shrink-0"
      role="banner"
      aria-label="Cabeçalho da aplicação"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <SidebarTrigger className="text-muted-foreground" aria-label="Alternar barra lateral" />
        </TooltipTrigger>
        <TooltipContent>Alternar barra lateral</TooltipContent>
      </Tooltip>

      <div className="flex-1 max-w-md">
        <div className="relative">
          <label htmlFor="global-search" className="sr-only">Buscar (atalho Ctrl+K)</label>
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
            aria-hidden="true"
          />
          <Input
            id="global-search"
            placeholder="Buscar pacientes, agendamentos..."
            className="pl-9 h-9 bg-muted/50 border-0 focus-visible:ring-1"
            aria-keyshortcuts="Control+K"
            aria-describedby="global-search-hint"
          />
          <span id="global-search-hint" className="sr-only">
            Use Control mais K para focar este campo a qualquer momento.
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <CompanySwitcher theme={theme} onToggleTheme={toggleTheme} />
        <NotificationBell count={3} />
        <UserMenu fullName={user?.full_name} roleName={user?.role_name} onLogout={handleLogout} />
      </div>
    </header>
  );
}
