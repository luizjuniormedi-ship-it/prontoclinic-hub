/**
 * MeusAgendamentosPage.tsx
 *
 * Portal do PACIENTE logado — lista seus agendamentos (proximos e passados).
 *
 * Features:
 *   - Abas: Proximos / Passados
 *   - Filtros: status, periodo
 *   - Cancelar (com modal de confirmacao)
 *   - Reagendar (modal placeholder — clinical rule: cria novo + cancela antigo)
 *   - Confirmar presenca (se agendamento for hoje/amanha)
 *
 * Para esta versao a paciente eh o usuario logado (vinculado via
 * user_profiles.patient_id). A clinic pode expor isso direto no JWT
 * via claim custom ou via coluna na profiles.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Calendar, Clock, MapPin, User, X, RefreshCw, CheckCircle2,
  AlertTriangle, Loader2, Filter, ChevronRight,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState, ErrorState } from "@/components/StateViews";
import { AppointmentStatusBadge } from "@/components/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import {
  appointmentsService,
  professionalsLookup,
  DbAppointment, DbProfessional,
} from "@/services/appointmentsService";
import type { AppointmentStatusForBadge } from "@/types/missing";

type Filter = "todos" | "agendado" | "confirmado" | "atendido" | "cancelado" | "faltou";

interface UserProfileWithPatient { id: string; patient_id?: string | null; }
interface ErrorWithMessage { message?: string; }

function startOfDay(iso: string): Date {
  const d = new Date(iso + "T00:00:00");
  return d;
}

function diffDays(a: Date, b: Date): number {
  return Math.round((startOfDay(b.toISOString().slice(0, 10)).getTime() - a.getTime()) / 86400000);
}

function isSameOrFuture(date: string): boolean {
  return startOfDay(date).getTime() >= startOfDay(new Date().toISOString().slice(0, 10)).getTime();
}

export default function MeusAgendamentosPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [appointments, setAppointments] = useState<DbAppointment[]>([]);
  const [professionals, setProfessionals] = useState<DbProfessional[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("todos");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  // Reschedule / Cancel state
  const [cancelTarget, setCancelTarget] = useState<DbAppointment | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelLoading, setCancelLoading] = useState(false);

  const [rescheduleTarget, setRescheduleTarget] = useState<DbAppointment | null>(null);

  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        // 1) Resolve patient_id do usuario logado
        let patientId: string | null = null;
        if (user?.id) {
          const { data: prof } = await supabase
            .from("user_profiles")
            .select("id")
            .eq("id", user.id)
            .maybeSingle();
          // Tenta campo direto na user_profiles
          if (prof && (prof as UserProfileWithPatient).patient_id) {
            patientId = (prof as UserProfileWithPatient).patient_id ?? null;
          } else if (user.email) {
            // Fallback: tenta casar pelo e-mail
            const { data: pat } = await supabase
              .from("patients")
              .select("id")
              .eq("email", user.email)
              .maybeSingle();
            if (pat) patientId = pat.id as string;
          }
        }

        if (!patientId) {
          // Sem vinculo -> lista vazia mas nao erro
          setAppointments([]);
          setProfessionals([]);
          return;
        }

        const [appts, profs] = await Promise.all([
          supabase
            .from("appointments")
            .select("*")
            .eq("patient_id", patientId)
            .order("appointment_date", { ascending: false })
            .order("start_time", { ascending: false })
            .then((r) => (r.data ?? []) as DbAppointment[]),
          professionalsLookup.getAll(),
        ]);
        setAppointments(appts);
        setProfessionals(profs);
      } catch (err) {
        setError(err?.message ?? "Erro ao carregar agendamentos.");
      } finally {
        setLoading(false);
      }
    })();
  }, [user?.id, user?.email]);

  const getProf = (id: string | null) => professionals.find((p) => p.id === id);

  const filtered = useMemo(() => {
    return appointments.filter((a) => {
      if (filter === "todos") {
        // OK
      } else if (filter === "agendado" && a.status !== "scheduled") return false;
      else if (filter === "confirmado" && a.status !== "confirmed") return false;
      else if (filter === "atendido" && a.status !== "completed") return false;
      else if (filter === "cancelado" && a.status !== "cancelled") return false;
      else if (filter === "faltou" && a.status !== "no_show") return false;

      if (fromDate && a.appointment_date < fromDate) return false;
      if (toDate && a.appointment_date > toDate) return false;
      return true;
    });
  }, [appointments, filter, fromDate, toDate]);

  const upcoming = useMemo(() => filtered.filter((a) => isSameOrFuture(a.appointment_date)), [filtered]);
  const past = useMemo(() => filtered.filter((a) => !isSameOrFuture(a.appointment_date)), [filtered]);

  const handleCancel = async () => {
    if (!cancelTarget) return;
    setCancelLoading(true);
    try {
      await appointmentsService.updateStatus(cancelTarget.id, "cancelled", cancelReason || "Cancelado pelo paciente");
      setAppointments((prev) =>
        prev.map((a) => (a.id === cancelTarget.id ? { ...a, status: "cancelled" } : a)),
      );
      toast({ title: "Agendamento cancelado." });
      setCancelTarget(null);
      setCancelReason("");
    } catch (err) {
      toast({ title: "Erro ao cancelar", description: (err as Error).message, variant: "destructive" });
    } finally {
      setCancelLoading(false);
    }
  };

  const handleConfirm = async (appt: DbAppointment) => {
    setConfirmingId(appt.id);
    try {
      await appointmentsService.updateStatus(appt.id, "confirmed");
      setAppointments((prev) =>
        prev.map((a) => (a.id === appt.id ? { ...a, status: "confirmed" } : a)),
      );
      toast({ title: "Presença confirmada! Até logo." });
    } catch (err) {
      toast({ title: "Erro ao confirmar", description: (err as Error).message, variant: "destructive" });
    } finally {
      setConfirmingId(null);
    }
  };

  if (loading) return <LoadingState message="Carregando seus agendamentos..." />;
  if (error) return <ErrorState message={error} onRetry={() => window.location.reload()} />;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Meus Agendamentos"
        description="Consulte, reagende ou cancele suas consultas e exames."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="h-4 w-4" />
            Filtros
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="status">Status</Label>
              <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
                <SelectTrigger id="status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="agendado">Agendado</SelectItem>
                  <SelectItem value="confirmado">Confirmado</SelectItem>
                  <SelectItem value="atendido">Atendido</SelectItem>
                  <SelectItem value="cancelado">Cancelado</SelectItem>
                  <SelectItem value="faltou">Faltou</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fromDate">De</Label>
              <Input id="fromDate" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="toDate">Até</Label>
              <Input id="toDate" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="upcoming">
        <TabsList>
          <TabsTrigger value="upcoming">
            Próximos ({upcoming.length})
          </TabsTrigger>
          <TabsTrigger value="past">
            Passados ({past.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="upcoming" className="space-y-3">
          {upcoming.length === 0 ? (
            <EmptyState
              icon={Calendar}
              title="Sem agendamentos próximos"
              description="Quando você tiver uma consulta, ela aparecerá aqui."
              action={
                <Button onClick={() => navigate("/schedule")}>
                  Ver agenda
                </Button>
              }
            />
          ) : (
            <ul className="space-y-2">
              {upcoming.map((a) => {
                const prof = getProf(a.professional_id);
                const daysAway = diffDays(new Date(), startOfDay(a.appointment_date));
                const canConfirm = daysAway <= 1 && (a.status === "scheduled" || a.status === "confirmed");
                return (
                  <li key={a.id}>
                    <AppointmentCard
                      appt={a}
                      prof={prof}
                      actions={
                        <>
                          {canConfirm && a.status !== "confirmed" && (
                            <Button
                              size="sm"
                              onClick={() => handleConfirm(a)}
                              disabled={confirmingId === a.id}
                            >
                              {confirmingId === a.id ? (
                                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <CheckCircle2 className="mr-2 h-3.5 w-3.5" />
                              )}
                              Confirmar presença
                            </Button>
                          )}
                          {(a.status === "scheduled" || a.status === "confirmed") && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setRescheduleTarget(a)}
                              >
                                <RefreshCw className="mr-2 h-3.5 w-3.5" />
                                Reagendar
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-destructive"
                                onClick={() => setCancelTarget(a)}
                              >
                                <X className="mr-2 h-3.5 w-3.5" />
                                Cancelar
                              </Button>
                            </>
                          )}
                        </>
                      }
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="past" className="space-y-3">
          {past.length === 0 ? (
            <EmptyState
              icon={Clock}
              title="Sem agendamentos passados"
              description="Seu histórico aparecerá aqui."
            />
          ) : (
            <ul className="space-y-2">
              {past.map((a) => {
                const prof = getProf(a.professional_id);
                return (
                  <li key={a.id}>
                    <AppointmentCard
                      appt={a}
                      prof={prof}
                      actions={
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => a.patient_id && navigate(`/patients/${a.patient_id}`)}
                        >
                          Ver detalhes
                          <ChevronRight className="ml-1 h-3.5 w-3.5" />
                        </Button>
                      }
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </TabsContent>
      </Tabs>

      {/* Modal de cancelamento */}
      <Dialog open={!!cancelTarget} onOpenChange={(o) => !o && setCancelTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Cancelar agendamento
            </DialogTitle>
            <DialogDescription>
              Tem certeza que deseja cancelar este agendamento? Esta ação pode ser revertida
              entrando em contato com a clínica.
            </DialogDescription>
          </DialogHeader>
          {cancelTarget && (
            <div className="rounded-md bg-muted/40 p-3 text-sm">
              <p><strong>Data:</strong> {cancelTarget.appointment_date} às {cancelTarget.start_time?.substring(0, 5)}</p>
              <p><strong>Profissional:</strong> {getProf(cancelTarget.professional_id)?.full_name ?? "—"}</p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="motivo">Motivo (opcional)</Label>
            <Textarea
              id="motivo"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Conte para a clínica por que você precisa cancelar..."
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)} disabled={cancelLoading}>
              Voltar
            </Button>
            <Button variant="destructive" onClick={handleCancel} disabled={cancelLoading}>
              {cancelLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmar cancelamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de reagendamento — placeholder */}
      <Dialog open={!!rescheduleTarget} onOpenChange={(o) => !o && setRescheduleTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reagendar consulta</DialogTitle>
            <DialogDescription>
              A clínica entrará em contato com horários disponíveis. Em breve, esta tela permitirá
              escolher diretamente entre os slots livres.
            </DialogDescription>
          </DialogHeader>
          {rescheduleTarget && (
            <div className="rounded-md bg-muted/40 p-3 text-sm">
              <p><strong>Atual:</strong> {rescheduleTarget.appointment_date} às {rescheduleTarget.start_time?.substring(0, 5)}</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRescheduleTarget(null)}>Fechar</Button>
            <Button onClick={() => { setRescheduleTarget(null); toast({ title: "Solicitação enviada à recepção." }); }}>
              Solicitar reagendamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AppointmentCard({
  appt, prof, actions,
}: {
  appt: DbAppointment;
  prof: DbProfessional | undefined;
  actions: React.ReactNode;
}) {
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex items-start gap-4 min-w-0">
            <div className="rounded-lg bg-primary/10 text-primary p-2 shrink-0 hidden sm:block">
              <Calendar className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-sm">
                  {new Date(appt.appointment_date + "T00:00:00").toLocaleDateString("pt-BR", {
                    weekday: "short",
                    day: "2-digit",
                    month: "short",
                  })}
                </span>
                <Badge variant="outline" className="font-mono">
                  {appt.start_time?.substring(0, 5)}
                </Badge>
                <AppointmentStatusBadge status={appt.status as unknown as AppointmentStatusForBadge} />
              </div>
              <div className="mt-1 text-sm text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                {prof && (
                  <span className="flex items-center gap-1">
                    <User className="h-3 w-3" />
                    Dr(a). {prof.full_name}
                  </span>
                )}
                {appt.unit_id && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    Unidade {appt.unit_id.slice(0, 6)}
                  </span>
                )}
              </div>
              {appt.notes && (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                  Obs.: {appt.notes}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">{actions}</div>
        </div>
      </CardContent>
    </Card>
  );
}