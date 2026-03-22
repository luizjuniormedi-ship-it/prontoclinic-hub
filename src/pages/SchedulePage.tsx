import { useEffect, useState } from "react";
import { Plus, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState } from "@/components/StateViews";
import { AppointmentStatusBadge } from "@/components/StatusBadge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/services/api";
import { Appointment } from "@/types";
import { useToast } from "@/hooks/use-toast";

const weekDays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export default function SchedulePage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState("2026-03-22");
  const [view, setView] = useState<"day" | "week">("day");
  const [dialogOpen, setDialogOpen] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    api.getAppointments().then((a) => { setAppointments(a); setLoading(false); });
  }, []);

  const dayAppointments = appointments
    .filter((a) => a.date === selectedDate)
    .sort((a, b) => a.time.localeCompare(b.time));

  const dateObj = new Date(selectedDate + "T00:00:00");
  const formattedDate = dateObj.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  const changeDate = (dir: number) => {
    const d = new Date(selectedDate + "T00:00:00");
    d.setDate(d.getDate() + dir);
    setSelectedDate(d.toISOString().split("T")[0]);
  };

  const getWeekDates = () => {
    const d = new Date(selectedDate + "T00:00:00");
    const day = d.getDay();
    const start = new Date(d);
    start.setDate(d.getDate() - day);
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      return date.toISOString().split("T")[0];
    });
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    toast({ title: "Agendamento criado com sucesso!" });
    setDialogOpen(false);
  };

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Agenda"
        description="Gerencie os atendimentos"
        actions={
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="mr-2 h-4 w-4" />Novo Agendamento</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Novo Agendamento</DialogTitle></DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="space-y-2"><Label>Paciente *</Label><Input placeholder="Nome do paciente" required /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>Data *</Label><Input type="date" required /></div>
                  <div className="space-y-2"><Label>Horário *</Label><Input type="time" required /></div>
                </div>
                <div className="space-y-2">
                  <Label>Médico *</Label>
                  <Select>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="d1">Dr. Ricardo Mendes</SelectItem>
                      <SelectItem value="d2">Dra. Camila Ferreira</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2"><Label>Tipo</Label><Input placeholder="Consulta, retorno, exame..." /></div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
                  <Button type="submit">Agendar</Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => changeDate(-1)}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="text-sm font-medium capitalize min-w-[250px] text-center">{formattedDate}</span>
          <Button variant="outline" size="icon" onClick={() => changeDate(1)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <div className="flex gap-1">
          <Button variant={view === "day" ? "default" : "outline"} size="sm" onClick={() => setView("day")}>Dia</Button>
          <Button variant={view === "week" ? "default" : "outline"} size="sm" onClick={() => setView("week")}>Semana</Button>
        </div>
      </div>

      {view === "week" ? (
        <div className="grid grid-cols-7 gap-2">
          {getWeekDates().map((date, i) => {
            const dayApps = appointments.filter((a) => a.date === date);
            const isSelected = date === selectedDate;
            return (
              <Card
                key={date}
                className={`cursor-pointer transition-colors ${isSelected ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
                onClick={() => { setSelectedDate(date); setView("day"); }}
              >
                <CardContent className="p-3 text-center">
                  <p className="text-xs text-muted-foreground">{weekDays[i]}</p>
                  <p className="text-lg font-bold">{new Date(date + "T00:00:00").getDate()}</p>
                  <p className="text-xs text-primary font-medium">{dayApps.length} consultas</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : dayAppointments.length === 0 ? (
        <EmptyState title="Sem agendamentos" description="Não há atendimentos agendados para esta data." />
      ) : (
        <div className="space-y-3">
          {dayAppointments.map((a) => (
            <Card key={a.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="text-center min-w-[60px]">
                    <p className="text-lg font-bold text-primary">{a.time}</p>
                    <p className="text-xs text-muted-foreground">{a.duration} min</p>
                  </div>
                  <div className="border-l pl-4">
                    <p className="font-medium">{a.patientName}</p>
                    <p className="text-sm text-muted-foreground">{a.doctorName} • {a.type}</p>
                  </div>
                </div>
                <AppointmentStatusBadge status={a.status} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
