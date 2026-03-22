import { useEffect, useState } from "react";
import { Check, Clock, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState } from "@/components/StateViews";
import { AppointmentStatusBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { api } from "@/services/api";
import { Appointment } from "@/types";
import { useToast } from "@/hooks/use-toast";

export default function ReceptionPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    api.getAppointments("2026-03-22").then((a) => { setAppointments(a); setLoading(false); });
  }, []);

  const handleCheckIn = (id: string) => {
    setAppointments((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: "confirmed" as const } : a))
    );
    toast({ title: "Check-in realizado!" });
  };

  const handleStartAttendance = (id: string) => {
    setAppointments((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: "in_progress" as const } : a))
    );
    toast({ title: "Atendimento iniciado!" });
  };

  if (loading) return <LoadingState />;

  const sorted = [...appointments].sort((a, b) => a.time.localeCompare(b.time));
  const waiting = sorted.filter((a) => a.status === "confirmed");
  const inProgress = sorted.filter((a) => a.status === "in_progress");

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Recepção" description={`${sorted.length} pacientes agendados hoje`} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="border-warning/30 bg-warning/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="h-4 w-4 text-warning" />
              <span className="font-semibold text-sm">Aguardando ({waiting.length})</span>
            </div>
          </CardContent>
        </Card>
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <UserCheck className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">Em Atendimento ({inProgress.length})</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {sorted.length === 0 ? (
        <EmptyState title="Nenhum paciente hoje" icon={UserCheck} />
      ) : (
        <div className="space-y-3">
          {sorted.map((a) => (
            <Card key={a.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="text-center min-w-[50px]">
                    <p className="text-sm font-bold text-primary">{a.time}</p>
                  </div>
                  <div>
                    <p className="font-medium">{a.patientName}</p>
                    <p className="text-sm text-muted-foreground">{a.doctorName} • {a.type}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <AppointmentStatusBadge status={a.status} />
                  {a.status === "scheduled" && (
                    <Button size="sm" variant="outline" onClick={() => handleCheckIn(a.id)}>
                      <Check className="mr-1 h-3 w-3" />Check-in
                    </Button>
                  )}
                  {a.status === "confirmed" && (
                    <Button size="sm" onClick={() => handleStartAttendance(a.id)}>
                      Iniciar
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
