import type { CheckinIssue, CheckinReadiness } from "@/services/receptionService";

export type ReceptionJourneyStepId =
  | "identification"
  | "registration"
  | "payer"
  | "eligibility"
  | "authorization"
  | "destination";

export type ReceptionJourneyStepStatus = "complete" | "attention" | "pending";

export interface ReceptionJourneyStep {
  id: ReceptionJourneyStepId;
  label: string;
  description: string;
  status: ReceptionJourneyStepStatus;
  issue?: CheckinIssue;
}

const issueTypesByStep: Partial<Record<ReceptionJourneyStepId, string[]>> = {
  registration: ["registration", "document", "documents"],
  payer: ["insurance_card", "insurance", "payer"],
  eligibility: ["eligibility"],
  authorization: ["authorization"],
};

const defaultDescriptions: Record<ReceptionJourneyStepId, string> = {
  identification: "Paciente e agendamento identificados.",
  registration: "Cadastro mínimo e documentos conferidos.",
  payer: "Pagador, convênio e carteirinha conferidos ou não aplicáveis.",
  eligibility: "Elegibilidade válida ou não exigida para este atendimento.",
  authorization: "Autorização válida ou não exigida para este atendimento.",
  destination: "A senha e o destino serão definidos ao concluir o check-in.",
};

const labels: Record<ReceptionJourneyStepId, string> = {
  identification: "Identificação",
  registration: "Cadastro e documentos",
  payer: "Pagador e convênio",
  eligibility: "Elegibilidade",
  authorization: "Autorização",
  destination: "Fila e destino",
};

function issueForStep(
  stepId: ReceptionJourneyStepId,
  readiness: CheckinReadiness | null,
): CheckinIssue | undefined {
  if (!readiness) return undefined;
  const acceptedTypes = issueTypesByStep[stepId] ?? [];
  return readiness.issues.find((issue) => acceptedTypes.includes(issue.type));
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
    "destination",
  ];

  return ids.map((id) => {
    const issue = issueForStep(id, readiness);
    let status: ReceptionJourneyStepStatus = "pending";

    if (id === "identification") status = "complete";
    else if (id === "destination") status = "pending";
    else if (issue) status = "attention";
    else if (readiness) status = "complete";

    return {
      id,
      label: labels[id],
      description: issue?.description ?? defaultDescriptions[id],
      status,
      issue,
    };
  });
}

export function getBlockingReceptionIssues(
  readiness: CheckinReadiness | null,
): CheckinIssue[] {
  return readiness?.issues.filter((issue) => issue.severity === "blocking") ?? [];
}
