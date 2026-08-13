import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardList, Search, Stethoscope } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "@/components/StateViews";
import { encountersService, ENC_STATUS_LABELS, type Encounter } from "@/services/encountersService";
import { formatDate } from "@/utils/formatters";

export default function EncountersPage() {
  const navigate = useNavigate();
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [detail, setDetail] = useState<Encounter | null>(null);
  const canResume = (encounter: Encounter) => Boolean(
    encounter.appointment_id
    && !encounter.signed_at
    && !["assinado", "finalizado", "finalized", "signed", "alta_ambulatorial", "encaminhado", "internado"]
      .includes(encounter.status.toLowerCase()),
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEncounters(await encountersService.list({
        status: statusFilter !== "all" ? statusFilter : undefined,
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar os atendimentos.");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => encounters.filter((encounter) => (
    !search || encounter.patient_name?.toLowerCase().includes(search.toLowerCase())
  )), [encounters, search]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={() => void load()} />;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Prontuário / Atendimentos"
        description="Consulta clínica; registros e assinaturas são feitos no atendimento canônico"
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <div className="relative min-w-0 flex-1 sm:min-w-[240px] sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar paciente..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[190px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {Object.entries(ENC_STATUS_LABELS).map(([key, value]) => (
              <SelectItem key={key} value={key}>{value}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Stethoscope} title="Nenhum atendimento encontrado" />
      ) : (
        <div className="overflow-auto rounded-lg border bg-card">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Paciente</TableHead><TableHead>Tipo</TableHead><TableHead>Status</TableHead>
              <TableHead>Data</TableHead><TableHead>Assinado por</TableHead><TableHead>Ações</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map((encounter) => (
                <TableRow key={encounter.id}>
                  <TableCell className="font-medium text-sm">{encounter.patient_name || "—"}</TableCell>
                  <TableCell className="text-xs">{encounter.encounter_type}</TableCell>
                  <TableCell><Badge variant="outline" className="border-0 text-[10px]">{ENC_STATUS_LABELS[encounter.status] || encounter.status}</Badge></TableCell>
                  <TableCell className="text-xs">{formatDate(encounter.created_at)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{encounter.signed_by_name || "—"}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setDetail(encounter)}>Consultar</Button>
                      {canResume(encounter) ? (
                        <Button size="sm" variant="outline" onClick={() => navigate(`/attendance/${encounter.appointment_id}`)}>
                          Abrir atendimento
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={Boolean(detail)} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-auto">
          <DialogHeader>
            <DialogTitle>{detail?.patient_name} · {detail?.encounter_type}</DialogTitle>
            <DialogDescription>{detail && (ENC_STATUS_LABELS[detail.status] || detail.status)}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Queixa principal</p>
              <p>{detail?.chief_complaint || "Não informada"}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Evolução</p>
              <p className="whitespace-pre-wrap">{detail?.summary || "Não informada"}</p>
            </div>
            <div className="flex items-center gap-2 rounded-md bg-muted p-3 text-xs">
              <ClipboardList className="h-4 w-4" />
              Alterações, diagnósticos e assinatura devem ser realizados pelo atendimento canônico.
            </div>
            {detail && canResume(detail) ? (
              <Button className="w-full sm:w-auto" onClick={() => navigate(`/attendance/${detail.appointment_id}`)}>
                Abrir atendimento canônico
              </Button>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
