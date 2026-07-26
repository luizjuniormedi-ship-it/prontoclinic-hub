import type { CheckinIssue, CheckinReadiness } from "@/services/receptionService";

export type ReceptionJourneyStepId =
  | "identification"
  | "registration"
  | "payer"
  | "eligibility"
  | "authorization"
  | "tiss"
  | "billing"
  | "destination";

export type ReceptionJourneyStepStatus = "complete" | "attention" | "pending";

export interface ReceptionJourneyStep {
  id: ReceptionJourneyStepId;
  label: string;
  description: string;
  status: ReceptionJourneyStepStatus;
  issues: CheckinIssue[];
}

const issueTypesByStep: Partial<Record<ReceptionJourneyStepId, string[]>> = {
  registration: ["registration", "document", "documents"],
  payer: ["insurance_card", "insurance", "payer"],
  eligibility: ["eligibility"],
  authorization: ["authorization"],
  tiss: ["tiss_guide", "tiss_guide_missing", "tiss_guide_invalid", "tiss_signature_missing"],
  billing: ["billing", "billing_not_prepared", "payment", "payment_pending", "cash_session_required"],
};

const defaultDescriptions: Record<ReceptionJourneyStepId, string> = {
  identification: "Paciente e agendamento identificados.",
  registration: "Cadastro mínimo e documentos conferidos.",
  payer: "Pagador, convênio e carteirinha conferidos ou não aplicáveis.",
  eligibility: "Elegibilidade válida ou não exigida para este atendimento.",
  authorization: "Autorização válida ou não exigida para este atendimento.",
  tiss: "Guia TISS válida e assinada ou não exigida para este atendimento.",
  billing: "Pré-conta, responsabilidade por pagador e pagamento conferidos.",
  destination: "A senha e o destino serão definidos ao concluir o check-in.",
};

const labels: Record<ReceptionJourneyStepId, string> = {
  identification: "Identificação",
  registration: "Cadastro e documentos",
  payer: "Pagador e convênio",
  eligibility: "Elegibilidade",
  authorization: "Autorização",
  tiss: "Guia TISS",
  billing: "Valores e pagamento",
  destination: "Fila e destino",
};

function issuesForStep(
  stepId: ReceptionJourneyStepId,
  readiness: CheckinReadiness | null,
): CheckinIssue[] {
  if (!readiness) return [];
  const acceptedTypes = issueTypesByStep[stepId] ?? [];
  return readiness.issues.filter((issue) => {
    if (issue.step === stepId) return true;
    if (stepId === "identification" && issue.step === "general") return true;
    return acceptedTypes.includes(issue.type);
  });
}

export function buildReceptionJourney(
  readiness: CheckinReadiness | null,
): ReceptionJourneyStep[] {
  const ids: ReceptionJourneyStepId[] = [
    "identification",
    "registration",
    "payer",
    "eligibility",
    "authorization",
    "tiss",
    "billing",
    "destination",
  ];

  return ids.map((id) => {
    const issues = issuesForStep(id, readiness);
    let status: ReceptionJourneyStepStatus = "pending";

    if (id === "identification") {
      status = issues.length > 0 ? "attention" : "complete";
    } else if (id === "destination") {
      status = issues.length > 0 ? "attention" : "pending";
    } else if (issues.length > 0) {
      status = "attention";
    } else if (readiness) {
      status = "complete";
    }

    return {
      id,
      label: labels[id],
      description: issues.length === 1
        ? issues[0].description
        : issues.length > 1
          ? `${issues.length} pendências nesta etapa.`
          : defaultDescriptions[id],
      status,
      issues,
    };
  });
}

export function getBlockingReceptionIssues(
  readiness: CheckinReadiness | null,
): CheckinIssue[] {
  return readiness?.issues.filter((issue) => issue.blocking) ?? [];
}
