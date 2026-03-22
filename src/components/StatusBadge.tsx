import { AppointmentStatus, PaymentStatus } from "@/types";
import { Badge } from "@/components/ui/badge";
import { getAppointmentStatusLabel, getPaymentStatusLabel } from "@/utils/formatters";

const appointmentVariants: Record<AppointmentStatus, string> = {
  scheduled: "bg-muted text-muted-foreground",
  confirmed: "bg-primary/10 text-primary",
  in_progress: "bg-warning/10 text-warning",
  completed: "bg-success/10 text-success",
  cancelled: "bg-destructive/10 text-destructive",
};

const paymentVariants: Record<PaymentStatus, string> = {
  paid: "bg-success/10 text-success",
  pending: "bg-warning/10 text-warning",
  overdue: "bg-destructive/10 text-destructive",
};

export function AppointmentStatusBadge({ status }: { status: AppointmentStatus }) {
  return (
    <Badge variant="outline" className={`${appointmentVariants[status]} border-0 font-medium`}>
      {getAppointmentStatusLabel(status)}
    </Badge>
  );
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return (
    <Badge variant="outline" className={`${paymentVariants[status]} border-0 font-medium`}>
      {getPaymentStatusLabel(status)}
    </Badge>
  );
}
