import {
  Activity,
  AlertOctagon,
  Banknote,
  BarChart3,
  BedDouble,
  Bell,
  Building2,
  Calculator,
  Calendar,
  ClipboardList,
  Clock,
  Database,
  DollarSign,
  FileImage,
  FileSignature,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  HeartPulse,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  ListPlus,
  Monitor,
  Phone,
  Pill,
  Radio,
  Receipt,
  Scissors,
  ScrollText,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Star,
  Stethoscope,
  Syringe,
  Truck,
  UserCheck,
  UserCog,
  Users,
  Video,
  type LucideIcon,
} from "lucide-react";
import {
  canAccessRoute,
  normalizeRoleName,
  ROLES,
  type RoleName,
} from "@/config/routePermissions";
import { isWaveModuleEnabled } from "@/config/moduleRollout";

export type NavigationArea =
  | "Meu trabalho"
  | "Entrada e agenda"
  | "Assistência clínica"
  | "Exames e laudos"
  | "Caixa e convênios"
  | "Gestão"
  | "Configurações";

export interface NavigationItem {
  title: string;
  url: string;
  icon: LucideIcon;
  area: NavigationArea;
  description: string;
  keywords?: string[];
}

export interface NavigationJourney {
  title: string;
  url: string;
  accessRoute: string;
  icon: LucideIcon;
  description: string;
  keywords: string[];
}

export type QuickCreateAction = "patient" | "appointment";

const quickCreateRoles: Record<QuickCreateAction, RoleName[]> = {
  patient: [ROLES.ADMIN, ROLES.RECEPCAO],
  appointment: [ROLES.ADMIN, ROLES.RECEPCAO],
};

const waveItems: NavigationItem[] = [
  ...(isWaveModuleEnabled(19)
    ? [{
        title: "Plano de enfermagem",
        url: "/nursing/clinical",
        icon: HeartPulse,
        area: "Assistência clínica" as const,
        description: "Plano assistencial e evolução de enfermagem.",
      }]
    : []),
  ...(isWaveModuleEnabled(20)
    ? [{
        title: "Prescrição eletrônica",
        url: "/prescriptions",
        icon: Pill,
        area: "Assistência clínica" as const,
        description: "Prescrever, revisar e acompanhar medicamentos.",
      }]
    : []),
  ...(isWaveModuleEnabled(21)
    ? [{
        title: "Protocolos assistenciais",
        url: "/care-protocols",
        icon: ListChecks,
        area: "Assistência clínica" as const,
        description: "Aplicar e acompanhar protocolos clínicos.",
      }]
    : []),
  ...(isWaveModuleEnabled(22)
    ? [{
        title: "Solicitações de exames",
        url: "/exam-requests",
        icon: ClipboardList,
        area: "Exames e laudos" as const,
        description: "Solicitar e acompanhar exames diagnósticos.",
      }]
    : []),
];

