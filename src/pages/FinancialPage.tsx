import { useEffect, useState, useCallback, useRef } from "react";
import { DollarSign, Search, TrendingUp, Calendar, Receipt } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState, ErrorState } from "@/components/StateViews";
import { StatsCard } from "@/components/StatsCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { financialService, DbFinancialTransaction } from "@/services/financialService";
import { Patient } from "@/types";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";

const formatCurrency = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const formatDate = (d: string) => {
  const parsed = new Date(d.includes("T") ? d : `${d}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? d : parsed.toLocaleDateString("pt-BR");
};

const statusLabels: Record<string, string> = { pendente: "Pendente", parcial: "Parcial", pago: "Pago", cancelado: "Cancelado" };
const statusColors: Record<string, string> = { pendente: "bg-warning/10 text-warning", parcial: "bg-primary/10 text-primary", pago: "bg-success/10 text-success", cancelado: "bg-muted text-muted-foreground" };
const methodLabels: Record<string, string> = { dinheiro: "Dinheiro", pix: "PIX", cartao_debito: "Déb.", cartao_credito: "Créd.", transferencia: "Transf.", convenio: "Convênio" };
const allMethods = ["dinheiro", "pix", "cartao_debito", "cartao_credito", "transferencia", "convenio"];

export default function FinancialPage() {
  const [transactions, setTransactions] = useState<DbFinancialTransaction[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [paymentDialog, setPaymentDialog] = useState<DbFinancialTransaction | null>(null);
  const [paymentMethod, setPaymentMethod] = useState("pix");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentKey, setPaymentKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const paymentInFlightRef = useRef(false);
  const { toast } = useToast();

  const loadAll = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const txns = await financialService.getAll();
      const patientIds = Array.from(new Set(txns.map((t) => t.patient_id).filter((id): id is string => Boolean(id))));
      const chunks: string[][] = [];
      for (let i = 0; i < patientIds.length; i += 100) chunks.push(patientIds.slice(i, i + 100));
      const patientResponses = await Promise.all(chunks.map((ids) =>
        supabase.from("patients").select("id, full_name").in("id", ids)
      ));
      const patientRows = patientResponses.flatMap(({ data, error: patientError }) => {
        if (patientError) throw patientError;
        return data || [];
      });
      setTransactions(txns);
      setPatients(patientRows.map((p: any) => ({ id: String(p.id), name: p.full_name || "" } as Patient)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const getPatientName = (id: string | null, fallback?: string | null) => fallback || patients.find((p) => p.id === id)?.name || "—";

  const filtered = transactions.filter((t) => {
    const q = search.toLowerCase();
    const patientName = getPatientName(t.patient_id, t.patient_name).toLowerCase();
    const matchSearch = !search || patientName.includes(q);
    const matchStatus = statusFilter === "all" || t.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const totalPaid = transactions.reduce((s, t) => s + t.received_amount, 0);
  const totalPending = transactions.reduce((s, t) => s + t.balance_amount, 0);

  const handleMarkPaid = async () => {
    if (!paymentDialog || !paymentKey || paymentInFlightRef.current) return;
    const amount = Number(paymentAmount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > paymentDialog.balance_amount) {
      toast({ title: "Valor de pagamento inválido", variant: "destructive" });
      return;
    }
    paymentInFlightRef.current = true;
    setSaving(true);
    try {
      await financialService.recordPayment(paymentDialog.id, amount, paymentMethod, paymentKey);
      toast({ title: "Pagamento registrado!" });
      setPaymentDialog(null);
      setPaymentKey(null);
      loadAll();
    } catch (err) {
      toast({ title: "Erro", description: (err as Error).message, variant: "destructive" });
    } finally {
      paymentInFlightRef.current = false;
      setSaving(false);
    }
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadAll} />;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Contas a Receber"
        description="Cobranças originadas de atendimentos e respectivos saldos"
      />

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3">
        <StatsCard title="Recebido" value={formatCurrency(totalPaid)} icon={TrendingUp} variant="success" />
        <StatsCard title="Pendente" value={formatCurrency(totalPending)} icon={DollarSign} variant="warning" />
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Calendar className="h-4 w-4 text-primary" />
              <span className="text-xs font-medium text-muted-foreground">Total transações</span>
            </div>
            <p className="text-lg font-bold">{transactions.length}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar paciente..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger aria-label="Filtrar por status financeiro" className="w-[120px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="pendente">Pendente</SelectItem>
            <SelectItem value="parcial">Parcial</SelectItem>
            <SelectItem value="pago">Pago</SelectItem>
            <SelectItem value="cancelado">Cancelado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Receipt} title="Nenhuma transação encontrada" />
      ) : (
        <div className="rounded-lg border bg-card overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Paciente</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Recebido</TableHead>
                <TableHead>Pgto</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead>Pago em</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((t) => (
                <TableRow key={t.id} className={t.status === "pendente" ? "" : t.status === "cancelado" ? "opacity-50" : ""}>
                  <TableCell className="font-medium text-sm">{getPatientName(t.patient_id, t.patient_name)}</TableCell>
                  <TableCell className="font-medium text-sm">{formatCurrency(t.amount)}</TableCell>
                  <TableCell className="text-xs">{formatCurrency(t.received_amount)}</TableCell>
                  <TableCell className="text-xs">{t.payment_method ? (methodLabels[t.payment_method] || t.payment_method) : "—"}</TableCell>
                  <TableCell className="text-xs">{t.due_date ? formatDate(t.due_date) : "—"}</TableCell>
                  <TableCell className="text-xs">{t.payment_date ? formatDate(t.payment_date) : "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`border-0 text-[10px] ${statusColors[t.status] || ""}`}>
                      {statusLabels[t.status] || t.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {t.balance_amount > 0 && t.status !== "cancelado" && (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setPaymentDialog(t); setPaymentMethod("pix"); setPaymentAmount(String(t.balance_amount)); setPaymentKey(crypto.randomUUID()); }}>
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
                <p className="font-medium text-sm">{getPatientName(paymentDialog.patient_id, paymentDialog.patient_name)}</p>
                <p className="text-xs text-muted-foreground">Saldo em aberto</p>
                <p className="text-lg font-bold text-primary">{formatCurrency(paymentDialog.balance_amount)}</p>
              </div>
              <div className="space-y-2"><Label htmlFor="payment-amount" className="text-xs">Valor recebido *</Label><Input id="payment-amount" type="number" min="0.01" step="0.01" max={paymentDialog.balance_amount} value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} /></div>
              <div className="space-y-2">
                <Label className="text-xs">Forma de Pagamento *</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger aria-label="Forma de pagamento"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {allMethods.map((m) => <SelectItem key={m} value={m}>{methodLabels[m] || m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentDialog(null)} disabled={saving}>Cancelar</Button>
            <Button onClick={handleMarkPaid} disabled={saving}>{saving ? "Salvando..." : "Confirmar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
