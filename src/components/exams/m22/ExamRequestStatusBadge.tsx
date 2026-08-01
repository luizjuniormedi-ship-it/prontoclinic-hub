import { Badge } from "@/components/ui/badge";
import type {
  ExamRequestItemStatus,
  ExamRequestStatus,
} from "@/types/examRequests";

const labels: Record<ExamRequestStatus | ExamRequestItemStatus, string> = {
  DRAFT: "Rascunho",
  SIGNED: "Assinada",
  PARTIALLY_DISPATCHED: "Despacho parcial",
  DISPATCHED: "Despachada",
  COMPLETED: "Concluída",
  CANCELLED: "Cancelada",
  PENDING: "Pendente",
  AUTHORIZATION_PENDING: "Aguardando autorização",
  READY: "Pronta",
  IN_PROGRESS: "Em execução",
  FAILED: "Falhou",
};

export function ExamRequestStatusBadge({
  status,
}: {
  status: ExamRequestStatus | ExamRequestItemStatus;
}) {
  const variant = status === "FAILED" || status === "CANCELLED"
    ? "destructive"
    : status === "COMPLETED"
      ? "default"
      : "secondary";

  return <Badge variant={variant}>{labels[status]}</Badge>;
}
