import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import {
  LayoutDashboard, Users, Calendar, FileText, DollarSign, Settings, Heart,
  UserCheck, Stethoscope, ShieldCheck, UserCog, KeyRound, Phone,
  ClipboardList, Monitor, Receipt, Banknote, Building2, Database,
  Server, FileImage, Activity, Radio, Shield, ScrollText, Bell,
  ListChecks, Calculator, FileSpreadsheet, ListPlus, Pill,
  HeartPulse, BarChart3, FlaskConical, Video,
  BedDouble, Scissors, AlertOctagon, FileSignature, Sparkles,
  Truck, ShoppingCart, Star, Ambulance, Clock, Syringe,
} from "lucide-react";
import {
  Sidebar, SidebarContent, useSidebar,
} from "@/components/ui/sidebar";
import { FlatSection, CollapsibleSection, MenuGroup } from "./sidebar/SidebarSection";
import { MenuItem } from "./sidebar/SidebarItem";
import { SidebarFooter } from "./sidebar/SidebarFooter";

const mainItems: MenuGroup = {
  items: [
    { title: "Dashboard", url: "/", icon: LayoutDashboard },
    { title: "Agenda", url: "/schedule", icon: Calendar },
    { title: "Recepção", url: "/reception", icon: UserCheck },
    { title: "Triagem", url: "/nursing/triage", icon: HeartPulse },
    { title: "Cuidados Enfermagem", url: "/nursing/care", icon: Syringe },
    { title: "Pacientes", url: "/patients", icon: Users },
    { title: "Profissionais", url: "/professionals", icon: Stethoscope },
    { title: "Prontuário", url: "/records", icon: FileText },
    { title: "Atendimento (PEP)", url: "/encounters", icon: Stethoscope },
    { title: "Timeline Clínica", url: "/clinical-timeline", icon: Clock },
    { title: "Farmácia", url: "/pharmacy", icon: Pill },
    { title: "Laboratório", url: "/lab", icon: FlaskConical },
    { title: "Call Center", url: "/callcenter", icon: Phone },
    { title: "Telemedicina", url: "/telemedicina", icon: Video },
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
    {
      groupTitle: "Enfermagem",
      items: [
        { title: "Painel de Chamada", url: "/nursing/queue", icon: Monitor },
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
        { title: "Contas a receber", url: "/financial", icon: DollarSign },
        { title: "Produção", url: "/billing-production", icon: Receipt },
        { title: "TISS", url: "/admin/tiss", icon: FileSpreadsheet },
        { title: "Repasse", url: "/professional-payment", icon: Banknote },
      ],
    },
  ],
};

const biItems: MenuGroup = {
  label: "Inteligência de Negócio",
  items: [
    { title: "BI / Indicadores", url: "/bi", icon: BarChart3 },
  ],
  subItems: [
    {
      groupTitle: "Gestão",
      items: [
        { title: "Metas", url: "/bi/metas", icon: ListChecks },
        { title: "Alertas", url: "/bi/alertas", icon: Bell },
      ],
    },
  ],
};

const clinicalAdvancedItems: MenuGroup = {
  label: "Assistência Avançada",
  items: [],
  subItems: [
    {
      groupTitle: "Hospital",
      items: [
        { title: "Internação", url: "/internacao", icon: BedDouble },
        { title: "Centro Cirúrgico", url: "/cirurgia", icon: Scissors },
        { title: "Pronto Atendimento", url: "/pa", icon: AlertOctagon },
      ],
    },
    {
      groupTitle: "Documentos & IA",
      items: [
        { title: "Assinatura Digital", url: "/assinatura", icon: FileSignature },
        { title: "IA Clínica", url: "/ia-clinica", icon: Sparkles },
      ],
    },
  ],
};

const logisticsItems: MenuGroup = {
  label: "Logística & Suprimentos",
  items: [],
  subItems: [
    {
      groupTitle: "Compras",
      items: [
        { title: "Compras", url: "/purchases", icon: ShoppingCart },
      ],
    },
    {
      groupTitle: "Operação",
      items: [
        { title: "Transporte", url: "/transport", icon: Truck },
      ],
    },
    {
      groupTitle: "Experiência",
      items: [
        { title: "NPS", url: "/nps", icon: Star },
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
        <FlatSection group={mainItems} collapsed={collapsed} roleName={roleName} />
        <CollapsibleSection group={dicomItems} collapsed={collapsed} roleName={roleName} />
        <CollapsibleSection group={financialItems} collapsed={collapsed} roleName={roleName} />
        <CollapsibleSection group={clinicalAdvancedItems} collapsed={collapsed} roleName={roleName} />
        <CollapsibleSection group={logisticsItems} collapsed={collapsed} roleName={roleName} />
        <CollapsibleSection group={biItems} collapsed={collapsed} roleName={roleName} />
        <CollapsibleSection group={adminItems} collapsed={collapsed} roleName={roleName} />
        <FlatSection group={{ items: bottomItems }} collapsed={collapsed} roleName={roleName} />
      </SidebarContent>

      <SidebarFooter user={user} collapsed={collapsed} onLogout={handleLogout} />
    </Sidebar>
  );
}
