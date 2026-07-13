import { AppointmentStatus, AppointmentType, PaymentStatus, ReturnStatus, TherapyPackageStatus, ProfessionalStatus } from "@/types";
import { Badge } from "@/components/ui/badge";
import { getAppointmentStatusLabel, getAppointmentTypeLabel, getPaymentStatusLabel, getReturnStatusLabel, getTherapyPackageStatusLabel, getProfessionalStatusLabel } from "@/utils/formatters";

const appointmentStatusVariants: Record<AppointmentStatus, string> = {
  scheduled: "bg-muted text-muted-foreground",
  confirmed: "bg-primary/10 text-primary",
  waiting: "bg-warning/20 text-foreground",
  in_progress: "bg-success/10 text-success",
  completed: "bg-muted text-muted-foreground",
  no_show: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground line-through",
};

const appointmentTypeVariants: Record<AppointmentType, string> = {
  consulta: "bg-primary/10 text-primary",
  retorno: "bg-secondary/10 text-secondary",
  exame: "bg-warning/10 text-warning",
  procedimento: "bg-accent text-accent-foreground",
  terapia_avulsa: "bg-success/10 text-success",
  terapia_pacote: "bg-success/15 text-success",
};

const paymentVariants: Record<PaymentStatus, string> = {
  paid: "bg-success/10 text-success",
  pending: "bg-warning/10 text-warning",
  overdue: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground line-through",
};

const returnStatusVariants: Record<ReturnStatus, string> = {
  active: "bg-success/10 text-success",
  used: "bg-muted text-muted-foreground",
  expired: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground line-through",
};

const therapyPackageStatusVariants: Record<TherapyPackageStatus, string> = {
  active: "bg-success/10 text-success",
  completed: "bg-primary/10 text-primary",
  expired: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

const professionalStatusVariants: Record<ProfessionalStatus, string> = {
  active: "bg-success/10 text-success",
  inactive: "bg-muted text-muted-foreground",
};

export function AppointmentStatusBadge({ status }: { status: AppointmentStatus }) {
  return <Badge variant="outline" className={`${appointmentStatusVariants[status]} border-0 font-medium`}>{getAppointmentStatusLabel(status)}</Badge>;
}

export function AppointmentTypeBadge({ type }: { type: AppointmentType }) {
  return <Badge variant="outline" className={`${appointmentTypeVariants[type]} border-0 font-medium`}>{getAppointmentTypeLabel(type)}</Badge>;
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return <Badge variant="outline" className={`${paymentVariants[status]} border-0 font-medium`}>{getPaymentStatusLabel(status)}</Badge>;
}

export function ReturnStatusBadge({ status }: { status: ReturnStatus }) {
  return <Badge variant="outline" className={`${returnStatusVariants[status]} border-0 font-medium`}>{getReturnStatusLabel(status)}</Badge>;
}

export function TherapyPackageStatusBadge({ status }: { status: TherapyPackageStatus }) {
  return <Badge variant="outline" className={`${therapyPackageStatusVariants[status]} border-0 font-medium`}>{getTherapyPackageStatusLabel(status)}</Badge>;
}

export function ProfessionalStatusBadge({ status }: { status: ProfessionalStatus }) {
  return <Badge variant="outline" className={`${professionalStatusVariants[status]} border-0 font-medium`}>{getProfessionalStatusLabel(status)}</Badge>;
}

