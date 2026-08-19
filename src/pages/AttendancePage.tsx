import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, User, AlertTriangle, Save, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, ErrorState } from "@/components/StateViews";
import { supabase } from "@/lib/supabase";
import { medicalAttendanceService, type MedicalEncounter } from "@/services/medicalAttendanceService";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { calculateAge } from "@/utils/formatters";

interface PatientInfo { id: string; full_name: string; birth_date: string | null; sex: string | null; allergies: string | null; clinical_alerts: string | null; insurance_plan_id: string | null; }
interface AppointmentInfo { id: string; patient_id: string; professional_id: string; specialty_id: string | null; unit_id: string | null; company_id: string | null; appointment_type_id: string | null; status: string; }

function textValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function arrayText(value: unknown, key: string): string {
  if (!Array.isArray(value) || value.length === 0) return "";
  const first = value[0];
  return first && typeof first === "object" ? textValue((first as Record<string, unknown>)[key]) : "";
}

function updateFirstRecord(
  existing: unknown[],
  values: Record<string, string | undefined>,
): unknown[] {
  const normalized = Object.fromEntries(
    Object.entries(values).filter(([, value]) => Boolean(value)),
  );
  if (Object.keys(normalized).length === 0) return existing;
  const current = existing[0] && typeof existing[0] === "object"
    ? existing[0] as Record<string, unknown>
    : {};
  return [{ ...current, ...normalized }, ...existing.slice(1)];
}

function parseAnamnesis(value: string | null) {
  const source = value || "";
  const section = (label: string) => {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = source.match(new RegExp(`\\*\\*${escaped}:\\*\\*\\s*([\\s\\S]*?)(?=\\n\\n\\*\\*|$)`, "i"));
    return match?.[1]?.trim() || "";
  };
  const hda = section("HDA");
  const personalHistory = section("Antecedentes Pessoais");
  const familyHistory = section("Antecedentes Familiares");
  const medications = section("Medicamentos em Uso");
  const structured = hda || personalHistory || familyHistory || medications;
  return { hda: structured ? hda : source, personalHistory, familyHistory, medications };
}

