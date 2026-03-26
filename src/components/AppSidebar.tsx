import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import {
  LayoutDashboard, Users, Calendar, FileText, DollarSign, Settings, LogOut,
  Heart, UserCheck, Stethoscope, ShieldCheck, UserCog, KeyRound, Phone,
  ClipboardList, Monitor, Receipt, Banknote, Building2, Database
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";
import { NavLink } from "@/components/NavLink";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getInitials } from "@/utils/formatters";

const mainItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Pacientes", url: "/patients", icon: Users },
  { title: "Profissionais", url: "/professionals", icon: Stethoscope },
  { title: "Agenda", url: "/schedule", icon: Calendar },
  { title: "Call Center", url: "/callcenter", icon: Phone },
  { title: "Recepção", url: "/reception", icon: UserCheck },
  { title: "Prontuário", url: "/records", icon: FileText },
];

const diagnosticItems = [
  { title: "Worklist", url: "/worklist", icon: ClipboardList },
  { title: "PACS", url: "/pacs", icon: Monitor },
];

const financialItems = [
  { title: "Financeiro", url: "/financial", icon: DollarSign },
  { title: "Faturamento", url: "/billing-production", icon: Receipt },
  { title: "Pgto Médico", url: "/professional-payment", icon: Banknote },
];

const adminItems = [
  { title: "Empresas", url: "/companies", icon: Building2 },
  { title: "Cadastros", url: "/master-data", icon: Database },
  { title: "Usuários", url: "/admin/users", icon: UserCog },
  { title: "Perfis", url: "/admin/profiles", icon: ShieldCheck },
  { title: "Permissões", url: "/admin/permissions", icon: KeyRound },
  { title: "Configurações", url: "/settings", icon: Settings },
];

function NavGroup({ items, label, collapsed }: { items: typeof mainItems; label?: string; collapsed: boolean }) {
  return (
    <SidebarGroup>
      {label && !collapsed && (
        <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-sidebar-muted px-3">{label}</SidebarGroupLabel>
      )}
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton asChild>
                <NavLink
                  to={item.url}
                  end={item.url === "/"}
                  className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
                  activeClassName="bg-sidebar-accent text-sidebar-accent-foreground"
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {!collapsed && <span>{item.title}</span>}
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => { logout(); navigate("/login"); };

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <div className="p-4 flex items-center gap-2 border-b border-sidebar-border">
        <div className="rounded-lg bg-primary p-1.5">
          <Heart className="h-5 w-5 text-primary-foreground" />
        </div>
        {!collapsed && (
          <div>
            <h2 className="text-base font-bold tracking-tight">PRONTOMEDIC</h2>
            <p className="text-[10px] text-sidebar-muted leading-none">Gestão Clínica</p>
          </div>
        )}
      </div>

      <SidebarContent className="pt-2 scrollbar-thin">
        <NavGroup items={mainItems} collapsed={collapsed} />
        <NavGroup items={diagnosticItems} label="Diagnóstico" collapsed={collapsed} />
        <NavGroup items={financialItems} label="Financeiro" collapsed={collapsed} />
        <NavGroup items={adminItems} label="Administrativo" collapsed={collapsed} />
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-3">
        {user && (
          <div className="flex items-center gap-2">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                {getInitials(user.full_name)}
              </AvatarFallback>
            </Avatar>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold truncate">{user.full_name}</p>
                <p className="text-[10px] text-sidebar-muted truncate">{user.email}</p>
              </div>
            )}
            <button
              onClick={handleLogout}
              className="p-1.5 rounded-md hover:bg-sidebar-accent text-sidebar-muted hover:text-destructive transition-colors"
              title="Sair"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
