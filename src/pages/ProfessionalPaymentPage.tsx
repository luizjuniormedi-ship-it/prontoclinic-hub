import { useEffect, useState } from "react";
import { Banknote, Search, TrendingUp } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState } from "@/components/StateViews";
import { StatsCard } from "@/components/StatsCard";
import { api } from "@/services/api";
import { ProfessionalPayment, ProfessionalPaymentStatus, RemunerationType, Unit } from "@/types";
import { formatCurrency } from "@/utils/formatters";

const paymentStatusLabels: Record<ProfessionalPaymentStatus, string> = { apurado: "Apurado", conferido: "Conferido", pago: "Pago", cancelado: "Cancelado" };
const paymentStatusColors: Record<ProfessionalPaymentStatus, string> = {
  apurado: "bg-warning/10 text-warning", conferido: "bg-primary/10 text-primary",
  pago: "bg-success/10 text-success", cancelado: "bg-muted text-muted-foreground",
};
const remTypeLabels: Record<RemunerationType, string> = { fixed: "Valor Fixo", package: "Pacote", ch: "CH" };

export default function ProfessionalPaymentPage() {
  const [payments, setPayments] = useState<ProfessionalPayment[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [unitFilter, setUnitFilter] = useState("all");

  useEffect(() => {
    Promise.all([api.getProfessionalPayments(), api.getUnits()]).then(([p, u]) => {
      setPayments(p); setUnits(u); setLoading(false);
    });
  }, []);

  const filtered = payments.filter((p) => {
    const q = search.toLowerCase();
    const matchSearch = !search || p.professionalName.toLowerCase().includes(q) || p.referenceDescription.toLowerCase().includes(q);
    const matchStatus = statusFilter === "all" || p.status === statusFilter;
    const matchUnit = unitFilter === "all" || p.unitId === unitFilter;
    return matchSearch && matchStatus && matchUnit;
  });

  const totalApurado = payments.filter((p) => p.status === "apurado").reduce((s, p) => s + p.totalValue, 0);
  const totalPago = payments.filter((p) => p.status === "pago").reduce((s, p) => s + p.totalValue, 0);

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Pagamento Médico" description="Repasses e remuneração de profissionais" />

      <div className="grid grid-cols-2 gap-3">
        <StatsCard title="A Pagar (apurado)" value={formatCurrency(totalApurado)} icon={TrendingUp} variant="warning" />
        <StatsCard title="Total Pago" value={formatCurrency(totalPago)} icon={Banknote} variant="success" />
      </div>

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar profissional..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[120px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {(Object.keys(paymentStatusLabels) as ProfessionalPaymentStatus[]).map((s) => <SelectItem key={s} value={s}>{paymentStatusLabels[s]}</SelectItem>)}
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

      {filtered.length === 0 ? <EmptyState icon={Banknote} title="Nenhum repasse" /> : (
        <div className="rounded-lg border bg-card overflow-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Profissional</TableHead><TableHead>Unidade</TableHead><TableHead>Período</TableHead><TableHead>Tipo</TableHead><TableHead>Referência</TableHead><TableHead>Qtd</TableHead><TableHead>Valor Unit.</TableHead><TableHead>CH</TableHead><TableHead>Total</TableHead><TableHead>Status</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium text-sm">{p.professionalName}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{p.unitName}</TableCell>
                  <TableCell className="text-xs">{p.period}</TableCell>
                  <TableCell><Badge variant="outline" className="border-0 bg-primary/10 text-primary text-[10px]">{remTypeLabels[p.remunerationType]}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[150px] truncate">{p.referenceDescription}</TableCell>
                  <TableCell className="text-xs">{p.quantity}</TableCell>
                  <TableCell className="text-xs">{p.unitValue > 0 ? formatCurrency(p.unitValue) : "—"}</TableCell>
                  <TableCell className="text-xs">{p.chQuantity ? `${p.chQuantity} × ${formatCurrency(p.chValue || 0)}` : "—"}</TableCell>
                  <TableCell className="font-medium text-sm">{formatCurrency(p.totalValue)}</TableCell>
                  <TableCell><Badge variant="outline" className={`border-0 text-[10px] ${paymentStatusColors[p.status]}`}>{paymentStatusLabels[p.status]}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
