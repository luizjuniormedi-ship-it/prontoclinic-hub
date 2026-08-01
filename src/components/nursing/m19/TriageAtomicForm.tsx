import { useMemo, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  module19NursingService,
  type Module19Classification,
  type Module19CompleteResult,
} from "@/services/module19NursingService";

interface TriageAtomicFormProps {
  unitId: number;
  classifications: Module19Classification[];
  initialPatientId?: number | null;
  initialAppointmentId?: number | null;
  initialQueueId?: number | null;
  onCompleted(result: Module19CompleteResult): void;
}

interface FormState {
  patientId: string;
  appointmentId: string;
  queueId: string;
  classificationId: string;
  classificationReason: string;
  chiefComplaint: string;
  systolicBloodPressure: string;
  diastolicBloodPressure: string;
  heartRate: string;
  respiratoryRate: string;
  temperature: string;
  oxygenSaturation: string;
  bloodGlucose: string;
  painScale: string;
  nursingNotes: string;
}

function optionalNumber(value: string): number | null {
  const normalized = value.trim();
  return normalized ? Number(normalized) : null;
}

export function TriageAtomicForm({
  unitId,
  classifications,
  initialPatientId,
  initialAppointmentId,
  initialQueueId,
  onCompleted,
}: TriageAtomicFormProps) {
  const [form, setForm] = useState<FormState>({
    patientId: initialPatientId ? String(initialPatientId) : "",
    appointmentId: initialAppointmentId ? String(initialAppointmentId) : "",
    queueId: initialQueueId ? String(initialQueueId) : "",
    classificationId: "",
    classificationReason: "",
    chiefComplaint: "",
    systolicBloodPressure: "",
    diastolicBloodPressure: "",
    heartRate: "",
    respiratoryRate: "",
    temperature: "",
    oxygenSaturation: "",
    bloodGlucose: "",
    painScale: "",
    nursingNotes: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedClassification = useMemo(
    () => classifications.find((item) => String(item.id) === form.classificationId),
    [classifications, form.classificationId],
  );

  const update = (field: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await module19NursingService.completeTriage({
        unitId,
        patientId: Number(form.patientId),
        appointmentId: optionalNumber(form.appointmentId),
        queueId: optionalNumber(form.queueId),
        classificationId: Number(form.classificationId),
        classificationReason: form.classificationReason,
        clinical: {
          chiefComplaint: form.chiefComplaint,
          systolicBloodPressure: optionalNumber(form.systolicBloodPressure),
          diastolicBloodPressure: optionalNumber(form.diastolicBloodPressure),
          heartRate: optionalNumber(form.heartRate),
          respiratoryRate: optionalNumber(form.respiratoryRate),
          temperature: optionalNumber(form.temperature),
          oxygenSaturation: optionalNumber(form.oxygenSaturation),
          bloodGlucose: optionalNumber(form.bloodGlucose),
          painScale: optionalNumber(form.painScale),
          nursingNotes: form.nursingNotes,
        },
      });
      onCompleted(result);
      setForm((current) => ({
        ...current,
        classificationReason: "",
        chiefComplaint: "",
        nursingNotes: "",
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível concluir a triagem.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="rounded-lg">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Triagem clínica</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={submit}>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="m19-patient">Paciente</Label>
              <Input
                id="m19-patient"
                inputMode="numeric"
                min={1}
                type="number"
                value={form.patientId}
                onChange={(event) => update("patientId", event.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m19-appointment">Agendamento</Label>
              <Input
                id="m19-appointment"
                inputMode="numeric"
                min={1}
                type="number"
                value={form.appointmentId}
                onChange={(event) => update("appointmentId", event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m19-queue">Senha da fila</Label>
              <Input
                id="m19-queue"
                inputMode="numeric"
                min={1}
                type="number"
                value={form.queueId}
                onChange={(event) => update("queueId", event.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
            <div className="space-y-1.5">
              <Label>Classificação</Label>
              <Select
                value={form.classificationId}
                onValueChange={(value) => update("classificationId", value)}
              >
                <SelectTrigger aria-label="Classificação de risco">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {classifications.map((classification) => (
                    <SelectItem key={classification.id} value={String(classification.id)}>
                      <span className="inline-flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="h-3 w-3 rounded-full border"
                          style={{ backgroundColor: classification.cd_cor_hex }}
                        />
                        {classification.ds_classificacao}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedClassification && (
                <p className="text-xs text-muted-foreground">
                  SLA: {selectedClassification.nr_tempo_max_atendimento_min} min
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m19-reason">Motivo clínico</Label>
              <Input
                id="m19-reason"
                value={form.classificationReason}
                onChange={(event) => update("classificationReason", event.target.value)}
                minLength={3}
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="m19-complaint">Queixa principal</Label>
            <Textarea
              id="m19-complaint"
              value={form.chiefComplaint}
              onChange={(event) => update("chiefComplaint", event.target.value)}
              rows={3}
              required
            />
          </div>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Sinais vitais</legend>
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
              {[
                ["systolicBloodPressure", "PAS", "mmHg"],
                ["diastolicBloodPressure", "PAD", "mmHg"],
                ["heartRate", "FC", "bpm"],
                ["respiratoryRate", "FR", "irpm"],
                ["temperature", "Temperatura", "°C"],
                ["oxygenSaturation", "SpO₂", "%"],
                ["bloodGlucose", "Glicemia", "mg/dL"],
                ["painScale", "Dor", "0-10"],
              ].map(([field, label, suffix]) => (
                <div className="space-y-1.5" key={field}>
                  <Label htmlFor={`m19-${field}`}>{label}</Label>
                  <div className="relative">
                    <Input
                      id={`m19-${field}`}
                      inputMode="decimal"
                      type="number"
                      step={field === "temperature" ? "0.1" : "1"}
                      value={form[field as keyof FormState]}
                      onChange={(event) => update(field as keyof FormState, event.target.value)}
                      className="pr-14"
                    />
                    <span className="pointer-events-none absolute right-2 top-2.5 text-xs text-muted-foreground">
                      {suffix}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="m19-notes">Observações de enfermagem</Label>
            <Textarea
              id="m19-notes"
              value={form.nursingNotes}
              onChange={(event) => update("nursingNotes", event.target.value)}
              rows={3}
            />
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <div className="flex justify-end">
            <Button type="submit" disabled={submitting || !form.classificationId}>
              {submitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Concluir triagem
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

