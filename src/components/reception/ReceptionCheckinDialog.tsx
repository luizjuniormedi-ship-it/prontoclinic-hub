import { AlertTriangle, CheckCircle2, CircleDashed, UserRoundCheck } from "lucide-react";
import { Appointment } from "@/types";
import type { CheckinIssue, CheckinReadiness } from "@/services/receptionService";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ExplainedActionButton } from "@/components/actions/ExplainedActionButton";
import { ReceptionFinancialPanel } from "@/components/reception/ReceptionFinancialPanel";
import {
  buildReceptionJourney,
  getBlockingReceptionIssues,
  type ReceptionJourneyStep,
} from "./receptionJourney";

export interface ReceptionPatientContext {
  id: string;
  full_name: string;
  birth_date: string | null;
  cpf: string | null;
  allergies: string | null;
}

interface ReceptionCheckinDialogProps {
  appointment: Appointment | null;
  patient?: ReceptionPatientContext;
  readiness: CheckinReadiness | null;
  loading: boolean;
  priority: "normal" | "legal" | "urgent";
  exceptionReason: string;
  canReleaseException: boolean;
  onPriorityChange: (value: "normal" | "legal" | "urgent") => void;
  onExceptionReasonChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  onOpenPatient: () => void;
  onResolveIssue: (type: string) => void;
  onCheckoutChanged: () => Promise<void>;
}

const statusStyles: Record<ReceptionJourneyStep["status"], string> = {
  complete: "border-success/30 bg-success/5 text-success",
  attention: "border-destructive/30 bg-destructive/5 text-destructive",
  pending: "border-border bg-muted/30 text-muted-foreground",
};

const financialIssueTypes = new Set([
  "billing",
  "billing_not_prepared",
  "payment",
  "payment_pending",
  "cash_session_required",
  "tiss_guide",
  "tiss_guide_missing",
  "tiss_guide_invalid",
  "tiss_signature_missing",
]);

function StepIcon({ status }: { status: ReceptionJourneyStep["status"] }) {
  if (status === "complete") return <CheckCircle2 className="h-4 w-4" aria-hidden="true" />;
  if (status === "attention") return <AlertTriangle className="h-4 w-4" aria-hidden="true" />;
  return <CircleDashed className="h-4 w-4" aria-hidden="true" />;
}

function issueActionLabel(type: string): string {
  if (["registration", "document", "documents", "insurance_card", "insurance", "payer"].includes(type)) {
    return "Corrigir cadastro";
  }
  if (["tiss_guide", "tiss_guide_missing", "tiss_guide_invalid", "tiss_signature_missing"].includes(type)) {
    return "Abrir guia";
  }
  if (["billing", "billing_not_prepared", "payment", "payment_pending", "cash_session_required"].includes(type)) {
    return "Abrir cobrança";
  }
  return "Resolver pendência";
}

