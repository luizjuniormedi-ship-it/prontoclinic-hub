import { useEffect, useState } from "react";
import { Ban, CalendarClock, Check, ClipboardCheck, Clock, Plus, RefreshCw, Trash2, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { patientsService } from "@/services/patientsService";
import {
  AvailableSlot,
  PrecheckIssue,
  PreferredPeriod,
  ScheduleBlock,
  schedulingOperationsService,
  WaitlistEntry,
  WaitlistPriority,
} from "@/services/schedulingOperationsService";
import { DbAppointmentType, DbProfessional, DbSpecialty } from "@/services/appointmentsService";
import { Patient } from "@/types";
import { friendlyError } from "@/utils/friendlyError";

interface Props {
  professionals: DbProfessional[];
  specialties: DbSpecialty[];
  appointmentTypes: DbAppointmentType[];
  selectedDate: string;
  onAppointmentCreated: () => void;
}

const priorityLabels: Record<WaitlistPriority, string> = { low: "Baixa", normal: "Normal", high: "Alta", urgent: "Urgente" };
const periodLabels: Record<PreferredPeriod, string> = { any: "Qualquer", morning: "Manhã", afternoon: "Tarde", evening: "Noite" };

export function SchedulingOperationsPanel({ professionals, specialties, appointmentTypes, selectedDate, onAppointmentCreated }: Props) {
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  const [blocks, setBlocks] = useState<ScheduleBlock[]>([]);
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [precheckIssues, setPrecheckIssues] = useState<PrecheckIssue[]>([]);
  const [professionalId, setProfessionalId] = useState("");
  const [slotDate, setSlotDate] = useState(selectedDate);
  const [duration, setDuration] = useState("30");
  const [loading, setLoading] = useState(false);
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [convertEntry, setConvertEntry] = useState<WaitlistEntry | null>(null);
  const { toast } = useToast();

  const loadOperationalData = async () => {
    try {
      setLoading(true);
      const start = new Date(`${selectedDate}T00:00:00`);
      const end = new Date(start);
      end.setDate(end.getDate() + 30);
      const [waitRows, blockRows, issueRows] = await Promise.all([
        schedulingOperationsService.listWaitlist(),
        schedulingOperationsService.listBlocks(selectedDate, end.toISOString().slice(0, 10)),
        schedulingOperationsService.listPrecheckIssues(),
      ]);
      setWaitlist(waitRows);
      setBlocks(blockRows);
      setPrecheckIssues(issueRows);
    } catch (error) {
      toast({ title: friendlyError(error, "Carregar operação da agenda"), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadOperationalData(); }, [selectedDate]);
  useEffect(() => { setSlotDate(selectedDate); }, [selectedDate]);

  const searchSlots = async () => {
    if (!professionalId) return;
    try {
      setLoading(true);
      setSlots(await schedulingOperationsService.getAvailableSlots(professionalId, slotDate, Number(duration)));
    } catch (error) {
      toast({ title: friendlyError(error, "Buscar horários"), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const closeWaitlist = async (entry: WaitlistEntry) => {
    const reason = window.prompt("Motivo para retirar o paciente da lista de espera:");
    if (!reason?.trim()) return;
    try {
      await schedulingOperationsService.closeWaitlist(entry.id, reason);
      toast({ title: "Espera encerrada" });
      await loadOperationalData();
    } catch (error) {
      toast({ title: friendlyError(error, "Encerrar espera"), variant: "destructive" });
    }
  };

  const cancelBlock = async (block: ScheduleBlock) => {
    try {
      await schedulingOperationsService.cancelBlock(block.id);
      toast({ title: "Bloqueio removido" });
      await loadOperationalData();
    } catch (error) {
      toast({ title: friendlyError(error, "Remover bloqueio"), variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm flex items-center gap-2"><CalendarClock className="h-4 w-4" />Operação da agenda</CardTitle>
          <Button variant="ghost" size="icon" onClick={() => void loadOperationalData()} disabled={loading} title="Atualizar operação"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></Button>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="availability">
          <TabsList className="grid w-full grid-cols-2 md:grid-cols-4 h-auto">
            <TabsTrigger value="availability"><Clock className="mr-2 h-4 w-4" />Disponibilidade</TabsTrigger>
            <TabsTrigger value="waitlist"><Users className="mr-2 h-4 w-4" />Espera ({waitlist.length})</TabsTrigger>
            <TabsTrigger value="blocks"><Ban className="mr-2 h-4 w-4" />Bloqueios ({blocks.length})</TabsTrigger>
            <TabsTrigger value="precheck"><ClipboardCheck className="mr-2 h-4 w-4" />Pendências ({precheckIssues.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="availability" className="space-y-3 pt-2">
            <div className="grid gap-2 md:grid-cols-[minmax(220px,1fr)_160px_120px_auto]">
              <Select value={professionalId} onValueChange={setProfessionalId}>
                <SelectTrigger aria-label="Profissional para consulta de disponibilidade"><SelectValue placeholder="Profissional" /></SelectTrigger>
                <SelectContent>{professionals.filter((p) => p.lg_ativo !== false).map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>)}</SelectContent>
              </Select>
              <Input aria-label="Data para consulta de disponibilidade" type="date" value={slotDate} onChange={(event) => setSlotDate(event.target.value)} />
              <Select value={duration} onValueChange={setDuration}><SelectTrigger aria-label="Duracao da consulta"><SelectValue /></SelectTrigger><SelectContent>{[10, 15, 20, 30, 40, 60].map((value) => <SelectItem key={value} value={String(value)}>{value} min</SelectItem>)}</SelectContent></Select>
              <Button onClick={() => void searchSlots()} disabled={!professionalId || loading}>Buscar</Button>
            </div>
            {slots.length > 0 ? <div className="flex flex-wrap gap-2">{slots.map((slot) => <Badge key={`${slot.start_time}-${slot.unit_id}`} variant="outline" className="px-3 py-1.5">{slot.start_time.slice(0, 5)} - {slot.end_time.slice(0, 5)}</Badge>)}</div> : <p className="text-sm text-muted-foreground">Selecione profissional, data e duração para calcular horários livres pela escala.</p>}
          </TabsContent>

          <TabsContent value="waitlist" className="space-y-3 pt-2">
            <div className="flex justify-end"><Button size="sm" onClick={() => setWaitlistOpen(true)}><Plus className="mr-2 h-4 w-4" />Adicionar à espera</Button></div>
            {waitlist.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum paciente aguardando horário.</p> : waitlist.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between gap-3 border-b py-2 last:border-0">
                <div className="min-w-0"><div className="flex items-center gap-2"><p className="font-medium text-sm truncate">{entry.patient_name || `Paciente #${entry.patient_id}`}</p><Badge variant={entry.priority === "urgent" ? "destructive" : "outline"}>{priorityLabels[entry.priority]}</Badge></div><p className="text-xs text-muted-foreground">{entry.specialty_name || "Sem especialidade"} · {entry.professional_name || "Qualquer profissional"} · {periodLabels[entry.preferred_period]}</p><p className="text-xs truncate">{entry.reason}</p></div>
                <div className="flex gap-1"><Button size="icon" variant="ghost" title="Converter em agendamento" onClick={() => setConvertEntry(entry)}><Check className="h-4 w-4" /></Button><Button size="icon" variant="ghost" title="Retirar da espera" onClick={() => void closeWaitlist(entry)}><Trash2 className="h-4 w-4 text-destructive" /></Button></div>
              </div>
            ))}
          </TabsContent>

          <TabsContent value="blocks" className="space-y-3 pt-2">
            <div className="flex justify-end"><Button size="sm" onClick={() => setBlockOpen(true)}><Plus className="mr-2 h-4 w-4" />Novo bloqueio</Button></div>
            {blocks.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum bloqueio ativo nos próximos 30 dias.</p> : blocks.map((block) => (
              <div key={block.id} className="flex items-center justify-between gap-3 border-b py-2 last:border-0"><div><p className="text-sm font-medium">{block.reason}</p><p className="text-xs text-muted-foreground">{new Date(block.starts_at).toLocaleString("pt-BR")} até {new Date(block.ends_at).toLocaleString("pt-BR")}</p></div><Button size="icon" variant="ghost" title="Cancelar bloqueio" onClick={() => void cancelBlock(block)}><Trash2 className="h-4 w-4 text-destructive" /></Button></div>
            ))}
          </TabsContent>

          <TabsContent value="precheck" className="space-y-3 pt-2">
            {precheckIssues.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma autorização ou elegibilidade pendente.</p> : precheckIssues.map((issue) => (
              <div key={`${issue.kind}-${issue.id}`} className="flex items-center justify-between gap-3 border-b py-2 last:border-0"><div><p className="text-sm font-medium">{issue.patient_name || `Paciente #${issue.patient_id || "-"}`}</p><p className="text-xs text-muted-foreground">Agendamento #{issue.appointment_id || "-"} · {issue.detail || "Sem detalhe adicional"}</p></div><Badge variant={issue.status === "portal_indisponivel" ? "destructive" : "outline"}>{issue.kind === "authorization" ? "Autorização" : "Elegibilidade"}: {issue.status}</Badge></div>
            ))}
          </TabsContent>
        </Tabs>
      </CardContent>
      <WaitlistDialog open={waitlistOpen} onOpenChange={setWaitlistOpen} professionals={professionals} specialties={specialties} appointmentTypes={appointmentTypes} onCreated={loadOperationalData} />
      <BlockDialog open={blockOpen} onOpenChange={setBlockOpen} professionals={professionals} onCreated={loadOperationalData} />
      <ConvertDialog entry={convertEntry} onOpenChange={(open) => !open && setConvertEntry(null)} onConverted={async () => { setConvertEntry(null); await loadOperationalData(); onAppointmentCreated(); }} />
    </Card>
  );
}

function WaitlistDialog({ open, onOpenChange, professionals, specialties, appointmentTypes, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; professionals: DbProfessional[]; specialties: DbSpecialty[]; appointmentTypes: DbAppointmentType[]; onCreated: () => Promise<void> }) {
  const [query, setQuery] = useState(""); const [patients, setPatients] = useState<Patient[]>([]); const [patientId, setPatientId] = useState("");
  const [professionalId, setProfessionalId] = useState("all"); const [specialtyId, setSpecialtyId] = useState("all"); const [typeId, setTypeId] = useState("all");
  const [dateFrom, setDateFrom] = useState(""); const [dateTo, setDateTo] = useState(""); const [period, setPeriod] = useState<PreferredPeriod>("any"); const [priority, setPriority] = useState<WaitlistPriority>("normal"); const [reason, setReason] = useState(""); const [notes, setNotes] = useState(""); const [saving, setSaving] = useState(false); const { toast } = useToast();
  useEffect(() => { if (query.trim().length < 2) { setPatients([]); return; } const timer = setTimeout(() => { patientsService.search(query).then((rows) => setPatients(rows.slice(0, 20))).catch(() => setPatients([])); }, 250); return () => clearTimeout(timer); }, [query]);
  const submit = async () => { if (!patientId || !reason.trim()) { toast({ title: "Paciente e motivo são obrigatórios", variant: "destructive" }); return; } try { setSaving(true); await schedulingOperationsService.createWaitlist({ patientId, reason, professionalId: professionalId === "all" ? undefined : professionalId, specialtyId: specialtyId === "all" ? undefined : specialtyId, appointmentTypeId: typeId === "all" ? undefined : typeId, dateFrom, dateTo, period, priority, notes }); toast({ title: "Paciente incluído na lista de espera" }); onOpenChange(false); await onCreated(); } catch (error) { toast({ title: friendlyError(error, "Incluir na espera"), variant: "destructive" }); } finally { setSaving(false); } };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>Adicionar à lista de espera</DialogTitle></DialogHeader><div className="grid gap-3"><div><Label>Buscar paciente *</Label><Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nome, CPF ou telefone" /></div>{patients.length > 0 && <Select value={patientId} onValueChange={setPatientId}><SelectTrigger><SelectValue placeholder="Selecione o paciente" /></SelectTrigger><SelectContent>{patients.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} {p.cpf ? `- ${p.cpf}` : ""}</SelectItem>)}</SelectContent></Select>}<div className="grid grid-cols-1 md:grid-cols-3 gap-2"><Select value={specialtyId} onValueChange={setSpecialtyId}><SelectTrigger><SelectValue placeholder="Especialidade" /></SelectTrigger><SelectContent><SelectItem value="all">Qualquer especialidade</SelectItem>{specialties.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select><Select value={professionalId} onValueChange={setProfessionalId}><SelectTrigger><SelectValue placeholder="Profissional" /></SelectTrigger><SelectContent><SelectItem value="all">Qualquer profissional</SelectItem>{professionals.map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>)}</SelectContent></Select><Select value={typeId} onValueChange={setTypeId}><SelectTrigger><SelectValue placeholder="Tipo" /></SelectTrigger><SelectContent><SelectItem value="all">Qualquer tipo</SelectItem>{appointmentTypes.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent></Select></div><div className="grid grid-cols-2 md:grid-cols-4 gap-2"><Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /><Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /><Select value={period} onValueChange={(v) => setPeriod(v as PreferredPeriod)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(periodLabels).map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}</SelectContent></Select><Select value={priority} onValueChange={(v) => setPriority(v as WaitlistPriority)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(priorityLabels).map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}</SelectContent></Select></div><div><Label>Motivo *</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} /></div><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observações" /></div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button><Button onClick={() => void submit()} disabled={saving}>{saving ? "Salvando..." : "Adicionar"}</Button></DialogFooter></DialogContent></Dialog>;
}

function BlockDialog({ open, onOpenChange, professionals, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; professionals: DbProfessional[]; onCreated: () => Promise<void> }) {
  const [professionalId, setProfessionalId] = useState(""); const [startsAt, setStartsAt] = useState(""); const [endsAt, setEndsAt] = useState(""); const [type, setType] = useState("operational"); const [reason, setReason] = useState(""); const [saving, setSaving] = useState(false); const { toast } = useToast();
  const submit = async () => { if (!professionalId || !startsAt || !endsAt || !reason.trim()) { toast({ title: "Preencha profissional, período e motivo", variant: "destructive" }); return; } try { setSaving(true); await schedulingOperationsService.createBlock({ professionalId, startsAt, endsAt, reason, type }); toast({ title: "Bloqueio criado" }); onOpenChange(false); await onCreated(); } catch (error) { toast({ title: friendlyError(error, "Criar bloqueio"), variant: "destructive" }); } finally { setSaving(false); } };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>Novo bloqueio de agenda</DialogTitle></DialogHeader><div className="space-y-3"><Select value={professionalId} onValueChange={setProfessionalId}><SelectTrigger><SelectValue placeholder="Profissional" /></SelectTrigger><SelectContent>{professionals.map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>)}</SelectContent></Select><div className="grid grid-cols-2 gap-2"><div><Label>Início</Label><Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></div><div><Label>Fim</Label><Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} /></div></div><Select value={type} onValueChange={setType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="operational">Operacional</SelectItem><SelectItem value="leave">Afastamento</SelectItem><SelectItem value="vacation">Férias</SelectItem><SelectItem value="meeting">Reunião</SelectItem><SelectItem value="emergency">Emergência</SelectItem></SelectContent></Select><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo obrigatório" /></div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button><Button onClick={() => void submit()} disabled={saving}>{saving ? "Salvando..." : "Bloquear"}</Button></DialogFooter></DialogContent></Dialog>;
}

function ConvertDialog({ entry, onOpenChange, onConverted }: { entry: WaitlistEntry | null; onOpenChange: (open: boolean) => void; onConverted: () => Promise<void> }) {
  const [date, setDate] = useState(""); const [start, setStart] = useState(""); const [end, setEnd] = useState(""); const [saving, setSaving] = useState(false); const { toast } = useToast();
  const submit = async () => { if (!entry || !date || !start) return; try { setSaving(true); await schedulingOperationsService.convertWaitlist(entry.id, date, start, end); toast({ title: "Espera convertida em agendamento" }); await onConverted(); } catch (error) { toast({ title: friendlyError(error, "Converter espera"), variant: "destructive" }); } finally { setSaving(false); } };
  return <Dialog open={Boolean(entry)} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>Converter espera em agendamento</DialogTitle></DialogHeader><p className="text-sm">{entry?.patient_name} · {entry?.professional_name || "Profissional não definido"}</p><div className="grid grid-cols-3 gap-2"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /><Input type="time" value={start} onChange={(e) => setStart(e.target.value)} /><Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button><Button onClick={() => void submit()} disabled={saving || !entry?.professional_id}>{saving ? "Convertendo..." : "Confirmar"}</Button></DialogFooter></DialogContent></Dialog>;
}
