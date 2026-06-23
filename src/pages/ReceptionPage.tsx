import { useEffect, useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Clock, UserCheck, Play, AlertTriangle, Search, Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState, ErrorState } from "@/components/StateViews";
import { AppointmentStatusBadge, AppointmentTypeBadge } from "@/components/StatusBadge";
import { appointmentsService, professionalsLookup, specialtiesLookup, appointmentTypesLookup, DbAppointment, DbProfessional, DbSpecialty, DbAppointmentType } from "@/services/appointmentsService";
import { supabase } from "@/lib/supabase";
import { Appointment, AppointmentStatus, Patient } from "@/types";
import type { AppointmentTypeLiteral, AppointmentStatusForBadge } from "@/types/missing";
import { useToast } from "@/hooks/use-toast";
import { calculateAge } from "@/utils/formatters";
import { useDebounce } from "@/hooks/useDebounce";

interface PatientRow { id: string; full_name: string; cpf: string | null; birth_date: string | null; phone: string | null; allergies: string | null; insurance_plan_id: string | null; }

function toDisplayAppointment(db: DbAppointment, patients: PatientRow[], professionals: DbProfessional[], specialties: DbSpecialty[], appointmentTypes: DbAppointmentType[]): Appointment {
  const patient = patients.find((p) => p.id === db.patient_id);
  const professional = professionals.find((p) => p.id === db.professional_id);
  const specialty = specialties.find((s) => s.id === db.specialty_id);
  const appType = appointmentTypes.find((t) => t.id === db.appointment_type_id);
  let duration = 30;
  if (db.start_time && db.end_time) { const [sh, sm] = db.start_time.split(":").map(Number); const [eh, em] = db.end_time.split(":").map(Number); duration = (eh * 60 + em) - (sh * 60 + sm); if (duration <= 0) duration = 30; }
  const typeCategory = appType?.category || "consulta";
  const validTypes = ["consulta", "retorno", "exame", "procedimento", "terapia_avulsa", "terapia_pacote"];
  return {
    id: db.id, patientId: db.patient_id || "", patientName: patient?.full_name || "Paciente não encontrado",
    patientCpf: patient?.cpf || undefined, patientPhone: patient?.phone || undefined,
    doctorId: db.professional_id || "", doctorName: professional?.full_name || "—",
    specialty: specialty?.name, unitId: db.unit_id || undefined,
    date: db.appointment_date, time: db.start_time?.substring(0, 5) || "00:00", duration,
    status: (db.status as AppointmentStatus) || "scheduled",
    type: (validTypes.includes(typeCategory) ? typeCategory : "consulta") as AppointmentTypeLiteral,
    typeLabel: appType?.name, notes: db.notes || undefined,
  };
}

