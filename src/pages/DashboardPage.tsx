import { useEffect, useState, useMemo } from "react";
import { Calendar, Users, Clock, AlertTriangle, TrendingUp, ClipboardList, Building2 } from "lucide-react";
import { StatsCard } from "@/components/StatsCard";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, ErrorState } from "@/components/StateViews";
import { AppointmentStatusBadge, AppointmentTypeBadge } from "@/components/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { appointmentsService, professionalsLookup, specialtiesLookup, appointmentTypesLookup, DbAppointment, DbProfessional, DbSpecialty, DbAppointmentType } from "@/services/appointmentsService";
import { patientsService } from "@/services/patientsService";
import { Appointment, AppointmentStatus, Patient } from "@/types";
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

export default function DashboardPage() {
  const [dbAppointments, setDbAppointments] = useState<DbAppointment[]>([]);
  const [professionals, setProfessionals] = useState<DbProfessional[]>([]);
  const [specialties, setSpecialties] = useState<DbSpecialty[]>([]);
  const [appointmentTypes, setAppointmentTypes] = useState<DbAppointmentType[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const today = new Date().toISOString().split("T")[0];

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
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
        setError(err.message || "Erro ao carregar dashboard");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [today]);

  const appointments = useMemo(() =>
    dbAppointments.map((db) => toDisplayAppointment(db, patients, professionals, specialties, appointmentTypes)),
    [dbAppointments, patients, professionals, specialties, appointmentTypes]
  );

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={() => window.location.reload()} />;

  const waiting = appointments.filter((a) => a.status === "waiting").length;
  const inProgress = appointments.filter((a) => a.status === "in_progress").length;
  const getPatient = (id: string) => patients.find((p) => p.id === id);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Dashboard" description="Visão geral da clínica" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard title="Atendimentos Hoje" value={appointments.length} icon={Calendar} variant="primary" />
        <StatsCard title="Pacientes Cadastrados" value={patients.length} icon={Users} variant="secondary" />
        <StatsCard title="Aguardando" value={waiting} icon={Clock} variant="warning" />
        <StatsCard title="Em Atendimento" value={inProgress} icon={TrendingUp} variant="success" />
      </div>

      {(waiting > 0 || inProgress > 0) && (
        <div className="flex flex-col gap-2">
          {waiting > 0 && (
            <Card className="border-warning/30 bg-warning/5">
              <CardContent className="p-3 flex items-center gap-2">
                <Clock className="h-4 w-4 text-warning" />
                <span className="text-sm font-medium">{waiting} paciente{waiting > 1 ? "s" : ""} aguardando</span>
              </CardContent>
            </Card>
          )}
          {inProgress > 0 && (
            <Card className="border-success/30 bg-success/5">
              <CardContent className="p-3 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-success" />
                <span className="text-sm font-medium">{inProgress} em atendimento</span>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Próximos Atendimentos</CardTitle>
        </CardHeader>
        <CardContent>
          {appointments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum atendimento agendado para hoje.</p>
          ) : (
            <div className="space-y-2">
              {appointments.slice(0, 8).map((a) => {
                const patient = getPatient(a.patientId);
                const age = patient?.birthDate ? calculateAge(patient.birthDate) : null;
                return (
                  <div key={a.id} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div className="flex items-center gap-3">
                      <div className="text-sm font-medium text-primary w-12">{a.time}</div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-medium">{a.patientName}</p>
                          {age != null && <span className="text-[10px] text-muted-foreground">{age}a</span>}
                          <AppointmentTypeBadge type={a.type} />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {a.doctorName}{a.specialty ? ` • ${a.specialty}` : ""}
                        </p>
                      </div>
                    </div>
                    <AppointmentStatusBadge status={a.status} />
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
