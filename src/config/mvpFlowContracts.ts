export interface MvpFlowContract {
  id: string;
  name: string;
  route: string;
  functionalAcceptance: string;
  permissions: string;
  states: string[];
  errorRecovery: string;
  focusedTests: string[];
  backendDependencies: string[];
  baselineStatus: "confirmed-local" | "partial-local" | "divergent" | "blocked";
  baselineEvidence: string;
}

export const MVP_FLOW_CONTRACTS: MvpFlowContract[] = [
  {
    id: "auth",
    name: "Autenticação e sessão",
    route: "/login",
    functionalAcceptance: "Usuário válido entra, sessão persiste e usuário inválido recebe mensagem acionável.",
    permissions: "Público no login; rotas protegidas exigem sessão e papel normalizado.",
    states: ["loading", "form", "submitting", "authenticated", "error"],
    errorRecovery: "Exibe erro de credencial/rede e permite nova tentativa sem perder o formulário.",
    focusedTests: ["src/test/setup.ts", "e2e/auth.spec.ts"],
    backendDependencies: ["Supabase Auth/local auth", "user_profiles", "company_id/role_name"],
    baselineStatus: "partial-local",
    baselineEvidence: "user_profiles e o vínculo tenant aparecem na baseline; Auth/configuração de sessão não é definida por migration local.",
  },
  {
    id: "patients",
    name: "Cadastro e busca de paciente",
    route: "/patients",
    functionalAcceptance: "Perfil autorizado localiza paciente, abre ficha e cria/edita dados válidos.",
    permissions: "admin, recepcao, medico e gestor.",
    states: ["loading", "list", "empty", "editing", "saving", "error"],
    errorRecovery: "ErrorState com retry no carregamento; validação permanece no formulário.",
    focusedTests: ["src/services/__tests__/patientsService.test.ts"],
    backendDependencies: ["patients", "company/unit scope", "RLS de leitura/escrita"],
    baselineStatus: "confirmed-local",
    baselineEvidence: "patients e as políticas tenant estão contemplados na baseline de tabelas/RLS; validação remota de dados não foi executada.",
  },
  {
    id: "schedule",
    name: "Agenda e agendamento",
    route: "/schedule",
    functionalAcceptance: "Usuário autorizado consulta dia/semana, cria, remarca, confirma e cancela sem salto inválido.",
    permissions: "admin, recepcao, medico e gestor.",
    states: ["loading", "ready", "empty", "saving", "status-transition", "error"],
    errorRecovery: "Retry mantém data/filtros; ação de status bloqueia duplo envio e mostra erro amigável.",
    focusedTests: ["src/services/__tests__/appointmentsService.test.ts", "src/services/__tests__/statusTransitions.test.ts", "src/utils/__tests__/formatters.test.ts"],
    backendDependencies: ["appointments", "professionals", "specialties", "appointment_types", "services_catalog", "create_appointment_secure", "update_appointment_status_secure", "reschedule_appointment_secure"],
    baselineStatus: "divergent",
    baselineEvidence: "A baseline local define create_appointment_secure, mas o serviço ainda chama create_appointment_with_requirements_secure e get_scheduling_requirements.",
  },
  {
    id: "callcenter",
    name: "Call Center e confirmação",
    route: "/callcenter",
    functionalAcceptance: "Operador registra contato, cria retorno, atualiza confirmação e conclui tarefa.",
    permissions: "admin e recepcao.",
    states: ["loading", "ready", "empty", "saving", "completing-task", "error"],
    errorRecovery: "Fila e tarefas têm ErrorState/retry; mutações desabilitam o item enquanto processam.",
    focusedTests: ["src/services/__tests__/callCenterService.test.ts"],
    backendDependencies: ["scheduling_contact_logs", "scheduling_call_center_tasks", "scheduling_confirmation_queue", "confirmation RPCs", "user_profiles"],
    baselineStatus: "blocked",
    baselineEvidence: "Não há CREATE TABLE nem RPC de confirmação correspondente nas migrations locais; o serviço depende de objetos ainda não localizados na baseline.",
  },
  {
    id: "reception-checkin",
    name: "Recepção e check-in",
    route: "/reception",
    functionalAcceptance: "Recepção consulta fila, vê prontidão, exige justificativa de exceção e gera senha/check-in.",
    permissions: "admin e recepcao; prontuário continua restrito a admin/medico.",
    states: ["loading", "queue", "readiness", "blocked", "checking-in", "waiting", "error"],
    errorRecovery: "Falha de leitura ou RPC mostra retry/erro; exceção exige justificativa e não duplica submissão.",
    focusedTests: ["src/services/__tests__/receptionService.test.ts", "src/services/__tests__/statusTransitions.test.ts", "src/config/__tests__/routePermissions.test.ts"],
    backendDependencies: ["appointments", "reception_authorizations", "reception_eligibility_checks", "readiness/check-in RPCs"],
    baselineStatus: "confirmed-local",
    baselineEvidence: "A migration canônica define as views de autorização/elegibilidade, tabelas de check-in/fila e get_reception_checkin_readiness/perform_reception_checkin_secure.",
  },
  {
    id: "attendance",
    name: "Atendimento clínico",
    route: "/attendance/:appointmentId",
    functionalAcceptance: "Médico abre atendimento em andamento, salva registro válido, conclui e gera no máximo uma cobrança vinculada.",
    permissions: "admin e medico; recepção não acessa conteúdo clínico.",
    states: ["loading", "ready", "in-progress", "saving", "completed", "error"],
    errorRecovery: "Retry recarrega atendimento; registro não é duplicado após falha de transição/faturamento.",
    focusedTests: ["src/services/__tests__/medicalRecordsService.test.ts", "src/services/__tests__/financialService.test.ts", "src/config/__tests__/routePermissions.test.ts"],
    backendDependencies: ["appointments", "patients", "medical_records", "billings", "price tables", "status RPC"],
    baselineStatus: "partial-local",
    baselineEvidence: "appointments, medical_records, billings e status RPC aparecem localmente; a cobrança exige a aplicação das constraints tenant e a tabela/preçário usado pelo ambiente.",
  },
  {
    id: "billing",
    name: "Faturamento e contas",
    route: "/billing-accounts",
    functionalAcceptance: "Financeiro consulta contas, identifica pendências, roda glosa preventiva, reabre com motivo e acompanha competência.",
    permissions: "admin, financeiro e gestor.",
    states: ["loading", "ready", "empty", "pending-issues", "reopening", "closing-competence", "error"],
    errorRecovery: "Erro de schema/RPC vira ErrorState com retry; ações sensíveis têm confirmação e bloqueio durante execução.",
    focusedTests: ["src/services/__tests__/billingAccountsService.test.ts", "src/services/__tests__/financialService.test.ts", "src/services/__tests__/integrationContracts.test.ts"],
    backendDependencies: ["billing_accounts", "billing_pending_issues", "billing_competencies", "billing_check_pending RPC", "revenue views"],
    baselineStatus: "blocked",
    baselineEvidence: "Não há definições locais identificáveis para billing_accounts, pendências, competências, RPC de glosa ou views de receita.",
  },
];