export const navigationItems: NavigationItem[] = [
  {
    title: "Visão do dia",
    url: "/",
    icon: LayoutDashboard,
    area: "Meu trabalho",
    description: "Resumo operacional e pendências do dia.",
  },
  {
    title: "Agenda de pacientes",
    url: "/schedule",
    icon: Calendar,
    area: "Entrada e agenda",
    description: "Agendar, confirmar, remarcar e consultar horários.",
    keywords: ["calendário", "horários", "grade profissional", "disponibilidade"],
  },
  {
    title: "Entrada do paciente",
    url: "/reception",
    icon: UserCheck,
    area: "Entrada e agenda",
    description: "Registrar chegada, definir particular ou convênio e encaminhar pendências.",
    keywords: ["recepção", "check-in", "entrada", "pagador", "convênio", "particular", "fila"],
  },
  {
    title: "Triagem e risco",
    url: "/nursing/triage",
    icon: HeartPulse,
    area: "Assistência clínica",
    description: "Registrar sinais vitais, risco e prioridade.",
  },
  {
    title: "Cuidados de enfermagem",
    url: "/nursing/care",
    icon: Syringe,
    area: "Assistência clínica",
    description: "Executar e registrar cuidados assistenciais.",
  },
  ...waveItems,
  {
    title: "Senhas e chamada",
    url: "/nursing/queue",
    icon: Monitor,
    area: "Entrada e agenda",
    description: "Acompanhar, chamar e transferir pacientes entre filas.",
    keywords: ["fila", "painel", "senha", "chamar próximo"],
  },
  {
    title: "Pacientes",
    url: "/patients",
    icon: Users,
    area: "Entrada e agenda",
    description: "Localizar, cadastrar e atualizar pacientes.",
  },
  {
    title: "Profissionais e corpo clínico",
    url: "/professionals",
    icon: Stethoscope,
    area: "Configurações",
    description: "Gerenciar cadastro, habilitações, vínculos e acesso à agenda.",
    keywords: ["médicos", "conselho", "habilitação", "agenda profissional"],
  },
  {
    title: "Prontuário eletrônico",
    url: "/records",
    icon: FileText,
    area: "Assistência clínica",
    description: "Consultar o prontuário eletrônico do paciente.",
  },
  {
    title: "Histórico clínico",
    url: "/clinical-timeline",
    icon: Clock,
    area: "Assistência clínica",
    description: "Revisar eventos clínicos em ordem cronológica.",
  },
  {
    title: "Farmácia clínica",
    url: "/pharmacy",
    icon: Pill,
    area: "Assistência clínica",
    description: "Dispensação e acompanhamento farmacêutico.",
  },
  {
    title: "Laboratório e resultados",
    url: "/lab",
    icon: FlaskConical,
    area: "Exames e laudos",
    description: "Pedidos, coleta, processamento e resultados laboratoriais.",
  },
  {
    title: "Central de atendimento",
    url: "/callcenter",
    icon: Phone,
    area: "Entrada e agenda",
    description: "Atender contatos e organizar solicitações.",
  },
  {
    title: "Atendimento por vídeo",
    url: "/telemedicina",
    icon: Video,
    area: "Assistência clínica",
    description: "Gerenciar atendimentos remotos.",
  },
  {
    title: "Equipamentos de imagem",
    url: "/admin/dicom",
    icon: Server,
    area: "Configurações",
    description: "Configurar equipamentos e conectividade DICOM.",
  },
  {
    title: "Modalidades de exames",
    url: "/dicom/modalities",
    icon: Activity,
    area: "Configurações",
    description: "Gerenciar modalidades por unidade.",
  },
  {
    title: "Servidores PACS e Worklist",
    url: "/dicom/nodes",
    icon: Server,
    area: "Configurações",
    description: "Gerenciar destinos PACS e Worklist.",
  },
  {
    title: "Monitor DICOM",
    url: "/dicom/dashboard",
    icon: Radio,
    area: "Configurações",
    description: "Monitorar conexões e integrações DICOM.",
  },
  {
    title: "Exames de imagem",
    url: "/dicom/orders",
    icon: FileImage,
    area: "Exames e laudos",
    description: "Acompanhar pedidos e execução de exames de imagem.",
  },
  {
    title: "Fila dos equipamentos",
    url: "/dicom/worklist",
    icon: ListChecks,
    area: "Exames e laudos",
    description: "Acompanhar a fila de exames dos equipamentos.",
  },
  {
    title: "Modelos de laudo",
    url: "/admin/report-templates",
    icon: FileSpreadsheet,
    area: "Configurações",
    description: "Padronizar modelos de laudos.",
  },
  {
    title: "Imagens e estudos",
    url: "/pacs",
    icon: Monitor,
    area: "Exames e laudos",
    description: "Abrir e revisar estudos de imagem.",
  },
  {
    title: "Laudos de imagem",
    url: "/dicom/reports",
    icon: ScrollText,
    area: "Exames e laudos",
    description: "Produzir, revisar e liberar laudos.",
  },
  {
    title: "Faturamento de convênios",
    url: "/billing-accounts",
    icon: Receipt,
    area: "Caixa e convênios",
    description: "Conferir contas de convênio, glosas e competências.",
    keywords: ["conta", "convênio", "faturar", "glosa", "competência"],
  },
  {
    title: "Produção para faturar",
    url: "/billing-production",
    icon: Receipt,
    area: "Caixa e convênios",
    description: "Acompanhar produção assistencial e faturável.",
  },
  {
    title: "Guias TISS e lotes",
    url: "/admin/tiss",
    icon: FileSpreadsheet,
    area: "Caixa e convênios",
    description: "Gerar e acompanhar guias e lotes TISS.",
  },
  {
    title: "Repasses aos profissionais",
    url: "/professional-payment",
    icon: Banknote,
    area: "Caixa e convênios",
    description: "Calcular e conferir repasses.",
  },
  {
    title: "Caixa: Pix, cartão e dinheiro",
    url: "/financial",
    icon: DollarSign,
    area: "Caixa e convênios",
    description: "Confirmar recebimentos particulares, coparticipações e movimentações.",
    keywords: ["pix", "cartão", "dinheiro", "receber", "pagamento", "caixa", "particular"],
  },
  {
    title: "Internações",
    url: "/internacao",
    icon: BedDouble,
    area: "Assistência clínica",
    description: "Gerenciar internações e evolução hospitalar.",
  },
  {
    title: "Centro cirúrgico",
    url: "/cirurgia",
    icon: Scissors,
    area: "Assistência clínica",
    description: "Organizar cirurgias e recursos do centro cirúrgico.",
  },
  {
    title: "Urgência e emergência",
    url: "/pa",
    icon: AlertOctagon,
    area: "Assistência clínica",
    description: "Operar o fluxo de urgência e emergência.",
  },
  {
    title: "Assinatura de documentos",
    url: "/assinatura",
    icon: FileSignature,
    area: "Assistência clínica",
    description: "Assinar e validar documentos clínicos.",
  },
  {
    title: "Assistente clínico",
    url: "/ia-clinica",
    icon: Sparkles,
    area: "Assistência clínica",
    description: "Apoio clínico com rastreabilidade e supervisão.",
  },
  {
    title: "Compras e fornecedores",
    url: "/purchases",
    icon: ShoppingCart,
    area: "Gestão",
    description: "Solicitações, cotações e pedidos de compra.",
  },
  {
    title: "Transporte de pacientes",
    url: "/transport",
    icon: Truck,
    area: "Gestão",
    description: "Organizar transporte de pacientes e materiais.",
  },
  {
    title: "Satisfação do paciente",
    url: "/nps",
    icon: Star,
    area: "Gestão",
    description: "Acompanhar satisfação e oportunidades de melhoria.",
  },
  {
    title: "Indicadores e análises",
    url: "/bi",
    icon: BarChart3,
    area: "Gestão",
    description: "Analisar indicadores operacionais e assistenciais.",
  },
  {
    title: "Metas e resultados",
    url: "/bi/metas",
    icon: ListChecks,
    area: "Gestão",
    description: "Definir e acompanhar metas.",
  },
  {
    title: "Alertas da gestão",
    url: "/bi/alertas",
    icon: Bell,
    area: "Gestão",
    description: "Revisar desvios e alertas operacionais.",
  },
  {
    title: "Usuários e acessos",
    url: "/admin/users",
    icon: UserCog,
    area: "Configurações",
    description: "Criar, editar, bloquear e recuperar usuários.",
  },
  {
    title: "Perfis de acesso",
    url: "/admin/profiles",
    icon: ShieldCheck,
    area: "Configurações",
    description: "Configurar perfis funcionais.",
  },
  {
    title: "Permissões por perfil",
    url: "/admin/permissions",
    icon: KeyRound,
    area: "Configurações",
    description: "Definir acessos por perfil e função.",
  },
  {
    title: "Delegações temporárias",
    url: "/admin/access",
    icon: KeyRound,
    area: "Configurações",
    description: "Controlar acessos temporários e delegações.",
  },
  {
    title: "Empresas do sistema",
    url: "/companies",
    icon: Building2,
    area: "Configurações",
    description: "Gerenciar empresas do ambiente.",
  },
  {
    title: "Unidades, setores e recursos",
    url: "/admin/organization",
    icon: Building2,
    area: "Configurações",
    description: "Organizar unidades, setores e vínculos.",
  },
  {
    title: "Convênios e contratos",
    url: "/admin/insurances",
    icon: Shield,
    area: "Caixa e convênios",
    description: "Configurar operadoras, planos e contratos.",
  },
  {
    title: "Validação do convênio",
    url: "/admin/eligibility",
    icon: ListChecks,
    area: "Caixa e convênios",
    description: "Consultar e registrar elegibilidade do beneficiário.",
  },
  {
    title: "Autorizações do convênio",
    url: "/admin/authorizations",
    icon: FileSignature,
    area: "Caixa e convênios",
    description: "Solicitar e acompanhar autorizações.",
  },
  {
    title: "Credenciamento profissional",
    url: "/admin/credentialing",
    icon: ListPlus,
    area: "Caixa e convênios",
    description: "Gerenciar regras de credenciamento.",
  },
  {
    title: "Tabelas e valores",
    url: "/admin/price-tables",
    icon: Calculator,
    area: "Caixa e convênios",
    description: "Configurar valores e vigências.",
  },
  {
    title: "Privacidade e consentimentos",
    url: "/admin/lgpd",
    icon: Shield,
    area: "Configurações",
    description: "Gerenciar privacidade, consentimento e retenção.",
  },
  {
    title: "Auditoria e logs",
    url: "/admin/audit",
    icon: FileText,
    area: "Configurações",
    description: "Consultar trilhas e eventos auditáveis.",
  },
  {
    title: "Notificações do sistema",
    url: "/admin/notifications",
    icon: Bell,
    area: "Configurações",
    description: "Configurar e acompanhar notificações.",
  },
  {
    title: "Catálogos e cadastros",
    url: "/master-data",
    icon: Database,
    area: "Configurações",
    description: "Manter catálogos e dados de referência.",
  },
  {
    title: "Parâmetros do sistema",
    url: "/settings",
    icon: Settings,
    area: "Configurações",
    description: "Configurar regras gerais do sistema.",
  },
];

