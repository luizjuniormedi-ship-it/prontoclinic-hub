import { useCallback, useEffect, useState } from "react";
import { Phone, Search, Plus, Calendar, CheckCircle, PhoneMissed, ListTodo, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState, ErrorState } from "@/components/StateViews";
import { callCenterService, CallCenterContactLog, CallCenterResult, CallCenterChannel, CallCenterDirection, CallCenterTask, ConfirmationQueueItem } from "@/services/callCenterService";
import { patientsService } from "@/services/patientsService";
import { Patient } from "@/types";
import { useToast } from "@/hooks/use-toast";
import { friendlyError } from "@/utils/friendlyError";

const resultLabels: Record<CallCenterResult, string> = {
  agendado: "Agendado",
  confirmado: "Confirmado",
  cancelado: "Cancelado",
  remarcado: "Remarcado",
  nao_atendeu: "Não atendeu",
  recado: "Recado",
  sem_interesse: "Sem interesse",
  numero_invalido: "Número inválido",
  retornar_depois: "Retornar depois",
};

const resultColors: Record<CallCenterResult, string> = {
  agendado: "bg-primary/10 text-primary",
  confirmado: "bg-success/10 text-success",
  cancelado: "bg-destructive/10 text-destructive",
  remarcado: "bg-warning/10 text-warning",
  nao_atendeu: "bg-muted text-muted-foreground",
  recado: "bg-secondary/10 text-secondary",
  sem_interesse: "bg-muted text-muted-foreground",
  numero_invalido: "bg-destructive/10 text-destructive",
  retornar_depois: "bg-warning/10 text-warning",
};

const channelLabels: Record<CallCenterChannel, string> = {
  telefone: "Telefone",
  whatsapp: "WhatsApp",
  email: "E-mail",
  portal: "Portal",
  presencial: "Presencial",
  campanha: "Campanha",
  instagram: "Instagram",
  google: "Google",
  site: "Site",
  convenio: "Convênio",
  indicacao: "Indicação",
};

