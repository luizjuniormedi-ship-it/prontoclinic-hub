import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarClock, FileText, Search, Stethoscope } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "@/components/StateViews";
import {
  encountersService,
  ENC_STATUS_LABELS,
  type Encounter,
} from "@/services/encountersService";
import { formatDate } from "@/utils/formatters";

const STATUS_OPTIONS = [
  "scheduled",
  "confirmed",
  "waiting",
  "in_progress",
  "completed",
  "cancelled",
  "no_show",
] as const;

const ATTENDANCE_STATUSES = new Set(["confirmed", "waiting", "in_progress"]);

export default function EncountersPage() {
  const navigate = useNavigate();
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEncounters(await encountersService.list({
        status: statusFilter === "all" ? undefined : statusFilter,
      }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    if (!term) return encounters;
    return encounters.filter((encounter) =>
      [encounter.patient_name, encounter.encounter_type]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase("pt-BR").includes(term)),
    );
  }, [encounters, search]);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Atendimentos clínicos"
        description="Agenda assistencial integrada ao prontuário e ao atendimento"
      />

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[220px] max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Buscar atendimentos por paciente ou serviço"
            className="pl-9"
            placeholder="Buscar paciente ou serviço..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[210px]" aria-label="Filtrar atendimentos por status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {STATUS_OPTIONS.map((status) => (
              <SelectItem key={status} value={status}>
                {ENC_STATUS_LABELS[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Stethoscope}
          title="Nenhum atendimento encontrado"
          description="A fila é formada pelos agendamentos da empresa e unidade ativas."
        />
      ) : (
        <div className="overflow-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Paciente</TableHead>
                <TableHead>Serviço</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Horário</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((encounter) => (
                <TableRow key={encounter.id}>
                  <TableCell className="font-medium text-sm">
                    {encounter.patient_name || "Paciente não identificado"}
                  </TableCell>
                  <TableCell className="text-xs">{encounter.encounter_type}</TableCell>
                  <TableCell className="text-xs">
                    {formatDate(encounter.appointment_date)}
                  </TableCell>
                  <TableCell className="text-xs">
                    {encounter.start_time?.slice(0, 5) || "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="border-0 text-[10px]">
                      {ENC_STATUS_LABELS[encounter.status] || encounter.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      {ATTENDANCE_STATUSES.has(encounter.status) && (
                        <Button
                          size="sm"
                          onClick={() => navigate(`/attendance/${encounter.appointment_id}`)}
                        >
                          <CalendarClock className="mr-1 h-3.5 w-3.5" />
                          Abrir atendimento
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigate("/records")}
                      >
                        <FileText className="mr-1 h-3.5 w-3.5" />
                        Prontuário
                      </Button>
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
