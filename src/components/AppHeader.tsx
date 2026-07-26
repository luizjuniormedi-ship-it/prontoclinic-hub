import { useEffect, useState } from "react";
import { Grid3X3, HelpCircle, Search } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { NotificationBell } from "./NotificationBell";
import { UserMenu } from "./UserMenu";
import { ThemeToggle } from "./ThemeToggle";
import { AccessContextSwitcher } from "./AccessContextSwitcher";
import { NavigationCommand } from "./NavigationCommand";
import { ExplainedActionButton } from "./ExplainedActionButton";
import { canAccessRoute } from "@/config/routePermissions";
import { useActiveAccessRole } from "@/hooks/useActiveAccessRole";

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
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Storage may be unavailable in restricted browser contexts.
    }
  }, [theme]);
  return [theme, () => setTheme((current) => (current === "light" ? "dark" : "light"))] as const;
}

export function AppHeader() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [theme, toggleTheme] = useTheme();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const activeRoleName = useActiveAccessRole(user?.role_name);

  useEffect(() => {
    const openNavigation = () => setNavigationOpen(true);
    document.addEventListener("open-navigation-command", openNavigation);
    return () => document.removeEventListener("open-navigation-command", openNavigation);
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  const openHelp = () => {
    document.dispatchEvent(new CustomEvent("show-shortcuts"));
  };

  const canOpenNotificationCenter = canAccessRoute(activeRoleName, "/admin/notifications");

  return (
    <>
      <header
        className="h-14 border-b bg-card flex items-center px-4 gap-3 shrink-0"
        role="banner"
        aria-label="Cabeçalho da aplicação"
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <SidebarTrigger className="text-muted-foreground" aria-label="Alternar barra lateral" />
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <p className="font-medium">Alternar barra lateral</p>
            <p className="text-xs text-muted-foreground">
              Recolhe ou expande os atalhos do seu trabalho diário.
            </p>
          </TooltipContent>
        </Tooltip>

        <div className="hidden flex-1 max-w-xl sm:block">
          <button
            id="global-search"
            type="button"
            onClick={() => setNavigationOpen(true)}
            className="flex h-9 w-full items-center gap-2 rounded-md bg-muted/50 px-3 text-left text-sm text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Buscar telas e funções. Atalho Control K"
          >
            <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="flex-1 truncate">Buscar telas e funções...</span>
            <kbd className="hidden rounded border bg-background px-1.5 py-0.5 text-[10px] font-medium sm:inline-flex">
              Ctrl K
            </kbd>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <ExplainedActionButton
            label="Todos os módulos"
            description="Pesquise e abra qualquer área permitida para o seu perfil."
            icon={Grid3X3}
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            labelClassName="hidden xl:inline"
            onClick={() => setNavigationOpen(true)}
          />

          <AccessContextSwitcher />
          <span className="hidden md:inline-flex">
            <ThemeToggle theme={theme} onToggleTheme={toggleTheme} />
          </span>
          <NotificationBell
            onOpenCenter={canOpenNotificationCenter ? () => navigate("/admin/notifications") : undefined}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={openHelp}
                className="hidden h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:inline-flex"
                aria-label="Abrir ajuda e atalhos de teclado"
              >
                <HelpCircle className="h-4 w-4" aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Ajuda e atalhos</TooltipContent>
          </Tooltip>
          <UserMenu
            fullName={user?.full_name}
            roleName={activeRoleName}
            onOpenHelp={openHelp}
            onLogout={handleLogout}
          />
        </div>
      </header>

      <NavigationCommand
        open={navigationOpen}
        onOpenChange={setNavigationOpen}
        roleName={activeRoleName}
      />
    </>
  );
}
