import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Phone, Mail, MapPin, AlertTriangle, Calendar, Clock, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, ErrorState } from "@/components/StateViews";
import { AppointmentStatusBadge, AppointmentTypeBadge } from "@/components/StatusBadge";
import { api } from "@/services/api";
import { Patient, MedicalRecord, Appointment } from "@/types";
import { formatDate, calculateAge, getAppointmentTypeLabel } from "@/utils/formatters";

export default function PatientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!id) return;
    Promise.all([api.getPatientById(id), api.getMedicalRecords(id), api.getAppointments()])
      .then(([p, r, a]) => {
        if (!p) { setError(true); setLoading(false); return; }
        setPatient(p);
        setRecords(r);
        setAppointments(a.filter((app) => app.patientId === id));
        setLoading(false);
      });
  }, [id]);

  if (loading) return <LoadingState />;
  if (error || !patient) return <ErrorState message="Paciente não encontrado." onRetry={() => navigate("/patients")} />;

  const isComplete = !!(patient.name && patient.cpf && patient.birthDate && patient.phone && patient.email && patient.gender);
  const sortedAppointments = [...appointments].sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));
  const lastApp = sortedAppointments.find((a) => a.status === "completed");

  const recordTypeLabels: Record<string, string> = {
    anamnesis: "Anamnese", evolution: "Evolução", vital_signs: "Sinais Vitais", attachment: "Anexo",
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Clinical header - fixed info bar */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
              <User className="h-6 w-6 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold">{patient.name}</h1>
                <Badge variant="outline" className={`text-[10px] border-0 ${isComplete ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
                  {isComplete ? "Completo" : "Incompleto"}
                </Badge>
              </div>
              <div className="flex items-center gap-3 text-sm text-muted-foreground mt-0.5 flex-wrap">
                <span>{calculateAge(patient.birthDate)} anos</span>
                <span>•</span>
                <span>{patient.gender === "M" ? "Masculino" : patient.gender === "F" ? "Feminino" : "Outro"}</span>
                <span>•</span>
                <span>{patient.healthInsurance || "Particular"}</span>
              </div>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => navigate("/patients")}>
            <ArrowLeft className="mr-1 h-3 w-3" />Voltar
          </Button>
        </div>

        {/* Alerts row */}
        <div className="flex items-center gap-3 mt-3 flex-wrap">
          {patient.allergies && (
            <div className="flex items-center gap-1 px-2 py-1 rounded bg-destructive/10">
              <AlertTriangle className="h-3 w-3 text-destructive" />
              <span className="text-xs text-destructive font-medium">Alergia: {patient.allergies}</span>
            </div>
          )}
          {lastApp && (
            <div className="flex items-center gap-1 px-2 py-1 rounded bg-muted">
              <Calendar className="h-3 w-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Última: {formatDate(lastApp.date)} — {lastApp.specialty || lastApp.doctorName}</span>
            </div>
          )}
          {patient.clinicalAlerts && (
            <div className="px-2 py-1 rounded bg-destructive/10">
              <span className="text-xs text-destructive font-medium">Alerta: {patient.clinicalAlerts}</span>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Dados Pessoais</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-muted-foreground" />{patient.phone}</div>
            <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 text-muted-foreground" />{patient.email}</div>
            {patient.clinicalAlerts && <div className="flex items-center gap-2"><AlertTriangle className="h-3.5 w-3.5 text-destructive" /><span className="text-xs">{patient.clinicalAlerts}</span></div>}
            <div className="pt-2 border-t space-y-1 text-xs">
              <p><span className="text-muted-foreground">CPF:</span> {patient.cpf}</p>
              <p><span className="text-muted-foreground">Nascimento:</span> {formatDate(patient.birthDate)}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Convênio</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-2">
            <p className="font-medium">{patient.healthInsurance || "Particular"}</p>
            {patient.healthInsuranceNumber && <p className="text-muted-foreground text-xs">Carteirinha: {patient.healthInsuranceNumber}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Linha do Tempo</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {sortedAppointments.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhum atendimento registrado.</p>
            ) : (
              sortedAppointments.slice(0, 4).map((a) => (
                <div key={a.id} className="flex items-center gap-2 text-xs py-1 border-b last:border-0">
                  <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="truncate">{formatDate(a.date)} — {a.specialty || a.doctorName}</p>
                    <p className="text-muted-foreground">{getAppointmentTypeLabel(a.type)}</p>
                  </div>
                  <AppointmentStatusBadge status={a.status} />
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="records">
        <TabsList>
          <TabsTrigger value="records">Prontuário</TabsTrigger>
          <TabsTrigger value="appointments">Histórico ({appointments.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="records" className="space-y-4 mt-4">
          {records.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">Nenhum registro encontrado.</CardContent></Card>
          ) : (
            records.map((r) => (
              <Card key={r.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{recordTypeLabels[r.type]}</Badge>
                      <span className="text-sm text-muted-foreground">{formatDate(r.date)}</span>
                    </div>
                    <span className="text-sm text-muted-foreground">{r.doctorName}</span>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm">{r.content}</p>
                  {r.vitalSigns && (
                    <div className="grid grid-cols-3 gap-3 mt-3 p-3 rounded-lg bg-muted/50">
                      {r.vitalSigns.bloodPressure && <div><p className="text-xs text-muted-foreground">PA</p><p className="text-sm font-medium">{r.vitalSigns.bloodPressure} mmHg</p></div>}
                      {r.vitalSigns.heartRate && <div><p className="text-xs text-muted-foreground">FC</p><p className="text-sm font-medium">{r.vitalSigns.heartRate} bpm</p></div>}
                      {r.vitalSigns.temperature && <div><p className="text-xs text-muted-foreground">Temp</p><p className="text-sm font-medium">{r.vitalSigns.temperature}°C</p></div>}
                      {r.vitalSigns.oxygenSaturation && <div><p className="text-xs text-muted-foreground">SpO2</p><p className="text-sm font-medium">{r.vitalSigns.oxygenSaturation}%</p></div>}
                      {r.vitalSigns.weight && <div><p className="text-xs text-muted-foreground">Peso</p><p className="text-sm font-medium">{r.vitalSigns.weight} kg</p></div>}
                      {r.vitalSigns.height && <div><p className="text-xs text-muted-foreground">Altura</p><p className="text-sm font-medium">{r.vitalSigns.height} cm</p></div>}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
        <TabsContent value="appointments" className="space-y-3 mt-4">
          {sortedAppointments.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">Nenhum atendimento encontrado.</CardContent></Card>
          ) : (
            sortedAppointments.map((a) => (
              <Card key={a.id}>
                <CardContent className="p-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="text-center min-w-[50px]">
                      <p className="text-sm font-bold text-primary">{a.time}</p>
                      <p className="text-[10px] text-muted-foreground">{formatDate(a.date)}</p>
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <p className="font-medium text-sm">{a.doctorName}</p>
                        <AppointmentTypeBadge type={a.type} />
                      </div>
                      <p className="text-xs text-muted-foreground">{a.specialty} • {a.duration}min</p>
                    </div>
                  </div>
                  <AppointmentStatusBadge status={a.status} />
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
