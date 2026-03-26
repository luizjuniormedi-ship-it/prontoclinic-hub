import { useEffect, useState, useCallback, useMemo } from "react";
import { Plus, ChevronLeft, ChevronRight, Clock, Users, CheckCircle, AlertCircle, XCircle, UserX, AlertTriangle, CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/PageHeader";
import { ScheduleSkeleton, EmptyState, ErrorState } from "@/components/StateViews";
import { AppointmentStatusBadge } from "@/components/StatusBadge";
import { ScheduleFilters } from "@/components/schedule/ScheduleFilters";
import { QuickActionsMenu } from "@/components/schedule/QuickActionsMenu";
import { NewAppointmentDialog } from "@/components/schedule/NewAppointmentDialog";
import { QuickActionDialog } from "@/components/schedule/QuickActionDialog";
import { AppointmentPreviewPopover } from "@/components/schedule/AppointmentPreviewPopover";
import { EncaixeDialog } from "@/components/schedule/EncaixeDialog";
import { appointmentsService, professionalsLookup, specialtiesLookup, appointmentTypesLookup, DbAppointment, DbProfessional, DbSpecialty, DbAppointmentType } from "@/services/appointmentsService";
import { patientsService } from "@/services/patientsService";
import { Appointment, AppointmentStatus, Patient } from "@/types";
import { useToast } from "@/hooks/use-toast";
import { calculateAge } from "@/utils/formatters";
import { useDebounce } from "@/hooks/useDebounce";

const weekDays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const statusBorderColors: Record<string, string> = {
  scheduled: "",
  confirmed: "border-l-4 border-l-primary",
  waiting: "border-l-4 border-l-warning",
  in_progress: "border-l-4 border-l-success",
  completed: "border-l-4 border-l-muted-foreground",
  no_show: "border-l-4 border-l-destructive",
  cancelled: "border-l-4 border-l-muted opacity-50",
};

// Convert DB appointment to display format
function toDisplayAppointment(
  db: DbAppointment,
  patients: Patient[],
  professionals: DbProfessional[],
  specialties: DbSpecialty[],
  appointmentTypes: DbAppointmentType[]
): Appointment {
  const patient = patients.find((p) => p.id === db.patient_id);
  const professional = professionals.find((p) => p.id === db.professional_id);
  const specialty = specialties.find((s) => s.id === db.specialty_id);
  const appType = appointmentTypes.find((t) => t.id === db.appointment_type_id);

  // Calculate duration from start_time and end_time
  let duration = 30;
  if (db.start_time && db.end_time) {
    const [sh, sm] = db.start_time.split(":").map(Number);
    const [eh, em] = db.end_time.split(":").map(Number);
    duration = (eh * 60 + em) - (sh * 60 + sm);
    if (duration <= 0) duration = 30;
  }

  // Map appointment_type category to AppointmentType
  const typeCategory = appType?.category || "consulta";
  const validTypes = ["consulta", "retorno", "exame", "procedimento", "terapia_avulsa", "terapia_pacote"];
  const type = validTypes.includes(typeCategory) ? typeCategory : "consulta";

  return {
    id: db.id,
    patientId: db.patient_id || "",
    patientName: patient?.name || "Paciente não encontrado",
    patientCpf: patient?.cpf,
    patientPhone: patient?.phone,
    doctorId: db.professional_id || "",
    doctorName: professional?.full_name || "Profissional não encontrado",
    specialty: specialty?.name,
    unitId: db.unit_id || undefined,
    date: db.appointment_date,
    time: db.start_time?.substring(0, 5) || "00:00",
    duration,
    status: (db.status as AppointmentStatus) || "scheduled",
    type: type as any,
    typeLabel: appType?.name,
    notes: db.notes || undefined,
  };
}

export default function SchedulePage() {
  const [dbAppointments, setDbAppointments] = useState<DbAppointment[]>([]);
  const [professionals, setProfessionals] = useState<DbProfessional[]>([]);
  const [specialties, setSpecialties] = useState<DbSpecialty[]>([]);
  const [appointmentTypes, setAppointmentTypes] = useState<DbAppointmentType[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [view, setView] = useState<"day" | "week">("day");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [encaixeOpen, setEncaixeOpen] = useState(false);
  const { toast } = useToast();

  // Filters
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [doctorFilter, setDoctorFilter] = useState("all");
  const [specialtyFilter, setSpecialtyFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  // Quick action
  const [quickAction, setQuickAction] = useState("");
  const [quickActionAppointment, setQuickActionAppointment] = useState<Appointment | null>(null);
  const [quickActionOpen, setQuickActionOpen] = useState(false);

  const loadLookups = useCallback(async () => {
    const [profs, specs, types, pats] = await Promise.all([
      professionalsLookup.getAll(),
      specialtiesLookup.getAll(),
      appointmentTypesLookup.getAll(),
      patientsService.getAll(),
    ]);
    setProfessionals(profs);
    setSpecialties(specs);
    setAppointmentTypes(types);
    setPatients(pats);
  }, []);

  const loadAppointments = useCallback(async (date: string) => {
    // For week view, load the whole week; for day, load single day
    const d = new Date(date + "T00:00:00");
    const dayOfWeek = d.getDay();
    const startOfWeek = new Date(d);
    startOfWeek.setDate(d.getDate() - dayOfWeek);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);

    const startStr = startOfWeek.toISOString().split("T")[0];
    const endStr = endOfWeek.toISOString().split("T")[0];

    const data = await appointmentsService.getByDateRange(startStr, endStr);
    setDbAppointments(data);
  }, []);

  const loadAll = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      await loadLookups();
      await loadAppointments(selectedDate);
    } catch (err: any) {
      setError(err.message || "Erro ao carregar agenda");
    } finally {
      setLoading(false);
    }
  }, [loadLookups, loadAppointments, selectedDate]);

  useEffect(() => {
    loadAll();
  }, []);

  // Reload appointments when date changes (without reloading lookups)
  useEffect(() => {
    if (!loading) {
      loadAppointments(selectedDate).catch(() => {});
    }
  }, [selectedDate]);

  // Convert all DB appointments to display format
  const appointments = useMemo(() =>
    dbAppointments.map((db) => toDisplayAppointment(db, patients, professionals, specialties, appointmentTypes)),
    [dbAppointments, patients, professionals, specialties, appointmentTypes]
  );

  const hasFilters = debouncedSearch !== "" || doctorFilter !== "all" || specialtyFilter !== "all" || typeFilter !== "all" || statusFilter !== "all";

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
            !(a.patientCpf && a.patientCpf.includes(q.replace(/\D/g, ''))) &&
            !(a.patientPhone && a.patientPhone.includes(q.replace(/\D/g, '')))) return false;
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

  const handleQuickActionConfirm = async (appointment: Appointment, newStatus: AppointmentStatus, notes?: string) => {
    try {
      await appointmentsService.updateStatus(appointment.id, newStatus, notes);
      await loadAppointments(selectedDate);
      const labels: Record<string, string> = {
        waiting: "Check-in realizado",
        in_progress: "Atendimento iniciado",
        scheduled: "Remarcado com sucesso",
        cancelled: "Agendamento cancelado",
        no_show: "Falta registrada",
      };
      toast({ title: labels[newStatus] || "Atualizado" });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    }
  };

  const handleAppointmentCreated = async () => {
    await loadAppointments(selectedDate);
    setDialogOpen(false);
  };

  const handleEncaixeCreated = async () => {
    await loadAppointments(selectedDate);
    setEncaixeOpen(false);
  };

  const getPatientForAppointment = (a: Appointment) => patients.find((p) => p.id === a.patientId);

  // Map DB lookups to legacy Doctor/Specialty format for filter components
  const doctorsForFilter = professionals.map((p) => ({ id: p.id, name: p.full_name, specialty: "", specialtyId: "" }));
  const specialtiesForFilter = specialties.map((s) => ({ id: s.id, name: s.name, code: s.code || undefined, status: (s.status as any) || "active" }));

  if (loading) return <div className="space-y-4"><PageHeader title="Agenda" description="Carregando..." /><ScheduleSkeleton count={5} /></div>;
  if (error) return <ErrorState message={error} onRetry={loadAll} />;

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
        doctors={doctorsForFilter} specialties={specialtiesForFilter}
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
            const age = patient?.birthDate ? calculateAge(patient.birthDate) : null;
            const insurance = patient?.healthInsurance || "Particular";
            const allergies = patient?.allergies;

            return (
              <Card key={a.id} className={`hover:shadow-md transition-shadow ${statusBorderColors[a.status] || ""}`}>
                <CardContent className="p-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
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
                        {a.typeLabel && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-0 bg-primary/10 text-primary">
                            {a.typeLabel}
                          </Badge>
                        )}
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
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
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
        professionals={professionals}
        specialties={specialties}
        appointmentTypes={appointmentTypes}
        patients={patients}
        selectedDate={selectedDate}
        onCreated={handleAppointmentCreated}
      />
      <EncaixeDialog
        open={encaixeOpen}
        onOpenChange={setEncaixeOpen}
        professionals={professionals}
        specialties={specialties}
        appointmentTypes={appointmentTypes}
        patients={patients}
        selectedDate={selectedDate}
        existingAppointments={dayAppointments}
        onCreated={handleEncaixeCreated}
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
