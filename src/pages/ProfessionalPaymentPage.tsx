import { useEffect, useState } from "react";
import { Banknote, Search, TrendingUp, CheckCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState } from "@/components/StateViews";
import { StatsCard } from "@/components/StatsCard";
import { professionalPaymentsService, type ProfessionalPaymentWithDetails } from "@/services/professionalPaymentsService";
import { catalogService } from "@/services/catalogService";
import { formatCurrency } from "@/utils/formatters";
import { useToast } from "@/hooks/use-toast";

const paymentStatusLabels: Record<string, string> = {
  apurado: "Apurado", conferido: "Conferido", pago: "Pago", cancelado: "Cancelado",
};
const paymentStatusColors: Record<string, string> = {
  apurado: "bg-warning/10 text-warning",
  conferido: "bg-primary/10 text-primary",
  pago: "bg-success/10 text-success",
  cancelado: "bg-muted text-muted-foreground",
};
const remTypeLabels: Record<string, string> = {
  FIXED: "Valor Fixo", PACKAGE: "Pacote", CH: "CH", PERCENTAGE: "Percentual",
};

export default function ProfessionalPaymentPage() {
  const [payments, setPayments] = useState<ProfessionalPaymentWithDetails[]>([]);
  const [units, setUnits] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [unitFilter, setUnitFilter] = useState("all");
  const { toast } = useToast();

  const load = async () => {
    setLoading(true);
    try {
      const [p, u] = await Promise.all([
        professionalPaymentsService.getAllWithDetails(),
        catalogService.units.getAll(),
      ]);
      setPayments(p);
      setUnits(u.map((unit) => ({ id: unit.id, name: unit.name })));
    } catch (err) {
      toast({
        title: "Erro ao carregar repasses",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleMarcarPago = async (id: number) => {
    try {
      await professionalPaymentsService.marcarComoPago(id, new Date().toISOString().split("T")[0]);
      toast({ title: "Repasse marcado como pago" });
      void load();
    } catch (err) {
      toast({
        title: "Erro ao marcar como pago",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };

  const filtered = payments.filter((p) => {
    const q = search.toLowerCase();
    const matchSearch = !search || (p.professionalName ?? "").toLowerCase().includes(q) || (p.ds_reference ?? "").toLowerCase().includes(q);
    const matchStatus = statusFilter === "all" || p.status === statusFilter;
    const matchUnit = unitFilter === "all" || String(p.cd_unit ?? "") === unitFilter;
    return matchSearch && matchStatus && matchUnit;
  });

  const totalApurado = payments.filter((p) => p.status === "apurado").reduce((s, p) => s + Number(p.total_value), 0);
  const totalPago = payments.filter((p) => p.status === "pago").reduce((s, p) => s + Number(p.total_value), 0);

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
            {Object.entries(paymentStatusLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
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

      {filtered.length === 0 ? <EmptyState icon={Banknote} title="Nenhum repasse" description="Cadastre repasses na produção médica para visualizar aqui." /> : (
        <div className="rounded-lg border bg-card overflow-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Profissional</TableHead>
              <TableHead>Unidade</TableHead>
              <TableHead>Referência</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead>Qtd</TableHead>
              <TableHead>%</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Ações</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium text-sm">{p.professionalName}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{p.unitName ?? "—"}</TableCell>
                  <TableCell className="text-xs">{new Date(p.dt_reference).toLocaleDateString("pt-BR")}</TableCell>
                  <TableCell><Badge variant="outline" className="border-0 bg-primary/10 text-primary text-[10px]">{remTypeLabels[p.tp_remuneration] ?? p.tp_remuneration}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[150px] truncate">{p.ds_reference ?? "—"}</TableCell>
                  <TableCell className="text-xs">{p.total_procedures}</TableCell>
                  <TableCell className="text-xs">{Number(p.percentage).toFixed(1)}%</TableCell>
                  <TableCell className="font-medium text-sm">{formatCurrency(Number(p.total_value))}</TableCell>
                  <TableCell><Badge variant="outline" className={`border-0 text-[10px] ${paymentStatusColors[p.status] ?? ""}`}>{paymentStatusLabels[p.status] ?? p.status}</Badge></TableCell>
                  <TableCell>
                    {p.status === "apurado" && (
                      <Button variant="ghost" size="sm" onClick={() => void handleMarcarPago(p.id)} title="Marcar como pago">
                        <CheckCircle className="h-4 w-4 text-success" />
                      </Button>
                    )}
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