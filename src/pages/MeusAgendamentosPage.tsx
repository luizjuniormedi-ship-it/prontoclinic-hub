/**
 * MeusAgendamentosPage.tsx
 *
 * Portal do PACIENTE logado — lista seus agendamentos (proximos e passados).
 *
 * Features:
 *   - Abas: Proximos / Passados
 *   - Filtros: status, periodo
 *   - Cancelar (com modal de confirmacao)
 *   - Reagendar com persistencia atomica no compromisso existente
 *   - Confirmar presenca (se agendamento for hoje/amanha)
 *
 * A autorização é resolvida exclusivamente no banco pelo vínculo
 * patients.user_id -> auth.uid(). O cliente nunca informa tenant/paciente
 * e todas as mutações atravessam RPCs específicas do portal.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Calendar, Clock, MapPin, User, X, RefreshCw, CheckCircle2,
  AlertTriangle, Loader2, Filter,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState, ErrorState } from "@/components/StateViews";
import { AppointmentStatusBadge } from "@/components/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  patientPortalService,
  type PatientPortalAppointment,
} from "@/services/patientPortalService";
import {
  clinicDateKey,
  diffClinicDays,
} from "@/services/patientPortalDate";
import type { AppointmentStatusForBadge } from "@/types/missing";

type Filter = "todos" | "agendado" | "confirmado" | "atendido" | "cancelado" | "faltou";

function isSameOrFuture(date: string, now = new Date()): boolean {
  return diffClinicDays(date, now) >= 0;
}

export default function MeusAgendamentosPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [appointments, setAppointments] = useState<PatientPortalAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("todos");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  // Reschedule / Cancel state
  const [cancelTarget, setCancelTarget] = useState<PatientPortalAppointment | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelLoading, setCancelLoading] = useState(false);

  const [rescheduleTarget, setRescheduleTarget] = useState<PatientPortalAppointment | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleTime, setRescheduleTime] = useState("");
  const [rescheduleReason, setRescheduleReason] = useState("");
  const [rescheduleLoading, setRescheduleLoading] = useState(false);

  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const loadAppointments = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setAppointments(await patientPortalService.listAppointments());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar agendamentos.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAppointments();
  }, [loadAppointments]);

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
      await patientPortalService.cancelAppointment(cancelTarget.id, cancelReason);
      await loadAppointments();
      toast({ title: "Agendamento cancelado." });
      setCancelTarget(null);
      setCancelReason("");
    } catch (err) {
      toast({ title: "Erro ao cancelar", description: (err as Error).message, variant: "destructive" });
    } finally {
      setCancelLoading(false);
    }
  };

  const handleConfirm = async (appt: PatientPortalAppointment) => {
    setConfirmingId(appt.id);
    try {
      await patientPortalService.confirmAppointment(appt.id);
      await loadAppointments();
      toast({ title: "Presença confirmada! Até logo." });
    } catch (err) {
      toast({ title: "Erro ao confirmar", description: (err as Error).message, variant: "destructive" });
    } finally {
      setConfirmingId(null);
    }
  };

  const openReschedule = (appointment: PatientPortalAppointment) => {
    setRescheduleTarget(appointment);
    setRescheduleDate("");
    setRescheduleTime(appointment.start_time.substring(0, 5));
    setRescheduleReason("");
  };

  const closeReschedule = () => {
    setRescheduleTarget(null);
    setRescheduleDate("");
    setRescheduleTime("");
    setRescheduleReason("");
  };

  const handleReschedule = async () => {
    if (!rescheduleTarget) return;
    setRescheduleLoading(true);
    try {
      await patientPortalService.rescheduleAppointment(rescheduleTarget.id, {
        appointmentDate: rescheduleDate,
        startTime: rescheduleTime,
        reason: rescheduleReason,
      });
      await loadAppointments();
      toast({ title: "Agendamento reagendado." });
      closeReschedule();
    } catch (err) {
      toast({
        title: "Erro ao reagendar",
        description: err instanceof Error ? err.message : "Não foi possível reagendar.",
        variant: "destructive",
      });
    } finally {
      setRescheduleLoading(false);
    }
  };

  if (loading) return <LoadingState message="Carregando seus agendamentos..." />;
  if (error) return <ErrorState message={error} onRetry={() => void loadAppointments()} />;

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
                const daysAway = diffClinicDays(a.appointment_date);
                const canConfirm = daysAway >= 0
                  && daysAway <= 1
                  && (a.status === "scheduled" || a.status === "confirmed");
                return (
                  <li key={a.id} data-appointment-id={a.id}>
                    <AppointmentCard
                      appt={a}
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
                                onClick={() => openReschedule(a)}
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
                return (
                  <li key={a.id}>
                    <AppointmentCard
                      appt={a}
                      actions={null}
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
              <p><strong>Profissional:</strong> {cancelTarget.professional_name ?? "—"}</p>
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

      <Dialog open={!!rescheduleTarget} onOpenChange={(open) => !open && closeReschedule()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reagendar consulta</DialogTitle>
            <DialogDescription>
              Escolha um novo horário dentro da grade publicada do profissional.
              A alteração será validada e gravada imediatamente.
            </DialogDescription>
          </DialogHeader>
          {rescheduleTarget && (
            <div className="rounded-md bg-muted/40 p-3 text-sm">
              <p><strong>Atual:</strong> {rescheduleTarget.appointment_date} às {rescheduleTarget.start_time?.substring(0, 5)}</p>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="reschedule-date">Nova data</Label>
              <Input
                id="reschedule-date"
                type="date"
                min={clinicDateKey()}
                value={rescheduleDate}
                onChange={(event) => setRescheduleDate(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reschedule-time">Novo horário</Label>
              <Input
                id="reschedule-time"
                type="time"
                value={rescheduleTime}
                onChange={(event) => setRescheduleTime(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reschedule-reason">Motivo</Label>
            <Textarea
              id="reschedule-reason"
              value={rescheduleReason}
              onChange={(event) => setRescheduleReason(event.target.value)}
              placeholder="Informe por que precisa alterar o horário."
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeReschedule}
              disabled={rescheduleLoading}
            >
              Voltar
            </Button>
            <Button
              onClick={handleReschedule}
              disabled={
                rescheduleLoading
                || !rescheduleDate
                || !rescheduleTime
                || rescheduleReason.trim().length < 3
              }
            >
              {rescheduleLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmar reagendamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AppointmentCard({
  appt, actions,
}: {
  appt: PatientPortalAppointment;
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
                <time
                  dateTime={appt.appointment_date}
                  className="font-semibold text-sm"
                >
                  {new Date(appt.appointment_date + "T00:00:00").toLocaleDateString("pt-BR", {
                    weekday: "short",
                    day: "2-digit",
                    month: "short",
                  })}
                </time>
                <Badge variant="outline" className="font-mono">
                  {appt.start_time?.substring(0, 5)}
                </Badge>
                <AppointmentStatusBadge status={appt.status as unknown as AppointmentStatusForBadge} />
              </div>
              <div className="mt-1 text-sm text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                {appt.professional_name && (
                  <span className="flex items-center gap-1">
                    <User className="h-3 w-3" />
                    Dr(a). {appt.professional_name}
                  </span>
                )}
                {appt.unit_name && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {appt.unit_name}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">{actions}</div>
        </div>
      </CardContent>
    </Card>
  );
}
