import { useEffect, useState } from "react";
import { Search, Bell, LogOut, Sun, Moon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function AppHeader() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  // Theme state — defaults to light, persists in localStorage
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    const stored = window.localStorage.getItem("prontomedic-theme");
    if (stored === "dark" || stored === "light") return stored;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    try {
      window.localStorage.setItem("prontomedic-theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  // Mock unread notifications count — replace with real data when available
  const unreadNotifications = 3;

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  const initials = user?.full_name
    ? user.full_name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()
    : "U";

  const userMenuLabel = `Menu do usuário, ${user?.full_name ?? "convidado"}`;
  const notificationsLabel = `${unreadNotifications} notificações não lidas`;
  const searchShortcutLabel = "Buscar (atalho Ctrl+K)";

  return (
    <header
      className="h-14 border-b bg-card flex items-center px-4 gap-4 shrink-0"
      role="banner"
      aria-label="Cabeçalho da aplicação"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <SidebarTrigger
            className="text-muted-foreground"
            aria-label="Alternar barra lateral"
          />
        </TooltipTrigger>
        <TooltipContent>Alternar barra lateral</TooltipContent>
      </Tooltip>
      <div className="flex-1 max-w-md">
        <div className="relative">
          <label htmlFor="global-search" className="sr-only">
            {searchShortcutLabel}
          </label>
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
        {/* Theme toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground"
              onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
              aria-label={`Alternar para tema ${theme === "light" ? "escuro" : "claro"}`}
              aria-pressed={theme === "dark"}
            >
              {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{theme === "light" ? "Tema escuro" : "Tema claro"}</TooltipContent>
        </Tooltip>

        {/* Notifications */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative text-muted-foreground"
              aria-label={notificationsLabel}
              aria-describedby="notifications-count"
            >
              <Bell className="h-4 w-4" aria-hidden="true" />
              {unreadNotifications > 0 && (
                <>
                  <span
                    className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-destructive"
                    aria-hidden="true"
                  />
                  <span id="notifications-count" className="sr-only">
                    {notificationsLabel}
                  </span>
                </>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Notificações</TooltipContent>
        </Tooltip>

        {/* User avatar + role */}
        <div className="flex items-center gap-2 ml-2" aria-label={userMenuLabel}>
          <Avatar className="h-7 w-7" aria-hidden="true">
            <AvatarFallback className="text-xs bg-primary/10 text-primary">{initials}</AvatarFallback>
          </Avatar>
          <div className="hidden md:block text-xs">
            <p className="font-medium text-foreground leading-tight">{user?.full_name}</p>
            {user?.role_name && (
              <p className="text-muted-foreground leading-tight">{user.role_name}</p>
            )}
          </div>
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground"
              onClick={handleLogout}
              aria-label="Sair da conta"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Sair</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}