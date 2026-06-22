/**
 * Index.tsx
 *
 * Landing page do sistema (rota "/"). É renderizada APÓS o login, dentro do AppLayout.
 *
 * Conteúdo:
 *   - Saudação personalizada
 *   - KPIs do dia (agendamentos, confirmados, em espera, atendidos)
 *   - Próximo paciente
 *   - Atalhos rápidos (novo agendamento, buscar paciente, prescrever)
 *   - Notificações recentes (3 últimas)
 *
 * DashboardPage continua existindo e oferece visão mais completa para
 * quem precisa de informações detalhadas.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Calendar, Clock, CheckCircle2, UserPlus, Search, Pill,
  Bell, ArrowRight, Stethoscope, Heart, Mail, MessageSquare, Smartphone,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { StatsCard } from "@/components/StatsCard";
import { LoadingState, ErrorState } from "@/components/StateViews";
import { AppointmentStatusBadge } from "@/components/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { appointmentsService, professionalsLookup, DbAppointment, DbProfessional } from "@/services/appointmentsService";
import { friendlyError } from "@/utils/friendlyError";

interface PatientLite { id: string; full_name: string; }
interface NotificationLite {
  id: string;
  channel: "EMAIL" | "SMS" | "WHATSAPP" | "PUSH";
  subject: string | null;
  body: string;
  status: string;
  dt_queued: string;
}

const channelIcon: Record<NotificationLite["channel"], React.ComponentType<{ className?: string }>> = {
  EMAIL: Mail,
  SMS: Smartphone,
  WHATSAPP: MessageSquare,
  PUSH: Bell,
};

const channelVariant: Record<NotificationLite["channel"], string> = {
  EMAIL: "bg-primary/10 text-primary",
  SMS: "bg-warning/10 text-warning",
  WHATSAPP: "bg-success/10 text-success",
  PUSH: "bg-accent text-accent-foreground",
};

function firstName(full?: string | null): string {
  if (!full) return "Usuário";
  return full.split(" ")[0];
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "agora";
  if (diff < 3600) return `${Math.floor(diff / 60)} min atrás`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h atrás`;
  return `${Math.floor(diff / 86400)}d atrás`;
}

export default function Index() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [appointments, setAppointments] = useState<DbAppointment[]>([]);
  const [professionals, setProfessionals] = useState<DbProfessional[]>([]);
  const [patients, setPatients] = useState<PatientLite[]>([]);
  const [notifications, setNotifications] = useState<NotificationLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const today = new Date().toISOString().split("T")[0];

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const [profs, appts] = await Promise.all([
          professionalsLookup.getAll(),
          appointmentsService.getByDate(today),
        ]);
        setProfessionals(profs);
        setAppointments(appts);

        const patientIds = [...new Set(appts.map((a) => a.patient_id).filter(Boolean))];
        if (patientIds.length > 0) {
          const { data } = await supabase.from("patients").select("id, full_name").in("id", patientIds);
          setPatients(data || []);
        }

        if (user?.id) {
          // Notificações recentes (best-effort — silencioso se a tabela não existir ainda)
          const { data: notifs } = await supabase
            .from("notifications")
            .select("id, channel, subject, body, status, dt_queued")
            .order("dt_queued", { ascending: false })
            .limit(3);
          setNotifications((notifs as NotificationLite[]) || []);
        }
      } catch (err: any) {
        setError(friendlyError(err, "Carregar painel"));
      } finally {
        setLoading(false);
      }
    })();
  }, [today, user?.id]);

  if (loading) return <LoadingState message="Carregando seu painel..." />;
  if (error) return <ErrorState message={error} onRetry={() => window.location.reload()} />;

  const getPatient = (id: string | null) => patients.find((p) => p.id === id);
  const getProf = (id: string | null) => professionals.find((p) => p.id === id);

  const confirmed = appointments.filter((a) => a.status === "confirmed").length;
  const waiting = appointments.filter((a) => a.status === "waiting").length;
  const completed = appointments.filter((a) => a.status === "completed").length;

  const sortedByTime = [...appointments].sort((a, b) =>
    (a.start_time ?? "").localeCompare(b.start_time ?? ""),
  );
  const nextAppointment = sortedByTime.find((a) =>
    ["scheduled", "confirmed", "waiting"].includes(a.status),
  );

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!search.trim()) {
      navigate("/patients");
      return;
    }
    navigate(`/patients?q=${encodeURIComponent(search.trim())}`);
  };

  const markNotificationRead = async (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    await supabase
      .from("notifications")
      .update({ status: "READ", updated_at: new Date().toISOString() })
      .eq("id", id);
    toast({ title: "Notificação marcada como lida." });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={`${greeting()}, ${firstName(user?.full_name)}!`}
        description={`Hoje, ${new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}`}
        actions={
          <Button variant="outline" size="sm" onClick={() => navigate("/schedule")}>
            <Calendar className="mr-2 h-4 w-4" />
            Abrir agenda
          </Button>
        }
      />

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard title="Agendamentos hoje" value={appointments.length} icon={Calendar} variant="primary" />
        <StatsCard title="Confirmados" value={confirmed} icon={CheckCircle2} variant="success" />
        <StatsCard title="Em espera" value={waiting} icon={Clock} variant="warning" />
        <StatsCard title="Atendidos" value={completed} icon={Stethoscope} variant="secondary" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Atalho de busca + ações rápidas */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Atalhos rápidos</CardTitle>
            <CardDescription>Acesso direto ao que você mais usa.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <form onSubmit={handleSearch} className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar paciente por nome ou CPF..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </form>
            <div className="grid grid-cols-1 gap-2">
              <Button variant="outline" className="justify-start" onClick={() => navigate("/schedule?new=1")}>
                <UserPlus className="mr-2 h-4 w-4" />
                Novo agendamento
              </Button>
              <Button variant="outline" className="justify-start" onClick={() => navigate("/patients")}>
                <Search className="mr-2 h-4 w-4" />
                Buscar paciente
              </Button>
              <Button variant="outline" className="justify-start" onClick={() => toast({ title: "Módulo de prescrição em breve." })}>
                <Pill className="mr-2 h-4 w-4" />
                Prescrever (em breve)
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Próximo paciente */}
        <Card className="lg:col-span-1">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Heart className="h-4 w-4 text-primary" />
                Próximo paciente
              </CardTitle>
              <CardDescription>Quem você atenderá a seguir.</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate("/reception")}>
              Recepção
              <ArrowRight className="ml-1 h-3 w-3" />
            </Button>
          </CardHeader>
          <CardContent>
            {!nextAppointment ? (
              <p className="text-sm text-muted-foreground">Nenhum paciente na fila.</p>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-lg font-semibold leading-tight">
                      {getPatient(nextAppointment.patient_id)?.full_name || "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Dr(a). {getProf(nextAppointment.professional_id)?.full_name || "—"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-primary">
                      {nextAppointment.start_time?.substring(0, 5)}
                    </p>
                    <AppointmentStatusBadge status={nextAppointment.status as any} />
                  </div>
                </div>
                <Button
                  className="w-full"
                  size="sm"
                  onClick={() => nextAppointment.patient_id && navigate(`/patients/${nextAppointment.patient_id}`)}
                >
                  Abrir prontuário
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Notificações recentes */}
        <Card className="lg:col-span-1">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Bell className="h-4 w-4" />
                Notificações
              </CardTitle>
              <CardDescription>Últimas mensagens enviadas.</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate("/admin/notifications")}>
              Ver todas
              <ArrowRight className="ml-1 h-3 w-3" />
            </Button>
          </CardHeader>
          <CardContent>
            {notifications.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem notificações recentes.</p>
            ) : (
              <ul className="space-y-2">
                {notifications.map((n) => {
                  const Icon = channelIcon[n.channel];
                  return (
                    <li
                      key={n.id}
                      className="flex items-start gap-3 rounded-md border p-2 hover:bg-muted/30 transition-colors"
                    >
                      <span className={`rounded-md p-1.5 ${channelVariant[n.channel]}`}>
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {n.subject || n.body.slice(0, 60)}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {n.channel} • {timeAgo(n.dt_queued)} • {n.status}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[11px]"
                        onClick={() => markNotificationRead(n.id)}
                      >
                        Marcar lida
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Próximos atendimentos (resumo) */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg">Agenda de hoje</CardTitle>
            <CardDescription>
              {appointments.length === 0
                ? "Nenhum atendimento para hoje."
                : `${appointments.length} atendimento${appointments.length > 1 ? "s" : ""} programado${appointments.length > 1 ? "s" : ""}.`}
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate("/schedule")}>
            Ver agenda completa
            <ArrowRight className="ml-1 h-3 w-3" />
          </Button>
        </CardHeader>
        <CardContent>
          {appointments.length === 0 ? (
            <div className="text-center py-6">
              <Badge variant="outline" className="text-success border-success/30 bg-success/5">
                Tudo tranquilo por hoje
              </Badge>
            </div>
          ) : (
            <div className="space-y-2">
              {sortedByTime.slice(0, 6).map((a) => {
                const pat = getPatient(a.patient_id);
                const prof = getProf(a.professional_id);
                return (
                  <button
                    key={a.id}
                    onClick={() => a.patient_id && navigate(`/patients/${a.patient_id}`)}
                    className="w-full flex items-center justify-between py-2 px-2 rounded-md border-b last:border-0 hover:bg-muted/30 text-left"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="text-sm font-medium text-primary w-12 shrink-0">
                        {a.start_time?.substring(0, 5)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{pat?.full_name || "—"}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          Dr(a). {prof?.full_name || "—"}
                        </p>
                      </div>
                    </div>
                    <AppointmentStatusBadge status={a.status as any} />
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}