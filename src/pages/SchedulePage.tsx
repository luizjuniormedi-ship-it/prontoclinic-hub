import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Plus, ChevronLeft, ChevronRight, Clock, Users, CheckCircle, AlertCircle, XCircle, UserX, CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";
import { ScheduleSkeleton, EmptyState, ErrorState } from "@/components/StateViews";
import { ScheduleFilters } from "@/components/schedule/ScheduleFilters";
import { AppointmentCard } from "@/components/schedule/AppointmentCard";
import { NewAppointmentDialog } from "@/components/schedule/NewAppointmentDialog";
import { QuickActionDialog } from "@/components/schedule/QuickActionDialog";
import { EncaixeDialog } from "@/components/schedule/EncaixeDialog";
import { SchedulingOperationsPanel } from "@/components/schedule/SchedulingOperationsPanel";
import { appointmentsService, professionalsLookup, specialtiesLookup, appointmentTypesLookup, servicesCatalogLookup, DbAppointment, DbProfessional, DbSpecialty, DbAppointmentType, DbServiceCatalog } from "@/services/appointmentsService";
import { supabase } from "@/lib/supabase";
import { Appointment, AppointmentStatus, Patient } from "@/types";
import type { AppointmentTypeLiteral, PatientDbRow } from "@/types/missing";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/useDebounce";
import { friendlyError } from "@/utils/friendlyError";
import { localDateKey } from "@/utils/formatters";

const weekDays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

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
    insuranceCompanyId: (db as any).insurance_company_id || undefined,
    date: db.appointment_date,
    time: db.start_time?.substring(0, 5) || "00:00",
    duration,
    status: (db.status as AppointmentStatus) || "scheduled",
    type: type as AppointmentTypeLiteral,
    typeLabel: appType?.name || undefined,
    serviceName: db.service_name || undefined,
    notes: db.notes || undefined,
  };
}