export const navigationJourneys: NavigationJourney[] = [
  {
    title: "Agendar paciente",
    url: "/schedule?action=new",
    accessRoute: "/schedule",
    icon: Calendar,
    description: "Criar um agendamento e reservar horário na agenda.",
    keywords: ["novo agendamento", "marcar consulta", "horário"],
  },
  {
    title: "Dar entrada no paciente",
    url: "/reception",
    accessRoute: "/reception",
    icon: UserCheck,
    description: "Fazer check-in e indicar se o atendimento é particular ou por convênio.",
    keywords: ["chegada", "recepção", "check-in", "particular", "convênio"],
  },
  {
    title: "Receber particular ou coparticipação",
    url: "/financial",
    accessRoute: "/financial",
    icon: DollarSign,
    description: "Confirmar pagamento por Pix, cartão, dinheiro ou transferência.",
    keywords: ["caixa", "pagamento", "pix", "cartão", "dinheiro", "coparticipação"],
  },
  {
    title: "Faturar atendimento pelo convênio",
    url: "/billing-accounts",
    accessRoute: "/billing-accounts",
    icon: Receipt,
    description: "Conferir a conta, a guia TISS e preparar o faturamento do convênio.",
    keywords: ["convênio", "faturamento", "conta", "tiss", "glosa"],
  },
];

