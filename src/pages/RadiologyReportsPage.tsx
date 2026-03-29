import { useEffect, useState } from "react";
import { FileText, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState } from "@/components/StateViews";
import { radiologyReportsService } from "@/services/dicomService";
import type { RadiologyReport, RadiologyReportStatus } from "@/types/dicom";
import { toast } from "@/hooks/use-toast";
import { formatDate } from "@/utils/formatters";

const statusLabels: Record<RadiologyReportStatus, string> = { draft: 'Rascunho', preliminary: 'Preliminar', final: 'Final', amended: 'Retificado', cancelled: 'Cancelado' };
const statusColors: Record<RadiologyReportStatus, string> = { draft: 'bg-muted text-muted-foreground', preliminary: 'bg-warning/10 text-warning', final: 'bg-success/10 text-success', amended: 'bg-primary/10 text-primary', cancelled: 'bg-destructive/10 text-destructive' };

export default function RadiologyReportsPage() {
  const [reports, setReports] = useState<RadiologyReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<RadiologyReport | null>(null);
  const [form, setForm] = useState({ report_text: '', impression: '', radiologist_name: '' });

  const load = () => {
    setLoading(true);
    radiologyReportsService.list({ status: statusFilter !== 'all' ? statusFilter : undefined })
      .then(setReports)
      .catch(() => toast({ title: "Erro ao carregar laudos", variant: "destructive" }))
      .finally(() => setLoading(false));
  };

  useEffect(load, [statusFilter]);

  const openEdit = (r: RadiologyReport) => {
    setEditing(r);
    setForm({ report_text: r.report_text || '', impression: r.impression || '', radiologist_name: r.radiologist_name || '' });
    setDialogOpen(true);
  };

  const save = async () => {
    if (!editing) return;
    try {
      await radiologyReportsService.update(editing.id, {
        report_text: form.report_text,
        impression: form.impression,
        radiologist_name: form.radiologist_name,
      });
      toast({ title: "Laudo atualizado" });
      setDialogOpen(false);
      load();
    } catch { toast({ title: "Erro ao salvar", variant: "destructive" }); }
  };

  const signReport = async (id: string) => {
    const name = prompt("Nome do radiologista para assinatura:");
    if (!name) return;
    try {
      await radiologyReportsService.sign(id, name);
      toast({ title: "Laudo assinado" });
      load();
    } catch { toast({ title: "Erro ao assinar", variant: "destructive" }); }
  };

  const filtered = reports.filter(r => {
    if (!search) return true;
    const q = search.toLowerCase();
    return r.patient_name?.toLowerCase().includes(q) || r.radiologist_name?.toLowerCase().includes(q);
  });

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Laudos Radiológicos" description="Laudos de exames de imagem" />

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar paciente ou radiologista..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {Object.entries(statusLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? <EmptyState icon={FileText} title="Nenhum laudo encontrado" /> : (
        <div className="rounded-lg border bg-card overflow-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Paciente</TableHead><TableHead>Radiologista</TableHead><TableHead>Impressão</TableHead>
              <TableHead>Status</TableHead><TableHead>Assinado</TableHead><TableHead>Data</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium text-sm">{r.patient_name || '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.radiologist_name || '—'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{r.impression || '—'}</TableCell>
                  <TableCell><Badge variant="outline" className={`border-0 text-[10px] ${statusColors[r.status]}`}>{statusLabels[r.status]}</Badge></TableCell>
                  <TableCell className="text-xs">{r.signed_at ? formatDate(r.signed_at) : '—'}</TableCell>
                  <TableCell className="text-xs">{formatDate(r.created_at)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => openEdit(r)}>Editar</Button>
                      {(r.status === 'draft' || r.status === 'preliminary') && (
                        <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => signReport(r.id)}>Assinar</Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Editar Laudo</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div><Label>Radiologista</Label><Input value={form.radiologist_name} onChange={(e) => setForm({ ...form, radiologist_name: e.target.value })} /></div>
            <div><Label>Texto do Laudo</Label><Textarea rows={8} value={form.report_text} onChange={(e) => setForm({ ...form, report_text: e.target.value })} /></div>
            <div><Label>Impressão / Conclusão</Label><Textarea rows={3} value={form.impression} onChange={(e) => setForm({ ...form, impression: e.target.value })} /></div>
          </div>
          <DialogFooter><Button onClick={save}>Salvar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
