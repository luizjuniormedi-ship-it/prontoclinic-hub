import { useEffect, useState, useCallback } from "react";
import { Receipt, Search, AlertTriangle, ShieldCheck, Send, RotateCcw, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState, ErrorState } from "@/components/StateViews";
import { billingAccountsService, BILLING_STATUS_LABELS, type BillingAccount, type PendingIssue, type Competency } from "@/services/billingAccountsService";
import { toast } from "@/hooks/use-toast";
import { useConfirm } from "@/hooks/useConfirm";
import { formatDate } from "@/utils/formatters";
import { friendlyError } from "@/utils/friendlyError";

const fmtBRL = (v: number) => (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function BillingAccountsPage() {
  const { confirm } = useConfirm();
  const [accounts, setAccounts] = useState<BillingAccount[]>([]);
  const [competencies, setCompetencies] = useState<Competency[]>([]);
  const [stats, setStats] = useState({ total: 0, abertas: 0, prontas: 0, comPendencia: 0, enviadas: 0, pagas: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [pendingOnly, setPendingOnly] = useState(false);

  const [detail, setDetail] = useState<BillingAccount | null>(null);
  const [issues, setIssues] = useState<PendingIssue[]>([]);
  const [reopenAcc, setReopenAcc] = useState<BillingAccount | null>(null);
  const [reopenReason, setReopenReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [dashConvenio, setDashConvenio] = useState<Array<{ convenio: string; contas: number; valor_faturado: number; valor_recebido: number; valor_aberto: number }>>([]);
  const [dashMensal, setDashMensal] = useState<Array<{ competence_month: string; contas: number; faturado: number; recebido: number; pct_recebido: number | null }>>([]);
  const [dashLoaded, setDashLoaded] = useState(false);

  const loadDashboard = async () => {
    if (dashLoaded) return;
    try {
      const [conv, mensal] = await Promise.all([billingAccountsService.receitaPorConvenio(), billingAccountsService.receitaMensal()]);
      setDashConvenio(conv); setDashMensal(mensal); setDashLoaded(true);
    } catch (e) { toast({ title: "Erro ao carregar dashboard", description: String(e), variant: "destructive" }); }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [a, c, s] = await Promise.all([
        billingAccountsService.list({
          status: statusFilter !== "all" ? statusFilter : undefined,
          billing_type: typeFilter !== "all" ? typeFilter : undefined,
          onlyPending: pendingOnly || undefined,
        }),
        billingAccountsService.listCompetencies(),
        billingAccountsService.stats(),
      ]);
      setAccounts(a); setCompetencies(c); setStats(s);
    } catch (e) {
      setError(friendlyError(e, "Carregar faturamento"));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, typeFilter, pendingOnly]);

  useEffect(() => { void load(); }, [load]);

  const openDetail = async (a: BillingAccount) => {
    setDetail(a);
    try { setIssues(await billingAccountsService.pendingIssues(a.id)); } catch { setIssues([]); }
  };

  const recheckPending = async (a: BillingAccount) => {
    setBusy(true);
    try {
      const n = await billingAccountsService.checkPending(a.id);
      toast({ title: "Glosa preventiva executada", description: n > 0 ? `${n} pendência(s) detectada(s)` : "Nenhuma pendência — pronta para envio" });
      if (detail) setIssues(await billingAccountsService.pendingIssues(a.id));
      load();
    } catch (e) { toast({ title: "Erro", description: String(e), variant: "destructive" }); }
    finally { setBusy(false); }
  };

  const resolveIssue = async (issueId: number) => {
    try { await billingAccountsService.resolveIssue(issueId); if (detail) setIssues(await billingAccountsService.pendingIssues(detail.id)); load(); }
    catch (e) { toast({ title: "Erro", description: String(e), variant: "destructive" }); }
  };

  const confirmReopen = async () => {
    if (!reopenAcc || !reopenReason.trim()) { toast({ title: "Informe o motivo", variant: "destructive" }); return; }
    setBusy(true);
    try { await billingAccountsService.reopen(reopenAcc.id, reopenReason.trim()); toast({ title: "Conta reaberta" }); setReopenAcc(null); setReopenReason(""); load(); }
    catch (e) { toast({ title: "Erro", description: String(e), variant: "destructive" }); }
    finally { setBusy(false); }
  };

  const closeCompetency = async (month: string) => {
    if (!await confirm({ title: `Fechar competência ${month}?`, description: "Bloqueia alterações retroativas.", confirmText: "Fechar competência" })) return;
    try { await billingAccountsService.closeCompetency(month); toast({ title: `Competência ${month} fechada` }); load(); }
    catch (e) { toast({ title: "Erro", description: String(e), variant: "destructive" }); }
  };

  const filtered = accounts.filter((a) => !search || a.patient_name?.toLowerCase().includes(search.toLowerCase()) || a.guide_number?.toLowerCase().includes(search.toLowerCase()));

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={() => void load()} />;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Faturamento" description="Contas por atendimento, glosa preventiva e competência" />

      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <Card><CardContent className="p-3"><p className="text-lg font-bold">{stats.total}</p><p className="text-[10px] text-muted-foreground">Contas (amostra)</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-lg font-bold">{stats.abertas}</p><p className="text-[10px] text-muted-foreground">Abertas</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-lg font-bold text-success">{stats.prontas}</p><p className="text-[10px] text-muted-foreground">Prontas p/ envio</p></CardContent></Card>
        <Card><CardContent className="p-3 flex items-center gap-1"><AlertTriangle className="h-4 w-4 text-warning" /><div><p className="text-lg font-bold text-warning">{stats.comPendencia}</p><p className="text-[10px] text-muted-foreground">Com pendência</p></div></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-lg font-bold text-primary">{stats.enviadas}</p><p className="text-[10px] text-muted-foreground">Enviadas</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-lg font-bold text-success">{stats.pagas}</p><p className="text-[10px] text-muted-foreground">Pagas</p></CardContent></Card>
      </div>

      <Tabs defaultValue="contas">
        <TabsList>
          <TabsTrigger value="contas">Contas</TabsTrigger>
          <TabsTrigger value="competencia">Competências</TabsTrigger>
          <TabsTrigger value="dashboard" onClick={() => void loadDashboard()}>Dashboard</TabsTrigger>
        </TabsList>

        <TabsContent value="contas" className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar paciente ou guia..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[170px]"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent><SelectItem value="all">Todos os status</SelectItem>
                {Object.entries(BILLING_STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[140px]"><SelectValue placeholder="Tipo" /></SelectTrigger>
              <SelectContent><SelectItem value="all">Todos</SelectItem><SelectItem value="convenio">Convênio</SelectItem><SelectItem value="particular">Particular</SelectItem></SelectContent>
            </Select>
            <Button variant={pendingOnly ? "default" : "outline"} onClick={() => setPendingOnly(!pendingOnly)} className="gap-1"><AlertTriangle className="h-4 w-4" />Só pendências</Button>
          </div>

          {filtered.length === 0 ? <EmptyState icon={Receipt} title="Nenhuma conta encontrada" /> : (
            <div className="rounded-lg border bg-card overflow-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Paciente</TableHead><TableHead>Tipo</TableHead><TableHead>Status</TableHead>
                  <TableHead>Competência</TableHead><TableHead className="text-right">Valor</TableHead><TableHead>Guia</TableHead><TableHead></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {filtered.map((a) => (
                    <TableRow key={a.id} className={a.has_pending_issues ? "bg-warning/5" : ""}>
                      <TableCell className="font-medium text-sm">
                        {a.has_pending_issues && <AlertTriangle className="h-3 w-3 text-warning inline mr-1" />}
                        {a.patient_name || "—"}
                      </TableCell>
                      <TableCell className="text-xs">{a.billing_type}</TableCell>
                      <TableCell><Badge variant="outline" className="border-0 text-[10px]">{BILLING_STATUS_LABELS[a.status] || a.status}</Badge></TableCell>
                      <TableCell className="text-xs">{a.competence_month || "—"}</TableCell>
                      <TableCell className="text-right text-sm font-medium">{fmtBRL(a.total_net_amount)}</TableCell>
                      <TableCell className="text-[10px] font-mono text-muted-foreground">{a.guide_number || "—"}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => openDetail(a)} title="Conferir"><Receipt className="h-3 w-3" /></Button>
                          <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => recheckPending(a)} title="Glosa preventiva"><ShieldCheck className="h-3 w-3 text-primary" /></Button>
                          {["enviada", "paga"].includes(a.status) && <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setReopenAcc(a)} title="Reabrir"><RotateCcw className="h-3 w-3 text-warning" /></Button>}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="competencia">
          <div className="rounded-lg border bg-card overflow-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Competência</TableHead><TableHead>Status</TableHead>
                <TableHead className="text-right">Receita prevista</TableHead><TableHead className="text-right">Realizada</TableHead><TableHead></TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {competencies.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.competence_month}</TableCell>
                    <TableCell><Badge variant="outline" className={`border-0 text-[10px] ${c.status === "fechada" ? "bg-muted text-muted-foreground" : "bg-success/10 text-success"}`}>{c.status}</Badge></TableCell>
                    <TableCell className="text-right">{fmtBRL(c.receita_prevista)}</TableCell>
                    <TableCell className="text-right">{fmtBRL(c.receita_realizada)}</TableCell>
                    <TableCell>{c.status === "aberta" && <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => closeCompetency(c.competence_month)}><Lock className="h-3 w-3" />Fechar</Button>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="dashboard" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border bg-card p-3">
              <p className="text-sm font-medium mb-2">Receita por convênio (top)</p>
              <div className="overflow-auto max-h-[360px]">
                <Table>
                  <TableHeader><TableRow><TableHead>Convênio</TableHead><TableHead className="text-right">Contas</TableHead><TableHead className="text-right">Faturado</TableHead><TableHead className="text-right">Em aberto</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {dashConvenio.map((c, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs">{c.convenio}</TableCell>
                        <TableCell className="text-right text-xs">{c.contas}</TableCell>
                        <TableCell className="text-right text-xs font-medium">{fmtBRL(c.valor_faturado)}</TableCell>
                        <TableCell className="text-right text-xs text-warning">{fmtBRL(c.valor_aberto)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
            <div className="rounded-lg border bg-card p-3">
              <p className="text-sm font-medium mb-2">Receita por competência</p>
              <div className="overflow-auto max-h-[360px]">
                <Table>
                  <TableHeader><TableRow><TableHead>Mês</TableHead><TableHead className="text-right">Contas</TableHead><TableHead className="text-right">Faturado</TableHead><TableHead className="text-right">% recebido</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {dashMensal.map((m, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs font-medium">{m.competence_month}</TableCell>
                        <TableCell className="text-right text-xs">{m.contas}</TableCell>
                        <TableCell className="text-right text-xs">{fmtBRL(m.faturado)}</TableCell>
                        <TableCell className="text-right text-xs">{m.pct_recebido ?? 0}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Conferência da conta */}
      <Dialog open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Conferência da Conta</DialogTitle><DialogDescription>{detail?.patient_name} · {detail?.billing_type} · {detail && (BILLING_STATUS_LABELS[detail.status] || detail.status)}</DialogDescription></DialogHeader>
          {detail && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-xs text-muted-foreground">Valor bruto</Label><p>{fmtBRL(detail.total_gross_amount)}</p></div>
                <div><Label className="text-xs text-muted-foreground">Valor líquido</Label><p className="font-medium">{fmtBRL(detail.total_net_amount)}</p></div>
                <div><Label className="text-xs text-muted-foreground">Guia</Label><p>{detail.guide_number || "—"}</p></div>
                <div><Label className="text-xs text-muted-foreground">Autorização</Label><p>{detail.authorization_number || "—"}</p></div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Pendências (glosa preventiva)</Label>
                {issues.length === 0 ? (
                  <div className="rounded bg-success/10 p-2 text-xs flex items-center gap-2 text-success mt-1"><ShieldCheck className="h-4 w-4" />Sem pendências — conta pronta para envio</div>
                ) : (
                  <div className="space-y-1 mt-1">
                    {issues.map((i) => (
                      <div key={i.id} className="rounded bg-warning/10 p-2 text-xs flex items-center justify-between gap-2">
                        <span className="text-warning">{i.issue_label}</span>
                        <Button size="sm" variant="ghost" className="h-5 text-[10px]" onClick={() => resolveIssue(i.id)}>Resolver</Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            {detail && <Button variant="outline" onClick={() => recheckPending(detail)} disabled={busy}>Rodar glosa preventiva</Button>}
            <Button onClick={() => setDetail(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reabrir conta */}
      <Dialog open={!!reopenAcc} onOpenChange={(v) => !v && setReopenAcc(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Reabrir Conta</DialogTitle><DialogDescription>Registra motivo e libera edição de conta enviada.</DialogDescription></DialogHeader>
          <div className="space-y-1.5 py-2"><Label>Motivo da reabertura *</Label><Textarea rows={3} value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} placeholder="Ex: correção de procedimento faturado" /></div>
          <DialogFooter><Button variant="outline" onClick={() => setReopenAcc(null)} disabled={busy}>Cancelar</Button><Button onClick={confirmReopen} disabled={busy}>{busy ? "..." : "Reabrir"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
