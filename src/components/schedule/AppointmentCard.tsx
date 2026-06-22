/**
 * AppointmentCard — Card memoizado de um agendamento individual
 * Usado no SchedulePage para evitar re-render de todos os cards quando
 * apenas um muda (ex: status update).
 */

import { memo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";
import {
  AppointmentPreviewPopover,
} from "@/components/schedule/AppointmentPreviewPopover";
import { AppointmentStatusBadge } from "@/components/StatusBadge";
import { QuickActionsMenu } from "@/components/schedule/QuickActionsMenu";
import { calculateAge } from "@/utils/formatters";
import type { Appointment, AppointmentStatus, Patient } from "@/types";

const statusBorderColors: Record<string, string> = {
  scheduled: "",
  confirmed: "border-l-4 border-l-primary",
  waiting: "border-l-4 border-l-warning",
  in_progress: "border-l-4 border-l-success",
  completed: "border-l-4 border-l-muted-foreground",
  no_show: "border-l-4 border-l-destructive",
  cancelled: "border-l-4 border-l-muted opacity-50",
};

export interface AppointmentCardProps {
  appointment: Appointment;
  patient: Patient | undefined;
  allAppointments: Appointment[];
  onQuickAction: (action: string, a: Appointment) => void;
  rowIndex: number;
}

function AppointmentCardImpl({
  appointment: a,
  patient,
  allAppointments,
  onQuickAction,
  rowIndex,
}: AppointmentCardProps) {
  const age = patient?.birthDate ? calculateAge(patient.birthDate) : null;
  const insurance = patient?.healthInsurance || "Particular";
  const allergies = patient?.allergies;

  return (
    <Card
      role="gridcell"
      tabIndex={0}
      aria-rowindex={rowIndex + 1}
      aria-label={`${a.time}, ${a.patientName}, com ${a.doctorName}${a.specialty ? `, ${a.specialty}` : ""}, status ${a.status}, ${a.duration} minutos${allergies ? `. Alerta: alergias ${allergies}` : ""}`}
      className={`hover:shadow-md transition-shadow ${statusBorderColors[a.status] || ""}`}
    >
      <CardContent className="p-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="text-center min-w-[52px]">
            <p className="text-base font-bold text-primary leading-tight">{a.time}</p>
            <p className="text-[10px] text-muted-foreground">{a.duration} min</p>
          </div>

          <div className="border-l pl-3 flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <AppointmentPreviewPopover appointment={a} patient={patient} appointments={allAppointments}>
                <span className="font-medium text-sm truncate cursor-pointer hover:text-primary transition-colors">
                  {a.patientName}
                </span>
              </AppointmentPreviewPopover>
              {age != null && (
                <span className="text-[10px] text-muted-foreground">{age}a</span>
              )}
              {a.typeLabel && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-0 bg-primary/10 text-primary">
                  {a.typeLabel}
                </Badge>
              )}
              {a.type === "retorno" && (
                <Badge variant="outline" className="bg-secondary/10 text-secondary border-0 text-[10px] px-1.5 py-0">Retorno</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate">
              {a.doctorName}{a.specialty ? ` • ${a.specialty}` : ""}
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] text-muted-foreground">{insurance}</span>
              {allergies && (
                <span className="text-[10px] text-destructive font-medium flex items-center gap-0.5">
                  <AlertTriangle className="h-2.5 w-2.5" aria-hidden="true" />{allergies}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <AppointmentStatusBadge status={a.status as AppointmentStatus} />
          <QuickActionsMenu appointment={a} onAction={(action) => onQuickAction(action, a)} />
        </div>
      </CardContent>
    </Card>
  );
}

function arePropsEqual(prev: AppointmentCardProps, next: AppointmentCardProps): boolean {
  return (
    prev.appointment === next.appointment &&
    prev.patient === next.patient &&
    prev.allAppointments === next.allAppointments &&
    prev.onQuickAction === next.onQuickAction &&
    prev.rowIndex === next.rowIndex
  );
}

export const AppointmentCard = memo(AppointmentCardImpl, arePropsEqual);
AppointmentCard.displayName = "AppointmentCard";

export default AppointmentCard;
