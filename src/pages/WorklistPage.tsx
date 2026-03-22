import { useEffect, useState } from "react";
import { ClipboardList, Search, Plus, AlertTriangle, Clock, CheckCircle, XCircle, Send, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState } from "@/components/StateViews";
import { api } from "@/services/api";
import { WorklistItem, WorklistStatus, WorklistPriority, Unit } from "@/types";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/utils/formatters";

const statusLabels: Record<WorklistStatus, string> = {
  solicitado: "Solicitado", agendado: "Agendado", aguardando: "Aguardando",
  em_execucao: "Em Execução", concluido: "Concluído", cancelado: "Cancelado",
  enviado_pacs: "Enviado PACS", laudado: "Laudado",
};
const statusColors: Record<WorklistStatus, string> = {
  solicitado: "bg-muted text-muted-foreground", agendado: "bg-primary/10 text-primary",
  aguardando: "bg-warning/10 text-warning", em_execucao: "bg-success/10 text-success",
  concluido: "bg-muted text-muted-foreground", cancelado: "bg-destructive/10 text-destructive",
  enviado_pacs: "bg-secondary/10 text-secondary", laudado: "bg-primary/10 text-primary",
};
const priorityLabels: Record<WorklistPriority, string> = { normal: "Normal", urgent: "Urgente", emergency: "Emergência" };
const priorityColors: Record<WorklistPriority, string> = { normal: "bg-muted text-muted-foreground", urgent: "bg-warning/10 text-warning", emergency: "bg-destructive/10 text-destructive" };

export default function WorklistPage() {
  const [items, setItems] = useState<WorklistItem[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [unitFilter, setUnitFilter] = useState("all");
  const { toast } = useToast();

  useEffect(() => {
    Promise.all([api.getWorklistItems(), api.getUnits()]).then(([w, u]) => {
      setItems(w); setUnits(u); setLoading(false);
    });
  }, []);

  const filtered = items.filter((w) => {
    const q = search.toLowerCase();
    const matchSearch = !search || w.patientName.toLowerCase().includes(q) || w.examName.toLowerCase().includes(q) || w.requestingDoctorName.toLowerCase().includes(q);
    const matchStatus = statusFilter === "all" || w.status === statusFilter;
    const matchPriority = priorityFilter === "all" || w.priority === priorityFilter;
    const matchUnit = unitFilter === "all" || w.unitId === unitFilter;
    return matchSearch && matchStatus && matchPriority && matchUnit;
  });

  const pending = items.filter((i) => ["solicitado", "agendado", "aguardando"].includes(i.status)).length;
  const inExec = items.filter((i) => i.status === "em_execucao").length;
  const done = items.filter((i) => ["concluido", "enviado_pacs", "laudado"].includes(i.status)).length;

  const handleAction = (item: WorklistItem, action: string) => {
    const statusMap: Record<string, WorklistStatus> = {
      confirm: "agendado", start: "em_execucao", complete: "concluido",
      cancel: "cancelado", send_pacs: "enviado_pacs",
    };
    const newStatus = statusMap[action];
    if (newStatus) {
      setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, status: newStatus } : i));
      toast({ title: `Status atualizado para ${statusLabels[newStatus]}` });
    }
  };

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Worklist" description="Solicitações de exames e procedimentos" actions={
        <Button><Plus className="mr-2 h-4 w-4" />Nova Solicitação</Button>
      } />

      <div className="grid grid-cols-3 gap-2">
        <Card><CardContent className="p-3 flex items-center gap-2"><Clock className="h-4 w-4 text-warning" /><div><p className="text-lg font-bold text-warning">{pending}</p><p className="text-[10px] text-muted-foreground">Pendentes</p></div></CardContent></Card>
        <Card><CardContent className="p-3 flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-success" /><div><p className="text-lg font-bold text-success">{inExec}</p><p className="text-[10px] text-muted-foreground">Em execução</p></div></CardContent></Card>
        <Card><CardContent className="p-3 flex items-center gap-2"><CheckCircle className="h-4 w-4 text-muted-foreground" /><div><p className="text-lg font-bold">{done}</p><p className="text-[10px] text-muted-foreground">Concluídos</p></div></CardContent></Card>
      </div>

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar paciente, exame, solicitante..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {(Object.keys(statusLabels) as WorklistStatus[]).map((s) => <SelectItem key={s} value={s}>{statusLabels[s]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-[120px]"><SelectValue placeholder="Prioridade" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            {(Object.keys(priorityLabels) as WorklistPriority[]).map((p) => <SelectItem key={p} value={p}>{priorityLabels[p]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={unitFilter} onValueChange={setUnitFilter}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Unidade" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            {units.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? <EmptyState icon={ClipboardList} title="Nenhum item na worklist" /> : (
        <div className="rounded-lg border bg-card overflow-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Paciente</TableHead><TableHead>Exame</TableHead><TableHead>Modalidade</TableHead><TableHead>Solicitante</TableHead><TableHead>Unidade</TableHead><TableHead>Data</TableHead><TableHead>Prioridade</TableHead><TableHead>Status</TableHead><TableHead>Ações</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map((w) => (
                <TableRow key={w.id} className={w.priority === "urgent" ? "bg-warning/5" : w.priority === "emergency" ? "bg-destructive/5" : ""}>
                  <TableCell className="font-medium text-sm">{w.patientName}</TableCell>
                  <TableCell className="text-sm">{w.examName}</TableCell>
                  <TableCell><Badge variant="outline" className="border-0 bg-primary/10 text-primary text-[10px]">{w.modality}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{w.requestingDoctorName}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{w.unitName}</TableCell>
                  <TableCell className="text-xs">{formatDate(w.date)}{w.time ? ` ${w.time}` : ""}</TableCell>
                  <TableCell><Badge variant="outline" className={`border-0 text-[10px] ${priorityColors[w.priority]}`}>{priorityLabels[w.priority]}</Badge></TableCell>
                  <TableCell><Badge variant="outline" className={`border-0 text-[10px] ${statusColors[w.status]}`}>{statusLabels[w.status]}</Badge></TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {w.status === "solicitado" && <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => handleAction(w, "confirm")}>Confirmar</Button>}
                      {(w.status === "agendado" || w.status === "aguardando") && <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => handleAction(w, "start")}>Iniciar</Button>}
                      {w.status === "em_execucao" && <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => handleAction(w, "complete")}>Concluir</Button>}
                      {w.status === "concluido" && <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => handleAction(w, "send_pacs")}><Send className="h-3 w-3 mr-1" />PACS</Button>}
                      {!["concluido", "cancelado", "enviado_pacs", "laudado"].includes(w.status) && <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 text-destructive" onClick={() => handleAction(w, "cancel")}><XCircle className="h-3 w-3" /></Button>}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
