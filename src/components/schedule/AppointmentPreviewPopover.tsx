import { ReactNode } from "react";
import { Calendar, Clock, Package, RotateCcw, AlertTriangle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Appointment, Patient } from "@/types";
import { formatDate, calculateAge } from "@/utils/formatters";
import { mockReturnControls, mockTherapyPackages } from "@/services/mockData";

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

  const activeReturns = mockReturnControls.filter(
    (r) => r.patientId === appointment.patientId && r.status === "active"
  );

  const activePackages = mockTherapyPackages.filter(
    (p) => p.patientId === appointment.patientId && p.status === "active"
  );

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="start">
        <div className="space-y-3">
          {/* Patient header */}
          <div>
            <p className="font-semibold text-sm">{appointment.patientName}</p>
            {patient && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                <span>{calculateAge(patient.birthDate)} anos</span>
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

          {/* Last consultation */}
          {lastConsulta && (
            <div className="border-t pt-2">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                <Calendar className="h-3 w-3" />Última consulta
              </div>
              <p className="text-xs">{formatDate(lastConsulta.date)} — {lastConsulta.specialty || lastConsulta.doctorName}</p>
            </div>
          )}

          {/* Active returns */}
          {activeReturns.length > 0 && (
            <div className="border-t pt-2">
              <div className="flex items-center gap-1.5 text-xs text-secondary mb-1">
                <RotateCcw className="h-3 w-3" />Retorno ativo
              </div>
              {activeReturns.map((r) => (
                <div key={r.id} className="text-xs">
                  <span>{r.specialty}</span>
                  <span className="text-muted-foreground"> — até {formatDate(r.expiresAt)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Active packages */}
          {activePackages.length > 0 && (
            <div className="border-t pt-2">
              <div className="flex items-center gap-1.5 text-xs text-success mb-1">
                <Package className="h-3 w-3" />Pacote ativo
              </div>
              {activePackages.map((p) => (
                <div key={p.id} className="text-xs">
                  <span>{p.therapyType}</span>
                  <Badge variant="outline" className="ml-1.5 text-[10px] px-1 py-0 bg-success/10 text-success border-0">
                    {p.remainingSessions}/{p.totalSessions} restantes
                  </Badge>
                </div>
              ))}
            </div>
          )}

          {!lastConsulta && activeReturns.length === 0 && activePackages.length === 0 && (
            <div className="border-t pt-2">
              <p className="text-xs text-muted-foreground">Nenhum histórico registrado.</p>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
