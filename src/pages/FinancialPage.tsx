import { useEffect, useState } from "react";
import { DollarSign, Search, TrendingUp, TrendingDown, Calendar, Plus, Receipt } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState } from "@/components/StateViews";
import { PaymentStatusBadge } from "@/components/StatusBadge";
import { StatsCard } from "@/components/StatsCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { api } from "@/services/api";
import { Billing, PaymentMethod, BillingType, PaymentStatus } from "@/types";
import { formatCurrency, formatDate, getBillingTypeLabel, getPaymentMethodLabel, getAppointmentTypeLabel } from "@/utils/formatters";
import { useToast } from "@/hooks/use-toast";

const allBillingTypes: BillingType[] = ["particular", "convenio", "retorno", "terapia_avulsa", "terapia_pacote"];
const allPaymentMethods: PaymentMethod[] = ["dinheiro", "pix", "cartao_debito", "cartao_credito", "transferencia", "convenio"];
const allStatuses: PaymentStatus[] = ["pending", "paid", "overdue", "cancelled"];

export default function FinancialPage() {
  const [billings, setBillings] = useState<Billing[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [periodFilter, setPeriodFilter] = useState("all");
  const [billingTypeFilter, setBillingTypeFilter] = useState("all");
  const [paymentDialog, setPaymentDialog] = useState<Billing | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("pix");
  const [newBillingOpen, setNewBillingOpen] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    api.getBillings().then((b) => { setBillings(b); setLoading(false); });
  }, []);

  const filtered = billings.filter((b) => {
    const q = search.toLowerCase();
    const matchesSearch = !search || b.patientName.toLowerCase().includes(q) || b.professionalName.toLowerCase().includes(q) || b.description.toLowerCase().includes(q);
    const matchesStatus = statusFilter === "all" || b.status === statusFilter;
    const matchesBillingType = billingTypeFilter === "all" || b.billingType === billingTypeFilter;
    if (!matchesSearch || !matchesStatus || !matchesBillingType) return false;

    if (periodFilter !== "all") {
      const dueDate = new Date(b.dueDate + "T00:00:00");
      const now = new Date();
      if (periodFilter === "today") return dueDate.toDateString() === now.toDateString();
      if (periodFilter === "week") { const w = new Date(now); w.setDate(now.getDate() - 7); return dueDate >= w && dueDate <= now; }
      if (periodFilter === "month") return dueDate.getMonth() === now.getMonth() && dueDate.getFullYear() === now.getFullYear();
    }
    return true;
  });

  const totalPaid = billings.filter((b) => b.status === "paid").reduce((s, b) => s + b.finalAmount, 0);
  const totalPending = billings.filter((b) => b.status === "pending").reduce((s, b) => s + b.finalAmount, 0);
  const totalOverdue = billings.filter((b) => b.status === "overdue").reduce((s, b) => s + b.finalAmount, 0);
  const totalCancelled = billings.filter((b) => b.status === "cancelled").reduce((s, b) => s + b.finalAmount, 0);

  const today = new Date().toISOString().split("T")[0];
  const todayPaid = billings.filter((b) => b.paidAt === today).reduce((s, b) => s + b.finalAmount, 0);
  const todayDue = billings.filter((b) => b.dueDate === today && b.status !== "paid").reduce((s, b) => s + b.finalAmount, 0);

  const handleMarkPaid = () => {
    if (!paymentDialog) return;
    setBillings((prev) => prev.map((b) => b.id === paymentDialog.id ? { ...b, status: "paid" as const, paidAt: today, paymentMethod } : b));
    toast({ title: "Pagamento registrado!" });
    setPaymentDialog(null);
  };

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Financeiro"
        description="Faturamento e cobranças"
        actions={
          <Button onClick={() => setNewBillingOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />Nova Cobrança
          </Button>
        }
      />

      {/* Stats */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
        <StatsCard title="Recebido" value={formatCurrency(totalPaid)} icon={TrendingUp} variant="success" />
        <StatsCard title="Pendente" value={formatCurrency(totalPending)} icon={DollarSign} variant="warning" />
        <StatsCard title="Atrasado" value={formatCurrency(totalOverdue)} icon={TrendingDown} variant="default" />
        <StatsCard title="Cancelado" value={formatCurrency(totalCancelled)} icon={DollarSign} variant="default" />
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
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar paciente, profissional..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[120px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {allStatuses.map((s) => <SelectItem key={s} value={s}>{s === "paid" ? "Pago" : s === "pending" ? "Pendente" : s === "overdue" ? "Atrasado" : "Cancelado"}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={billingTypeFilter} onValueChange={setBillingTypeFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Tipo cobrança" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {allBillingTypes.map((t) => <SelectItem key={t} value={t}>{getBillingTypeLabel(t)}</SelectItem>)}
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
        <EmptyState icon={Receipt} title="Nenhuma cobrança encontrada" />
      ) : (
        <div className="rounded-lg border bg-card overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Paciente</TableHead>
                <TableHead>Profissional</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Bruto</TableHead>
                <TableHead>Desc.</TableHead>
                <TableHead>Final</TableHead>
                <TableHead>Pgto</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((b) => (
                <TableRow key={b.id} className={b.status === "overdue" ? "bg-destructive/5" : b.status === "cancelled" ? "opacity-50" : ""}>
                  <TableCell className="font-medium text-sm">{b.patientName}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{b.professionalName}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-0">{getBillingTypeLabel(b.billingType)}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[150px] truncate">{b.description}</TableCell>
                  <TableCell className="text-xs">{formatCurrency(b.grossAmount)}</TableCell>
                  <TableCell className="text-xs">{b.discount > 0 ? `-${formatCurrency(b.discount)}` : "—"}</TableCell>
                  <TableCell className={`font-medium text-sm ${b.status === "overdue" ? "text-destructive" : ""}`}>{formatCurrency(b.finalAmount)}</TableCell>
                  <TableCell className="text-xs">{b.paymentMethod ? getPaymentMethodLabel(b.paymentMethod) : "—"}</TableCell>
                  <TableCell className="text-xs">{formatDate(b.dueDate)}</TableCell>
                  <TableCell><PaymentStatusBadge status={b.status} /></TableCell>
                  <TableCell>
                    {(b.status === "pending" || b.status === "overdue") && (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setPaymentDialog(b); setPaymentMethod("pix"); }}>
                        Registrar
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
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
                <p className="text-xs text-muted-foreground">Profissional: {paymentDialog.professionalName}</p>
                {paymentDialog.discount > 0 && (
                  <p className="text-xs text-muted-foreground">Desconto: {formatCurrency(paymentDialog.discount)}</p>
                )}
                <p className="text-lg font-bold text-primary">{formatCurrency(paymentDialog.finalAmount)}</p>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Forma de Pagamento *</Label>
                <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {allPaymentMethods.map((m) => (
                      <SelectItem key={m} value={m}>{getPaymentMethodLabel(m)}</SelectItem>
                    ))}
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

      {/* New billing dialog (stub) */}
      <Dialog open={newBillingOpen} onOpenChange={setNewBillingOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nova Cobrança</DialogTitle>
            <DialogDescription>Registre uma cobrança vinculada a um atendimento.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Paciente *</Label><Input placeholder="Selecione o paciente" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Tipo de Cobrança *</Label>
                <Select><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{allBillingTypes.map((t) => <SelectItem key={t} value={t}>{getBillingTypeLabel(t)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Profissional *</Label>
                <Input placeholder="Selecione" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2"><Label>Valor Bruto *</Label><Input type="number" placeholder="0,00" /></div>
              <div className="space-y-2"><Label>Desconto</Label><Input type="number" placeholder="0,00" /></div>
              <div className="space-y-2"><Label>Valor Final</Label><Input type="number" placeholder="0,00" disabled /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Vencimento *</Label><Input type="date" /></div>
              <div className="space-y-2">
                <Label>Forma de Pagamento</Label>
                <Select><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{allPaymentMethods.map((m) => <SelectItem key={m} value={m}>{getPaymentMethodLabel(m)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2"><Label>Observações</Label><Textarea placeholder="Notas..." rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewBillingOpen(false)}>Cancelar</Button>
            <Button onClick={() => { toast({ title: "Cobrança registrada!" }); setNewBillingOpen(false); }}>Registrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