const primaryRoutesByRole: Record<RoleName, string[]> = {
  [ROLES.ADMIN]: [
    "/",
    "/schedule",
    "/reception",
    "/patients",
    "/professionals",
    "/billing-accounts",
    "/financial",
    "/bi",
  ],
  [ROLES.RECEPCAO]: [
    "/",
    "/schedule",
    "/reception",
    "/patients",
    "/callcenter",
    "/nursing/queue",
    "/transport",
  ],
  [ROLES.MEDICO]: [
    "/",
    "/schedule",
    "/patients",
    "/records",
    "/clinical-timeline",
    "/prescriptions",
    "/exam-requests",
    "/dicom/reports",
  ],
  [ROLES.FINANCEIRO]: [
    "/",
    "/billing-accounts",
    "/billing-production",
    "/financial",
    "/professional-payment",
  ],
  [ROLES.DIAGNOSTICO]: [
    "/",
    "/exam-requests",
    "/dicom/orders",
    "/dicom/worklist",
    "/pacs",
    "/dicom/reports",
    "/dicom/dashboard",
  ],
  [ROLES.LABORATORIO]: ["/", "/lab", "/exam-requests"],
  [ROLES.GESTOR]: [
    "/",
    "/schedule",
    "/patients",
    "/professionals",
    "/bi",
    "/financial",
    "/billing-production",
    "/dicom/reports",
  ],
  [ROLES.ADMINISTRATIVO]: [
    "/",
    "/professionals",
    "/settings",
    "/master-data",
    "/companies",
    "/purchases",
    "/transport",
    "/admin/users",
  ],
  [ROLES.ENFERMAGEM]: [
    "/",
    "/nursing/triage",
    "/nursing/queue",
    "/nursing/care",
    "/nursing/clinical",
    "/care-protocols",
    "/exam-requests",
  ],
  [ROLES.FARMACIA]: ["/", "/pharmacy", "/prescriptions"],
  [ROLES.CALL_CENTER]: ["/", "/callcenter"],
};

