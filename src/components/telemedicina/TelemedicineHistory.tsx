/**
 * TelemedicineHistory — Histórico de consultas de telemedicina
 *
 * Lista todas as salas com filtros (período, status, médico, paciente).
 * Para cada sala:
 *   - Status, duração, métricas de qualidade
 *   - Receita digital linkada (se houver)
 *   - Player de gravação (se houver URL)
 *   - Log de participantes
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Download, ExternalLink, Filter } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { telemedicinaService, type TelemedReceita, type TelemedSala } from "@/services/telemedicinaService";
import { formatDate } from "@/utils/formatters";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

interface SalaComRelacoes extends TelemedSala {
  paciente?: { full_name?: string | null; cpf?: string | null } | null;
  medico?: { full_name?: string | null; crm?: string | null } | null;
  receita?: TelemedReceita | null;
}

interface TelemedicineHistoryProps {
  companyId: string;
  pacientes?: { id: number; full_name: string }[];
  medicos?: { id: number; full_name: string }[];
}

function formatarStatus(status: string) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    AGUARDANDO: { label: "Aguardando", variant: "outline" },
    EM_ANDAMENTO: { label: "Em andamento", variant: "default" },
    FINALIZADA: { label: "Finalizada", variant: "secondary" },
    CANCELADA: { label: "Cancelada", variant: "destructive" },
    FALHOU: { label: "Falhou", variant: "destructive" },
  };
  return map[status] ?? { label: status, variant: "outline" };
}

export function TelemedicineHistory({
  companyId,
  pacientes = [],
  medicos = [],
}: TelemedicineHistoryProps) {
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState<string>("todos");
  const [pacienteFiltro, setPacienteFiltro] = useState<string>("todos");
  const [medicoFiltro, setMedicoFiltro] = useState<string>("todos");
  const [inicio, setInicio] = useState<string>(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [fim, setFim] = useState<string>(() => new Date().toISOString().slice(0, 10));

  const { data, isLoading } = useQuery({
    queryKey: ["telemedicina-historico", companyId, status, pacienteFiltro, medicoFiltro, inicio, fim],
    enabled: Boolean(companyId),
    queryFn: async (): Promise<SalaComRelacoes[]> => {
      let q = supabase
        .from("telemedicina_salas")
        .select(`
          *,
          paciente:patients!telemedicina_salas_cd_paciente_fkey(full_name, cpf),
          medico:professionals!telemedicina_salas_cd_medico_fkey(full_name, crm),
          receita:telemedicina_receitas(*)
        `)
        .eq("company_id", companyId)
        .gte("dt_criacao", inicio)
        .lte("dt_criacao", fim + "T23:59:59")
        .order("dt_criacao", { ascending: false })
        .limit(500);
      if (status !== "todos") q = q.eq("tp_status", status);
      if (pacienteFiltro !== "todos") q = q.eq("cd_paciente", Number(pacienteFiltro));
      if (medicoFiltro !== "todos") q = q.eq("cd_medico", Number(medicoFiltro));

      const { data: rows, error } = await q;
      if (error) throw error;

      // Filtra receita para a sala correspondente
      return (rows ?? []).map((r) => {
        const receita = Array.isArray(r.receita) ? r.receita[0] : r.receita;
        return { ...r, receita } as SalaComRelacoes;
      });
    },
  });

  const rows = useMemo(() => {
    if (!data) return [];
    const q = busca.toLowerCase().trim();
    if (!q) return data;
    return data.filter(
      (r) =>
        r.ds_sala_daily?.toLowerCase().includes(q) ||
        r.paciente?.full_name?.toLowerCase().includes(q) ||
        r.medico?.full_name?.toLowerCase().includes(q),
    );
  }, [data, busca]);

  function exportCsv() {
    if (!rows.length) return;
    const header = ["Data", "Paciente", "Médico", "Status", "Duração (s)", "Latência (ms)", "Packet Loss (%)", "Gravação", "Receita"];
    const csv = [
      header.join(","),
      ...rows.map((r) =>
        [
          r.dt_criacao,
          r.paciente?.full_name ?? "",
          r.medico?.full_name ?? "",
          r.tp_status,
          r.duracao_segundos ?? "",
          r.vl_latencia_media ?? "",
          r.vl_packet_loss ?? "",
          r.ds_url_gravacao ? "sim" : "não",
          r.receita?.id ?? "",
        ]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(","),
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `telemedicina-historico-${inicio}_a_${fim}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Histórico de Telemedicina</CardTitle>
        <CardDescription>
          {rows.length} consulta{rows.length === 1 ? "" : "s"} no período.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
          <div className="space-y-1">
            <Label htmlFor="busca" className="text-xs">Busca</Label>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input id="busca" className="pl-7" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome, sala…" />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ini" className="text-xs">De</Label>
            <Input id="ini" type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="fim" className="text-xs">Até</Label>
            <Input id="fim" type="date" value={fim} onChange={(e) => setFim(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="AGUARDANDO">Aguardando</SelectItem>
                <SelectItem value="EM_ANDAMENTO">Em andamento</SelectItem>
                <SelectItem value="FINALIZADA">Finalizada</SelectItem>
                <SelectItem value="CANCELADA">Cancelada</SelectItem>
                <SelectItem value="FALHOU">Falhou</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Médico</Label>
            <Select value={medicoFiltro} onValueChange={setMedicoFiltro}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {medicos.map((m) => <SelectItem key={m.id} value={String(m.id)}>{m.full_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Paciente</Label>
            <Select value={pacienteFiltro} onValueChange={setPacienteFiltro}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {pacientes.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.full_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}>
            <Download className="h-4 w-4 mr-2" /> Exportar CSV
          </Button>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Filter className="h-8 w-8 mx-auto mb-2" />
            Nenhuma consulta encontrada com os filtros atuais.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Paciente</TableHead>
                  <TableHead>Médico</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Duração</TableHead>
                  <TableHead>Qualidade</TableHead>
                  <TableHead>Gravação</TableHead>
                  <TableHead>Receita</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const st = formatarStatus(r.tp_status);
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs whitespace-nowrap">{new Date(r.dt_criacao).toLocaleString("pt-BR")}</TableCell>
                      <TableCell className="text-sm">{r.paciente?.full_name ?? `#${r.cd_paciente}`}</TableCell>
                      <TableCell className="text-sm">{r.medico?.full_name ?? `#${r.cd_medico}`}</TableCell>
                      <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
                      <TableCell className="text-xs tabular-nums">{r.duracao_segundos ? formatDuration(r.duracao_segundos) : "—"}</TableCell>
                      <TableCell className="text-xs">
                        {r.vl_latencia_media ? `${r.vl_latencia_media}ms` : "—"}
                        {r.vl_packet_loss ? ` / ${r.vl_packet_loss}%` : ""}
                      </TableCell>
                      <TableCell>
                        {r.ds_url_gravacao ? (
                          <a href={r.ds_url_gravacao} target="_blank" rel="noreferrer" className="inline-flex items-center text-primary text-xs hover:underline">
                            <ExternalLink className="h-3 w-3 mr-1" /> Ver
                          </a>
                        ) : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
                      <TableCell>
                        {r.receita ? (
                          <Badge variant="outline" className="text-[10px]">{r.receita.tp_receita ?? "—"}</Badge>
                        ) : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default TelemedicineHistory;
