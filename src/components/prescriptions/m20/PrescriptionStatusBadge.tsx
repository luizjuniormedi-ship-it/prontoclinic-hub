import { Badge } from "@/components/ui/badge";
import type { ElectronicPrescriptionStatus } from "@/types/electronicPrescriptions";

const STATUS_LABELS: Record<ElectronicPrescriptionStatus, string> = {
  draft: "Rascunho",
  validated: "Validada",
  signed: "Assinada",
  active: "Ativa",
  suspended: "Suspensa",
  cancelled: "Cancelada",
  completed: "Concluída",
  expired: "Expirada",
};

const STATUS_CLASSES: Record<ElectronicPrescriptionStatus, string> = {
  draft: "border-muted-foreground/30 text-muted-foreground",
  validated: "border-amber-500/40 bg-amber-500/10 text-amber-700",
  signed: "border-sky-500/40 bg-sky-500/10 text-sky-700",
  active: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700",
  suspended: "border-orange-500/40 bg-orange-500/10 text-orange-700",
  cancelled: "border-destructive/40 bg-destructive/10 text-destructive",
  completed: "border-teal-500/40 bg-teal-500/10 text-teal-700",
  expired: "border-zinc-500/40 bg-zinc-500/10 text-zinc-700",
};

export function PrescriptionStatusBadge({ status }: { status: ElectronicPrescriptionStatus }) {
  return (
    <Badge variant="outline" className={STATUS_CLASSES[status]}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}
