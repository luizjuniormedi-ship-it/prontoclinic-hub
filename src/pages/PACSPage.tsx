import { useEffect, useState } from "react";
import { Monitor, Search, Eye, FileText, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState } from "@/components/StateViews";
import { pacsStudiesService, radiologyReportsService } from "@/services/dicomService";
import type { PacsStudy, RadiologyReport } from "@/types/dicom";
import { toast } from "@/hooks/use-toast";
import { formatDate } from "@/utils/formatters";

const statusLabels: Record<string, string> = { pending: 'Pendente', received: 'Recebido', reported: 'Laudado', delivered: 'Entregue' };
const statusColors: Record<string, string> = {
  pending: 'bg-warning/10 text-warning', received: 'bg-primary/10 text-primary',
  reported: 'bg-success/10 text-success', delivered: 'bg-muted text-muted-foreground',
};

export default function PACSPage() {
  const [studies, setStudies] = useState<PacsStudy[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedStudy, setSelectedStudy] = useState<PacsStudy | null>(null);
  const [report, setReport] = useState<RadiologyReport | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const load = () => {
    setLoading(true);
    pacsStudiesService.list({ status: statusFilter !== 'all' ? statusFilter : undefined })
      .then(setStudies)
      .catch(() => toast({ title: "Erro ao carregar estudos PACS", variant: "destructive" }))
      .finally(() => setLoading(false));
  };

  useEffect(load, [statusFilter]);

  const openDetail = async (study: PacsStudy) => {
    setSelectedStudy(study);
    setReport(null);
    // Try to find linked report
    if (study.id) {
      const reports = await radiologyReportsService.list({ patient_id: study.patient_id });
      const linked = reports.find(r => r.pacs_study_id === study.id || r.study_instance_uid === study.study_instance_uid);
      setReport(linked || null);
    }
    setDetailOpen(true);
  };

  const filtered = studies.filter(s => {
    if (!search) return true;
    const q = search.toLowerCase();
    return s.patient_name?.toLowerCase().includes(q) || s.accession_number?.toLowerCase().includes(q) || s.study_instance_uid.toLowerCase().includes(q);
  });

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="PACS - Estudos de Imagem" description="Estudos recebidos e armazenados no servidor PACS" />

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar paciente, accession ou UID..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[130px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {Object.entries(statusLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? <EmptyState icon={Monitor} title="Nenhum estudo PACS encontrado" description="Estudos aparecerão aqui quando forem recebidos do servidor PACS." /> : (
        <div className="rounded-lg border bg-card overflow-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Paciente</TableHead>
              <TableHead>Modalidade</TableHead>
              <TableHead>Accession</TableHead>
              <TableHead>Study UID</TableHead>
              <TableHead>Estação</TableHead>
              <TableHead>Data</TableHead>
              <TableHead>Recebido</TableHead>
              <TableHead>Status</TableHead>
              <TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium text-sm">{s.patient_name || '—'}</TableCell>
                  <TableCell>
                    {s.modality_type && <Badge variant="outline" className="border-0 bg-primary/10 text-primary text-[10px]">{s.modality_type}</Badge>}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{s.accession_number || '—'}</TableCell>
                  <TableCell className="font-mono text-[10px] text-muted-foreground max-w-[140px] truncate" title={s.study_instance_uid}>{s.study_instance_uid}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{s.station_aetitle || '—'}</TableCell>
                  <TableCell className="text-xs">{s.study_date ? formatDate(s.study_date) : '—'}</TableCell>
                  <TableCell className="text-xs">{s.received_at ? formatDate(s.received_at) : '—'}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`border-0 text-[10px] ${statusColors[s.pacs_status] || ''}`}>
                      {statusLabels[s.pacs_status] || s.pacs_status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => openDetail(s)}>
                      <Eye className="h-3 w-3 mr-1" />Detalhes
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Estudo PACS</DialogTitle></DialogHeader>
          {selectedStudy && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Paciente:</span> <strong>{selectedStudy.patient_name}</strong></div>
                <div><span className="text-muted-foreground">Modalidade:</span> {selectedStudy.modality_type || '—'}</div>
                <div><span className="text-muted-foreground">Accession:</span> <span className="font-mono">{selectedStudy.accession_number || '—'}</span></div>
                <div><span className="text-muted-foreground">Estação:</span> <span className="font-mono">{selectedStudy.station_aetitle || '—'}</span></div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">Study Instance UID:</span>
                  <span className="font-mono text-xs ml-1 break-all">{selectedStudy.study_instance_uid}</span>
                </div>
                <div><span className="text-muted-foreground">Data do Estudo:</span> {selectedStudy.study_date ? formatDate(selectedStudy.study_date) : '—'}</div>
                <div><span className="text-muted-foreground">Recebido em:</span> {selectedStudy.received_at ? formatDate(selectedStudy.received_at) : '—'}</div>
                <div>
                  <span className="text-muted-foreground">Status:</span>{' '}
                  <Badge variant="outline" className={`border-0 text-[10px] ${statusColors[selectedStudy.pacs_status]}`}>
                    {statusLabels[selectedStudy.pacs_status]}
                  </Badge>
                </div>
              </div>

              {/* Viewer placeholder */}
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                <ExternalLink className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>Visualizador DICOM</p>
                <p className="text-xs mt-1">Integração com OHIF Viewer / Stone Web Viewer será configurada aqui</p>
                <p className="text-xs font-mono mt-2">wado-rs://pacs-server/studies/{selectedStudy.study_instance_uid}</p>
              </div>

              {/* Report section */}
              <div className="rounded-lg border p-4">
                <h4 className="text-sm font-semibold flex items-center gap-2 mb-2"><FileText className="h-4 w-4" />Laudo</h4>
                {report ? (
                  <div className="space-y-2 text-sm">
                    <div><span className="text-muted-foreground">Status:</span> <Badge variant="outline" className="text-[10px]">{report.status}</Badge></div>
                    {report.radiologist_name && <div><span className="text-muted-foreground">Radiologista:</span> {report.radiologist_name}</div>}
                    {report.impression && <div><span className="text-muted-foreground">Impressão:</span> {report.impression}</div>}
                    {report.report_text && <div className="whitespace-pre-wrap text-xs bg-muted/50 rounded p-3 mt-2">{report.report_text}</div>}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Nenhum laudo vinculado a este estudo.</p>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