export function ReceptionCheckinDialog({
  appointment,
  patient,
  readiness,
  loading,
  priority,
  exceptionReason,
  canReleaseException,
  onPriorityChange,
  onExceptionReasonChange,
  onClose,
  onConfirm,
  onOpenPatient,
  onResolveIssue,
  onCheckoutChanged,
}: ReceptionCheckinDialogProps) {
  const steps = buildReceptionJourney(readiness);
  const blockingIssues = getBlockingReceptionIssues(readiness);
  const requiresException = Boolean(readiness && !readiness.ready);
  const missingExceptionReason = requiresException && canReleaseException && !exceptionReason.trim();

  let disabledReason: string | undefined;
  if (!readiness || loading) disabledReason = "Aguarde a validação dos dados do paciente e do atendimento.";
  else if (requiresException && !canReleaseException) disabledReason = "Existem pendências bloqueantes e seu perfil não pode liberar por exceção.";
  else if (missingExceptionReason) disabledReason = "Informe a justificativa e o risco assumido para liberar por exceção.";

  const handleIssueAction = (issue: CheckinIssue) => {
    if (
      issue.step === "registration"
      || issue.step === "payer"
      || ["registration", "document", "documents", "insurance_card", "insurance", "payer"].includes(issue.type)
    ) {
      onOpenPatient();
      return;
    }
    if (issue.step === "billing" || issue.step === "tiss" || financialIssueTypes.has(issue.type)) {
      document.getElementById("reception-financial-title")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    onResolveIssue(issue.type);
  };

  return (
    <Dialog open={Boolean(appointment)} onOpenChange={(open) => !open && !loading && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserRoundCheck className="h-5 w-5 text-primary" aria-hidden="true" />
            Jornada do check-in
          </DialogTitle>
          <DialogDescription>
            {appointment?.patientName} · {appointment?.time} · {appointment?.doctorName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {patient && (
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{patient.full_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {patient.cpf ? `CPF ${patient.cpf}` : "CPF não informado"}
                    {patient.allergies ? ` · Alergia: ${patient.allergies}` : ""}
                  </p>
                </div>
                <ExplainedActionButton
                  label="Abrir cadastro"
                  description="Abre o cadastro do paciente para conferência ou correção dos dados administrativos."
                  variant="outline"
                  size="sm"
                  onClick={onOpenPatient}
                />
              </div>
            </div>
          )}

          <section aria-labelledby="checkin-steps-title" className="space-y-2">
            <div>
              <h3 id="checkin-steps-title" className="text-sm font-semibold">Etapas administrativas</h3>
              <p className="text-xs text-muted-foreground">
                Confira o que está pronto e resolva somente as etapas que exigem atenção.
              </p>
            </div>
            <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {steps.map((step, index) => (
                <li key={step.id} className={`rounded-lg border p-3 ${statusStyles[step.status]}`}>
                  <div className="flex items-start gap-2">
                    <StepIcon status={step.status} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold">{index + 1}. {step.label}</p>
                      <p className="mt-1 text-[11px] leading-relaxed text-foreground/70">{step.description}</p>
                      {step.issues.length > 0 && (
                        <div className="mt-2 space-y-2" role="list" aria-label={`Pendências de ${step.label}`}>
                          {step.issues.map((issue, issueIndex) => (
                            <div
                              key={`${issue.type}-${issueIndex}`}
                              className="rounded border border-current/20 bg-background/70 p-2 text-foreground"
                              role="listitem"
                            >
                              <p className="text-[11px] leading-relaxed">{issue.description}</p>
                              {issue.impact && (
                                <p className="mt-1 text-[10px] text-muted-foreground">
                                  Impacto: {issue.impact}
                                </p>
                              )}
                              {issue.owner && (
                                <p className="mt-1 text-[10px] text-muted-foreground">
                                  Responsável: {issue.owner}
                                </p>
                              )}
                              {issue.resolution_action && (
                                <p className="mt-1 text-[10px] text-muted-foreground">
                                  Ação recomendada: {issue.resolution_action}
                                </p>
                              )}
                              <Button
                                type="button"
                                variant="link"
                                className="mt-1 h-auto p-0 text-xs"
                                onClick={() => handleIssueAction(issue)}
                                aria-label={`${issueActionLabel(issue.type)}. ${issue.description}`}
                              >
                                {issueActionLabel(issue.type)}
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {loading && !readiness ? (
            <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground" role="status">
              Validando cadastro, convênio, elegibilidade, autorização, guia e cobrança...
            </div>
          ) : appointment ? (
            <ReceptionFinancialPanel
              appointmentId={appointment.id}
              summary={readiness?.checkout}
              onChanged={onCheckoutChanged}
            />
          ) : null}

          {readiness ? (
            <div
              className={`rounded-lg border p-3 ${readiness.ready ? "border-success/30 bg-success/5" : "border-destructive/30 bg-destructive/5"}`}
              role="status"
            >
              <p className="text-sm font-medium">
                {readiness.ready ? "Paciente pronto para o check-in" : `${blockingIssues.length} pendência(s) bloqueiam o check-in`}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {readiness.ready
                  ? "Ao concluir, o sistema gerará a senha e encaminhará o paciente para a fila correta."
                  : "Resolva as pendências ou, quando permitido, registre uma liberação por exceção."}
              </p>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="reception-priority">Prioridade da fila</Label>
              <Select value={priority} onValueChange={(value) => onPriorityChange(value as typeof priority)}>
                <SelectTrigger id="reception-priority" aria-label="Prioridade da fila">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="legal">Prioridade legal</SelectItem>
                  <SelectItem value="urgent">Urgente</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                A prioridade administrativa não substitui a classificação clínica da triagem.
              </p>
            </div>

            {requiresException && canReleaseException ? (
              <div className="space-y-2">
                <Label htmlFor="reception-exception">Justificativa da exceção *</Label>
                <Textarea
                  id="reception-exception"
                  value={exceptionReason}
                  onChange={(event) => onExceptionReasonChange(event.target.value)}
                  placeholder="Motivo, responsável e risco assumido"
                  aria-required="true"
                />
              </div>
            ) : requiresException ? (
              <div className="rounded-lg border border-warning/30 bg-warning/5 p-3">
                <p className="text-sm font-medium text-warning">Liberação restrita</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Um supervisor ou gestor deve resolver as pendências ou registrar a exceção.
                </p>
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <ExplainedActionButton
            label="Cancelar"
            description="Fecha esta conferência sem alterar o agendamento ou realizar o check-in."
            variant="outline"
            onClick={onClose}
            disabled={loading}
          />
          <ExplainedActionButton
            label={requiresException ? "Liberar por exceção" : "Concluir check-in"}
            description={requiresException
              ? "Registra a justificativa, mantém as pendências na auditoria e encaminha o paciente para a fila."
              : "Finaliza a conferência administrativa, gera a senha e encaminha o paciente para a fila correta."}
            disabled={Boolean(disabledReason)}
            disabledReason={disabledReason}
            loading={loading}
            loadingLabel="Concluindo..."
            onClick={onConfirm}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
