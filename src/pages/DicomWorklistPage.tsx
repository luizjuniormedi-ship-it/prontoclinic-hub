import { useEffect, useState } from "react";
import { ClipboardList, Search, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState } from "@/components/StateViews";
import { worklistQueueService } from "@/services/dicomService";
import type { DicomWorklistItem } from "@/types/dicom";
import { toast } from "@/hooks/use-toast";
import { formatDate } from "@/utils/formatters";

const statusLabels: Record<string, string> = { pending: 'Pendente', exported: 'Exportado', acquired: 'Adquirido', cancelled: 'Cancelado' };
const statusColors: Record<string, string> = { pending: 'bg-warning/10 text-warning', exported: 'bg-primary/10 text-primary', acquired: 'bg-success/10 text-success', cancelled: 'bg-muted text-muted-foreground' };

export default function DicomWorklistPage() {
  const [items, setItems] = useState<DicomWorklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const load = () => {
    setLoading(true);
    worklistQueueService.list({ status: statusFilter !== 'all' ? statusFilter : undefined })
      .then(setItems)
      .catch(() => toast({ title: "Erro ao carregar worklist", variant: "destructive" }))
      .finally(() => setLoading(false));
  };

  useEffect(load, [statusFilter]);

  const markExported = async (id: string) => {
    try {
      await worklistQueueService.markExported(id);
      toast({ title: "Marcado como exportado" });
      load();
    } catch { toast({ title: "Erro", variant: "destructive" }); }
  };

  const cancel = async (id: string) => {
    try {
      await worklistQueueService.cancel(id);
      toast({ title: "Item cancelado da worklist" });
      load();
    } catch { toast({ title: "Erro", variant: "destructive" }); }
  };

  const filtered = items.filter(i => {
    if (!search) return true;
    const q = search.toLowerCase();
    return i.patient_name.toLowerCase().includes(q) || i.accession_number.toLowerCase().includes(q);
  });

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="DICOM Worklist Queue" description="Itens de worklist prontos para as modalidades consultarem" actions={<Button variant="outline" onClick={load}><RefreshCw className="h-4 w-4 mr-2" />Atualizar</Button>} />

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar paciente ou accession..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {Object.entries(statusLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? <EmptyState icon={ClipboardList} title="Worklist vazia" /> : (
        <div className="rounded-lg border bg-card overflow-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Paciente</TableHead><TableHead>ID</TableHead><TableHead>Accession</TableHead>
              <TableHead>Exame</TableHead><TableHead>Modalidade</TableHead><TableHead>AE Title</TableHead>
              <TableHead>Data/Hora</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="font-medium text-sm">{i.patient_name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{i.patient_identifier || '—'}</TableCell>
                  <TableCell className="font-mono text-xs">{i.accession_number}</TableCell>
                  <TableCell className="text-sm">{i.requested_procedure_description || '—'}</TableCell>
                  <TableCell><Badge variant="outline" className="border-0 bg-primary/10 text-primary text-[10px]">{i.modality_type}</Badge></TableCell>
                  <TableCell className="font-mono text-xs">{i.scheduled_station_aetitle || '—'}</TableCell>
                  <TableCell className="text-xs">{i.scheduled_datetime ? formatDate(i.scheduled_datetime) : '—'}</TableCell>
                  <TableCell><Badge variant="outline" className={`border-0 text-[10px] ${statusColors[i.status]}`}>{statusLabels[i.status]}</Badge></TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {i.status === 'pending' && (
                        <>
                          <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => markExported(i.id)}>Exportar</Button>
                          <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 text-destructive" onClick={() => cancel(i.id)}>Cancelar</Button>
                        </>
                      )}
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
