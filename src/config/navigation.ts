import type { LucideIcon } from "lucide-react";
import {
  Activity, AlertOctagon, Banknote, BarChart3, BedDouble, Bell, Building2,
  Calculator, Calendar, CalendarCheck, Clock, Database, DollarSign, FileImage, FileSignature,
  FileSpreadsheet, FileText, FlaskConical, HeartPulse, KeyRound, LayoutDashboard,
  ListChecks, ListPlus, Monitor, Phone, Pill, Receipt, Scissors, ScrollText,
  Server, Settings, Shield, ShieldCheck, ShoppingCart, Sparkles, Star,
  Stethoscope, Syringe, Truck, UserCheck, UserCog, Users, Video,
} from "lucide-react";
import { canAccessRoute, normalizeRoleName, type RoleName } from "@/config/routePermissions";

export type NavigationWorkspace =
  | "inicio" | "operacao" | "assistencia" | "diagnostico"
  | "receita" | "suprimentos" | "gestao" | "administracao";

export type NavigationItem = {
  id: string;
  title: string;
  description: string;
  url: string;
  icon: LucideIcon;
  workspace: NavigationWorkspace;
  keywords: string[];
  /**
   * Rotas privadas abertas a partir desta tela, mas que não devem virar outro
   * item de menu. Ex.: o atendimento atual é iniciado pela lista de atendimentos.
   */
  relatedRoutes?: string[];
};

export const navigationWorkspaces: Array<{ id: NavigationWorkspace; label: string }> = [
  { id: "inicio", label: "Início" },
  { id: "operacao", label: "Operação e atendimento" },
  { id: "assistencia", label: "Assistência clínica" },
  { id: "diagnostico", label: "Diagnóstico e laudos" },
  { id: "receita", label: "Faturamento e financeiro" },
  { id: "suprimentos", label: "Suprimentos e apoio" },
  { id: "gestao", label: "Gestão e experiência" },
  { id: "administracao", label: "Administração" },
];

const item = (
  id: string, title: string, description: string, url: string, icon: LucideIcon,
  workspace: NavigationWorkspace, keywords: string[] = [], relatedRoutes: string[] = [],
): NavigationItem => ({
  id,
  title,
  description,
  url,
  icon,
  workspace,
  keywords,
  relatedRoutes: relatedRoutes.length > 0 ? relatedRoutes : undefined,
});