export default function SchedulePage() {
  const [dbAppointments, setDbAppointments] = useState<DbAppointment[]>([]);
  const [professionals, setProfessionals] = useState<DbProfessional[]>([]);
  const [specialties, setSpecialties] = useState<DbSpecialty[]>([]);
  const [appointmentTypes, setAppointmentTypes] = useState<DbAppointmentType[]>([]);
  const [services, setServices] = useState<DbServiceCatalog[]>([]);
  const [insurances, setInsurances] = useState<Array<{ id: string; name: string }>>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [insuranceNames, setInsuranceNames] = useState<Record<string, string>>({});
  const [units, setUnits] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => localDateKey());
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
  const [unitFilter, setUnitFilter] = useState("all");

  // Quick action
  const [quickAction, setQuickAction] = useState("");
  const [quickActionAppointment, setQuickActionAppointment] = useState<Appointment | null>(null);
  const [quickActionOpen, setQuickActionOpen] = useState(false);
  const initialLoadRef = useRef(false);

  const loadLookups = useCallback(async () => {
    const [profs, specs, types, serviceRows] = await Promise.all([
      professionalsLookup.getAll(),
      specialtiesLookup.getAll(),
      appointmentTypesLookup.getAll(),
      servicesCatalogLookup.getAll(),
    ]);
    setProfessionals(profs);
    setSpecialties(specs);
    setAppointmentTypes(types);
    setServices(serviceRows);

    try {
      const [{ data: ins }, { data: unitRows }] = await Promise.all([
        supabase.from("insurance_companies").select("id, name"),
        supabase.from("units").select("id, name").order("name"),
      ]);
      if (ins) {
        setInsuranceNames(Object.fromEntries(ins.map((i: any) => [String(i.id), i.name])));
        setInsurances(ins.map((i: any) => ({ id: String(i.id), name: i.name })).sort((a, b) => a.name.localeCompare(b.name)));
      }
      if (unitRows) {
        setUnits(unitRows.map((u: any) => ({ id: String(u.id), name: u.name })));
      }
    } catch {
      setUnits([]);
    }
  }, []);

  const loadAppointments = useCallback(async (date: string) => {
    const d = new Date(date + "T00:00:00");
    const dayOfWeek = d.getDay();
    const startOfWeek = new Date(d);
    startOfWeek.setDate(d.getDate() - dayOfWeek);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);

    const startStr = localDateKey(startOfWeek);
    const endStr = localDateKey(endOfWeek);

    const data = await appointmentsService.getByDateRange(startStr, endStr);
    setDbAppointments(data);

    // Load only patients referenced in these appointments
    const patientIds = [...new Set(data.map((a) => a.patient_id).filter(Boolean))] as string[];
    if (patientIds.length > 0) {
      const { data: pats } = await supabase
        .from("patients")
        .select("id, full_name, cpf, birth_date, phone, email, sex, insurance_plan_id, insurance_card_number, allergies, clinical_alerts, created_at, updated_at")
        .in("id", patientIds);

      // Load insurance names for display
      const insuranceIds = [...new Set((pats || []).map((p: any) => p.insurance_plan_id).filter(Boolean))];
      let insuranceMap: Record<string, string> = {};
      if (insuranceIds.length > 0) {
        const { data: insurances } = await supabase
          .from("insurance_companies")
          .select("id, name")
          .in("id", insuranceIds);
        if (insurances) {
          insuranceMap = Object.fromEntries(insurances.map((i: any) => [String(i.id), i.name]));
        }
      }
      setPatients((pats || []).map((row: PatientDbRow) => ({
        id: String(row.id), companyId: undefined, name: row.full_name || "", cpf: row.cpf || "",
        birthDate: row.birth_date || "", phone: row.phone || "", email: row.email || "",
        gender: row.sex || "O", healthInsurance: row.insurance_plan_id ? (insuranceMap[String(row.insurance_plan_id)] || "Convênio #" + row.insurance_plan_id) : undefined, healthInsuranceNumber: row.insurance_card_number ?? undefined,
        allergies: row.allergies ?? undefined, clinicalAlerts: row.clinical_alerts ?? undefined,
        createdAt: row.created_at || "", updatedAt: row.updated_at || "",
      })) as Patient[]);
    } else {
      setPatients([]);
    }
  }, []);

  const refreshAppointments = useCallback(async (date: string) => {
    try {
      setError(null);
      await loadAppointments(date);
    } catch (err) {
      const message = friendlyError(err, "Carregar agenda");
      setError(message);
      throw err;
    }
  }, [loadAppointments]);

  const loadAll = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      await loadLookups();
      await refreshAppointments(selectedDate);
     } catch (err) {
      setError(friendlyError(err, "Carregar agenda"));
    } finally {
      setLoading(false);
    }
  }, [loadLookups, refreshAppointments, selectedDate]);

  useEffect(() => {
    if (initialLoadRef.current) return;
    initialLoadRef.current = true;
    void loadAll();
  }, [loadAll]);

  // Reload appointments when date changes (without reloading lookups)
  useEffect(() => {
    if (!loading) {
      refreshAppointments(selectedDate).catch(() => {});
    }
  }, [selectedDate, refreshAppointments]);

  // Convert all DB appointments to display format
  const appointments = useMemo(() =>
    dbAppointments.map((db) => {
      const appt = toDisplayAppointment(db, patients, professionals, specialties, appointmentTypes);
      // Resolve insurance name from appointment's insurance_company_id
      const icId = (db as any).insurance_company_id;
      if (icId && insuranceNames[String(icId)]) {
        (appt as any).insuranceName = insuranceNames[String(icId)];
      }
      return appt;
    }),
    [dbAppointments, patients, professionals, specialties, appointmentTypes, insuranceNames]
  );

  const hasFilters = debouncedSearch !== "" || doctorFilter !== "all" || specialtyFilter !== "all" || typeFilter !== "all" || statusFilter !== "all" || unitFilter !== "all";

  const clearFilters = () => {
    setSearch("");
    setDoctorFilter("all");
    setSpecialtyFilter("all");
    setTypeFilter("all");
    setStatusFilter("all");
    setUnitFilter("all");
  };

  const dayAppointments = appointments
    .filter((a) => a.date === selectedDate)
    .filter((a) => {
      if (debouncedSearch) {
        const q = debouncedSearch.toLowerCase();
        if (!a.patientName.toLowerCase().includes(q) &&
            !(a.patientCpf && a.patientCpf.includes(q.replace(/\D/g, ''))) &&
            !(a.patientPhone && a.patientPhone.includes(q.replace(/\D/g, '')))) return false;
      }
      if (doctorFilter !== "all" && a.doctorId !== doctorFilter) return false;
      if (specialtyFilter !== "all" && a.specialty !== specialtyFilter) return false;
      if (typeFilter !== "all" && a.type !== typeFilter) return false;
      if (statusFilter !== "all" && a.status !== statusFilter) return false;
      if (unitFilter !== "all" && a.unitId !== unitFilter) return false;
      return true;
    })
    .sort((a, b) => a.time.localeCompare(b.time));

  const dateObj = new Date(selectedDate + "T00:00:00");
  const formattedDate = dateObj.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  const changeDate = (dir: number) => {
    const d = new Date(selectedDate + "T00:00:00");
    d.setDate(d.getDate() + (view === "week" ? dir * 7 : dir));
    setSelectedDate(localDateKey(d));
  };

  const getWeekDates = () => {
    const d = new Date(selectedDate + "T00:00:00");
    const day = d.getDay();
    const start = new Date(d);
    start.setDate(d.getDate() - day);
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      return localDateKey(date);
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

  const handleQuickActionConfirm = async (
    appointment: Appointment,
    newStatus: AppointmentStatus,
    details?: { reason?: string; newDate?: string; newTime?: string }
  ) => {
    try {
      if (details?.newDate && details?.newTime) {
        await appointmentsService.reschedule(appointment.id, {
          appointment_date: details.newDate,
          start_time: details.newTime,
          reason: details.reason || "Remarcação solicitada",
        });
      } else {
        await appointmentsService.updateStatus(appointment.id, newStatus, details?.reason);
      }
      await refreshAppointments(selectedDate);
      const labels: Record<string, string> = {
        waiting: "Check-in realizado",
        in_progress: "Atendimento iniciado",
        scheduled: "Remarcado com sucesso",
        cancelled: "Agendamento cancelado",
        no_show: "Falta registrada",
      };
      toast({ title: labels[newStatus] || "Atualizado" });
     } catch (err) {
      toast({ title: friendlyError(err, "Atualizar agendamento"), variant: "destructive" });
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
  const specialtiesForFilter = specialties.map((s) => ({ id: s.id, name: s.name, code: s.code || undefined, status: (s.status === "inactive" ? "inactive" : "active") }));

  if (loading) return <div className="space-y-4"><PageHeader title="Agenda" description="Carregando..." /><ScheduleSkeleton count={5} /></div>;
  if (error) return <ErrorState message={error} onRetry={loadAll} />;

  return (
    <div className="space-y-4 animate-fade-in" aria-labelledby="schedule-page-title">
      <PageHeader
        title="Agenda"
        titleId="schedule-page-title"
        description="Gerencie atendimentos, retornos e terapias"
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setEncaixeOpen(true)}
              aria-label="Adicionar encaixe (agendamento fora da grade)"
            >
              <CalendarPlus className="mr-2 h-4 w-4" aria-hidden="true" />Encaixe
            </Button>
            <Button
              onClick={() => setDialogOpen(true)}
              aria-label="Criar novo agendamento (atalho Control mais N)"
            >
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />Novo Agendamento
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
      <div
        className="flex items-center justify-between"
        role="toolbar"
        aria-label="Navegação de data e visualização"
      >
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => changeDate(-1)}
            aria-label={`Dia anterior${view === "week" ? " (voltar uma semana)" : ""}`}
            title={view === "week" ? "Semana anterior" : "Dia anterior"}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <h2 className="text-sm font-medium capitalize min-w-[220px] text-center" aria-live="polite">
            {formattedDate}
          </h2>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => changeDate(1)}
            aria-label={`Próximo dia${view === "week" ? " (avançar uma semana)" : ""}`}
            title={view === "week" ? "Próxima semana" : "Próximo dia"}
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs"
            onClick={() => setSelectedDate(localDateKey())}
            aria-label="Ir para hoje"
          >
            Hoje
          </Button>
        </div>
        <div className="flex gap-1" role="group" aria-label="Modo de visualização">
          <Button
            variant={view === "day" ? "default" : "outline"}
            size="sm"
            onClick={() => setView("day")}
            aria-pressed={view === "day"}
          >
            Dia
          </Button>
          <Button
            variant={view === "week" ? "default" : "outline"}
            size="sm"
            onClick={() => setView("week")}
            aria-pressed={view === "week"}
          >
            Semana
          </Button>
        </div>
      </div>

      {/* Filters */}
      <ScheduleFilters
        search={search} onSearchChange={setSearch}
        doctorFilter={doctorFilter} onDoctorFilter={setDoctorFilter}
        specialtyFilter={specialtyFilter} onSpecialtyFilter={setSpecialtyFilter}
        typeFilter={typeFilter} onTypeFilter={setTypeFilter}
        statusFilter={statusFilter} onStatusFilter={setStatusFilter}
        unitFilter={unitFilter} onUnitFilter={setUnitFilter}
        doctors={doctorsForFilter} specialties={specialtiesForFilter}
        units={units}
        onClearFilters={clearFilters} hasFilters={hasFilters}
      />

      <SchedulingOperationsPanel
        professionals={professionals}
        specialties={specialties}
        appointmentTypes={appointmentTypes}
        selectedDate={selectedDate}
        onAppointmentCreated={() => refreshAppointments(selectedDate)}
      />

      {/* Content */}
      {view === "week" ? (
        <div
          className="grid grid-cols-7 gap-2"
          role="grid"
          aria-label={`Semana de ${formattedDate}`}
          aria-rowcount={1}
          aria-colcount={7}
        >
          {getWeekDates().map((date, i) => {
            const dayApps = appointments.filter((a) => a.date === date);
            const isSelected = date === selectedDate;
            const isToday = date === localDateKey();
            const waiting = dayApps.filter((a) => a.status === "waiting").length;
            return (
              <Card
                key={date}
                role="gridcell"
                tabIndex={0}
                aria-colindex={i + 1}
                aria-selected={isSelected}
                aria-label={`${weekDays[i]} ${new Date(date + "T00:00:00").getDate()}, ${dayApps.length} agendamentos${waiting > 0 ? `, ${waiting} aguardando` : ""}${isToday ? ", hoje" : ""}`}
                className={`cursor-pointer transition-colors ${isSelected ? "border-primary bg-primary/5" : isToday ? "border-secondary/50" : "hover:bg-muted/50"}`}
                onClick={() => { setSelectedDate(date); setView("day"); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedDate(date);
                    setView("day");
                  }
                }}
              >
                <CardContent className="p-3 text-center">
                  <p className="text-xs text-muted-foreground">{weekDays[i]}</p>
                  <p className={`text-lg font-bold ${isToday ? "text-primary" : ""}`}>{new Date(date + "T00:00:00").getDate()}</p>
                  <p className="text-xs text-primary font-medium">{dayApps.length} atend.</p>
                  {waiting > 0 && (
                    <p className="text-xs text-warning">{waiting} aguard.</p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : dayAppointments.length === 0 ? (
        <EmptyState
          title="Sem agendamentos"
          description={hasFilters ? "Nenhum resultado para os filtros aplicados." : "Não há atendimentos para esta data."}
        />
      ) : (
        <VirtualizedDayList
          appointments={dayAppointments}
          appointmentsLookup={appointments}
          getPatientForAppointment={getPatientForAppointment}
          onQuickAction={handleQuickAction}
          formattedDate={formattedDate}
        />
      )}

      {/* Dialogs */}
      <NewAppointmentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        professionals={professionals}
        specialties={specialties}
        appointmentTypes={appointmentTypes}
        services={services}
        insurances={insurances}
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

/**
 * VirtualizedDayList — renderiza a lista de agendamentos do dia com virtualização.
 * Substitui a renderização direta por uma windowed list usando @tanstack/react-virtual
 * para suportar dias com grande volume (clinicas com 200+ agendamentos/dia).
 */
function VirtualizedDayList({
  appointments,
  appointmentsLookup,
  getPatientForAppointment,
  onQuickAction,
  formattedDate,
}: {
  appointments: Appointment[];
  appointmentsLookup: Appointment[];
  getPatientForAppointment: (a: Appointment) => Patient | undefined;
  onQuickAction: (action: string, a: Appointment) => void;
  formattedDate: string;
}) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: appointments.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 96, // altura estimada de um card (px)
    overscan: 5,
  });

  return (
    <div
      role="grid"
      aria-label={`Agendamentos de ${formattedDate}`}
      aria-rowcount={appointments.length}
      aria-colcount={1}
      ref={parentRef}
      className="space-y-2 overflow-auto"
      style={{ height: "min(70vh, 720px)" }}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const a = appointments[virtualRow.index];
          if (!a) return null;
          const patient = getPatientForAppointment(a);
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
                paddingBottom: "0.5rem",
              }}
            >
              <AppointmentCard
                appointment={a}
                patient={patient}
                allAppointments={appointmentsLookup}
                onQuickAction={onQuickAction}
                rowIndex={virtualRow.index}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
