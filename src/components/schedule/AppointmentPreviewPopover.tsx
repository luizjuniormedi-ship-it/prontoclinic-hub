import { ReactNode } from "react";
import { Calendar, AlertTriangle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Appointment, Patient } from "@/types";
import { formatDate, calculateAge } from "@/utils/formatters";

interface AppointmentPreviewPopoverProps {
  appointment: Appointment;
  patient?: Patient;
  appointments: Appointment[];
  children: ReactNode;
}

export function AppointmentPreviewPopover({ appointment, patient, appointments, children }: AppointmentPreviewPopoverProps) {
  const patientAppointments = appointments
    .filter((a) => a.patientId === appointment.patientId && a.status === "completed")
    .sort((a, b) => b.date.localeCompare(a.date));

  const lastConsulta = patientAppointments[0];

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="start">
        <div className="space-y-3">
          <div>
            <p className="font-semibold text-sm">{appointment.patientName}</p>
            {patient && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                {patient.birthDate && <span>{calculateAge(patient.birthDate)} anos</span>}
                <span>•</span>
                <span>{patient.gender === "M" ? "Masc." : patient.gender === "F" ? "Fem." : "Outro"}</span>
                <span>•</span>
                <span>{patient.healthInsurance || "Particular"}</span>
              </div>
            )}
            {patient?.allergies && (
              <div className="flex items-center gap-1 mt-1">
                <AlertTriangle className="h-3 w-3 text-destructive" />
                <span className="text-xs text-destructive font-medium">{patient.allergies}</span>
              </div>
            )}
          </div>

          {lastConsulta && (
            <div className="border-t pt-2">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                <Calendar className="h-3 w-3" />Última consulta
              </div>
              <p className="text-xs">{formatDate(lastConsulta.date)} — {lastConsulta.specialty || lastConsulta.doctorName}</p>
            </div>
          )}

          {!lastConsulta && (
            <div className="border-t pt-2">
              <p className="text-xs text-muted-foreground">Nenhum histórico registrado.</p>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
