import { useEffect, useState } from "react";
import { ClipboardList, Search, Plus, AlertTriangle, Clock, CheckCircle, XCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState } from "@/components/StateViews";
import { dicomService, worklistService } from "@/services/dicomService";
import { catalogService } from "@/services/catalogService";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";

const statusLabels: Record<string, string> = {
  pendente: "Solicitado", agendado: "Agendado", em_andamento: "Em Execução",
  concluido: "Concluído", cancelado: "Cancelado", enviado_pacs: "Enviado PACS",
};
const statusColors: Record<string, string> = {
  pendente: "bg-muted text-muted-foreground", agendado: "bg-primary/10 text-primary",
  em_andamento: "bg-success/10 text-success", concluido: "bg-muted text-muted-foreground",
  cancelado: "bg-destructive/10 text-destructive", enviado_pacs: "bg-secondary/10 text-secondary",
};
const modalityLabels: Record<string, string> = {
  CR: "RX", CT: "TC", MR: "RM", US: "US", XA: "XA", MG: "MG", NM: "MN", PT: "PT",
};

export default function WorklistPage() {
  const [items, setItems] = useState<Array<{
    id: number;
    patientName: string;
    examName: string;
    modality: string;
    requestingDoctorName: string;
    unitName: string;
    scheduledAt: string;
    priority: string;
    status: string;
  }>>([]);
  const [units, setUnits] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [unitFilter, setUnitFilter] = useState("all");
  const { toast } = useToast();

  const load = async () => {
    setLoading(true);
    try {
      const [raw, u] = await Promise.all([
        worklistService.list(),
        catalogService.units.getAll(),
      ]);
      const unitMap = new Map(u.map((unit) => [String(unit.id), unit.name]));
      // Mapear para estrutura flat com campos derivados
      const mapped = await Promise.all(raw.map(async (r) => {
        // Tenta enriquecer com nome do paciente se houver patient_id
        let patientName = "—";
        if (r.cd_patient) {
          const { data: p } = await supabase
            .from("patients")
            .select("full_name")
            .eq("id", r.cd_patient)
            .maybeSingle();
          if (p) patientName = p.full_name;
        }
        return {
          id: Number(r.id),
          patientName,
          examName: r.ds_procedure ?? "—",
          modality: r.modality ?? "—",
          requestingDoctorName: r.requesting_physician ?? "—",
          unitName: r.cd_unit ? unitMap.get(String(r.cd_unit)) ?? "—" : "—",
          scheduledAt: r.scheduled_at ?? r.created_at,
          priority: r.priority ?? "normal",
          status: r.status ?? "pendente",
        };
      }));
      setItems(mapped);
      setUnits(u.map((unit) => ({ id: unit.id, name: unit.name })));
    } catch (err) {
      console.error("Erro ao carregar worklist:", err);
      toast({ title: "Erro ao carregar worklist", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const handleAction = async (id: number, action: string) => {
    try {
      const statusMap: Record<string, string> = {
        confirm: "agendado", start: "em_andamento", complete: "concluido",
        cancel: "cancelado", send_pacs: "enviado_pacs",
      };
      const newStatus = statusMap[action];
      if (!newStatus) return;
      await worklistService.update(id, { status: newStatus });
      toast({ title: `Status atualizado para ${statusLabels[newStatus]}` });
      void load();
    } catch (err) {
      toast({ title: "Erro ao atualizar", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  };

  const filtered = items.filter((w) => {
    const q = search.toLowerCase();
    const matchSearch = !search || w.patientName.toLowerCase().includes(q) || w.examName.toLowerCase().includes(q) || w.requestingDoctorName.toLowerCase().includes(q);
    const matchStatus = statusFilter === "all" || w.status === statusFilter;
    const matchPriority = priorityFilter === "all" || w.priority === priorityFilter;
    const matchUnit = unitFilter === "all" || w.unitName === unitFilter;
    return matchSearch && matchStatus && matchPriority && matchUnit;
  });

  const pending = items.filter((i) => ["pendente", "agendado"].includes(i.status)).length;
  const inExec = items.filter((i) => i.status === "em_andamento").length;
  const done = items.filter((i) => ["concluido", "enviado_pacs"].includes(i.status)).length;

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Worklist" description="Solicitações de exames DICOM (Integração PACS)" actions={
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
            {Object.entries(statusLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-[120px]"><SelectValue placeholder="Prioridade" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="normal">Normal</SelectItem>
            <SelectItem value="urgent">Urgente</SelectItem>
            <SelectItem value="emergency">Emergência</SelectItem>
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

      {filtered.length === 0 ? <EmptyState icon={ClipboardList} title="Nenhum item na worklist" description="Itens aparecerão aqui quando exames forem agendados." /> : (
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
                  <TableCell><Badge variant="outline" className="border-0 bg-primary/10 text-primary text-[10px]">{modalityLabels[w.modality] ?? w.modality}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{w.requestingDoctorName}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{w.unitName}</TableCell>
                  <TableCell className="text-xs">{w.scheduledAt ? new Date(w.scheduledAt).toLocaleDateString("pt-BR") : "—"}</TableCell>
                  <TableCell><Badge variant="outline" className={`border-0 text-[10px] ${w.priority === "urgent" ? "bg-warning/10 text-warning" : w.priority === "emergency" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}>{w.priority}</Badge></TableCell>
                  <TableCell><Badge variant="outline" className={`border-0 text-[10px] ${statusColors[w.status] ?? ""}`}>{statusLabels[w.status] ?? w.status}</Badge></TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {w.status === "pendente" && <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => void handleAction(w.id, "confirm")}>Confirmar</Button>}
                      {w.status === "agendado" && <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => void handleAction(w.id, "start")}>Iniciar</Button>}
                      {w.status === "em_andamento" && <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => void handleAction(w.id, "complete")}>Concluir</Button>}
                      {w.status === "concluido" && <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => void handleAction(w.id, "send_pacs")}><Send className="h-3 w-3 mr-1" />PACS</Button>}
                      {!["concluido", "cancelado", "enviado_pacs"].includes(w.status) && <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 text-destructive" onClick={() => void handleAction(w.id, "cancel")}><XCircle className="h-3 w-3" /></Button>}
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