import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { canAccessRoute } from "@/config/routePermissions";
import {
  LayoutDashboard, Users, Calendar, FileText, DollarSign, Settings, LogOut,
  Heart, UserCheck, Stethoscope, ShieldCheck, UserCog, KeyRound, Phone,
  ClipboardList, Monitor, Receipt, Banknote, Building2, Database,
  Server, FileImage, Activity, Radio, Shield, ScrollText, Bell,
  ListChecks, Calculator, FileSpreadsheet, ChevronRight, ListPlus, Search, Pill,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub,
  SidebarMenuSubItem, SidebarMenuSubButton, SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { NavLink } from "@/components/NavLink";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getInitials } from "@/utils/formatters";

type Icon = React.ComponentType<{ className?: string }>;

type MenuItem = { title: string; url: string; icon: Icon };
type SubItem = { title: string; url: string; icon?: Icon };
type MenuGroup = {
  label?: string;
  items: MenuItem[];
  subItems?: { groupTitle: string; items: SubItem[] }[];
};

const mainItems: MenuGroup = {
  items: [
    { title: "Dashboard", url: "/", icon: LayoutDashboard },
    { title: "Agenda", url: "/schedule", icon: Calendar },
    { title: "Recepção", url: "/reception", icon: UserCheck },
    { title: "Pacientes", url: "/patients", icon: Users },
    { title: "Profissionais", url: "/professionals", icon: Stethoscope },
    { title: "Prontuário", url: "/records", icon: FileText },
    { title: "Call Center", url: "/callcenter", icon: Phone },
  ],
};

const dicomItems: MenuGroup = {
  label: "PACS / DICOM",
  items: [],
  subItems: [
    {
      groupTitle: "Imagem",
      items: [
        { title: "Equipamentos", url: "/admin/dicom", icon: Server },
        { title: "Modalidades", url: "/dicom/modalities", icon: Activity },
        { title: "Nós DICOM", url: "/dicom/nodes", icon: Server },
        { title: "Integração", url: "/dicom/dashboard", icon: Monitor },
        { title: "Pedidos", url: "/dicom/orders", icon: FileImage },
      ],
    },
    {
      groupTitle: "Laudos",
      items: [
        { title: "Worklist", url: "/dicom/worklist", icon: ListChecks },
        { title: "Templates", url: "/admin/report-templates", icon: FileSpreadsheet },
        { title: "Visualizador", url: "/pacs", icon: Monitor },
        { title: "Laudos", url: "/dicom/reports", icon: ScrollText },
      ],
    },
  ],
};

const financialItems: MenuGroup = {
  label: "Faturamento",
  items: [],
  subItems: [
    {
      groupTitle: "Operação",
      items: [
        { title: "Produção", url: "/billing-production", icon: Receipt },
        { title: "TISS", url: "/admin/tiss", icon: FileSpreadsheet },
        { title: "Repasse", url: "/professional-payment", icon: Banknote },
        { title: "Financeiro", url: "/financial", icon: DollarSign },
      ],
    },
  ],
};

const adminItems: MenuGroup = {
  label: "Administração",
  items: [],
  subItems: [
    {
      groupTitle: "Acesso",
      items: [
        { title: "Usuários", url: "/admin/users", icon: UserCog },
        { title: "Perfis", url: "/admin/profiles", icon: ShieldCheck },
        { title: "Permissões", url: "/admin/permissions", icon: KeyRound },
        { title: "Empresas", url: "/companies", icon: Building2 },
      ],
    },
    {
      groupTitle: "Convênios",
      items: [
        { title: "Convênios", url: "/admin/insurances", icon: Shield },
        { title: "Credenciamento", url: "/admin/credentialing", icon: ListPlus },
        { title: "Tabela de Preços", url: "/admin/price-tables", icon: Calculator },
      ],
    },
    {
      groupTitle: "Compliance",
      items: [
        { title: "LGPD", url: "/admin/lgpd", icon: Shield },
        { title: "Auditoria", url: "/admin/audit", icon: FileText },
        { title: "Notificações", url: "/admin/notifications", icon: Bell },
      ],
    },
  ],
};

const bottomItems: MenuItem[] = [
  { title: "Cadastros", url: "/master-data", icon: Database },
  { title: "Configurações", url: "/settings", icon: Settings },
];

function filterItems(items: MenuItem[], roleName: string | null | undefined): MenuItem[] {
  return items.filter((item) => canAccessRoute(roleName, item.url));
}

