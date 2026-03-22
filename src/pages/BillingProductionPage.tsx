import { useEffect, useState } from "react";
import { Receipt, Search, TrendingUp } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState } from "@/components/StateViews";
import { StatsCard } from "@/components/StatsCard";
import { api } from "@/services/api";
import { BillingProduction, BillingProductionStatus, Unit } from "@/types";
import { formatCurrency, formatDate, getBillingTypeLabel, getAppointmentTypeLabel } from "@/utils/formatters";

const prodStatusLabels: Record<BillingProductionStatus, string> = { em_aberto: "Em Aberto", faturado: "Faturado", cancelado: "Cancelado", glosa: "Glosa" };
const prodStatusColors: Record<BillingProductionStatus, string> = {
  em_aberto: "bg-warning/10 text-warning", faturado: "bg-success/10 text-success",
  cancelado: "bg-muted text-muted-foreground", glosa: "bg-destructive/10 text-destructive",
};

export default function BillingProductionPage() {
  const [items, setItems] = useState<BillingProduction[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [unitFilter, setUnitFilter] = useState("all");

  useEffect(() => {
    Promise.all([api.getBillingProductions(), api.getUnits()]).then(([b, u]) => {
      setItems(b); setUnits(u); setLoading(false);
    });
  }, []);

  const filtered = items.filter((i) => {
    const q = search.toLowerCase();
    const matchSearch = !search || i.patientName.toLowerCase().includes(q) || i.professionalName.toLowerCase().includes(q) || i.description.toLowerCase().includes(q);
    const matchStatus = statusFilter === "all" || i.status === statusFilter;
    const matchUnit = unitFilter === "all" || i.unitId === unitFilter;
    return matchSearch && matchStatus && matchUnit;
  });

  const totalFaturado = items.filter((i) => i.status === "faturado").reduce((s, i) => s + i.finalAmount, 0);
  const totalAberto = items.filter((i) => i.status === "em_aberto").reduce((s, i) => s + i.finalAmount, 0);

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Faturamento" description="Produção faturável vinculada aos atendimentos" />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatsCard title="Faturado" value={formatCurrency(totalFaturado)} icon={TrendingUp} variant="success" />
        <StatsCard title="Em Aberto" value={formatCurrency(totalAberto)} icon={Receipt} variant="warning" />
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground mb-1">Produção por Unidade</p>
          {units.map((u) => {
            const unitTotal = items.filter((i) => i.unitId === u.id).reduce((s, i) => s + i.finalAmount, 0);
            return unitTotal > 0 ? <p key={u.id} className="text-xs">{u.name}: <span className="font-bold">{formatCurrency(unitTotal)}</span></p> : null;
          })}
        </CardContent></Card>
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
            {(Object.keys(prodStatusLabels) as BillingProductionStatus[]).map((s) => <SelectItem key={s} value={s}>{prodStatusLabels[s]}</SelectItem>)}
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

      {filtered.length === 0 ? <EmptyState icon={Receipt} title="Nenhuma produção encontrada" /> : (
        <div className="rounded-lg border bg-card overflow-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Paciente</TableHead><TableHead>Profissional</TableHead><TableHead>Unidade</TableHead><TableHead>Tipo</TableHead><TableHead>Convênio</TableHead><TableHead>Bruto</TableHead><TableHead>Final</TableHead><TableHead>Status</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="font-medium text-sm">{i.patientName}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{i.professionalName}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{i.unitName}</TableCell>
                  <TableCell><Badge variant="outline" className="border-0 bg-primary/10 text-primary text-[10px]">{getBillingTypeLabel(i.billingType)}</Badge></TableCell>
                  <TableCell className="text-xs">{i.insuranceName || "Particular"}</TableCell>
                  <TableCell className="text-xs">{formatCurrency(i.grossAmount)}</TableCell>
                  <TableCell className="font-medium text-sm">{formatCurrency(i.finalAmount)}</TableCell>
                  <TableCell><Badge variant="outline" className={`border-0 text-[10px] ${prodStatusColors[i.status]}`}>{prodStatusLabels[i.status]}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
