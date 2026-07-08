import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Appointment, AppointmentStatus } from "@/types";
import { useToast } from "@/hooks/use-toast";

interface QuickActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: string;
  appointment: Appointment | null;
  onConfirm: (
    appointment: Appointment,
    newStatus: AppointmentStatus,
    details?: { reason?: string; newDate?: string; newTime?: string }
  ) => void;
}

const actionConfig: Record<string, { title: string; description: string; status: AppointmentStatus; needsDate?: boolean; needsReason?: boolean }> = {
  checkin: { title: "Check-in", description: "Confirmar chegada do paciente.", status: "waiting" },
  start: { title: "Iniciar Atendimento", description: "Iniciar o atendimento do paciente.", status: "in_progress" },
  reschedule: { title: "Remarcar", description: "Selecione nova data e horário.", status: "scheduled", needsDate: true, needsReason: true },
  cancel: { title: "Cancelar Agendamento", description: "Esta ação não pode ser desfeita.", status: "cancelled", needsReason: true },
  no_show: { title: "Registrar Falta", description: "Registrar que o paciente não compareceu.", status: "no_show", needsReason: true },
};

export function QuickActionDialog({ open, onOpenChange, action, appointment, onConfirm }: QuickActionDialogProps) {
  const { toast } = useToast();
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");
  const [reason, setReason] = useState("");

  const config = actionConfig[action];
  if (!config || !appointment) return null;

  const handleConfirm = () => {
    if (config.needsDate && (!newDate || !newTime)) {
      toast({ title: "Preencha a nova data e horário", variant: "destructive" });
      return;
    }
    if (config.needsReason && !reason.trim()) {
      toast({ title: "Informe o motivo", variant: "destructive" });
      return;
    }
    onConfirm(appointment, config.status, {
      reason: reason.trim() || undefined,
      newDate: newDate || undefined,
      newTime: newTime || undefined,
    });
    setNewDate("");
    setNewTime("");
    setReason("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{config.title}</DialogTitle>
          <DialogDescription>{config.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="font-medium text-sm">{appointment.patientName}</p>
            <p className="text-xs text-muted-foreground">{appointment.doctorName} • {appointment.time}</p>
          </div>
          {config.needsDate && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Nova Data</Label>
                <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Novo Horário</Label>
                <Input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} />
              </div>
            </div>
          )}
          {config.needsReason && (
            <div className="space-y-1">
              <Label className="text-xs">Motivo *</Label>
              <Textarea placeholder="Informe o motivo..." value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            variant={action === "cancel" ? "destructive" : "default"}
            onClick={handleConfirm}
          >
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
