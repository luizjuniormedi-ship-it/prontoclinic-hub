import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, FileClock, LockKeyhole, Search, Stethoscope } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "@/components/StateViews";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { ENC_STATUS_LABELS, encountersService, type Encounter, type EncounterStatus } from "@/services/encountersService";
import { formatDate } from "@/utils/formatters";

const statusEntries = Object.entries(ENC_STATUS_LABELS) as Array<[EncounterStatus, string]>;

function SignatureState({ encounter }: { encounter: Encounter }) {
  if (encounter.status === "legacy_locked") {
    return (
      <div className="flex items-start gap-2 rounded border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
        <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />
        <span>Registro legado bloqueado. Não há assinatura digital canônica associada.</span>
      </div>
    );
  }

  if (encounter.status === "signed") {
    return (
      <div className="flex items-start gap-2 rounded border border-success/30 bg-success/10 p-3 text-sm text-success">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Registro assinado
          {encounter.signed_by_name ? ` por ${encounter.signed_by_name}` : ""}
          {encounter.signed_at ? ` em ${formatDate(encounter.signed_at)}` : ""}.
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 rounded border bg-muted/40 p-3 text-sm text-muted-foreground">
      <FileClock className="mt-0.5 h-4 w-4 shrink-0" />
      <span>Registro em rascunho. Esta tela é somente leitura.</span>
    </div>
  );
}

export default function EncountersPage() {
  const { toast } = useToast();
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openingEncounterId, setOpeningEncounterId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [detail, setDetail] = useState<Encounter | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    encountersService.list({ status: statusFilter === "all" ? undefined : statusFilter })
      .then(setEncounters)
      .catch((error: unknown) => {
        setLoadError(error instanceof Error ? error.message : "Não foi possível carregar os atendimentos.");
      })
      .finally(() => setLoading(false));
  }, [statusFilter]);

  useEffect(load, [load]);

  const openDetail = async (encounterId: string) => {
    setOpeningEncounterId(encounterId);
    try {
      const encounter = await encountersService.get(encounterId);
      if (!encounter) throw new Error("Atendimento não encontrado.");
      setDetail(encounter);
    } catch (error) {
      toast({
        title: "Erro ao abrir prontuário",
        description: error instanceof Error ? error.message : "Não foi possível carregar o atendimento.",
        variant: "destructive",
      });
    } finally {
      setOpeningEncounterId(null);
    }
  };

  const normalizedSearch = search.trim().toLocaleLowerCase("pt-BR");
  const filtered = encounters.filter((encounter) =>
    !normalizedSearch || (encounter.patient_name || "").toLocaleLowerCase("pt-BR").includes(normalizedSearch));

  if (loading) return <LoadingState message="Carregando atendimentos..." />;
  if (loadError) return <ErrorState message={loadError} onRetry={load} />;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Prontuário / Atendimentos" description="Consulta clínica somente leitura" />

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[200px] max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Buscar paciente"
            placeholder="Buscar paciente..."
            className="pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[190px]" aria-label="Filtrar por status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {statusEntries.map(([status, label]) => <SelectItem key={status} value={status}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Stethoscope} title="Nenhum atendimento encontrado" />
      ) : (
        <div className="overflow-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Paciente</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Assinatura</TableHead>
                <TableHead><span className="sr-only">Ações</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((encounter) => (
                <TableRow key={encounter.id}>
                  <TableCell className="text-sm font-medium">{encounter.patient_name || "—"}</TableCell>
                  <TableCell className="text-xs">{encounter.encounter_type || "Atendimento clínico"}</TableCell>
                  <TableCell><Badge variant="outline" className="border-0 text-[10px]">{ENC_STATUS_LABELS[encounter.status]}</Badge></TableCell>
                  <TableCell className="text-xs">{formatDate(encounter.created_at)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {encounter.status === "signed" ? encounter.signed_by_name || "Assinado" : "—"}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      disabled={openingEncounterId === encounter.id}
                      onClick={() => void openDetail(encounter.id)}
                    >
                      {openingEncounterId === encounter.id ? "Carregando..." : "Abrir"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={Boolean(detail)} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-auto">
          <DialogHeader>
            <DialogTitle>{detail?.patient_name || "Paciente não identificado"}</DialogTitle>
            <DialogDescription>
              {detail?.encounter_type || "Atendimento clínico"}
              {detail ? ` · ${ENC_STATUS_LABELS[detail.status]}` : ""}
            </DialogDescription>
          </DialogHeader>

          {detail && (
            <div className="space-y-4">
              <SignatureState encounter={detail} />
              <div>
                <Label className="text-xs text-muted-foreground">Queixa principal</Label>
                <p className="mt-1 whitespace-pre-wrap text-sm">{detail.chief_complaint || "—"}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Evolução</Label>
                <p className="mt-1 whitespace-pre-wrap text-sm">{detail.summary || "—"}</p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