export default function CallCenterPage() {
  const [contacts, setContacts] = useState<CallCenterContactLog[]>([]);
  const [tasks, setTasks] = useState<CallCenterTask[]>([]);
  const [confirmations, setConfirmations] = useState<ConfirmationQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [resultFilter, setResultFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const { toast } = useToast();

  const reload = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      await callCenterService.refreshConfirmationQueue(3);
      const [contactRows, taskRows, confirmationRows] = await Promise.all([
        callCenterService.listContacts(),
        callCenterService.listTasks("pending"),
        callCenterService.listConfirmationQueue(),
      ]);
      setContacts(contactRows);
      setTasks(taskRows);
      setConfirmations(confirmationRows);
    } catch (err) {
      setError(friendlyError(err, "Carregar call center"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const filtered = contacts.filter((r) => {
    const q = search.trim().toLowerCase();
    const matchSearch = !q ||
      (r.patient_name || "").toLowerCase().includes(q) ||
      (r.patient_cpf || "").includes(q.replace(/\D/g, "")) ||
      (r.patient_phone || "").includes(q.replace(/\D/g, "")) ||
      r.contact_reason.toLowerCase().includes(q);
    const matchResult = resultFilter === "all" || r.result === resultFilter;
    return matchSearch && matchResult;
  });

  const stats = {
    total: contacts.length,
    agendados: contacts.filter((r) => r.result === "agendado").length,
    confirmados: contacts.filter((r) => r.result === "confirmado").length,
    naoAtendeu: contacts.filter((r) => r.result === "nao_atendeu").length,
    pendencias: tasks.length,
  };

  const registerConfirmation = async (item: ConfirmationQueueItem, outcome: "confirmed" | "cancelled" | "no_answer" | "invalid_number") => {
    const notes = outcome === "cancelled" ? window.prompt("Motivo do cancelamento:") : undefined;
    if (outcome === "cancelled" && !notes?.trim()) return;
    try {
      await callCenterService.recordConfirmation(item.id, outcome, notes);
      toast({ title: outcome === "confirmed" ? "Presença confirmada" : "Tentativa registrada" });
      await reload();
    } catch (error) {
      toast({ title: friendlyError(error, "Registrar confirmação"), variant: "destructive" });
    }
  };

  const [completingTaskId, setCompletingTaskId] = useState<number | null>(null);
  const completeTask = async (task: CallCenterTask) => {
    if (completingTaskId) return;
    try {
      setCompletingTaskId(task.id);
      await callCenterService.completeTask(task.id);
      toast({ title: "Tarefa concluída" });
      await reload();
    } catch (err) {
      toast({ title: friendlyError(err, "Concluir tarefa"), variant: "destructive" });
    } finally {
      setCompletingTaskId(null);
    }
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={() => void reload()} />;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Call Center" description="Contatos, retornos e tarefas operacionais" actions={
        <Button onClick={() => setDialogOpen(true)}><Plus className="mr-2 h-4 w-4" />Novo Contato</Button>
      } />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Stat icon={<Phone className="h-4 w-4 text-primary" />} label="Total contatos" value={stats.total} />
        <Stat icon={<Calendar className="h-4 w-4 text-primary" />} label="Agendados" value={stats.agendados} color="text-primary" />
        <Stat icon={<CheckCircle className="h-4 w-4 text-success" />} label="Confirmados" value={stats.confirmados} color="text-success" />
        <Stat icon={<PhoneMissed className="h-4 w-4 text-muted-foreground" />} label="Não atendeu" value={stats.naoAtendeu} color="text-muted-foreground" />
        <Stat icon={<ListTodo className="h-4 w-4 text-warning" />} label="Pendências" value={stats.pendencias} color="text-warning" />
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold">Fila de confirmação</h2><p className="text-xs text-muted-foreground">Próximos 3 dias · envio automático externo ainda não configurado</p></div><Badge variant="outline">{confirmations.length} pendentes</Badge></div>
          {confirmations.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma confirmação pendente.</p> : confirmations.slice(0, 20).map((item) => <div key={item.id} className="flex items-center justify-between gap-3 border-b py-2 last:border-0"><div><p className="text-sm font-medium">{item.patient_name || `Paciente #${item.patient_id || "-"}`}</p><p className="text-xs text-muted-foreground">{item.patient_phone || "Sem telefone"} · Agendamento #{item.appointment_id} · {item.attempt_count} tentativa(s)</p></div><div className="flex gap-1"><Button size="sm" variant="outline" onClick={() => void registerConfirmation(item, "no_answer")}><RefreshCw className="mr-1 h-3 w-3" />Não atendeu</Button><Button size="sm" onClick={() => void registerConfirmation(item, "confirmed")}><CheckCircle className="mr-1 h-3 w-3" />Confirmar</Button><Button size="icon" variant="ghost" title="Cancelar agendamento" onClick={() => void registerConfirmation(item, "cancelled")}><XCircle className="h-4 w-4 text-destructive" /></Button></div></div>)}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold">Tarefas pendentes</h2><p className="text-xs text-muted-foreground">Retornos e ações vinculadas aos contatos.</p></div><Badge variant="outline">{tasks.length}</Badge></div>
          {tasks.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma tarefa pendente.</p> : tasks.slice(0, 20).map((task) => <div key={task.id} className="flex items-center justify-between gap-3 border-b py-2 last:border-0"><div className="min-w-0"><p className="text-sm font-medium truncate">{task.description}</p><p className="text-xs text-muted-foreground">{task.task_type} · prioridade {task.priority}{task.due_at ? ` · ${new Date(task.due_at).toLocaleString("pt-BR")}` : ""}</p></div><Button size="sm" variant="outline" onClick={() => void completeTask(task)} disabled={completingTaskId === task.id}>{completingTaskId === task.id ? "Concluindo..." : "Concluir"}</Button></div>)}
        </CardContent>
      </Card>

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por paciente, CPF, telefone ou motivo..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={resultFilter} onValueChange={setResultFilter}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Resultado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {(Object.keys(resultLabels) as CallCenterResult[]).map((s) => <SelectItem key={s} value={s}>{resultLabels[s]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? <EmptyState icon={Phone} title="Nenhum contato" description="Registre o primeiro contato real do call center." /> : (
        <div className="rounded-lg border bg-card overflow-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Paciente</TableHead><TableHead>Canal</TableHead><TableHead>Direção</TableHead><TableHead>Motivo</TableHead><TableHead>Resultado</TableHead><TableHead>Próxima ação</TableHead><TableHead>Observações</TableHead><TableHead>Data</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <p className="font-medium text-sm">{r.patient_name || "Paciente não vinculado"}</p>
                    {r.patient_cpf && <p className="text-[10px] text-muted-foreground">{r.patient_cpf}</p>}
                    {r.patient_phone && <p className="text-[10px] text-muted-foreground">{r.patient_phone}</p>}
                  </TableCell>
                  <TableCell className="text-xs">{channelLabels[r.channel]}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.direction === "inbound" ? "Recebido" : "Ativo"}</TableCell>
                  <TableCell className="text-xs">{r.contact_reason}</TableCell>
                  <TableCell><Badge variant="outline" className={`border-0 text-[10px] ${resultColors[r.result]}`}>{resultLabels[r.result]}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.next_action || "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate">{r.notes || "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString("pt-BR")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <NewContactDialog open={dialogOpen} onOpenChange={setDialogOpen} onCreated={reload} />
    </div>
  );
}

function Stat({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color?: string }) {
  return <Card><CardContent className="p-3 flex items-center gap-2">{icon}<div><p className={`text-lg font-bold ${color || ""}`}>{value}</p><p className="text-[10px] text-muted-foreground">{label}</p></div></CardContent></Card>;
}

interface NewContactDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}

function NewContactDialog({ open, onOpenChange, onCreated }: NewContactDialogProps) {
  const [patientSearch, setPatientSearch] = useState("");
  const [patientResults, setPatientResults] = useState<Patient[]>([]);
  const [patientId, setPatientId] = useState("");
  const [channel, setChannel] = useState<CallCenterChannel>("telefone");
  const [direction, setDirection] = useState<CallCenterDirection>("inbound");
  const [contactReason, setContactReason] = useState("");
  const [result, setResult] = useState<CallCenterResult>("recado");
  const [notes, setNotes] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [nextActionAt, setNextActionAt] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const term = patientSearch.trim();
    if (term.length < 2) {
      setPatientResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const rows = await patientsService.search(term);
        if (!cancelled) setPatientResults(rows.slice(0, 20));
      } catch {
        if (!cancelled) setPatientResults([]);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [patientSearch]);

  const reset = () => {
    setPatientSearch(""); setPatientResults([]); setPatientId("");
    setChannel("telefone"); setDirection("inbound"); setContactReason("");
    setResult("recado"); setNotes(""); setNextAction(""); setNextActionAt("");
  };

  const handleSubmit = async () => {
    if (!patientId) {
      toast({ title: "Paciente obrigatório", description: "Busque e selecione um paciente antes de registrar o contato.", variant: "destructive" });
      return;
    }
    if (!contactReason.trim()) {
      toast({ title: "Motivo obrigatório", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await callCenterService.createContact({
        patient_id: patientId,
        channel,
        direction,
        contact_reason: contactReason,
        result,
        notes,
        next_action: nextAction || null,
        next_action_at: nextActionAt || null,
        create_task: Boolean(nextAction),
      });
      toast({ title: "Contato registrado" });
      reset();
      onOpenChange(false);
      onCreated();
    } catch (err) {
      toast({ title: friendlyError(err, "Registrar contato"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Novo contato</DialogTitle>
          <DialogDescription>Registre canal, motivo, resultado e próxima ação do atendimento.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Paciente *</Label>
            <Input placeholder="Buscar por nome, CPF, telefone ou e-mail" value={patientSearch} onChange={(e) => setPatientSearch(e.target.value)} />
            {patientResults.length > 0 && (
              <Select value={patientId} onValueChange={setPatientId}>
                <SelectTrigger><SelectValue placeholder="Selecione o paciente" /></SelectTrigger>
                <SelectContent>
                  {patientResults.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}{p.cpf ? ` — ${p.cpf}` : ""}{p.phone ? ` — ${p.phone}` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>Canal</Label>
              <Select value={channel} onValueChange={(v) => setChannel(v as CallCenterChannel)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{(Object.keys(channelLabels) as CallCenterChannel[]).map((c) => <SelectItem key={c} value={c}>{channelLabels[c]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Direção</Label>
              <Select value={direction} onValueChange={(v) => setDirection(v as CallCenterDirection)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="inbound">Recebido</SelectItem><SelectItem value="outbound">Ativo</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Resultado</Label>
              <Select value={result} onValueChange={(v) => setResult(v as CallCenterResult)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{(Object.keys(resultLabels) as CallCenterResult[]).map((r) => <SelectItem key={r} value={r}>{resultLabels[r]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Motivo *</Label>
            <Input placeholder="Ex.: marcação de consulta, confirmação, remarcação, retorno de campanha" value={contactReason} onChange={(e) => setContactReason(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Próxima ação</Label>
              <Input placeholder="Ex.: retornar ligação, enviar preparo, confirmar autorização" value={nextAction} onChange={(e) => setNextAction(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Quando</Label>
              <Input type="datetime-local" value={nextActionAt} onChange={(e) => setNextActionAt(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Observações</Label>
            <Textarea placeholder="Resumo objetivo do contato..." rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={saving}>{saving ? "Salvando..." : "Registrar contato"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
