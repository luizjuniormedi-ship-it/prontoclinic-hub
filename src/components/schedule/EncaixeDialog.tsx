import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DbProfessional, DbSpecialty, DbAppointmentType, appointmentsService } from "@/services/appointmentsService";
import { Appointment, Patient } from "@/types";
import { useToast } from "@/hooks/use-toast";

interface EncaixeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  professionals: DbProfessional[];
  specialties: DbSpecialty[];
  appointmentTypes: DbAppointmentType[];
  patients: Patient[];
  selectedDate: string;
  existingAppointments: Appointment[];
  onCreated: () => void;
}

export function EncaixeDialog({ open, onOpenChange, professionals, specialties, appointmentTypes, patients, selectedDate, existingAppointments, onCreated }: EncaixeDialogProps) {
  const { toast } = useToast();
  const [patientId, setPatientId] = useState("");
  const [professionalId, setProfessionalId] = useState("");
  const [specialtyId, setSpecialtyId] = useState("");
  const [appointmentTypeId, setAppointmentTypeId] = useState("");
  const [time, setTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const conflicts = time && professionalId
    ? existingAppointments.filter((a) => {
        if (a.doctorId !== professionalId || a.status === "cancelled") return false;
        const aStart = timeToMinutes(a.time);
        const aEnd = aStart + a.duration;
        const newStart = timeToMinutes(time);
        const newEnd = newStart + 30;
        return newStart < aEnd && newEnd > aStart;
      })
    : [];

  const resetForm = () => {
    setPatientId(""); setProfessionalId(""); setSpecialtyId("");
    setAppointmentTypeId(""); setTime(""); setEndTime(""); setReason(""); setSaving(false);
  };

  const handleClose = () => { resetForm(); onOpenChange(false); };

  const handleSubmit = async () => {
    if (!patientId || !professionalId || !time) {
      toast({ title: "Preencha os campos obrigatórios", variant: "destructive" });
      return;
    }
    if (!reason.trim()) {
      toast({ title: "Justificativa obrigatória", variant: "destructive" });
      return;
    }
    try {
      setSaving(true);
      await appointmentsService.create({
        patient_id: patientId,
        professional_id: professionalId,
        specialty_id: specialtyId || undefined,
        appointment_type_id: appointmentTypeId || undefined,
        appointment_date: selectedDate,
        start_time: time,
        end_time: endTime || undefined,
        notes: `[ENCAIXE] ${reason}`,
        status: "scheduled",
      });
      toast({
        title: "Encaixe criado com sucesso!",
        description: conflicts.length > 0 ? "Conflito de horário ignorado." : undefined,
      });
      handleClose();
      onCreated();
    } catch (err: any) {
      toast({ title: "Erro ao criar encaixe", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); else onOpenChange(v); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Encaixe Manual</DialogTitle>
          <DialogDescription>Agendar atendimento fora do horário regular.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Paciente *</Label>
            <Select value={patientId} onValueChange={setPatientId}>
              <SelectTrigger><SelectValue placeholder="Selecione o paciente" /></SelectTrigger>
              <SelectContent>
                {patients.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} — {p.cpf}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Especialidade</Label>
              <Select value={specialtyId} onValueChange={setSpecialtyId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {specialties.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Profissional *</Label>
              <Select value={professionalId} onValueChange={setProfessionalId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {professionals.map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Horário *</Label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={appointmentTypeId} onValueChange={setAppointmentTypeId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {appointmentTypes.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {conflicts.length > 0 && (
            <Card className="border-warning/30 bg-warning/5">
              <CardContent className="p-3 space-y-1.5">
                <div className="flex items-center gap-1.5 text-warning text-sm font-medium">
                  <AlertTriangle className="h-4 w-4" />Conflito de horário detectado
                </div>
                {conflicts.map((c) => (
                  <p key={c.id} className="text-xs text-muted-foreground">{c.time} — {c.patientName} ({c.duration}min)</p>
                ))}
                <Badge variant="outline" className="bg-warning/10 text-warning border-0 text-[10px]">O encaixe será permitido mesmo com conflito</Badge>
              </CardContent>
            </Card>
          )}
          <div className="space-y-2">
            <Label>Justificativa do encaixe *</Label>
            <Textarea placeholder="Motivo do encaixe..." value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={saving}>{saving ? "Salvando..." : "Confirmar Encaixe"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}
