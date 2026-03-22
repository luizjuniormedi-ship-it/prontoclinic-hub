import { useEffect, useState } from "react";
import { DollarSign, Search, TrendingUp, TrendingDown, Calendar } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState } from "@/components/StateViews";
import { PaymentStatusBadge } from "@/components/StatusBadge";
import { StatsCard } from "@/components/StatsCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { api } from "@/services/api";
import { Payment } from "@/types";
import { formatCurrency, formatDate } from "@/utils/formatters";
import { useToast } from "@/hooks/use-toast";

export default function FinancialPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [periodFilter, setPeriodFilter] = useState<string>("all");
  const [paymentDialog, setPaymentDialog] = useState<Payment | null>(null);
  const [paymentMethod, setPaymentMethod] = useState("pix");
  const { toast } = useToast();

  useEffect(() => {
    api.getPayments().then((p) => { setPayments(p); setLoading(false); });
  }, []);

  const filtered = payments.filter((p) => {
    const matchesSearch = p.patientName.toLowerCase().includes(search.toLowerCase()) || p.description.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || p.status === statusFilter;
    if (!matchesSearch || !matchesStatus) return false;

    if (periodFilter !== "all") {
      const dueDate = new Date(p.dueDate + "T00:00:00");
      const now = new Date();
      if (periodFilter === "today") {
        return dueDate.toDateString() === now.toDateString();
      }
      if (periodFilter === "week") {
        const weekAgo = new Date(now);
        weekAgo.setDate(now.getDate() - 7);
        return dueDate >= weekAgo && dueDate <= now;
      }
      if (periodFilter === "month") {
        return dueDate.getMonth() === now.getMonth() && dueDate.getFullYear() === now.getFullYear();
      }
    }
    return true;
  });

  const totalPaid = payments.filter((p) => p.status === "paid").reduce((s, p) => s + p.amount, 0);
  const totalPending = payments.filter((p) => p.status === "pending").reduce((s, p) => s + p.amount, 0);
  const totalOverdue = payments.filter((p) => p.status === "overdue").reduce((s, p) => s + p.amount, 0);

  // Daily summary
  const today = new Date().toISOString().split("T")[0];
  const todayPaid = payments.filter((p) => p.paidAt === today).reduce((s, p) => s + p.amount, 0);
  const todayDue = payments.filter((p) => p.dueDate === today && p.status !== "paid").reduce((s, p) => s + p.amount, 0);

  const handleMarkPaid = () => {
    if (!paymentDialog) return;
    setPayments((prev) => prev.map((p) => p.id === paymentDialog.id ? { ...p, status: "paid" as const, paidAt: new Date().toISOString().split("T")[0], method: paymentMethod } : p));
    toast({ title: "Pagamento registrado!" });
    setPaymentDialog(null);
  };

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Financeiro" description="Gestão de cobranças e pagamentos" />

      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard title="Recebido" value={formatCurrency(totalPaid)} icon={TrendingUp} variant="success" />
        <StatsCard title="Pendente" value={formatCurrency(totalPending)} icon={DollarSign} variant="warning" />
        <StatsCard title="Atrasado" value={formatCurrency(totalOverdue)} icon={TrendingDown} variant="default" />
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Calendar className="h-4 w-4 text-primary" />
              <span className="text-xs font-medium text-muted-foreground">Resumo do Dia</span>
            </div>
            <p className="text-sm">Recebido: <span className="font-bold text-success">{formatCurrency(todayPaid)}</span></p>
            <p className="text-sm">A vencer: <span className="font-bold text-warning">{formatCurrency(todayDue)}</span></p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar paciente ou descrição..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[130px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="paid">Pago</SelectItem>
            <SelectItem value="pending">Pendente</SelectItem>
            <SelectItem value="overdue">Atrasado</SelectItem>
          </SelectContent>
        </Select>
        <Select value={periodFilter} onValueChange={setPeriodFilter}>
          <SelectTrigger className="w-[130px]"><SelectValue placeholder="Período" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="today">Hoje</SelectItem>
            <SelectItem value="week">Última semana</SelectItem>
            <SelectItem value="month">Este mês</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <EmptyState icon={DollarSign} title="Nenhuma cobrança encontrada" />
      ) : (
        <div className="rounded-lg border bg-card overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Paciente</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead>Pagamento</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p) => {
                const isOverdue = p.status === "overdue";
                return (
                  <TableRow key={p.id} className={isOverdue ? "bg-destructive/5" : ""}>
                    <TableCell className="font-medium text-sm">{p.patientName}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{p.description}</TableCell>
                    <TableCell className={`font-medium ${isOverdue ? "text-destructive" : ""}`}>{formatCurrency(p.amount)}</TableCell>
                    <TableCell className="text-xs">{formatDate(p.dueDate)}</TableCell>
                    <TableCell className="text-xs">{p.method || "—"}</TableCell>
                    <TableCell><PaymentStatusBadge status={p.status} /></TableCell>
                    <TableCell>
                      {p.status !== "paid" && (
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setPaymentDialog(p); setPaymentMethod("pix"); }}>
                          Registrar Pgto
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Payment dialog */}
      <Dialog open={!!paymentDialog} onOpenChange={(v) => !v && setPaymentDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Registrar Pagamento</DialogTitle>
            <DialogDescription>Confirme os dados do pagamento.</DialogDescription>
          </DialogHeader>
          {paymentDialog && (
            <div className="space-y-4">
              <div className="rounded-lg bg-muted/50 p-3 space-y-1">
                <p className="font-medium text-sm">{paymentDialog.patientName}</p>
                <p className="text-xs text-muted-foreground">{paymentDialog.description}</p>
                <p className="text-lg font-bold text-primary">{formatCurrency(paymentDialog.amount)}</p>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Forma de Pagamento</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pix">PIX</SelectItem>
                    <SelectItem value="cartao_credito">Cartão de Crédito</SelectItem>
                    <SelectItem value="cartao_debito">Cartão de Débito</SelectItem>
                    <SelectItem value="dinheiro">Dinheiro</SelectItem>
                    <SelectItem value="boleto">Boleto</SelectItem>
                    <SelectItem value="convenio">Convênio</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentDialog(null)}>Cancelar</Button>
            <Button onClick={handleMarkPaid}>Confirmar Pagamento</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
