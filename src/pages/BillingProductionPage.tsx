import { useEffect, useState, useCallback } from "react";
import { Receipt, Search, TrendingUp } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState, ErrorState } from "@/components/StateViews";
import { StatsCard } from "@/components/StatsCard";
import { billingsService, DbBilling } from "@/services/financialService";
import { professionalsLookup, DbProfessional } from "@/services/appointmentsService";
import { Patient } from "@/types";
import { supabase } from "@/lib/supabase";

const formatCurrency = (v: number | null | undefined) => (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const statusLabels: Record<string, string> = { em_aberto: "Em Aberto", faturado: "Faturado", faturado_enviado: "Faturado enviado", cancelado: "Cancelado", glosa: "Glosa" };
const statusColors: Record<string, string> = {
  em_aberto: "bg-warning/10 text-warning", faturado: "bg-success/10 text-success",
  faturado_enviado: "bg-success/10 text-success", cancelado: "bg-muted text-muted-foreground", glosa: "bg-destructive/10 text-destructive",
};
const billingTypeLabels: Record<string, string> = { particular: "Particular", convenio: "Convênio", retorno: "Retorno" };

export default function BillingProductionPage() {
  const [billings, setBillings] = useState<DbBilling[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [professionals, setProfessionals] = useState<DbProfessional[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const loadAll = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [b, profs] = await Promise.all([
        billingsService.getAll(),
        professionalsLookup.getAll(),
      ]);
      const patientIds = Array.from(new Set(b.map((item) => item.patient_id).filter((id): id is string => Boolean(id))));
      const chunks: string[][] = [];
      for (let i = 0; i < patientIds.length; i += 100) chunks.push(patientIds.slice(i, i + 100));
      const responses = await Promise.all(chunks.map((ids) => supabase.from("patients").select("id, full_name").in("id", ids)));
      const patientRows = responses.flatMap(({ data, error: patientError }) => {
        if (patientError) throw patientError;
        return data || [];
      });
      setBillings(b);
      setPatients(patientRows.map((p: any) => ({ id: String(p.id), name: p.full_name || "" } as Patient)));
      setProfessionals(profs);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const getPatientName = (id: string | null) => patients.find((p) => p.id === id)?.name || "—";
  const getProfName = (id: string | null) => professionals.find((p) => p.id === id)?.full_name || "—";

  const filtered = billings.filter((b) => {
    const q = search.toLowerCase();
    const patName = getPatientName(b.patient_id).toLowerCase();
    const profName = getProfName(b.professional_id).toLowerCase();
    const matchSearch = !search || patName.includes(q) || profName.includes(q);
    const matchStatus = statusFilter === "all" || b.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const totalFaturado = billings.filter((b) => b.status === "faturado").reduce((s, b) => s + b.net_amount, 0);
  const totalAberto = billings.filter((b) => b.status === "em_aberto").reduce((s, b) => s + b.net_amount, 0);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadAll} />;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Faturamento"
        description="Produção faturável vinculada aos atendimentos"
      />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatsCard title="Faturado" value={formatCurrency(totalFaturado)} icon={TrendingUp} variant="success" />
        <StatsCard title="Em Aberto" value={formatCurrency(totalAberto)} icon={Receipt} variant="warning" />
        <StatsCard title="Total registros" value={String(billings.length)} icon={Receipt} variant="default" />
      </div>

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar paciente, profissional..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[130px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {Object.entries(statusLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? <EmptyState icon={Receipt} title="Nenhum faturamento encontrado" /> : (
        <div className="rounded-lg border bg-card overflow-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Paciente</TableHead>
              <TableHead>Profissional</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Bruto</TableHead>
              <TableHead>Desc.</TableHead>
              <TableHead>Líquido</TableHead>
              <TableHead>Status</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium text-sm">{getPatientName(b.patient_id)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{getProfName(b.professional_id)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="border-0 bg-primary/10 text-primary text-[10px]">
                      {billingTypeLabels[b.billing_type || ""] || b.billing_type || "—"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">{formatCurrency(b.gross_amount)}</TableCell>
                  <TableCell className="text-xs">{b.discount > 0 ? `-${formatCurrency(b.discount)}` : "—"}</TableCell>
                  <TableCell className="font-medium text-sm">{formatCurrency(b.net_amount)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`border-0 text-[10px] ${statusColors[b.status] || ""}`}>
                      {statusLabels[b.status] || b.status}
                    </Badge>
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
