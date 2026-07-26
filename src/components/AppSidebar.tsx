import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Grid3X3, Heart } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FlatSection, type MenuGroup } from "./sidebar/SidebarSection";
import { SidebarFooter } from "./sidebar/SidebarFooter";
import { getSidebarNavigation } from "@/config/navigation";
import { normalizeRoleName } from "@/config/routePermissions";
import { useActiveAccessRole } from "@/hooks/useActiveAccessRole";

const roleLabels: Record<string, string> = {
  admin: "Administração",
  gestor: "Gestão",
  recepcao: "Recepção",
  medico: "Área médica",
  enfermagem: "Enfermagem",
  laboratorio: "Laboratório",
  diagnostico: "Diagnóstico",
  farmacia: "Farmácia",
  financeiro: "Financeiro",
  dpo: "Privacidade",
  administrativo: "Administrativo",
};

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const roleName = useActiveAccessRole(user?.role_name);
  const normalizedRole = normalizeRoleName(roleName);

  const primaryGroup = useMemo<MenuGroup>(() => ({
    label: "Meu trabalho",
    items: getSidebarNavigation(roleName),
  }), [roleName]);

  const openAllModules = () => {
    document.dispatchEvent(new CustomEvent("open-navigation-command"));
  };

  const handleLogout = () => {
    void logout();
    navigate("/login");
  };

  return (
    <Sidebar
      collapsible="icon"
      className="border-r border-sidebar-border"
      role="navigation"
      aria-label="Navegação principal"
    >
      <div className="p-4 flex items-center gap-2 border-b border-sidebar-border">
        <div className="rounded-lg bg-primary p-1.5">
          <Heart className="h-5 w-5 text-primary-foreground" aria-hidden="true" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <h2 className="text-base font-bold tracking-tight">PRONTOMEDIC</h2>
            <p className="text-[10px] text-sidebar-muted leading-none truncate">
              {normalizedRole ? roleLabels[normalizedRole] : "Gestão clínica"}
            </p>
          </div>
        )}
      </div>

      <SidebarContent className="pt-2 scrollbar-thin">
        <FlatSection group={primaryGroup} collapsed={collapsed} roleName={roleName} />

        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <Tooltip delayDuration={350}>
                  <TooltipTrigger asChild>
                    <SidebarMenuButton
                      onClick={openAllModules}
                      className="w-full text-sidebar-foreground hover:bg-sidebar-accent"
                      aria-label="Abrir todos os módulos disponíveis"
                    >
                      <Grid3X3 className="h-4 w-4 shrink-0" aria-hidden="true" />
                      {!collapsed && <span>Todos os módulos</span>}
                    </SidebarMenuButton>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-xs">
                    <p className="font-medium">Todos os módulos</p>
                    <p className="text-xs text-muted-foreground">
                      Pesquise e abra qualquer área permitida para o seu perfil.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter user={user} collapsed={collapsed} onLogout={handleLogout} />
    </Sidebar>
  );
}
