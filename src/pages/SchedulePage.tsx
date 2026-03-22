import { useEffect, useState } from "react";
import { Plus, ChevronLeft, ChevronRight, Clock, Users, CheckCircle, AlertCircle, XCircle, UserX, AlertTriangle, CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState } from "@/components/StateViews";
import { AppointmentStatusBadge, AppointmentTypeBadge } from "@/components/StatusBadge";
import { ScheduleFilters } from "@/components/schedule/ScheduleFilters";
import { QuickActionsMenu } from "@/components/schedule/QuickActionsMenu";
import { NewAppointmentDialog } from "@/components/schedule/NewAppointmentDialog";
import { QuickActionDialog } from "@/components/schedule/QuickActionDialog";
import { AppointmentPreviewPopover } from "@/components/schedule/AppointmentPreviewPopover";
import { EncaixeDialog } from "@/components/schedule/EncaixeDialog";
import { api } from "@/services/api";
import { Appointment, AppointmentStatus, Doctor, Specialty, Patient } from "@/types";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency, calculateAge } from "@/utils/formatters";

const weekDays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const statusBorderColors: Record<AppointmentStatus, string> = {
  scheduled: "",
  confirmed: "border-l-4 border-l-primary",
  waiting: "border-l-4 border-l-warning",
  in_progress: "border-l-4 border-l-success",
  completed: "border-l-4 border-l-muted-foreground",
  no_show: "border-l-4 border-l-destructive",
  cancelled: "border-l-4 border-l-muted opacity-50",
};

