import { useEffect, useState } from "react";
import { Check, Clock, UserCheck, Play, AlertTriangle, DollarSign, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState } from "@/components/StateViews";
import { AppointmentStatusBadge, AppointmentTypeBadge } from "@/components/StatusBadge";
import { api } from "@/services/api";
import { Appointment, Patient, Payment } from "@/types";
import { useToast } from "@/hooks/use-toast";
import { calculateAge, getAppointmentTypeLabel } from "@/utils/formatters";

type ReceptionStatus = "arrived" | "waiting" | "in_progress" | "completed";

export default function ReceptionPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    Promise.all([
      api.getAppointments("2026-03-22"),
      api.getPatients(),
      api.getPayments(),
    ]).then(([a, p, pay]) => {
      setAppointments(a);
      setPatients(p);
      setPayments(pay);
      setLoading(false);
    });
  }, []);

  const handleCheckIn = (id: string) => {
    setAppointments((prev) => prev.map((a) => (a.id === id ? { ...a, status: "waiting" as const } : a)));
    toast({ title: "Check-in realizado! Paciente na sala de espera." });
  };

  const handleStartAttendance = (id: string) => {
    setAppointments((prev) => prev.map((a) => (a.id === id ? { ...a, status: "in_progress" as const } : a)));
    toast({ title: "Atendimento iniciado!" });
  };

  if (loading) return <LoadingState />;

  const sorted = [...appointments].sort((a, b) => a.time.localeCompare(b.time));
  const arrived = sorted.filter((a) => a.status === "confirmed");
  const waiting = sorted.filter((a) => a.status === "waiting");
  const inProgress = sorted.filter((a) => a.status === "in_progress");
  const completed = sorted.filter((a) => a.status === "completed");

  const getPatient = (patientId: string) => patients.find((p) => p.id === patientId);
  const hasPending = (patientId: string) => payments.some((p) => p.patientId === patientId && (p.status === "pending" || p.status === "overdue"));

  // Check if appointment is late (past scheduled time and still scheduled/confirmed)
  const isLate = (a: Appointment) => {
    const now = new Date();
    const [h, m] = a.time.split(":").map(Number);
    const scheduled = new Date();
    scheduled.setHours(h, m, 0, 0);
    return now > scheduled && (a.status === "scheduled" || a.status === "confirmed");
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Recepção" description={`${sorted.length} pacientes agendados hoje`} />

      {/* Status cards */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        <StatusCard icon={<Check className="h-4 w-4" />} label="Chegaram" count={arrived.length} color="text-primary" bg="bg-primary/5 border-primary/20" />
        <StatusCard icon={<Clock className="h-4 w-4" />} label="Aguardando" count={waiting.length} color="text-warning" bg="bg-warning/5 border-warning/20" />
        <StatusCard icon={<Play className="h-4 w-4" />} label="Em atendimento" count={inProgress.length} color="text-success" bg="bg-success/5 border-success/20" />
        <StatusCard icon={<UserCheck className="h-4 w-4" />} label="Finalizados" count={completed.length} color="text-muted-foreground" bg="bg-muted/50" />
      </div>

      {sorted.length === 0 ? (
        <EmptyState title="Nenhum paciente hoje" icon={UserCheck} />
      ) : (
        <div className="space-y-2">
          {sorted.map((a) => {
            const patient = getPatient(a.patientId);
            const pending = hasPending(a.patientId);
            const late = isLate(a);
            const age = patient ? calculateAge(patient.birthDate) : null;

            return (
              <Card key={a.id} className={`hover:shadow-md transition-shadow ${late ? "border-l-4 border-l-destructive" : a.status === "waiting" ? "border-l-4 border-l-warning" : a.status === "in_progress" ? "border-l-4 border-l-success" : ""}`}>
                <CardContent className="p-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="text-center min-w-[48px]">
                      <p className="text-sm font-bold text-primary">{a.time}</p>
                      <p className="text-[10px] text-muted-foreground">{a.duration}min</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="font-medium text-sm">{a.patientName}</p>
                        {age != null && <span className="text-[10px] text-muted-foreground">{age}a</span>}
                        <AppointmentTypeBadge type={a.type} />
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-xs text-muted-foreground">{a.doctorName}{a.specialty ? ` • ${a.specialty}` : ""}</p>
                        <span className="text-[10px] text-muted-foreground">{patient?.healthInsurance || "Particular"}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {late && (
                          <span className="text-[10px] text-destructive font-medium flex items-center gap-0.5">
                            <AlertTriangle className="h-2.5 w-2.5" />Atrasado
                          </span>
                        )}
                        {pending && (
                          <span className="text-[10px] text-warning font-medium flex items-center gap-0.5">
                            <DollarSign className="h-2.5 w-2.5" />Pendência financeira
                          </span>
                        )}
                        {patient?.allergies && (
                          <span className="text-[10px] text-destructive flex items-center gap-0.5">
                            <AlertTriangle className="h-2.5 w-2.5" />{patient.allergies}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <AppointmentStatusBadge status={a.status} />
                    {(a.status === "scheduled" || a.status === "confirmed") && (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleCheckIn(a.id)}>
                        <Check className="mr-1 h-3 w-3" />Check-in
                      </Button>
                    )}
                    {a.status === "waiting" && (
                      <Button size="sm" className="h-7 text-xs" onClick={() => handleStartAttendance(a.id)}>
                        <Play className="mr-1 h-3 w-3" />Iniciar
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatusCard({ icon, label, count, color, bg }: { icon: React.ReactNode; label: string; count: number; color: string; bg: string }) {
  return (
    <Card className={`${bg}`}>
      <CardContent className="p-3 flex items-center gap-2">
        <div className={color}>{icon}</div>
        <div>
          <p className={`text-lg font-bold leading-tight ${color}`}>{count}</p>
          <p className="text-[10px] text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}