export const navigationItems: NavigationItem[] = [
  item("dashboard", "Dashboard", "Veja prioridades, indicadores e atalhos do seu perfil.", "/", LayoutDashboard, "inicio", ["início", "painel"]),

  item("schedule", "Agenda", "Agende, confirme, remarque e acompanhe consultas, exames e procedimentos.", "/schedule", Calendar, "operacao", ["horário", "encaixe", "espera"]),
  item("reception", "Recepção", "Faça check-in, resolva pendências, valide convênio e encaminhe o paciente.", "/reception", UserCheck, "operacao", ["check-in", "elegibilidade", "autorização", "guia"]),
  item("patients", "Pacientes", "Pesquise, cadastre e consulte os dados administrativos do paciente.", "/patients", Users, "operacao", ["cpf", "cns", "carteirinha"]),
  item("my-appointments", "Meus agendamentos", "Consulte seus próximos agendamentos e o histórico de marcações.", "/meus-agendamentos", CalendarCheck, "operacao", ["portal", "consulta", "exame"]),
  item("call-center", "Call Center", "Registre contatos e transforme solicitações em agendamentos.", "/callcenter", Phone, "operacao", ["telefone", "ligação", "campanha"]),
  item("pa", "Pronto Atendimento", "Acompanhe a jornada do paciente no pronto atendimento.", "/pa", AlertOctagon, "operacao", ["urgência", "emergência"]),
  item("telemedicine", "Telemedicina", "Acesse salas, atendimentos e documentos de consultas remotas.", "/telemedicina", Video, "operacao", ["teleconsulta", "vídeo"]),

  item("professionals", "Profissionais", "Cadastre habilitações, unidades, convênios e disponibilidade profissional.", "/professionals", Stethoscope, "assistencia", ["crm", "rqe", "grade"]),
  item("records", "Prontuário", "Consulte a história clínica longitudinal e os documentos do paciente.", "/records", FileText, "assistencia", ["pep", "histórico", "evolução"]),
  item("encounters", "Atendimento clínico", "Abra e acompanhe atendimentos médicos em andamento.", "/encounters", Stethoscope, "assistencia", ["consulta", "episódio"], ["/attendance"]),
  item("clinical-timeline", "Timeline clínica", "Visualize eventos clínicos do paciente em ordem cronológica.", "/clinical-timeline", Clock, "assistencia", ["linha do tempo"]),
  item("nursing-triage", "Triagem", "Registre sinais vitais, queixa e classificação de risco.", "/nursing/triage", HeartPulse, "assistencia", ["enfermagem", "risco"]),
  item("nursing-care", "Cuidados de enfermagem", "Execute medicações, procedimentos, tarefas e evoluções de enfermagem.", "/nursing/care", Syringe, "assistencia", ["medicação", "procedimento"]),
  item("nursing-queue", "Painel de chamada", "Chame e acompanhe pacientes da fila de enfermagem.", "/nursing/queue", Monitor, "assistencia", ["fila", "senha"]),
  item("internacao", "Internação", "Gerencie admissões, leitos, evoluções, transferências e altas.", "/internacao", BedDouble, "assistencia", ["hospital", "leito"]),
  item("cirurgia", "Centro cirúrgico", "Planeje cirurgia, sala, equipe, checklist, materiais e execução.", "/cirurgia", Scissors, "assistencia", ["cirurgia", "opme"]),
  item("digital-signature", "Assinatura digital", "Assine e valide documentos clínicos com rastreabilidade.", "/assinatura", FileSignature, "assistencia", ["certificado", "documento"]),
  item("clinical-ai", "IA clínica", "Use assistência clínica supervisionada e auditável.", "/ia-clinica", Sparkles, "assistencia", ["inteligência artificial", "resumo"]),

  item("lab", "Laboratório", "Acompanhe coleta, amostras, resultados, validação e liberação.", "/lab", FlaskConical, "diagnostico", ["lis", "coleta", "resultado"]),
  item("imaging-execution", "Execução de exames", "Gerencie o fluxo assistencial dos exames de imagem até o PACS.", "/worklist", FileImage, "diagnostico", ["ris", "exame", "execução"]),
  item("imaging-orders", "Pedidos de imagem", "Consulte e organize solicitações de exames de imagem.", "/dicom/orders", FileImage, "diagnostico", ["pedido", "imagem"]),
  item("dicom-worklist", "Fila técnica DICOM", "Acompanhe itens exportados para as modalidades DICOM.", "/dicom/worklist", ListChecks, "diagnostico", ["mwl", "modalidade", "accession"]),
  item("pacs", "Visualizador PACS", "Abra, compare e consulte estudos e imagens médicas.", "/pacs", Monitor, "diagnostico", ["dicom", "imagem", "estudo"]),
  item("radiology-reports", "Laudos", "Produza, revise, assine e libere laudos de imagem.", "/dicom/reports", ScrollText, "diagnostico", ["laudo", "assinatura"]),
  item("report-templates", "Modelos de laudo", "Cadastre e versione modelos usados na elaboração de laudos.", "/admin/report-templates", FileSpreadsheet, "diagnostico", ["template", "modelo"]),
  item("dicom-integration", "Integração DICOM", "Monitore worklist, estudos e falhas de integração DICOM.", "/dicom/dashboard", Activity, "diagnostico", ["integração", "monitoramento"]),
  item("dicom-modalities", "Modalidades DICOM", "Cadastre modalidades e parâmetros técnicos de aquisição.", "/dicom/modalities", Activity, "diagnostico", ["equipamento", "ae title"]),
  item("dicom-nodes", "Nós DICOM", "Configure servidores e destinos de comunicação DICOM.", "/dicom/nodes", Server, "diagnostico", ["pacs", "servidor"]),
  item("dicom-equipment", "Equipamentos DICOM", "Administre equipamentos e conexões do ambiente de imagem.", "/admin/dicom", Server, "diagnostico", ["modalidade", "equipamento"]),

  item("billing-accounts", "Contas de faturamento", "Revise contas, itens, pendências e fechamento assistencial.", "/billing-accounts", Receipt, "receita", ["conta", "convênio"]),
  item("billing-production", "Produção faturável", "Acompanhe procedimentos e consumos capturados para faturamento.", "/billing-production", Receipt, "receita", ["produção", "itens"]),
  item("tiss", "TISS", "Gere, valide e acompanhe guias e arquivos TISS.", "/admin/tiss", FileSpreadsheet, "receita", ["guia", "xml", "sadt"]),
  item("financial", "Financeiro", "Controle contas a receber, pagamentos, caixa e conciliação.", "/financial", DollarSign, "receita", ["recebimento", "cartão", "pix"]),
  item("professional-payment", "Repasses profissionais", "Calcule, confira e acompanhe repasses aos profissionais.", "/professional-payment", Banknote, "receita", ["produção", "repasse"]),

  item("pharmacy", "Farmácia", "Valide prescrições, dispense medicamentos e acompanhe o estoque farmacêutico.", "/pharmacy", Pill, "suprimentos", ["dispensação", "medicamento"]),
  item("purchases", "Compras", "Solicite, aprove, cote e acompanhe compras e recebimentos.", "/purchases", ShoppingCart, "suprimentos", ["fornecedor", "cotação"]),
  item("transport", "Transporte", "Solicite e acompanhe transportes internos e externos.", "/transport", Truck, "suprimentos", ["ambulância", "remoção"]),

  item("bi", "BI e indicadores", "Acompanhe indicadores operacionais, clínicos e financeiros.", "/bi", BarChart3, "gestao", ["dashboard", "métrica"]),
  item("bi-goals", "Metas", "Cadastre metas e acompanhe o desempenho dos indicadores.", "/bi/metas", ListChecks, "gestao", ["objetivo", "kpi"]),
  item("bi-alerts", "Alertas gerenciais", "Configure e acompanhe desvios dos indicadores.", "/bi/alertas", Bell, "gestao", ["kpi", "limite"]),
  item("nps", "Experiência e NPS", "Acompanhe satisfação, respostas e planos de ação.", "/nps", Star, "gestao", ["pesquisa", "satisfação"]),

  item("admin-users", "Usuários", "Cadastre usuários e controle o estado de acesso.", "/admin/users", UserCog, "administracao", ["acesso", "conta"]),
  item("admin-profiles", "Perfis", "Organize papéis e conjuntos de permissões.", "/admin/profiles", ShieldCheck, "administracao", ["rbac", "papel"]),
  item("admin-permissions", "Permissões", "Defina ações permitidas por módulo, perfil e empresa.", "/admin/permissions", KeyRound, "administracao", ["autorização", "rbac"]),
  item("companies", "Empresas e unidades", "Administre empresas, unidades e contextos de operação.", "/companies", Building2, "administracao", ["filial", "unidade"]),
  item("insurances", "Convênios", "Cadastre operadoras, planos, contratos e regras de cobertura.", "/admin/insurances", Shield, "administracao", ["plano", "operadora"]),
  item("credentialing", "Credenciamento", "Gerencie vínculos entre profissionais, unidades, planos e serviços.", "/admin/credentialing", ListPlus, "administracao", ["profissional", "convênio"]),
  item("price-tables", "Tabelas de preços", "Cadastre valores, vigências e regras por pagador.", "/admin/price-tables", Calculator, "administracao", ["tuss", "valor"]),
  item("master-data", "Cadastros mestres", "Administre catálogos compartilhados por todo o sistema.", "/master-data", Database, "administracao", ["cid", "tuss", "catálogo"]),
  item("lgpd", "LGPD e privacidade", "Gerencie consentimentos, solicitações e políticas de privacidade.", "/admin/lgpd", Shield, "administracao", ["consentimento", "dpo"]),
  item("audit", "Auditoria", "Consulte acessos, alterações e eventos críticos do sistema.", "/admin/audit", FileText, "administracao", ["log", "histórico"]),
  item("admin-notifications", "Central de notificações", "Configure e acompanhe notificações operacionais.", "/admin/notifications", Bell, "administracao", ["mensagem", "alerta"]),
  item("settings", "Configurações", "Ajuste parâmetros gerais e preferências da organização.", "/settings", Settings, "administracao", ["parâmetro", "sistema"]),
];

