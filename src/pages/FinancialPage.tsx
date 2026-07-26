import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Calendar, DollarSign, ExternalLink, Receipt, Search, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/PageHeader";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, ErrorState, LoadingState } from "@/components/StateViews";
import { StatsCard } from "@/components/StatsCard";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  financialService,
  type DbFinancialTransaction,
} from "@/services/financialService";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";

const formatCurrency = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const formatDate = (date: string) => {
  try {
    return new Date(`${date}T00:00:00`).toLocaleDateString("pt-BR");
  } catch {
    return date;
  }
};

const statusLabels: Record<string, string> = {
  pendente: "Pendente",
  pago: "Pago",
  cancelado: "Cancelado",
};

const statusColors: Record<string, string> = {
  pendente: "bg-warning/10 text-warning",
  pago: "bg-success/10 text-success",
  cancelado: "bg-muted text-muted-foreground",
};

const methodLabels: Record<string, string> = {
  dinheiro: "Dinheiro",
  pix: "PIX",
  cartao_debito: "Débito",
  cartao_credito: "Crédito",
  transferencia: "Transferência",
  boleto: "Boleto",
};

const paymentMethods = Object.keys(methodLabels);

export default function FinancialPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [transactions, setTransactions] = useState<DbFinancialTransaction[]>([]);
  const [patientNames, setPatientNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [paymentDialog, setPaymentDialog] = useState<DbFinancialTransaction | null>(null);
  const [paymentMethod, setPaymentMethod] = useState("pix");
  const [paymentReference, setPaymentReference] = useState("");
  const [saving, setSaving] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const rows = await financialService.getAll();
      const ids = [...new Set(
        rows
          .map((transaction) => transaction.patient_id)
          .filter((id): id is string => Boolean(id)),
      )];
      const chunks: string[][] = [];
      for (let index = 0; index < ids.length; index += 100) {
        chunks.push(ids.slice(index, index + 100));
      }
      const responses = await Promise.all(
        chunks.map((chunk) =>
          supabase.from("patients").select("id, full_name").in("id", chunk),
        ),
      );
      const names: Record<string, string> = {};
      for (const response of responses) {
        if (response.error) throw response.error;
        for (const patient of response.data || []) {
          names[String(patient.id)] = patient.full_name || "";
        }
      }
      setTransactions(rows);
      setPatientNames(names);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const getPatientName = (transaction: DbFinancialTransaction) =>
    transaction.patient_name
      || (transaction.patient_id ? patientNames[transaction.patient_id] : null)
      || "—";

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return transactions.filter((transaction) => {
      const matchesSearch = !term
        || getPatientName(transaction).toLocaleLowerCase("pt-BR").includes(term);
      const matchesStatus = statusFilter === "all" || transaction.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [patientNames, search, statusFilter, transactions]);

  const totalPaid = transactions
    .filter((transaction) => transaction.status === "pago")
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const totalPending = transactions
    .filter((transaction) => transaction.status === "pendente")
    .reduce((sum, transaction) => sum + transaction.amount, 0);

  const openPayment = (transaction: DbFinancialTransaction) => {
    setPaymentDialog(transaction);
    setPaymentMethod("pix");
    setPaymentReference("");
  };

  const closePayment = () => {
    setPaymentDialog(null);
    setPaymentReference("");
  };

  const handleMarkPaid = async () => {
    if (!paymentDialog) return;
    if (paymentMethod !== "dinheiro" && !paymentReference.trim()) {
      toast({
        title: "Informe o comprovante ou referência",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      await financialService.markPaid(
        paymentDialog,
        paymentMethod,
        paymentReference.trim() || undefined,
      );
      toast({ title: "Pagamento registrado!" });
      closePayment();
      await loadAll();
    } catch (paymentError) {
      toast({
        title: "Erro",
        description: paymentError instanceof Error ? paymentError.message : String(paymentError),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Financeiro"
        description="Recebíveis originados pelas contas assistenciais"
        actions={(
          <Button variant="outline" onClick={() => navigate("/billing-accounts")}>
            <ExternalLink className="mr-2 h-4 w-4" />
            Gerenciar contas
          </Button>
        )}
      />

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={loadAll} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <StatsCard
              title="Recebido"
              value={formatCurrency(totalPaid)}
              icon={TrendingUp}
              variant="success"
            />
            <StatsCard
              title="Pendente"
              value={formatCurrency(totalPending)}
              icon={DollarSign}
              variant="warning"
            />
            <Card>
              <CardContent className="p-4">
                <div className="mb-1 flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-primary" />
                  <span className="text-xs font-medium text-muted-foreground">
                    Total de recebíveis
                  </span>
                </div>
                <p className="text-lg font-bold">{transactions.length}</p>
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-[180px] max-w-xs flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Buscar recebíveis por paciente"
                className="pl-9"
                placeholder="Buscar paciente..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[140px]" aria-label="Filtrar recebíveis por status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="pendente">Pendente</SelectItem>
                <SelectItem value="pago">Pago</SelectItem>
                <SelectItem value="cancelado">Cancelado</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="Nenhum recebível encontrado"
              description="As cobranças são geradas pelo fluxo de atendimento e faturamento."
            />
          ) : (
            <div className="overflow-auto rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Paciente</TableHead>
                    <TableHead>Valor</TableHead>
                    <TableHead>Desconto</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead>Pago em</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((transaction) => (
                    <TableRow
                      key={transaction.id}
                      className={transaction.status === "cancelado" ? "opacity-50" : undefined}
                    >
                      <TableCell className="font-medium text-sm">
                        {getPatientName(transaction)}
                      </TableCell>
                      <TableCell className="font-medium text-sm">
                        {formatCurrency(transaction.amount)}
                      </TableCell>
                      <TableCell className="text-xs">
                        {transaction.discount > 0
                          ? `-${formatCurrency(transaction.discount)}`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {transaction.due_date ? formatDate(transaction.due_date) : "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {transaction.payment_date ? formatDate(transaction.payment_date) : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`border-0 text-[10px] ${statusColors[transaction.status] || ""}`}
                        >
                          {statusLabels[transaction.status] || transaction.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {transaction.status === "pendente" && (
                          <Button
                            className="h-7 text-xs"
                            size="sm"
                            variant="outline"
                            onClick={() => openPayment(transaction)}
                          >
                            Registrar pagamento
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}

      <Dialog open={Boolean(paymentDialog)} onOpenChange={(open) => !open && closePayment()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Registrar pagamento</DialogTitle>
            <DialogDescription>
              O recebimento será registrado pelo checkout transacional e auditável.
            </DialogDescription>
          </DialogHeader>
          {paymentDialog && (
            <div className="space-y-4">
              <div className="space-y-1 rounded-lg bg-muted/50 p-3">
                <p className="font-medium text-sm">{getPatientName(paymentDialog)}</p>
                <p className="text-lg font-bold text-primary">
                  {formatCurrency(paymentDialog.amount)}
                </p>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Forma de pagamento *</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger aria-label="Forma de pagamento">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {paymentMethods.map((method) => (
                      <SelectItem key={method} value={method}>
                        {methodLabels[method]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {paymentMethod !== "dinheiro" && (
                <div className="space-y-2">
                  <Label htmlFor="payment-reference" className="text-xs">
                    Comprovante, NSU ou referência *
                  </Label>
                  <Input
                    id="payment-reference"
                    value={paymentReference}
                    onChange={(event) => setPaymentReference(event.target.value)}
                    placeholder="Informe a referência externa"
                  />
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closePayment} disabled={saving}>
              Cancelar
            </Button>
            <Button
              onClick={handleMarkPaid}
              disabled={saving || (paymentMethod !== "dinheiro" && !paymentReference.trim())}
            >
              {saving ? "Salvando..." : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