function filterSubItems(items: SubItem[], roleName: string | null | undefined): SubItem[] {
  return items.filter((item) => canAccessRoute(roleName, item.url));
}

function NavLink_({ item, collapsed }: { item: MenuItem; collapsed: boolean }) {
  return (
    <SidebarMenuItem>
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
  );
}

function SubGroup({ items, collapsed, roleName }: { items: SubItem[]; collapsed: boolean; roleName: string | null | undefined }) {
  const allowed = filterSubItems(items, roleName);
  if (allowed.length === 0) return null;
  return (
    <SidebarMenuSub>
      {allowed.map((s) => (
        <SidebarMenuSubItem key={s.title}>
          <SidebarMenuSubButton asChild>
            <NavLink
              to={s.url}
              className="flex items-center gap-2 text-xs text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground rounded-md px-2 py-1.5"
              activeClassName="bg-sidebar-accent text-sidebar-accent-foreground"
            >
              {s.icon && <s.icon className="h-3.5 w-3.5 shrink-0" />}
              {!collapsed && <span>{s.title}</span>}
            </NavLink>
          </SidebarMenuSubButton>
        </SidebarMenuSubItem>
      ))}
    </SidebarMenuSub>
  );
}

function CollapsibleGroup({
  group, collapsed, roleName,
}: { group: MenuGroup; collapsed: boolean; roleName: string | null | undefined }) {
  const allowedSub = (group.subItems ?? []).map((g) => ({
    groupTitle: g.groupTitle,
    items: filterSubItems(g.items, roleName),
  })).filter((g) => g.items.length > 0);

  const allowedMain = filterItems(group.items, roleName);

  if (allowedSub.length === 0 && allowedMain.length === 0) return null;

  if (allowedSub.length === 0) {
    return (
      <SidebarGroup>
        {group.label && !collapsed && (
          <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-sidebar-muted px-3">{group.label}</SidebarGroupLabel>
        )}
        <SidebarGroupContent>
          <SidebarMenu>
            {allowedMain.map((it) => <NavLink_ key={it.title} item={it} collapsed={collapsed} />)}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  return (
    <SidebarGroup>
      {group.label && !collapsed && (
        <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-sidebar-muted px-3">{group.label}</SidebarGroupLabel>
      )}
      <SidebarGroupContent>
        <SidebarMenu>
          <Collapsible defaultOpen className="group/collapsible">
            <CollapsibleTrigger asChild>
              <SidebarMenuButton className="flex items-center justify-between w-full text-sidebar-foreground/80">
                <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide">
                  <ChevronRight className="h-3.5 w-3.5 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                  {!collapsed && "Menu"}
                </span>
              </SidebarMenuButton>
            </CollapsibleTrigger>
            <CollapsibleContent>
              {allowedSub.map((sub) => (
                <div key={sub.groupTitle} className="px-2 mt-2">
                  {!collapsed && (
                    <p className="px-2 py-1 text-[10px] uppercase text-sidebar-muted">{sub.groupTitle}</p>
                  )}
                  <SubGroup items={sub.items} collapsed={collapsed} roleName={roleName} />
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function FlatGroup({ group, collapsed, roleName }: { group: MenuGroup; collapsed: boolean; roleName: string | null | undefined }) {
  const items = filterItems(group.items, roleName);
  if (items.length === 0) return null;
  return (
    <SidebarGroup>
      {group.label && !collapsed && (
        <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-sidebar-muted px-3">{group.label}</SidebarGroupLabel>
      )}
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((it) => <NavLink_ key={it.title} item={it} collapsed={collapsed} />)}
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
  const roleName = user?.role_name;

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
        <FlatGroup group={mainItems} collapsed={collapsed} roleName={roleName} />
        <CollapsibleGroup group={dicomItems} collapsed={collapsed} roleName={roleName} />
        <CollapsibleGroup group={financialItems} collapsed={collapsed} roleName={roleName} />
        <CollapsibleGroup group={adminItems} collapsed={collapsed} roleName={roleName} />
        <FlatGroup group={{ items: bottomItems }} collapsed={collapsed} roleName={roleName} />
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
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleLogout}
                    className="p-1.5 rounded-md hover:bg-sidebar-accent text-sidebar-muted hover:text-destructive transition-colors"
                    aria-label="Sair da conta"
                  >
                    <LogOut className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">Sair</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}