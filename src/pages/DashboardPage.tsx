import { useEffect, useState } from "react";
import { Calendar, Users, DollarSign, Clock, AlertTriangle, TrendingUp, ClipboardList, Building2 } from "lucide-react";
import { StatsCard } from "@/components/StatsCard";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState } from "@/components/StateViews";
import { AppointmentStatusBadge, AppointmentTypeBadge } from "@/components/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api } from "@/services/api";
import { DashboardStats, Appointment, Patient } from "@/types";
import { formatCurrency, calculateAge } from "@/utils/formatters";

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.getDashboardStats(), api.getAppointments("2026-03-22"), api.getPatients()]).then(([s, a, p]) => {
      setStats(s); setAppointments(a); setPatients(p); setLoading(false);
    });
  }, []);

  if (loading) return <LoadingState />;

  const waiting = appointments.filter((a) => a.status === "waiting").length;
  const inProgress = appointments.filter((a) => a.status === "in_progress").length;
  const getPatient = (id: string) => patients.find((p) => p.id === id);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Dashboard" description="Visão geral da clínica" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatsCard title="Atendimentos Hoje" value={stats!.todayAppointments} icon={Calendar} variant="primary" />
        <StatsCard title="Pacientes Cadastrados" value={stats!.totalPatients} icon={Users} variant="secondary" />
        <StatsCard title="Faturamento Mensal" value={formatCurrency(stats!.monthlyRevenue)} icon={TrendingUp} variant="success" />
        <StatsCard title="Pagamentos Pendentes" value={stats!.pendingPayments} icon={DollarSign} variant="warning" />
        {stats!.pendingWorklist != null && (
          <StatsCard title="Worklist Pendente" value={stats!.pendingWorklist} icon={ClipboardList} variant="default" />
        )}
      </div>

      {/* Quick status + production by unit */}
      <div className="grid gap-3 md:grid-cols-3">
        {(waiting > 0 || inProgress > 0) && (
          <div className="flex flex-col gap-2 md:col-span-2">
            {waiting > 0 && (
              <Card className="border-warning/30 bg-warning/5">
                <CardContent className="p-3 flex items-center gap-2">
                  <Clock className="h-4 w-4 text-warning" />
                  <span className="text-sm font-medium">{waiting} paciente{waiting > 1 ? "s" : ""} aguardando</span>
                </CardContent>
              </Card>
            )}
            {inProgress > 0 && (
              <Card className="border-success/30 bg-success/5">
                <CardContent className="p-3 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-success" />
                  <span className="text-sm font-medium">{inProgress} em atendimento</span>
                </CardContent>
              </Card>
            )}
          </div>
        )}
        {stats!.productionByUnit && stats!.productionByUnit.length > 0 && (
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Building2 className="h-4 w-4 text-primary" />
                <span className="text-xs font-medium text-muted-foreground">Produção por Unidade</span>
              </div>
              {stats!.productionByUnit.map((u) => (
                <div key={u.unitName} className="flex justify-between items-center py-1">
                  <span className="text-xs">{u.unitName}</span>
                  <Badge variant="outline" className="border-0 bg-primary/10 text-primary text-[10px]">{u.count} atend.</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Próximos Atendimentos</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {appointments.slice(0, 6).map((a) => {
              const patient = getPatient(a.patientId);
              const age = patient ? calculateAge(patient.birthDate) : null;
              return (
                <div key={a.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div className="flex items-center gap-3">
                    <div className="text-sm font-medium text-primary w-12">{a.time}</div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium">{a.patientName}</p>
                        {age != null && <span className="text-[10px] text-muted-foreground">{age}a</span>}
                        <AppointmentTypeBadge type={a.type} />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {a.doctorName}{a.specialty ? ` • ${a.specialty}` : ""}
                        {a.unitName ? ` • ${a.unitName}` : ""}
                      </p>
                    </div>
                  </div>
                  <AppointmentStatusBadge status={a.status} />
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
