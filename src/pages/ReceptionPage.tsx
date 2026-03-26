import { useEffect, useState, useCallback, useMemo } from "react";
import { Check, Clock, UserCheck, Play, AlertTriangle, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState, ErrorState } from "@/components/StateViews";
import { AppointmentStatusBadge, AppointmentTypeBadge } from "@/components/StatusBadge";
import { appointmentsService, professionalsLookup, specialtiesLookup, appointmentTypesLookup, DbAppointment, DbProfessional, DbSpecialty, DbAppointmentType } from "@/services/appointmentsService";
import { patientsService } from "@/services/patientsService";
import { Appointment, AppointmentStatus, Patient } from "@/types";
import { useToast } from "@/hooks/use-toast";
import { calculateAge } from "@/utils/formatters";

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

  let duration = 30;
  if (db.start_time && db.end_time) {
    const [sh, sm] = db.start_time.split(":").map(Number);
    const [eh, em] = db.end_time.split(":").map(Number);
    duration = (eh * 60 + em) - (sh * 60 + sm);
    if (duration <= 0) duration = 30;
  }

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

export default function ReceptionPage() {
  const [dbAppointments, setDbAppointments] = useState<DbAppointment[]>([]);
  const [professionals, setProfessionals] = useState<DbProfessional[]>([]);
  const [specialties, setSpecialties] = useState<DbSpecialty[]>([]);
  const [appointmentTypes, setAppointmentTypes] = useState<DbAppointmentType[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const today = new Date().toISOString().split("T")[0];

  const loadAll = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [profs, specs, types, pats, appts] = await Promise.all([
        professionalsLookup.getAll(),
        specialtiesLookup.getAll(),
        appointmentTypesLookup.getAll(),
        patientsService.getAll(),
        appointmentsService.getByDate(today),
      ]);
      setProfessionals(profs);
      setSpecialties(specs);
      setAppointmentTypes(types);
      setPatients(pats);
      setDbAppointments(appts);
    } catch (err: any) {
      setError(err.message || "Erro ao carregar recepção");
    } finally {
      setLoading(false);
    }
  }, [today]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const appointments = useMemo(() =>
    dbAppointments.map((db) => toDisplayAppointment(db, patients, professionals, specialties, appointmentTypes)),
    [dbAppointments, patients, professionals, specialties, appointmentTypes]
  );

  const handleCheckIn = async (id: string) => {
    try {
      await appointmentsService.updateStatus(id, "waiting");
      await appointmentsService.getByDate(today).then(setDbAppointments);
      toast({ title: "Check-in realizado! Paciente na sala de espera." });
    } catch (err: any) {
      toast({ title: "Erro no check-in", description: err.message, variant: "destructive" });
    }
  };

  const handleStartAttendance = async (id: string) => {
    try {
      await appointmentsService.updateStatus(id, "in_progress");
      await appointmentsService.getByDate(today).then(setDbAppointments);
      toast({ title: "Atendimento iniciado!" });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    }
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadAll} />;

  const sorted = [...appointments].sort((a, b) => a.time.localeCompare(b.time));
  const arrived = sorted.filter((a) => a.status === "confirmed");
  const waiting = sorted.filter((a) => a.status === "waiting");
  const inProgress = sorted.filter((a) => a.status === "in_progress");
  const completed = sorted.filter((a) => a.status === "completed");

  const getPatient = (patientId: string) => patients.find((p) => p.id === patientId);

  const isLate = (a: Appointment) => {
    const now = new Date();
    const [h, m] = a.time.split(":").map(Number);
    const scheduled = new Date();
    scheduled.setHours(h, m, 0, 0);
    return now > scheduled && (a.status === "scheduled" || a.status === "confirmed");
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Recepção" description={`${sorted.length} pacientes agendados hoje`} />

      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        <StatusCard icon={<Check className="h-4 w-4" />} label="Chegaram" count={arrived.length} color="text-primary" bg="bg-primary/5 border-primary/20" />
        <StatusCard icon={<Clock className="h-4 w-4" />} label="Aguardando" count={waiting.length} color="text-warning" bg="bg-warning/5 border-warning/20" />
        <StatusCard icon={<Play className="h-4 w-4" />} label="Em atendimento" count={inProgress.length} color="text-success" bg="bg-success/5 border-success/20" />
        <StatusCard icon={<UserCheck className="h-4 w-4" />} label="Finalizados" count={completed.length} color="text-muted-foreground" bg="bg-muted/50" />
      </div>

      {sorted.length === 0 ? (
        <EmptyState title="Nenhum paciente hoje" icon={UserCheck} />
      ) : (
        <div className="space-y-2">
          {sorted.map((a) => {
            const patient = getPatient(a.patientId);
            const late = isLate(a);
            const age = patient?.birthDate ? calculateAge(patient.birthDate) : null;

            return (
              <Card key={a.id} className={`hover:shadow-md transition-shadow ${late ? "border-l-4 border-l-destructive" : a.status === "waiting" ? "border-l-4 border-l-warning" : a.status === "in_progress" ? "border-l-4 border-l-success" : ""}`}>
                <CardContent className="p-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="text-center min-w-[48px]">
                      <p className="text-sm font-bold text-primary">{a.time}</p>
                      <p className="text-[10px] text-muted-foreground">{a.duration}min</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="font-medium text-sm">{a.patientName}</p>
                        {age != null && <span className="text-[10px] text-muted-foreground">{age}a</span>}
                        {a.typeLabel && <AppointmentTypeBadge type={a.type} />}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-xs text-muted-foreground">{a.doctorName}{a.specialty ? ` • ${a.specialty}` : ""}</p>
                        <span className="text-[10px] text-muted-foreground">{patient?.healthInsurance || "Particular"}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {late && (
                          <span className="text-[10px] text-destructive font-medium flex items-center gap-0.5">
                            <AlertTriangle className="h-2.5 w-2.5" />Atrasado
                          </span>
                        )}
                        {patient?.allergies && (
                          <span className="text-[10px] text-destructive flex items-center gap-0.5">
                            <AlertTriangle className="h-2.5 w-2.5" />{patient.allergies}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <AppointmentStatusBadge status={a.status} />
                    {(a.status === "scheduled" || a.status === "confirmed") && (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleCheckIn(a.id)}>
                        <Check className="mr-1 h-3 w-3" />Check-in
                      </Button>
                    )}
                    {a.status === "waiting" && (
                      <Button size="sm" className="h-7 text-xs" onClick={() => handleStartAttendance(a.id)}>
                        <Play className="mr-1 h-3 w-3" />Iniciar
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatusCard({ icon, label, count, color, bg }: { icon: React.ReactNode; label: string; count: number; color: string; bg: string }) {
  return (
    <Card className={`${bg}`}>
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
