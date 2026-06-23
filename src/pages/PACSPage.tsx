/**
 * PACSPage — Lista de exames de imagem recebidos do servidor PACS (Orthanc).
 *
 * Migration: 000009_dicom.sql
 * Service:  src/services/dicomService.ts (examService + reportService)
 *
 * Tabela com filtros simples (status, busca textual).
 * Detalhe do estudo mostra metadados, link para visualizador e laudo vinculado.
 */

import { useEffect, useState } from "react";
import { Monitor, Search, Eye, FileText, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState } from "@/components/StateViews";
import {
  examService,
  reportService,
  type DicomExam,
  type DicomReport,
  type DicomExamStatus,
} from "@/services/dicomService";
import { toast } from "@/hooks/use-toast";
import { formatDate } from "@/utils/formatters";

const STATUS_LABELS: Record<DicomExamStatus, string> = {
  AGENDADO: "Agendado",
  EM_ANDAMENTO: "Em andamento",
  REALIZADO: "Realizado",
  IMAGEM_RECEBIDA: "Imagem recebida",
  LAUDANDO: "Laudando",
  LAUDO_LIBERADO: "Laudo liberado",
  CANCELADO: "Cancelado",
};

const STATUS_COLORS: Record<string, string> = {
  AGENDADO: "bg-warning/10 text-warning",
  EM_ANDAMENTO: "bg-primary/10 text-primary",
  REALIZADO: "bg-success/10 text-success",
  IMAGEM_RECEBIDA: "bg-success/10 text-success",
  LAUDANDO: "bg-primary/10 text-primary",
  LAUDO_LIBERADO: "bg-success/10 text-success",
  CANCELADO: "bg-muted text-muted-foreground",
};

export default function PACSPage() {
  const [studies, setStudies] = useState<DicomExam[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<DicomExamStatus | "all">("all");
  const [selectedStudy, setSelectedStudy] = useState<DicomExam | null>(null);
  const [report, setReport] = useState<DicomReport | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const load = () => {
    setLoading(true);
    examService
      .list({ status: statusFilter !== "all" ? statusFilter : undefined })
      .then((data) => setStudies(data as unknown as DicomExam[]))
      .catch(() =>
        toast({ title: "Erro ao carregar estudos PACS", variant: "destructive" }),
      )
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const openDetail = async (study: DicomExam) => {
    setSelectedStudy(study);
    setReport(null);
    if (study.id) {
      try {
        const reports = await reportService.list({
          // Filtro genérico; em produção, queremos buscar pelo ID do exame (study)
          company_id: study.company_id,
        });
        const linked = reports.find(
          (r) => (r as unknown as { cd_dicom_exame?: number }).cd_dicom_exame === study.id,
        );
        setReport(linked || null);
      } catch {
        setReport(null);
      }
    }
    setDetailOpen(true);
  };

  const filtered = studies.filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      s.ds_patient_name?.toLowerCase().includes(q) ||
      s.cd_dicom_exame?.toLowerCase().includes(q) ||
      s.ds_exame?.toLowerCase().includes(q)
    );
  });

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="PACS - Estudos de Imagem"
        description="Estudos recebidos e armazenados no servidor PACS"
      />

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar paciente, Study UID ou exame..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as DicomExamStatus | "all")}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {(Object.keys(STATUS_LABELS) as DicomExamStatus[]).map((k) => (
              <SelectItem key={k} value={k}>
                {STATUS_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Monitor}
          title="Nenhum estudo PACS encontrado"
          description="Estudos aparecerão aqui quando forem recebidos do servidor PACS (Orthanc)."
        />
      ) : (
        <div className="rounded-lg border bg-card overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Paciente</TableHead>
                <TableHead>Modalidade</TableHead>
                <TableHead>Study UID</TableHead>
                <TableHead>Estação</TableHead>
                <TableHead>Exame</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium text-sm">
                    {s.ds_patient_name || "—"}
                  </TableCell>
                  <TableCell>
                    {s.ds_modality && (
                      <Badge variant="outline" className="border-0 bg-primary/10 text-primary text-[10px]">
                        {s.ds_modality}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-[10px] text-muted-foreground max-w-[140px] truncate" title={s.cd_dicom_exame}>
                    {s.cd_dicom_exame}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {s.ds_ae_title || "—"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {s.ds_exame || "—"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {s.dt_exame ? formatDate(s.dt_exame) : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`border-0 text-[10px] ${STATUS_COLORS[s.ds_status] ?? ""}`}
                    >
                      {STATUS_LABELS[s.ds_status] ?? s.ds_status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-[10px]"
                      onClick={() => void openDetail(s)}
                    >
                      <Eye className="h-3 w-3 mr-1" />
                      Detalhes
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
          <DialogHeader>
            <DialogTitle>Estudo PACS</DialogTitle>
          </DialogHeader>
          {selectedStudy && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Paciente:</span>{" "}
                  <strong>{selectedStudy.ds_patient_name}</strong>
                </div>
                <div>
                  <span className="text-muted-foreground">Modalidade:</span>{" "}
                  {selectedStudy.ds_modality || "—"}
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">Study Instance UID:</span>{" "}
                  <span className="font-mono text-xs break-all">
                    {selectedStudy.cd_dicom_exame}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Estação (AE-Title):</span>{" "}
                  <span className="font-mono">{selectedStudy.ds_ae_title || "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Nº de imagens:</span>{" "}
                  {selectedStudy.nr_images}
                </div>
                <div>
                  <span className="text-muted-foreground">Data do Exame:</span>{" "}
                  {selectedStudy.dt_exame ? formatDate(selectedStudy.dt_exame) : "—"}
                </div>
                <div>
                  <span className="text-muted-foreground">Status:</span>{" "}
                  <Badge
                    variant="outline"
                    className={`border-0 text-[10px] ${STATUS_COLORS[selectedStudy.ds_status] ?? ""}`}
                  >
                    {STATUS_LABELS[selectedStudy.ds_status] ?? selectedStudy.ds_status}
                  </Badge>
                </div>
              </div>

              {/* Viewer placeholder */}
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                <ExternalLink className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>Visualizador DICOM</p>
                <p className="text-xs mt-1">
                  Integração com OHIF Viewer / Stone Web Viewer será configurada aqui
                </p>
                <p className="text-xs font-mono mt-2">
                  wado-rs://orthanc/studies/{selectedStudy.cd_dicom_exame}
                </p>
              </div>

              {/* Report section */}
              <div className="rounded-lg border p-4">
                <h4 className="text-sm font-semibold flex items-center gap-2 mb-2">
                  <FileText className="h-4 w-4" />
                  Laudo
                </h4>
                {report ? (
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Status:</span>{" "}
                      <Badge variant="outline" className="text-[10px]">
                        {report.tp_status}
                      </Badge>
                    </div>
                    {report.ds_laudo && (
                      <div className="whitespace-pre-wrap text-xs bg-muted/50 rounded p-3 mt-2">
                        {report.ds_laudo}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Nenhum laudo vinculado a este estudo.
                  </p>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}