export default function AttendancePage() {
  const { appointmentId } = useParams<{ appointmentId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { activeUnitId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [patient, setPatient] = useState<PatientInfo | null>(null);
  const [appointment, setAppointment] = useState<AppointmentInfo | null>(null);
  const [encounter, setEncounter] = useState<MedicalEncounter | null>(null);

  // Form fields
  const [chiefComplaint, setChiefComplaint] = useState("");
  const [hda, setHda] = useState("");
  const [personalHistory, setPersonalHistory] = useState("");
  const [familyHistory, setFamilyHistory] = useState("");
  const [medications, setMedications] = useState("");
  const [physicalExam, setPhysicalExam] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [cid, setCid] = useState("");
  const [conduct, setConduct] = useState("");
  const [prescription, setPrescription] = useState("");
  const [examRequests, setExamRequests] = useState("");
  const [returnNotes, setReturnNotes] = useState("");
  const [vitalSigns, setVitalSigns] = useState({ bloodPressure: "", heartRate: "", temperature: "", weight: "", height: "", oxygenSaturation: "" });

  const loadAttendance = useCallback(async () => {
    const parsedAppointmentId = Number(appointmentId);
    if (!Number.isSafeInteger(parsedAppointmentId) || parsedAppointmentId <= 0) {
      setError("Agendamento inválido.");
      setLoading(false);
      return;
    }
    if (!activeUnitId) {
      setError("Selecione a unidade ativa do atendimento.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const opened = await medicalAttendanceService.open(parsedAppointmentId, activeUnitId);
      setEncounter(opened);
      const anamnesis = parseAnamnesis(opened.anamnesis);
      setChiefComplaint(opened.chief_complaint || "");
      setHda(anamnesis.hda);
      setPersonalHistory(anamnesis.personalHistory);
      setFamilyHistory(anamnesis.familyHistory);
      setMedications(anamnesis.medications);
      setPhysicalExam(opened.physical_exam || "");
      setDiagnosis(arrayText(opened.diagnoses, "description"));
      setCid(arrayText(opened.diagnoses, "code"));
      setConduct(opened.conduct || "");
      setPrescription(arrayText(opened.prescriptions, "text"));
      setExamRequests(arrayText(opened.exams, "text"));
      setReturnNotes(opened.return_plan || "");
      const vitals = opened.vital_signs || {};
      setVitalSigns({
        bloodPressure: textValue(vitals.bloodPressure),
        heartRate: vitals.heartRate == null ? "" : String(vitals.heartRate),
        temperature: vitals.temperature == null ? "" : String(vitals.temperature),
        weight: vitals.weight == null ? "" : String(vitals.weight),
        height: vitals.height == null ? "" : String(vitals.height),
        oxygenSaturation: vitals.oxygenSaturation == null ? "" : String(vitals.oxygenSaturation),
      });
      const { data: appt, error: appointmentError } = await supabase
        .from("appointments")
        .select("id, patient_id, professional_id, specialty_id, unit_id, company_id, appointment_type_id, status")
        .eq("id", parsedAppointmentId)
        .maybeSingle();
      if (appointmentError || !appt) throw new Error("Atendimento não encontrado.");
      setAppointment(appt as AppointmentInfo);
      const { data: pat, error: patientError } = await supabase
        .from("patients")
        .select("id, full_name, birth_date, sex, allergies, clinical_alerts, insurance_plan_id")
        .eq("id", opened.patient_id)
        .maybeSingle();
      if (patientError || !pat) throw new Error("Paciente do atendimento não encontrado.");
      setPatient(pat as PatientInfo);
    } catch (cause) {
      setEncounter(null);
      setAppointment(null);
      setPatient(null);
      setError(cause instanceof Error ? cause.message : "Não foi possível abrir o atendimento.");
    } finally {
      setLoading(false);
    }
  }, [activeUnitId, appointmentId]);

  useEffect(() => {
    void loadAttendance();
  }, [loadAttendance]);

  const handleSave = async () => {
    if (!patient || !appointment || !encounter) return;
    if (!chiefComplaint.trim() && !hda.trim() && !physicalExam.trim()) {
      toast({ title: "Preencha pelo menos a queixa principal, HDA ou exame físico", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const vs: Record<string, unknown> = {};
      if (vitalSigns.bloodPressure) vs.bloodPressure = vitalSigns.bloodPressure;
      if (vitalSigns.heartRate) vs.heartRate = Number(vitalSigns.heartRate);
      if (vitalSigns.temperature) vs.temperature = Number(vitalSigns.temperature);
      if (vitalSigns.weight) vs.weight = Number(vitalSigns.weight);
      if (vitalSigns.height) vs.height = Number(vitalSigns.height);
      if (vitalSigns.oxygenSaturation) vs.oxygenSaturation = Number(vitalSigns.oxygenSaturation);

      const composedAnamnesis = [
        hda && `**HDA:** ${hda}`,
        personalHistory && `**Antecedentes Pessoais:** ${personalHistory}`,
        familyHistory && `**Antecedentes Familiares:** ${familyHistory}`,
        medications && `**Medicamentos em Uso:** ${medications}`,
      ].filter(Boolean).join("\n\n");
      const initialAnamnesis = parseAnamnesis(encounter.anamnesis);
      const anamnesisUnchanged = hda === initialAnamnesis.hda
        && personalHistory === initialAnamnesis.personalHistory
        && familyHistory === initialAnamnesis.familyHistory
        && medications === initialAnamnesis.medications;
      const mergedVitals = { ...encounter.vital_signs, ...vs };

      const result = await medicalAttendanceService.finalizeAppointmentWithBilling(
        Number(appointment.id),
        {
        chief_complaint: chiefComplaint,
        anamnesis: anamnesisUnchanged ? encounter.anamnesis || "" : composedAnamnesis,
        physical_exam: physicalExam,
        vital_signs: mergedVitals,
        diagnoses: updateFirstRecord(encounter.diagnoses, {
          description: diagnosis || undefined,
          code: cid || undefined,
        }),
        conduct,
        procedures: encounter.procedures,
        prescriptions: updateFirstRecord(encounter.prescriptions, { text: prescription || undefined }),
        exams: updateFirstRecord(encounter.exams, { text: examRequests || undefined }),
        certificate: encounter.certificate,
        referral: encounter.referral,
        return_plan: returnNotes,
        discharge_summary: encounter.discharge_summary || "",
        admission_plan: encounter.admission_plan || "",
        },
      );

      toast({ title: "Atendimento concluído e conta encaminhada ao faturamento!" });
      const params = new URLSearchParams({
        account: result.billing.billing_account_id,
        appointment: appointment.id,
      });
      navigate(`/billing-accounts?${params.toString()}`);
    } catch (err) {
      toast({ title: "Erro ao salvar", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={() => void loadAttendance()} />;
  if (!patient || !appointment || !encounter) return <ErrorState message="Dados não encontrados" />;

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader
        title="Atendimento"
        description="Registro do prontuário médico"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate("/reception")}><ArrowLeft className="mr-1 h-4 w-4" />Voltar</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
              {saving ? "Salvando..." : "Finalizar Atendimento"}
            </Button>
          </div>
        }
      />

      {/* Patient banner */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-3 flex items-center gap-3 flex-wrap">
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
            <User className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="font-semibold">{patient.full_name}</p>
            <p className="text-xs text-muted-foreground">
              {patient.birth_date ? `${calculateAge(patient.birth_date)} anos` : ""} • {patient.sex === "M" ? "Masc." : patient.sex === "F" ? "Fem." : "Outro"} • {patient.insurance_plan_id || "Particular"}
            </p>
          </div>
          {patient.allergies && (
            <Badge variant="outline" className="bg-destructive/10 text-destructive border-0 gap-1 text-xs">
              <AlertTriangle className="h-3 w-3" />Alergia: {patient.allergies}
            </Badge>
          )}
          {patient.clinical_alerts && (
            <Badge variant="outline" className="bg-warning/10 text-warning border-0 gap-1 text-xs">
              <AlertTriangle className="h-3 w-3" />{patient.clinical_alerts}
            </Badge>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="anamnesis">
        <TabsList className="flex-wrap">
          <TabsTrigger value="anamnesis">Anamnese</TabsTrigger>
          <TabsTrigger value="exam">Exame Físico</TabsTrigger>
          <TabsTrigger value="vitals">Sinais Vitais</TabsTrigger>
          <TabsTrigger value="diagnosis">Diagnóstico</TabsTrigger>
          <TabsTrigger value="prescription">Prescrição</TabsTrigger>
        </TabsList>

        <TabsContent value="anamnesis" className="mt-4 space-y-4">
          <div className="space-y-2"><Label>Queixa Principal *</Label><Textarea rows={3} placeholder="Motivo da consulta..." value={chiefComplaint} onChange={(e) => setChiefComplaint(e.target.value)} /></div>
          <div className="space-y-2"><Label>História da Doença Atual (HDA)</Label><Textarea rows={4} placeholder="Descrição detalhada..." value={hda} onChange={(e) => setHda(e.target.value)} /></div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2"><Label>Antecedentes Pessoais</Label><Textarea rows={3} placeholder="Doenças prévias, cirurgias..." value={personalHistory} onChange={(e) => setPersonalHistory(e.target.value)} /></div>
            <div className="space-y-2"><Label>Antecedentes Familiares</Label><Textarea rows={3} placeholder="Doenças na família..." value={familyHistory} onChange={(e) => setFamilyHistory(e.target.value)} /></div>
          </div>
          <div className="space-y-2"><Label>Medicamentos em Uso</Label><Textarea rows={2} placeholder="Listar medicamentos..." value={medications} onChange={(e) => setMedications(e.target.value)} /></div>
        </TabsContent>

        <TabsContent value="exam" className="mt-4">
          <div className="space-y-2"><Label>Exame Físico</Label><Textarea rows={6} placeholder="Achados do exame físico..." value={physicalExam} onChange={(e) => setPhysicalExam(e.target.value)} /></div>
        </TabsContent>

        <TabsContent value="vitals" className="mt-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Sinais Vitais</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="space-y-1.5"><Label className="text-xs">Pressão Arterial</Label><Input placeholder="120/80" value={vitalSigns.bloodPressure} onChange={(e) => setVitalSigns({ ...vitalSigns, bloodPressure: e.target.value })} /></div>
              <div className="space-y-1.5"><Label className="text-xs">FC (bpm)</Label><Input type="number" placeholder="72" value={vitalSigns.heartRate} onChange={(e) => setVitalSigns({ ...vitalSigns, heartRate: e.target.value })} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Temp (°C)</Label><Input type="number" step="0.1" placeholder="36.5" value={vitalSigns.temperature} onChange={(e) => setVitalSigns({ ...vitalSigns, temperature: e.target.value })} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Peso (kg)</Label><Input type="number" step="0.1" placeholder="70" value={vitalSigns.weight} onChange={(e) => setVitalSigns({ ...vitalSigns, weight: e.target.value })} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Altura (cm)</Label><Input type="number" placeholder="170" value={vitalSigns.height} onChange={(e) => setVitalSigns({ ...vitalSigns, height: e.target.value })} /></div>
              <div className="space-y-1.5"><Label className="text-xs">SpO2 (%)</Label><Input type="number" placeholder="98" value={vitalSigns.oxygenSaturation} onChange={(e) => setVitalSigns({ ...vitalSigns, oxygenSaturation: e.target.value })} /></div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="diagnosis" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2"><Label>Hipótese Diagnóstica</Label><Textarea rows={3} placeholder="Diagnóstico..." value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} /></div>
            <div className="space-y-2"><Label>CID</Label><Input placeholder="Ex: J06.9" value={cid} onChange={(e) => setCid(e.target.value)} /></div>
          </div>
          <div className="space-y-2"><Label>Conduta</Label><Textarea rows={3} placeholder="Conduta médica..." value={conduct} onChange={(e) => setConduct(e.target.value)} /></div>
          <div className="space-y-2"><Label>Solicitação de Exames</Label><Textarea rows={2} placeholder="Exames solicitados..." value={examRequests} onChange={(e) => setExamRequests(e.target.value)} /></div>
          <div className="space-y-2"><Label>Retorno</Label><Input placeholder="Ex: 15 dias, 1 mês" value={returnNotes} onChange={(e) => setReturnNotes(e.target.value)} /></div>
        </TabsContent>

        <TabsContent value="prescription" className="mt-4">
          <div className="space-y-2"><Label>Prescrição Médica</Label><Textarea rows={8} placeholder="1. Medicamento - dose - posologia - duração&#10;2. ..." value={prescription} onChange={(e) => setPrescription(e.target.value)} /></div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
