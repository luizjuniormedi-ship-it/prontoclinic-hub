import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Phone, Mail, AlertTriangle, User, Edit, FileText, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LoadingState, ErrorState, EmptyState } from "@/components/StateViews";
import { supabase } from "@/lib/supabase";
import { formatDate, calculateAge, formatCPF } from "@/utils/formatters";
import { maskPhone } from "@/utils/masks";
import { medicalRecordsService, DbMedicalRecord } from "@/services/medicalRecordsService";
import { professionalsLookup, DbProfessional } from "@/services/appointmentsService";

interface PatientFull {
  id: string;
  full_name: string;
  cpf: string | null;
  birth_date: string | null;
  sex: string | null;
  phone: string | null;
  email: string | null;
  marital_status: string | null;
  responsible_name: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  insurance_plan_id: string | null;
  insurance_card_number: string | null;
  allergies: string | null;
  clinical_alerts: string | null;
  admin_notes: string | null;
  clinical_notes: string | null;
  registration_status: string | null;
  created_at: string | null;
}

export default function PatientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [patient, setPatient] = useState<PatientFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [records, setRecords] = useState<DbMedicalRecord[]>([]);
  const [professionals, setProfessionals] = useState<DbProfessional[]>([]);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      supabase.from("patients").select("*").eq("id", id).maybeSingle(),
      medicalRecordsService.getByPatient(id),
      professionalsLookup.getAll(),
    ]).then(([{ data, error: e }, recs, profs]) => {
      if (e || !data) { setError("Paciente não encontrado."); setLoading(false); return; }
      setPatient(data);
      setRecords(recs);
      setProfessionals(profs);
      setLoading(false);
    }).catch((err) => { setError(err.message); setLoading(false); });
  }, [id]);

  if (loading) return <LoadingState />;
  if (error || !patient) return <ErrorState message={error || "Paciente não encontrado."} onRetry={() => navigate("/patients")} />;

  const maritalLabel: Record<string, string> = { solteiro: "Solteiro(a)", casado: "Casado(a)", divorciado: "Divorciado(a)", viuvo: "Viúvo(a)", uniao_estavel: "União Estável" };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Clinical header */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
              <User className="h-6 w-6 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold">{patient.full_name}</h1>
                <Badge variant="outline" className={`text-[10px] border-0 ${patient.registration_status === "complete" ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
                  {patient.registration_status === "complete" ? "Completo" : "Incompleto"}
                </Badge>
              </div>
              <div className="flex items-center gap-3 text-sm text-muted-foreground mt-0.5 flex-wrap">
                {patient.birth_date && <span>{calculateAge(patient.birth_date)} anos</span>}
                <span>•</span>
                <span>{patient.sex === "M" ? "Masculino" : patient.sex === "F" ? "Feminino" : "Outro"}</span>
                <span>•</span>
                <span>{patient.insurance_plan_id || "Particular"}</span>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate(`/patients/${id}/edit`)}>
              <Edit className="mr-1 h-3 w-3" />Editar
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/patients")}>
              <ArrowLeft className="mr-1 h-3 w-3" />Voltar
            </Button>
          </div>
        </div>

        {(patient.allergies || patient.clinical_alerts) && (
          <div className="flex items-center gap-3 mt-3 flex-wrap">
            {patient.allergies && (
              <div className="flex items-center gap-1 px-2 py-1 rounded bg-destructive/10">
                <AlertTriangle className="h-3 w-3 text-destructive" />
                <span className="text-xs text-destructive font-medium">Alergia: {patient.allergies}</span>
              </div>
            )}
            {patient.clinical_alerts && (
              <div className="px-2 py-1 rounded bg-warning/10">
                <span className="text-xs text-warning font-medium">Alerta: {patient.clinical_alerts}</span>
              </div>
            )}
          </div>
        )}
      </div>

      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Dados Cadastrais</TabsTrigger>
          <TabsTrigger value="clinical">Clínico</TabsTrigger>
          <TabsTrigger value="records">Prontuário ({records.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Dados Pessoais</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p><span className="text-muted-foreground text-xs">CPF:</span> {patient.cpf ? formatCPF(patient.cpf) : "—"}</p>
                <p><span className="text-muted-foreground text-xs">Nascimento:</span> {patient.birth_date ? formatDate(patient.birth_date) : "—"}</p>
                <p><span className="text-muted-foreground text-xs">Estado Civil:</span> {patient.marital_status ? maritalLabel[patient.marital_status] || patient.marital_status : "—"}</p>
                <p><span className="text-muted-foreground text-xs">Responsável:</span> {patient.responsible_name || "—"}</p>
                <p><span className="text-muted-foreground text-xs">Cadastrado em:</span> {patient.created_at ? formatDate(patient.created_at.split("T")[0]) : "—"}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Contato</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-muted-foreground" />{patient.phone ? maskPhone(patient.phone) : "—"}</div>
                <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 text-muted-foreground" />{patient.email || "—"}</div>
                {(patient.emergency_contact_name || patient.emergency_contact_phone) && (
                  <div className="pt-2 border-t">
                    <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Shield className="h-3 w-3" />Emergência</p>
                    {patient.emergency_contact_name && <p className="text-xs">{patient.emergency_contact_name}</p>}
                    {patient.emergency_contact_phone && <p className="text-xs">{maskPhone(patient.emergency_contact_phone)}</p>}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Convênio</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="font-medium">{patient.insurance_plan_id || "Particular"}</p>
                {patient.insurance_card_number && <p className="text-xs text-muted-foreground">Carteirinha: {patient.insurance_card_number}</p>}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="clinical" className="mt-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Informações Clínicas</CardTitle></CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Alergias</p>
                {patient.allergies ? (
                  <div className="flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5 text-destructive" /><span className="text-destructive font-medium">{patient.allergies}</span></div>
                ) : <p className="text-muted-foreground">Nenhuma alergia registrada</p>}
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Alertas Clínicos</p>
                {patient.clinical_alerts ? <span className="text-warning font-medium">{patient.clinical_alerts}</span> : <p className="text-muted-foreground">Nenhum alerta</p>}
              </div>
              {patient.clinical_notes && <div><p className="text-xs text-muted-foreground mb-1">Notas Clínicas</p><p className="whitespace-pre-wrap">{patient.clinical_notes}</p></div>}
              {patient.admin_notes && <div><p className="text-xs text-muted-foreground mb-1">Notas Administrativas</p><p className="whitespace-pre-wrap">{patient.admin_notes}</p></div>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="records" className="mt-4">
          {records.length === 0 ? (
            <EmptyState icon={FileText} title="Nenhum registro" description="Este paciente ainda não possui registros no prontuário." />
          ) : (
            <div className="space-y-3">
              {records.map((r) => {
                const prof = professionals.find((p) => p.id === r.professional_id);
                const vs = r.vital_signs as Record<string, any> | null;
                return (
                  <Card key={r.id}>
                    <CardHeader className="py-3">
                      <CardTitle className="text-sm font-medium">
                        {formatDate(r.record_date.split("T")[0])}
                        {prof && <span className="text-muted-foreground font-normal"> — {prof.full_name}</span>}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0 space-y-2">
                      {r.anamnesis && <div><p className="text-xs font-medium text-muted-foreground">Anamnese</p><p className="text-sm whitespace-pre-wrap">{r.anamnesis}</p></div>}
                      {r.evolution && <div><p className="text-xs font-medium text-muted-foreground">Evolução</p><p className="text-sm whitespace-pre-wrap">{r.evolution}</p></div>}
                      {vs && Object.keys(vs).length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">Sinais Vitais</p>
                          <div className="flex gap-3 flex-wrap text-xs">
                            {vs.bloodPressure && <span>PA: <strong>{vs.bloodPressure}</strong></span>}
                            {vs.heartRate && <span>FC: <strong>{vs.heartRate} bpm</strong></span>}
                            {vs.temperature && <span>Temp: <strong>{vs.temperature}°C</strong></span>}
                            {vs.weight && <span>Peso: <strong>{vs.weight} kg</strong></span>}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
