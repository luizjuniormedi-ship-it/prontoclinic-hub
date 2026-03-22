import { useEffect, useState } from "react";
import { Calendar, Users, DollarSign, Clock } from "lucide-react";
import { StatsCard } from "@/components/StatsCard";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState } from "@/components/StateViews";
import { AppointmentStatusBadge } from "@/components/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/services/api";
import { DashboardStats, Appointment } from "@/types";
import { formatCurrency } from "@/utils/formatters";

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.getDashboardStats(), api.getAppointments("2026-03-22")]).then(([s, a]) => {
      setStats(s);
      setAppointments(a);
      setLoading(false);
    });
  }, []);

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Dashboard" description="Visão geral da clínica" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard title="Atendimentos Hoje" value={stats!.todayAppointments} icon={Calendar} variant="primary" />
        <StatsCard title="Pacientes Cadastrados" value={stats!.totalPatients} icon={Users} variant="secondary" />
        <StatsCard title="Faturamento Mensal" value={formatCurrency(stats!.monthlyRevenue)} icon={DollarSign} variant="success" />
        <StatsCard title="Pagamentos Pendentes" value={stats!.pendingPayments} icon={Clock} variant="warning" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Próximos Atendimentos</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {appointments.slice(0, 5).map((a) => (
              <div key={a.id} className="flex items-center justify-between py-2 border-b last:border-0">
                <div className="flex items-center gap-3">
                  <div className="text-sm font-medium text-primary w-12">{a.time}</div>
                  <div>
                    <p className="text-sm font-medium">{a.patientName}</p>
                    <p className="text-xs text-muted-foreground">{a.doctorName} • {a.type}</p>
                  </div>
                </div>
                <AppointmentStatusBadge status={a.status} />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