export default function SchedulePage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState("2026-03-22");
  const [view, setView] = useState<"day" | "week">("day");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [encaixeOpen, setEncaixeOpen] = useState(false);
  const { toast } = useToast();

  // Filters
  const [search, setSearch] = useState("");
  const [doctorFilter, setDoctorFilter] = useState("all");
  const [specialtyFilter, setSpecialtyFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  // Quick action
  const [quickAction, setQuickAction] = useState("");
  const [quickActionAppointment, setQuickActionAppointment] = useState<Appointment | null>(null);
  const [quickActionOpen, setQuickActionOpen] = useState(false);

  useEffect(() => {
    Promise.all([
      api.getAppointments(),
      api.getDoctors(),
      api.getSpecialties(),
      api.getPatients(),
    ]).then(([a, d, s, p]) => {
      setAppointments(a);
      setDoctors(d);
      setSpecialties(s);
      setPatients(p);
      setLoading(false);
    });
  }, []);

  const hasFilters = search !== "" || doctorFilter !== "all" || specialtyFilter !== "all" || typeFilter !== "all" || statusFilter !== "all";

  const clearFilters = () => {
    setSearch("");
    setDoctorFilter("all");
    setSpecialtyFilter("all");
    setTypeFilter("all");
    setStatusFilter("all");
  };

  const dayAppointments = appointments
    .filter((a) => a.date === selectedDate)
    .filter((a) => {
      if (search) {
        const q = search.toLowerCase();
        if (!a.patientName.toLowerCase().includes(q) &&
            !(a.patientCpf && a.patientCpf.includes(q)) &&
            !(a.patientPhone && a.patientPhone.includes(q))) return false;
      }
      if (doctorFilter !== "all" && a.doctorId !== doctorFilter) return false;
      if (specialtyFilter !== "all" && a.specialty !== specialtyFilter) return false;
      if (typeFilter !== "all" && a.type !== typeFilter) return false;
      if (statusFilter !== "all" && a.status !== statusFilter) return false;
      return true;
    })
    .sort((a, b) => a.time.localeCompare(b.time));

  const dateObj = new Date(selectedDate + "T00:00:00");
  const formattedDate = dateObj.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  const changeDate = (dir: number) => {
    const d = new Date(selectedDate + "T00:00:00");
    d.setDate(d.getDate() + (view === "week" ? dir * 7 : dir));
    setSelectedDate(d.toISOString().split("T")[0]);
  };

  const getWeekDates = () => {
    const d = new Date(selectedDate + "T00:00:00");
    const day = d.getDay();
    const start = new Date(d);
    start.setDate(d.getDate() - day);
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      return date.toISOString().split("T")[0];
    });
  };

  const allDayApps = appointments.filter((a) => a.date === selectedDate);
  const stats = {
    total: allDayApps.length,
    waiting: allDayApps.filter((a) => a.status === "waiting").length,
    inProgress: allDayApps.filter((a) => a.status === "in_progress").length,
    completed: allDayApps.filter((a) => a.status === "completed").length,
    noShow: allDayApps.filter((a) => a.status === "no_show").length,
    cancelled: allDayApps.filter((a) => a.status === "cancelled").length,
  };

  const handleQuickAction = (action: string, appointment: Appointment) => {
    setQuickAction(action);
    setQuickActionAppointment(appointment);
    setQuickActionOpen(true);
  };

  const handleQuickActionConfirm = (appointment: Appointment, newStatus: AppointmentStatus) => {
    setAppointments((prev) =>
      prev.map((a) => (a.id === appointment.id ? { ...a, status: newStatus } : a))
    );
    const labels: Record<string, string> = {
      waiting: "Check-in realizado",
      in_progress: "Atendimento iniciado",
      scheduled: "Remarcado com sucesso",
      cancelled: "Agendamento cancelado",
      no_show: "Falta registrada",
    };
    toast({ title: labels[newStatus] || "Atualizado" });
  };

  const getPatientForAppointment = (a: Appointment) => patients.find((p) => p.id === a.patientId);

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader
        title="Agenda"
        description="Gerencie atendimentos, retornos e terapias"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setEncaixeOpen(true)}>
              <CalendarPlus className="mr-2 h-4 w-4" />Encaixe
            </Button>
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />Novo Agendamento
            </Button>
          </div>
        }
      />

      {/* Stats row */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        <MiniStat icon={<Clock className="h-4 w-4" />} label="Total" value={stats.total} />
        <MiniStat icon={<Users className="h-4 w-4 text-warning" />} label="Aguardando" value={stats.waiting} color="text-warning" />
        <MiniStat icon={<AlertCircle className="h-4 w-4 text-success" />} label="Em atendim." value={stats.inProgress} color="text-success" />
        <MiniStat icon={<CheckCircle className="h-4 w-4 text-muted-foreground" />} label="Finalizados" value={stats.completed} color="text-muted-foreground" />
        <MiniStat icon={<UserX className="h-4 w-4 text-destructive" />} label="Faltas" value={stats.noShow} color="text-destructive" />
        <MiniStat icon={<XCircle className="h-4 w-4 text-muted-foreground" />} label="Cancelados" value={stats.cancelled} color="text-muted-foreground" />
      </div>

      {/* Date navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => changeDate(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium capitalize min-w-[220px] text-center">{formattedDate}</span>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => changeDate(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" className="text-xs" onClick={() => setSelectedDate(new Date().toISOString().split("T")[0])}>
            Hoje
          </Button>
        </div>
        <div className="flex gap-1">
          <Button variant={view === "day" ? "default" : "outline"} size="sm" onClick={() => setView("day")}>Dia</Button>
          <Button variant={view === "week" ? "default" : "outline"} size="sm" onClick={() => setView("week")}>Semana</Button>
        </div>
      </div>

      {/* Filters */}
      <ScheduleFilters
        search={search} onSearchChange={setSearch}
        doctorFilter={doctorFilter} onDoctorFilter={setDoctorFilter}
        specialtyFilter={specialtyFilter} onSpecialtyFilter={setSpecialtyFilter}
        typeFilter={typeFilter} onTypeFilter={setTypeFilter}
        statusFilter={statusFilter} onStatusFilter={setStatusFilter}
        doctors={doctors} specialties={specialties}
        onClearFilters={clearFilters} hasFilters={hasFilters}
      />

      {/* Content */}
      {view === "week" ? (
        <div className="grid grid-cols-7 gap-2">
          {getWeekDates().map((date, i) => {
            const dayApps = appointments.filter((a) => a.date === date);
            const isSelected = date === selectedDate;
            const isToday = date === new Date().toISOString().split("T")[0];
            return (
              <Card
                key={date}
                className={`cursor-pointer transition-colors ${isSelected ? "border-primary bg-primary/5" : isToday ? "border-secondary/50" : "hover:bg-muted/50"}`}
                onClick={() => { setSelectedDate(date); setView("day"); }}
              >
                <CardContent className="p-3 text-center">
                  <p className="text-xs text-muted-foreground">{weekDays[i]}</p>
                  <p className={`text-lg font-bold ${isToday ? "text-primary" : ""}`}>{new Date(date + "T00:00:00").getDate()}</p>
                  <p className="text-xs text-primary font-medium">{dayApps.length} atend.</p>
                  {dayApps.filter((a) => a.status === "waiting").length > 0 && (
                    <p className="text-xs text-warning">{dayApps.filter((a) => a.status === "waiting").length} aguard.</p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : dayAppointments.length === 0 ? (
        <EmptyState title="Sem agendamentos" description={hasFilters ? "Nenhum resultado para os filtros aplicados." : "Não há atendimentos para esta data."} />
      ) : (
        <div className="space-y-2">
          {dayAppointments.map((a) => {
            const patient = getPatientForAppointment(a);
            const age = patient ? calculateAge(patient.birthDate) : null;
            const insurance = patient?.healthInsurance || "Particular";
            const allergies = patient?.allergies;

            return (
              <Card key={a.id} className={`hover:shadow-md transition-shadow ${statusBorderColors[a.status]}`}>
                <CardContent className="p-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {/* Time block */}
                    <div className="text-center min-w-[52px]">
                      <p className="text-base font-bold text-primary leading-tight">{a.time}</p>
                      <p className="text-[10px] text-muted-foreground">{a.duration} min</p>
                    </div>

                    <div className="border-l pl-3 flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <AppointmentPreviewPopover appointment={a} patient={patient} appointments={appointments}>
                          <span className="font-medium text-sm truncate cursor-pointer hover:text-primary transition-colors">
                            {a.patientName}
                          </span>
                        </AppointmentPreviewPopover>
                        {age != null && (
                          <span className="text-[10px] text-muted-foreground">{age}a</span>
                        )}
                        <AppointmentTypeBadge type={a.type} />
                        {a.type === "retorno" && (
                          <Badge variant="outline" className="bg-secondary/10 text-secondary border-0 text-[10px] px-1.5 py-0">Retorno</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {a.doctorName}{a.specialty ? ` • ${a.specialty}` : ""}
                      </p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] text-muted-foreground">{insurance}</span>
                        {allergies && (
                          <span className="text-[10px] text-destructive font-medium flex items-center gap-0.5">
                            <AlertTriangle className="h-2.5 w-2.5" />{allergies}
                          </span>
                        )}
                        {a.therapyType && (
                          <span className="text-[10px] text-secondary">{a.therapyType}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {a.value != null && a.value > 0 && (
                      <span className="text-[10px] font-medium text-muted-foreground hidden md:block">{formatCurrency(a.value)}</span>
                    )}
                    <AppointmentStatusBadge status={a.status} />
                    <QuickActionsMenu appointment={a} onAction={handleQuickAction} />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Dialogs */}
      <NewAppointmentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        doctors={doctors}
        specialties={specialties}
        patients={patients}
      />
      <EncaixeDialog
        open={encaixeOpen}
        onOpenChange={setEncaixeOpen}
        doctors={doctors}
        specialties={specialties}
        patients={patients}
        selectedDate={selectedDate}
        existingAppointments={dayAppointments}
      />
      <QuickActionDialog
        open={quickActionOpen}
        onOpenChange={setQuickActionOpen}
        action={quickAction}
        appointment={quickActionAppointment}
        onConfirm={handleQuickActionConfirm}
      />
    </div>
  );
}

function MiniStat({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color?: string }) {
  return (
    <Card>
      <CardContent className="p-2.5 flex items-center gap-2">
        {icon}
        <div>
          <p className={`text-lg font-bold leading-tight ${color || ""}`}>{value}</p>
          <p className="text-[10px] text-muted-foreground leading-tight">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}
