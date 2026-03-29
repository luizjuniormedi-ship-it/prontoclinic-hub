import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Calendar, Users, Clock, AlertTriangle, TrendingUp, UserX, Stethoscope } from "lucide-react";
import { StatsCard } from "@/components/StatsCard";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, ErrorState } from "@/components/StateViews";
import { AppointmentStatusBadge } from "@/components/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { appointmentsService, professionalsLookup, DbAppointment, DbProfessional } from "@/services/appointmentsService";
import { calculateAge } from "@/utils/formatters";
import { useAuth } from "@/hooks/useAuth";

interface PatientRow { id: string; full_name: string; birth_date: string | null; }

export default function DashboardPage() {
  const [appointments, setAppointments] = useState<DbAppointment[]>([]);
  const [professionals, setProfessionals] = useState<DbProfessional[]>([]);
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [totalPatients, setTotalPatients] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { user } = useAuth();
  const today = new Date().toISOString().split("T")[0];

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const [profs, appts, { count }] = await Promise.all([
          professionalsLookup.getAll(),
          appointmentsService.getByDate(today),
          supabase.from("patients").select("id", { count: "exact", head: true }),
        ]);
        setProfessionals(profs);
        setAppointments(appts);
        setTotalPatients(count || 0);

        const patientIds = [...new Set(appts.map((a) => a.patient_id).filter(Boolean))];
        if (patientIds.length > 0) {
          const { data } = await supabase.from("patients").select("id, full_name, birth_date").in("id", patientIds);
          setPatients(data || []);
        }
      } catch (err: any) { setError(err.message); }
      finally { setLoading(false); }
    })();
  }, [today]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={() => window.location.reload()} />;

  const waiting = appointments.filter((a) => a.status === "waiting").length;
  const inProgress = appointments.filter((a) => a.status === "in_progress").length;
  const noShow = appointments.filter((a) => a.status === "no_show").length;
  const completed = appointments.filter((a) => a.status === "completed").length;
  const getPatient = (pid: string | null) => patients.find((p) => p.id === pid);
  const getProf = (pid: string | null) => professionals.find((p) => p.id === pid);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Dashboard" description={`Bem-vindo, ${user?.full_name || ""}! Visão geral da clínica.`} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatsCard title="Agendamentos Hoje" value={appointments.length} icon={Calendar} variant="primary" />
        <StatsCard title="Pacientes Cadastrados" value={totalPatients} icon={Users} variant="secondary" />
        <StatsCard title="Aguardando" value={waiting} icon={Clock} variant="warning" />
        <StatsCard title="Em Atendimento" value={inProgress} icon={Stethoscope} variant="success" />
        <StatsCard title="Faltas Hoje" value={noShow} icon={UserX} variant="destructive" />
      </div>

      {/* Quick action alerts */}
      {(waiting > 0 || inProgress > 0) && (
        <div className="flex flex-col gap-2">
          {waiting > 0 && (
            <Card className="border-warning/30 bg-warning/5 cursor-pointer hover:shadow-md" onClick={() => navigate("/reception")}>
              <CardContent className="p-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-warning" />
                  <span className="text-sm font-medium">{waiting} paciente{waiting > 1 ? "s" : ""} na sala de espera</span>
                </div>
                <Button variant="ghost" size="sm" className="text-xs">Ir para Recepção →</Button>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Next appointments */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Próximos Atendimentos</CardTitle>
          <Button variant="ghost" size="sm" className="text-xs" onClick={() => navigate("/schedule")}>Ver Agenda →</Button>
        </CardHeader>
        <CardContent>
          {appointments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum atendimento agendado para hoje.</p>
          ) : (
            <div className="space-y-2">
              {appointments.slice(0, 10).map((a) => {
                const pat = getPatient(a.patient_id);
                const prof = getProf(a.professional_id);
                return (
                  <div key={a.id} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div className="flex items-center gap-3">
                      <div className="text-sm font-medium text-primary w-12">{a.start_time?.substring(0, 5)}</div>
                      <div>
                        <p className="text-sm font-medium">{pat?.full_name || "—"}</p>
                        <p className="text-xs text-muted-foreground">{prof?.full_name || "—"}</p>
                      </div>
                    </div>
                    <AppointmentStatusBadge status={a.status as any} />
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
