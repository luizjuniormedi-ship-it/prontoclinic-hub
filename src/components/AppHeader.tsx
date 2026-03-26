import { Search, Bell, LogOut } from "lucide-react";
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

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  const initials = user?.full_name
    ? user.full_name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()
    : "U";

  return (
    <header className="h-14 border-b bg-card flex items-center px-4 gap-4 shrink-0">
      <SidebarTrigger className="text-muted-foreground" />
      <div className="flex-1 max-w-md">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar pacientes, agendamentos..."
            className="pl-9 h-9 bg-muted/50 border-0 focus-visible:ring-1"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="relative text-muted-foreground">
          <Bell className="h-4 w-4" />
          <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-destructive" />
        </Button>

        <div className="flex items-center gap-2 ml-2">
          <Avatar className="h-7 w-7">
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
            <Button variant="ghost" size="icon" className="text-muted-foreground" onClick={handleLogout}>
              <LogOut className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Sair</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