const sidebarByRole: Record<RoleName, string[]> = {
  admin: ["dashboard", "schedule", "reception", "patients", "encounters", "billing-accounts", "financial", "bi"],
  gestor: ["dashboard", "schedule", "reception", "patients", "billing-accounts", "financial", "bi"],
  recepcao: ["dashboard", "schedule", "reception", "patients", "call-center", "pa"],
  medico: ["dashboard", "schedule", "encounters", "records", "radiology-reports", "telemedicine", "internacao"],
  enfermagem: ["dashboard", "nursing-triage", "nursing-care", "nursing-queue", "internacao", "pa"],
  laboratorio: ["dashboard", "lab", "imaging-execution"],
  diagnostico: ["dashboard", "imaging-orders", "imaging-execution", "dicom-worklist", "pacs", "radiology-reports"],
  farmacia: ["dashboard", "pharmacy", "purchases"],
  financeiro: ["dashboard", "billing-accounts", "billing-production", "financial", "professional-payment", "tiss"],
  faturamento: ["dashboard", "billing-accounts", "billing-production", "tiss", "price-tables"],
  call_center: ["dashboard", "call-center", "schedule", "patients"],
  dpo: ["dashboard", "lgpd", "audit", "admin-notifications"],
  administrativo: ["dashboard", "professionals", "companies", "insurances", "credentialing", "price-tables", "master-data", "settings"],
  paciente: ["my-appointments"],
};

