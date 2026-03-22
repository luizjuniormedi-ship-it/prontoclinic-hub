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
import { Appointment, Doctor, Specialty, Patient, AppointmentType } from "@/types";
import { getAppointmentTypeLabel } from "@/utils/formatters";
import { useToast } from "@/hooks/use-toast";

const appointmentTypes: AppointmentType[] = ["consulta", "retorno", "exame", "procedimento", "terapia_avulsa", "terapia_pacote"];

interface EncaixeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  doctors: Doctor[];
  specialties: Specialty[];
  patients: Patient[];
  selectedDate: string;
  existingAppointments: Appointment[];
}

export function EncaixeDialog({ open, onOpenChange, doctors, specialties, patients, selectedDate, existingAppointments }: EncaixeDialogProps) {
  const { toast } = useToast();
  const [patientId, setPatientId] = useState("");
  const [type, setType] = useState<AppointmentType | "">("");
  const [doctorId, setDoctorId] = useState("");
  const [specialtyId, setSpecialtyId] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState("30");
  const [reason, setReason] = useState("");

  const filteredDoctors = specialtyId ? doctors.filter((d) => d.specialtyId === specialtyId) : doctors;

  // Check for conflicts
  const conflicts = time && doctorId
    ? existingAppointments.filter((a) => {
        if (a.doctorId !== doctorId || a.status === "cancelled") return false;
        const aStart = timeToMinutes(a.time);
        const aEnd = aStart + a.duration;
        const newStart = timeToMinutes(time);
        const newEnd = newStart + parseInt(duration);
        return newStart < aEnd && newEnd > aStart;
      })
    : [];

  const resetForm = () => {
    setPatientId("");
    setType("");
    setDoctorId("");
    setSpecialtyId("");
    setTime("");
    setDuration("30");
    setReason("");
  };

  const handleClose = () => {
    resetForm();
    onOpenChange(false);
  };

  const handleSubmit = () => {
    if (!patientId || !type || !doctorId || !time) {
      toast({ title: "Preencha todos os campos obrigatórios", variant: "destructive" });
      return;
    }
    if (!reason.trim()) {
      toast({ title: "Justificativa obrigatória", description: "Informe o motivo do encaixe.", variant: "destructive" });
      return;
    }
    toast({
      title: "Encaixe criado com sucesso!",
      description: conflicts.length > 0 ? "Conflito de horário ignorado. Ação registrada em auditoria." : undefined,
    });
    handleClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); else onOpenChange(v); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Encaixe Manual</DialogTitle>
          <DialogDescription>Agendar atendimento fora do horário regular. Esta ação será registrada em auditoria.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Paciente *</Label>
            <Select value={patientId} onValueChange={setPatientId}>
              <SelectTrigger><SelectValue placeholder="Selecione o paciente" /></SelectTrigger>
              <SelectContent>
                {patients.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name} — {p.cpf}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Tipo de Atendimento *</Label>
            <Select value={type} onValueChange={(v) => setType(v as AppointmentType)}>
              <SelectTrigger><SelectValue placeholder="Selecione o tipo" /></SelectTrigger>
              <SelectContent>
                {appointmentTypes.map((t) => (
                  <SelectItem key={t} value={t}>{getAppointmentTypeLabel(t)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Especialidade *</Label>
              <Select value={specialtyId} onValueChange={(v) => { setSpecialtyId(v); setDoctorId(""); }}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {specialties.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Profissional *</Label>
              <Select value={doctorId} onValueChange={setDoctorId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {filteredDoctors.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
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
              <Label>Duração (min)</Label>
              <Input type="number" value={duration} onChange={(e) => setDuration(e.target.value)} min="10" step="5" />
            </div>
          </div>

          {/* Conflict warning */}
          {conflicts.length > 0 && (
            <Card className="border-warning/30 bg-warning/5">
              <CardContent className="p-3 space-y-1.5">
                <div className="flex items-center gap-1.5 text-warning text-sm font-medium">
                  <AlertTriangle className="h-4 w-4" />Conflito de horário detectado
                </div>
                {conflicts.map((c) => (
                  <p key={c.id} className="text-xs text-muted-foreground">
                    {c.time} — {c.patientName} ({c.duration}min)
                  </p>
                ))}
                <Badge variant="outline" className="bg-warning/10 text-warning border-0 text-[10px]">
                  O encaixe será permitido mesmo com conflito
                </Badge>
              </CardContent>
            </Card>
          )}

          <div className="space-y-2">
            <Label>Justificativa do encaixe *</Label>
            <Textarea placeholder="Motivo do encaixe fora da agenda regular..." value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
            <p className="text-[10px] text-muted-foreground">Esta ação será registrada em auditoria com identificação do usuário.</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Cancelar</Button>
          <Button onClick={handleSubmit}>Confirmar Encaixe</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}
