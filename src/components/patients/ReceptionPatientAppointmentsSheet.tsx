import { useCallback, useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { EmptyState, ErrorState, LoadingState } from "@/components/StateViews";
import {
  receptionService,
  type ReceptionPatientAppointment,
} from "@/services/receptionService";
import { formatDate } from "@/utils/formatters";

interface ReceptionPatientAppointmentsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  patientName: string;
}

const statusLabels: Record<string, string> = {
  scheduled: "Agendado",
  confirmed: "Confirmado",
  waiting: "Aguardando",
  in_progress: "Em atendimento",
  completed: "Finalizado",
  no_show: "Falta",
  cancelled: "Cancelado",
};

function timeLabel(appointment: ReceptionPatientAppointment): string {
  const start = appointment.startTime.slice(0, 5);
  const end = appointment.endTime?.slice(0, 5);
  return end ? `${start} - ${end}` : start;
}

export function ReceptionPatientAppointmentsSheet({
  open,
  onOpenChange,
  patientId,
  patientName,
}: ReceptionPatientAppointmentsSheetProps) {
  const [appointments, setAppointments] = useState<ReceptionPatientAppointment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAppointments = useCallback(async () => {
    if (!patientId) return;
    try {
      setLoading(true);
      setError(null);
      setAppointments(await receptionService.listPatientAppointments(patientId));
    } catch (loadError) {
      setAppointments([]);
      setError(loadError instanceof Error ? loadError.message : "Falha ao carregar agendamentos");
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    if (open) void loadAppointments();
  }, [loadAppointments, open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Agendamentos do paciente</SheetTitle>
          <SheetDescription>{patientName}</SheetDescription>
        </SheetHeader>

        <div className="mt-6">
          {loading && <LoadingState message="Carregando histórico de agendamentos..." />}
          {!loading && error && <ErrorState message={error} onRetry={() => void loadAppointments()} />}
          {!loading && !error && appointments.length === 0 && (
            <EmptyState
              icon={CalendarDays}
              title="Nenhum agendamento encontrado"
              description="Não há agendamentos acessíveis para este paciente na empresa e unidade atuais."
            />
          )}
          {!loading && !error && appointments.length > 0 && (
            <ol
              aria-label={`Histórico de agendamentos de ${patientName}`}
              className="space-y-3"
            >
              {appointments.map((appointment) => (
                <li
                  key={appointment.id}
                  className="rounded-md border bg-card p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">
                        {formatDate(appointment.appointmentDate)}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {timeLabel(appointment)}
                      </p>
                    </div>
                    <Badge variant="outline">
                      {statusLabels[appointment.status] ?? appointment.status.replace(/_/g, " ")}
                    </Badge>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="mt-6 flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
