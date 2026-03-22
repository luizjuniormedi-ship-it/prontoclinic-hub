import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DbProfessional, DbSpecialty, DbAppointmentType, appointmentsService } from "@/services/appointmentsService";
import { Patient } from "@/types";
import { useToast } from "@/hooks/use-toast";

interface NewAppointmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  professionals: DbProfessional[];
  specialties: DbSpecialty[];
  appointmentTypes: DbAppointmentType[];
  patients: Patient[];
  selectedDate: string;
  onCreated: () => void;
}

export function NewAppointmentDialog({ open, onOpenChange, professionals, specialties, appointmentTypes, patients, selectedDate, onCreated }: NewAppointmentDialogProps) {
  const { toast } = useToast();
  const [patientId, setPatientId] = useState("");
  const [professionalId, setProfessionalId] = useState("");
  const [specialtyId, setSpecialtyId] = useState("");
  const [appointmentTypeId, setAppointmentTypeId] = useState("");
  const [date, setDate] = useState(selectedDate);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [isReturn, setIsReturn] = useState(false);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    setPatientId(""); setProfessionalId(""); setSpecialtyId("");
    setAppointmentTypeId(""); setDate(selectedDate); setStartTime("");
    setEndTime(""); setIsReturn(false); setNotes(""); setSaving(false);
  };

  const handleClose = () => { resetForm(); onOpenChange(false); };

  // Auto-calculate end time based on appointment type duration
  const handleStartTimeChange = (time: string) => {
    setStartTime(time);
    const selectedType = appointmentTypes.find((t) => t.id === appointmentTypeId);
    const duration = selectedType?.default_duration_minutes || 30;
    if (time) {
      const [h, m] = time.split(":").map(Number);
      const endMinutes = h * 60 + m + duration;
      const eh = Math.floor(endMinutes / 60);
      const em = endMinutes % 60;
      setEndTime(`${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}`);
    }
  };

  const handleSubmit = async () => {
    if (!patientId || !professionalId || !date || !startTime) {
      toast({ title: "Preencha os campos obrigatórios", variant: "destructive" });
      return;
    }
    try {
      setSaving(true);
      await appointmentsService.create({
        patient_id: patientId,
        professional_id: professionalId,
        specialty_id: specialtyId || undefined,
        appointment_type_id: appointmentTypeId || undefined,
        appointment_date: date,
        start_time: startTime,
        end_time: endTime || undefined,
        is_return: isReturn,
        notes: notes || undefined,
        status: "scheduled",
      });
      toast({ title: "Agendamento criado com sucesso!" });
      handleClose();
      onCreated();
    } catch (err: any) {
      toast({ title: "Erro ao criar agendamento", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); else onOpenChange(v); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo Agendamento</DialogTitle>
          <DialogDescription>Preencha os dados para criar um agendamento.</DialogDescription>
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Especialidade</Label>
              <Select value={specialtyId} onValueChange={(v) => { setSpecialtyId(v); setProfessionalId(""); }}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {specialties.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Tipo de Atendimento</Label>
              <Select value={appointmentTypeId} onValueChange={setAppointmentTypeId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {appointmentTypes.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Profissional *</Label>
            <Select value={professionalId} onValueChange={setProfessionalId}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {professionals.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>Data *</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Início *</Label>
              <Input type="time" value={startTime} onChange={(e) => handleStartTimeChange(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Fim</Label>
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Observações</Label>
            <Textarea placeholder="Notas adicionais..." value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={saving}>{saving ? "Salvando..." : "Agendar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
