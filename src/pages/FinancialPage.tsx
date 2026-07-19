import { useEffect, useState, useCallback } from "react";
import { DollarSign, Search, TrendingUp, TrendingDown, Calendar, Plus, Receipt } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState, ErrorState } from "@/components/StateViews";
import { StatsCard } from "@/components/StatsCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { financialService, DbFinancialTransaction } from "@/services/financialService";
import { billingsService } from "@/services/financialService";
import { professionalsLookup, DbProfessional } from "@/services/appointmentsService";
import { Patient } from "@/types";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";

const formatCurrency = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const formatDate = (d: string) => { try { return new Date(d + "T00:00:00").toLocaleDateString("pt-BR"); } catch { return d; } };

const statusLabels: Record<string, string> = { pendente: "Pendente", pago: "Pago", cancelado: "Cancelado" };
const statusColors: Record<string, string> = { pendente: "bg-warning/10 text-warning", pago: "bg-success/10 text-success", cancelado: "bg-muted text-muted-foreground" };
const methodLabels: Record<string, string> = { dinheiro: "Dinheiro", pix: "PIX", cartao_debito: "Déb.", cartao_credito: "Créd.", transferencia: "Transf.", convenio: "Convênio" };
const allMethods = ["dinheiro", "pix", "cartao_debito", "cartao_credito", "transferencia", "convenio"];

export default function FinancialPage() {
  const [transactions, setTransactions] = useState<DbFinancialTransaction[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [professionals, setProfessionals] = useState<DbProfessional[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [paymentDialog, setPaymentDialog] = useState<DbFinancialTransaction | null>(null);
  const [paymentMethod, setPaymentMethod] = useState("pix");
  const [newOpen, setNewOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const { user } = useAuth();
  const { toast } = useToast();

  // New transaction form
  const [newPatientId, setNewPatientId] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [newMethod, setNewMethod] = useState("pix");
  const [newDueDate, setNewDueDate] = useState(new Date().toISOString().split("T")[0]);
  const [newNotes, setNewNotes] = useState("");

  const loadAll = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [txns, profs] = await Promise.all([
        financialService.getAll(),
        professionalsLookup.getAll(),
      ]);
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
      setProfessionals(profs);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const getPatientName = (id: string | null, fallback?: string | null) => fallback || patients.find((p) => p.id === id)?.name || "—";
  const getProfName = (id: string | null) => professionals.find((p) => p.id === id)?.full_name || "—";

  const filtered = transactions.filter((t) => {
    const q = search.toLowerCase();
    const patientName = getPatientName(t.patient_id, t.patient_name).toLowerCase();
    const matchSearch = !search || patientName.includes(q);
    const matchStatus = statusFilter === "all" || t.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const totalPaid = transactions.filter((t) => t.status === "pago" || t.status === "faturado").reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const totalPending = transactions.filter((t) => t.status === "pendente" || t.status === "em_aberto").reduce((s, t) => s + (Number(t.amount) || 0), 0);

  const handleMarkPaid = async () => {
    if (!paymentDialog) return;
    setSaving(true);
    try {
      await financialService.markPaid(paymentDialog.id, paymentMethod);
      toast({ title: "Pagamento registrado!" });
      setPaymentDialog(null);
      loadAll();
    } catch (err) {
      toast({ title: "Erro", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleCreateTransaction = async () => {
    if (!newPatientId || !newAmount) {
      toast({ title: "Preencha paciente e valor", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await financialService.create({
        patient_id: newPatientId,
        company_id: user?.company_id || undefined,
        unit_id: user?.primary_unit_id || undefined,
        amount: Number(newAmount),
        payment_method: newMethod,
        due_date: newDueDate,
        notes: newNotes.trim() || undefined,
        status: "pendente",
      });
      toast({ title: "Cobrança criada!" });
      setNewOpen(false);
      setNewPatientId("");
      setNewAmount("");
      setNewNotes("");
      loadAll();
    } catch (err) {
      toast({ title: "Erro", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadAll} />;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Financeiro"
        description="Transações e cobranças"
        actions={<Button onClick={() => setNewOpen(true)}><Plus className="mr-2 h-4 w-4" />Nova Cobrança</Button>}
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
          <SelectTrigger className="w-[120px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="pendente">Pendente</SelectItem>
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
                <TableHead>Desconto</TableHead>
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
                  <TableCell className="text-xs">{t.discount > 0 ? `-${formatCurrency(t.discount)}` : "—"}</TableCell>
                  <TableCell className="text-xs">{t.payment_method ? (methodLabels[t.payment_method] || t.payment_method) : "—"}</TableCell>
                  <TableCell className="text-xs">{t.due_date ? formatDate(t.due_date) : "—"}</TableCell>
                  <TableCell className="text-xs">{t.payment_date ? formatDate(t.payment_date) : "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`border-0 text-[10px] ${statusColors[t.status] || ""}`}>
                      {statusLabels[t.status] || t.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {t.status === "pendente" && (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setPaymentDialog(t); setPaymentMethod("pix"); }}>
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
                <p className="text-lg font-bold text-primary">{formatCurrency(paymentDialog.amount)}</p>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Forma de Pagamento *</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {allMethods.map((m) => <SelectItem key={m} value={m}>{methodLabels[m] || m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentDialog(null)}>Cancelar</Button>
            <Button onClick={handleMarkPaid} disabled={saving}>{saving ? "Salvando..." : "Confirmar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New transaction dialog */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nova Cobrança</DialogTitle>
            <DialogDescription>Registre uma cobrança.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Paciente *</Label>
              <Select value={newPatientId} onValueChange={setNewPatientId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {patients.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Valor *</Label><Input type="number" placeholder="0.00" value={newAmount} onChange={(e) => setNewAmount(e.target.value)} /></div>
              <div className="space-y-2"><Label>Vencimento</Label><Input type="date" value={newDueDate} onChange={(e) => setNewDueDate(e.target.value)} /></div>
            </div>
            <div className="space-y-2">
              <Label>Forma de Pagamento</Label>
              <Select value={newMethod} onValueChange={setNewMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {allMethods.map((m) => <SelectItem key={m} value={m}>{methodLabels[m] || m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Observações</Label><Textarea rows={2} value={newNotes} onChange={(e) => setNewNotes(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreateTransaction} disabled={saving}>{saving ? "Salvando..." : "Registrar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