export function getAuthorizedNavigation(
  roleName: string | null | undefined,
): NavigationItem[] {
  return navigationItems.filter((item) => canAccessRoute(roleName, item.url));
}

export function canOfferQuickCreate(
  roleName: string | null | undefined,
  action: QuickCreateAction,
): boolean {
  const role = normalizeRoleName(roleName);
  return role ? quickCreateRoles[action].includes(role) : false;
}

export function getAuthorizedJourneys(
  roleName: string | null | undefined,
): NavigationJourney[] {
  return navigationJourneys.filter((journey) =>
    canAccessRoute(roleName, journey.accessRoute));
}

export function getNavigationItemForPath(pathname: string): NavigationItem | null {
  return [...navigationItems]
    .sort((a, b) => b.url.length - a.url.length)
    .find((item) => item.url === "/"
      ? pathname === "/"
      : pathname === item.url || pathname.startsWith(`${item.url}/`)) ?? null;
}

export function getPrimaryNavigation(
  roleName: string | null | undefined,
): NavigationItem[] {
  const role = normalizeRoleName(roleName);
  if (!role) {
    return navigationItems.filter((item) => item.url === "/");
  }

  const authorizedByUrl = new Map(
    getAuthorizedNavigation(roleName).map((item) => [item.url, item]),
  );

  return primaryRoutesByRole[role]
    .map((url) => authorizedByUrl.get(url))
    .filter((item): item is NavigationItem => Boolean(item))
    .slice(0, 8);
}

export const navigationAreaOrder: NavigationArea[] = [
  "Meu trabalho",
  "Entrada e agenda",
  "Assistência clínica",
  "Exames e laudos",
  "Caixa e convênios",
  "Gestão",
  "Configurações",
];