export function getAccessibleNavigation(roleName: string | null | undefined): NavigationItem[] {
  return navigationItems.filter((entry) => canAccessRoute(roleName, entry.url));
}

export function getSidebarNavigation(roleName: string | null | undefined): NavigationItem[] {
  const role = normalizeRoleName(roleName);
  if (!role) return getAccessibleNavigation(roleName).slice(0, 6);
  const accessibleById = new Map(
    getAccessibleNavigation(roleName).map((entry) => [entry.id, entry])
  );
  return sidebarByRole[role]
    .map((id) => accessibleById.get(id))
    .filter((entry): entry is NavigationItem => Boolean(entry));
}

export function getNavigationSearchValue(entry: NavigationItem): string {
  return [entry.title, entry.description, ...entry.keywords].join(" ");
}

export function getNavigationItemForPath(pathname: string): NavigationItem | undefined {
  const matchesPath = (route: string) => (
    route === "/"
      ? pathname === "/"
      : pathname === route || pathname.startsWith(`${route}/`)
  );

  return [...navigationItems]
    .sort((a, b) => {
      const longestRoute = (entry: NavigationItem) => Math.max(
        entry.url.length,
        ...(entry.relatedRoutes ?? []).map((route) => route.length),
      );
      return longestRoute(b) - longestRoute(a);
    })
    .find((entry) => [entry.url, ...(entry.relatedRoutes ?? [])].some(matchesPath));
}

export function getWorkspaceLabel(workspace: NavigationWorkspace): string {
  return navigationWorkspaces.find((entry) => entry.id === workspace)?.label ?? "Área";
}