export default function ReceptionPage() {
  const [dbAppointments, setDbAppointments] = useState<DbAppointment[]>([]);
  const [professionals, setProfessionals] = useState<DbProfessional[]>([]);
  const [specialties, setSpecialties] = useState<DbSpecialty[]>([]);
  const [appointmentTypes, setAppointmentTypes] = useState<DbAppointmentType[]>([]);
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const navigate = useNavigate();
  const { toast } = useToast();
  const today = new Date().toISOString().split("T")[0];

  const loadAll = useCallback(async () => {
    try {
      setLoading(true); setError(null);
      const [profs, specs, types, appts] = await Promise.all([
        professionalsLookup.getAll(), specialtiesLookup.getAll(), appointmentTypesLookup.getAll(),
        appointmentsService.getByDate(today),
      ]);
      // Load patients for today's appointments
      const patientIds = [...new Set(appts.map((a) => a.patient_id).filter(Boolean))];
      let pats: PatientRow[] = [];
      if (patientIds.length > 0) {
        const { data } = await supabase.from("patients").select("id, full_name, cpf, birth_date, phone, allergies, insurance_plan_id").in("id", patientIds);
        pats = data || [];
      }
      setProfessionals(profs); setSpecialties(specs); setAppointmentTypes(types); setPatients(pats); setDbAppointments(appts);
    } catch (err) { setError((err as Error).message || "Erro ao carregar recepção"); }
    finally { setLoading(false); }
  }, [today]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const appointments = useMemo(() => dbAppointments.map((db) => toDisplayAppointment(db, patients, professionals, specialties, appointmentTypes)), [dbAppointments, patients, professionals, specialties, appointmentTypes]);

  const handleStatusChange = async (id: string, newStatus: AppointmentStatus) => {
    try {
      await appointmentsService.updateStatus(id, newStatus);
      await appointmentsService.getByDate(today).then(setDbAppointments);
      const labels: Record<string, string> = { waiting: "Check-in realizado!", in_progress: "Atendimento iniciado!", completed: "Finalizado!" };
      toast({ title: labels[newStatus] || "Atualizado" });
    } catch (err) { toast({ title: "Erro", description: (err as Error).message, variant: "destructive" }); }
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadAll} />;

  const sorted = [...appointments].sort((a, b) => a.time.localeCompare(b.time));
  const filtered = sorted.filter((a) => {
    if (!debouncedSearch.trim()) return true;
    const q = debouncedSearch.toLowerCase();
    return a.patientName.toLowerCase().includes(q) || (a.patientCpf && a.patientCpf.includes(q.replace(/\D/g, "")));
  });

  const scheduled = filtered.filter((a) => a.status === "scheduled" || a.status === "confirmed");
  const waiting = filtered.filter((a) => a.status === "waiting");
  const inProgress = filtered.filter((a) => a.status === "in_progress");
  const completed = filtered.filter((a) => a.status === "completed");
  const getPatient = (pid: string) => patients.find((p) => p.id === pid);
  const isLate = (a: Appointment) => { const now = new Date(); const [h, m] = a.time.split(":").map(Number); const s = new Date(); s.setHours(h, m, 0, 0); return now > s && (a.status === "scheduled" || a.status === "confirmed"); };

  const renderCard = (a: Appointment, actions: React.ReactNode) => {
    const pat = getPatient(a.patientId);
    const late = isLate(a);
    const age = pat?.birth_date ? calculateAge(pat.birth_date) : null;
    return (
      <Card key={a.id} className={`hover:shadow-md transition-shadow ${late ? "border-l-4 border-l-destructive" : a.status === "waiting" ? "border-l-4 border-l-warning" : a.status === "in_progress" ? "border-l-4 border-l-success" : ""}`}>
        <CardContent className="p-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="text-center min-w-[48px]"><p className="text-sm font-bold text-primary">{a.time}</p><p className="text-[10px] text-muted-foreground">{a.duration}min</p></div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className="font-medium text-sm">{a.patientName}</p>
                {age != null && <span className="text-[10px] text-muted-foreground">{age}a</span>}
                {a.typeLabel && <AppointmentTypeBadge type={a.type} />}
              </div>
              <p className="text-xs text-muted-foreground">{a.doctorName}{a.specialty ? ` • ${a.specialty}` : ""}</p>
              {(late || pat?.allergies) && (
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  {late && <span className="text-[10px] text-destructive font-medium flex items-center gap-0.5"><AlertTriangle className="h-2.5 w-2.5" />Atrasado</span>}
                  {pat?.allergies && <span className="text-[10px] text-destructive flex items-center gap-0.5"><AlertTriangle className="h-2.5 w-2.5" />{pat.allergies}</span>}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <AppointmentStatusBadge status={a.status as AppointmentStatusForBadge} />
            {actions}
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader title="Recepção" description={`${sorted.length} pacientes agendados hoje`} />

      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        <StatusCard icon={<Clock className="h-4 w-4" />} label="Aguardando Chegada" count={scheduled.length} color="text-primary" bg="bg-primary/5 border-primary/20" />
        <StatusCard icon={<Check className="h-4 w-4" />} label="Sala de Espera" count={waiting.length} color="text-warning" bg="bg-warning/5 border-warning/20" />
        <StatusCard icon={<Stethoscope className="h-4 w-4" />} label="Em Atendimento" count={inProgress.length} color="text-success" bg="bg-success/5 border-success/20" />
        <StatusCard icon={<UserCheck className="h-4 w-4" />} label="Finalizados" count={completed.length} color="text-muted-foreground" bg="bg-muted/50" />
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Buscar paciente..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <Tabs defaultValue="queue">
        <TabsList>
          <TabsTrigger value="queue">Fila ({scheduled.length + waiting.length})</TabsTrigger>
          <TabsTrigger value="attending">Em Atendimento ({inProgress.length})</TabsTrigger>
          <TabsTrigger value="done">Finalizados ({completed.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="mt-3 space-y-2">
          {[...scheduled, ...waiting].length === 0 ? (
            <EmptyState icon={UserCheck} title="Nenhum paciente na fila" />
          ) : (
            [...scheduled, ...waiting].map((a) => renderCard(a,
              a.status === "scheduled" || a.status === "confirmed" ? (
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleStatusChange(a.id, "waiting")}><Check className="mr-1 h-3 w-3" />Check-in</Button>
              ) : a.status === "waiting" ? (
                <Button size="sm" className="h-7 text-xs" onClick={() => { handleStatusChange(a.id, "in_progress"); navigate(`/attendance/${a.id}`); }}><Play className="mr-1 h-3 w-3" />Iniciar</Button>
              ) : null
            ))
          )}
        </TabsContent>

        <TabsContent value="attending" className="mt-3 space-y-2">
          {inProgress.length === 0 ? <EmptyState icon={Stethoscope} title="Nenhum atendimento em andamento" /> :
            inProgress.map((a) => renderCard(a,
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => navigate(`/attendance/${a.id}`)}>
                <Stethoscope className="mr-1 h-3 w-3" />Abrir
              </Button>
            ))
          }
        </TabsContent>

        <TabsContent value="done" className="mt-3 space-y-2">
          {completed.length === 0 ? <EmptyState icon={UserCheck} title="Nenhum atendimento finalizado" /> :
            completed.map((a) => renderCard(a, null))
          }
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatusCard({ icon, label, count, color, bg }: { icon: React.ReactNode; label: string; count: number; color: string; bg: string }) {
  return (
    <Card className={bg}>
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
