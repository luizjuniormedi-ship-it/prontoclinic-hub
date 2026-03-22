import { useEffect, useState } from "react";
import { Monitor, Search, ExternalLink, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState } from "@/components/StateViews";
import { api } from "@/services/api";
import { PACSStudy, PACSStatus, Unit } from "@/types";
import { formatDate } from "@/utils/formatters";

const pacsStatusLabels: Record<PACSStatus, string> = { pending: "Pendente", received: "Recebido", reported: "Laudado", delivered: "Entregue" };
const pacsStatusColors: Record<PACSStatus, string> = {
  pending: "bg-warning/10 text-warning", received: "bg-primary/10 text-primary",
  reported: "bg-success/10 text-success", delivered: "bg-muted text-muted-foreground",
};

export default function PACSPage() {
  const [studies, setStudies] = useState<PACSStudy[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [unitFilter, setUnitFilter] = useState("all");

  useEffect(() => {
    Promise.all([api.getPACSStudies(), api.getUnits()]).then(([p, u]) => {
      setStudies(p); setUnits(u); setLoading(false);
    });
  }, []);

  const filtered = studies.filter((s) => {
    const q = search.toLowerCase();
    const matchSearch = !search || s.patientName.toLowerCase().includes(q) || s.examName.toLowerCase().includes(q) || s.accessionNumber.toLowerCase().includes(q);
    const matchStatus = statusFilter === "all" || s.pacsStatus === statusFilter;
    const matchUnit = unitFilter === "all" || s.unitId === unitFilter;
    return matchSearch && matchStatus && matchUnit;
  });

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="PACS" description="Estudos de imagem e laudos" />

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar paciente, exame, accession number..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[120px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {(Object.keys(pacsStatusLabels) as PACSStatus[]).map((s) => <SelectItem key={s} value={s}>{pacsStatusLabels[s]}</SelectItem>)}
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

      {filtered.length === 0 ? <EmptyState icon={Monitor} title="Nenhum estudo PACS" /> : (
        <div className="rounded-lg border bg-card overflow-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Paciente</TableHead><TableHead>Exame</TableHead><TableHead>Modalidade</TableHead><TableHead>Accession</TableHead><TableHead>Solicitante</TableHead><TableHead>Unidade</TableHead><TableHead>Data</TableHead><TableHead>Status</TableHead><TableHead>Laudo</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium text-sm">{s.patientName}</TableCell>
                  <TableCell className="text-sm">{s.examName}</TableCell>
                  <TableCell><Badge variant="outline" className="border-0 bg-primary/10 text-primary text-[10px]">{s.modality}</Badge></TableCell>
                  <TableCell className="text-xs font-mono">{s.accessionNumber}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{s.requestingDoctorName}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{s.unitName}</TableCell>
                  <TableCell className="text-xs">{formatDate(s.studyDate)}</TableCell>
                  <TableCell><Badge variant="outline" className={`border-0 text-[10px] ${pacsStatusColors[s.pacsStatus]}`}>{pacsStatusLabels[s.pacsStatus]}</Badge></TableCell>
                  <TableCell>
                    {s.reportSummary ? (
                      <span className="text-xs text-muted-foreground max-w-[150px] truncate block" title={s.reportSummary}>{s.reportSummary}</span>
                    ) : <span className="text-xs text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {s.externalLink && (
                        <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => window.open(s.externalLink, "_blank")}>
                          <ExternalLink className="h-3 w-3 mr-1" />Viewer
                        </Button>
                      )}
                      {s.pacsStatus === "reported" && (
                        <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2"><FileText className="h-3 w-3 mr-1" />Laudo</Button>
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
