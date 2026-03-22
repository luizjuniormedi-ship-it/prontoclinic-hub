import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Phone, Mail, MapPin, Heart, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, ErrorState } from "@/components/StateViews";
import { api } from "@/services/api";
import { Patient, MedicalRecord } from "@/types";
import { formatDate, calculateAge } from "@/utils/formatters";

export default function PatientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!id) return;
    Promise.all([api.getPatientById(id), api.getMedicalRecords(id)])
      .then(([p, r]) => {
        if (!p) { setError(true); setLoading(false); return; }
        setPatient(p);
        setRecords(r);
        setLoading(false);
      });
  }, [id]);

  if (loading) return <LoadingState />;
  if (error || !patient) return <ErrorState message="Paciente não encontrado." onRetry={() => navigate("/patients")} />;

  const recordTypeLabels: Record<string, string> = {
    anamnesis: "Anamnese", evolution: "Evolução", vital_signs: "Sinais Vitais", attachment: "Anexo",
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={patient.name}
        description={`${calculateAge(patient.birthDate)} anos • ${patient.gender === "M" ? "Masculino" : patient.gender === "F" ? "Feminino" : "Outro"}`}
        actions={<Button variant="outline" onClick={() => navigate("/patients")}><ArrowLeft className="mr-2 h-4 w-4" />Voltar</Button>}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-base">Dados Pessoais</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center gap-2"><Phone className="h-4 w-4 text-muted-foreground" />{patient.phone}</div>
            <div className="flex items-center gap-2"><Mail className="h-4 w-4 text-muted-foreground" />{patient.email}</div>
            {patient.address && <div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-muted-foreground" />{patient.address}</div>}
            <div className="pt-2 border-t space-y-1">
              <p><span className="text-muted-foreground">CPF:</span> {patient.cpf}</p>
              <p><span className="text-muted-foreground">Nascimento:</span> {formatDate(patient.birthDate)}</p>
              {patient.bloodType && <p><span className="text-muted-foreground">Tipo Sanguíneo:</span> {patient.bloodType}</p>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Convênio</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-2">
            <p className="font-medium">{patient.healthInsurance || "Particular"}</p>
            {patient.healthInsuranceNumber && <p className="text-muted-foreground">Carteirinha: {patient.healthInsuranceNumber}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Informações Médicas</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-2">
            {patient.allergies ? (
              <div>
                <p className="text-muted-foreground mb-1">Alergias:</p>
                <Badge variant="outline" className="bg-destructive/10 text-destructive border-0">{patient.allergies}</Badge>
              </div>
            ) : (
              <p className="text-muted-foreground">Nenhuma alergia registrada</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="records">
        <TabsList>
          <TabsTrigger value="records">Prontuário</TabsTrigger>
          <TabsTrigger value="appointments">Histórico</TabsTrigger>
        </TabsList>
        <TabsContent value="records" className="space-y-4 mt-4">
          {records.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Nenhum registro encontrado.</CardContent></Card>
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
        <TabsContent value="appointments" className="mt-4">
          <Card><CardContent className="py-8 text-center text-muted-foreground">Histórico de atendimentos será exibido aqui.</CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
