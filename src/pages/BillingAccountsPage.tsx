import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { Receipt, Search, AlertTriangle, Loader2, RotateCcw, CalendarRange, LockKeyhole, ClipboardCheck, UserCheck, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState } from "@/components/StateViews";
import {
  billingAccountsService,
  BILLING_STATUS_LABELS,
  type BillingAccount,
  type BillingAuditQueueItem,
  type BillingCompetence,
} from "@/services/billingAccountsService";
import { toast } from "@/hooks/use-toast";

const fmtBRL = (v: number) => (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function BillingAccountsPage() {
  const [searchParams] = useSearchParams();
  const requestedAccountId = searchParams.get("account");
  const requestedAppointmentId = searchParams.get("appointment");
  const parsedAppointmentId = requestedAppointmentId && /^\d+$/.test(requestedAppointmentId)
    ? Number(requestedAppointmentId)
    : null;
  const hasFocusedHandoff = requestedAccountId !== null || requestedAppointmentId !== null;
  const [accounts, setAccounts] = useState<BillingAccount[]>([]);
  const [stats, setStats] = useState({ total: 0, abertas: 0, prontas: 0, comPendencia: 0, enviadas: 0, pagas: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [pendingOnly, setPendingOnly] = useState(false);
  const [activeTab, setActiveTab] = useState("accounts");
  const [competences, setCompetences] = useState<BillingCompetence[]>([]);
  const [competencesLoading, setCompetencesLoading] = useState(false);
  const [competencesError, setCompetencesError] = useState<string | null>(null);
  const [selectedCompetence, setSelectedCompetence] = useState<BillingCompetence | null>(null);
  const [competenceReason, setCompetenceReason] = useState("");
  const [updatingCompetence, setUpdatingCompetence] = useState(false);
  const [auditQueue, setAuditQueue] = useState<BillingAuditQueueItem[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [selectedAudit, setSelectedAudit] = useState<BillingAuditQueueItem | null>(null);
  const [auditOpinion, setAuditOpinion] = useState("");
  const [auditEvidence, setAuditEvidence] = useState("");
  const [updatingAudit, setUpdatingAudit] = useState(false);

  const [detail, setDetail] = useState<BillingAccount | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [focusedError, setFocusedError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setFocusedError(null);
    if (hasFocusedHandoff) {
      if ((requestedAppointmentId !== null && parsedAppointmentId === null) || !requestedAccountId) {
        setAccounts([]);
        setStats(billingAccountsService.stats([]));
        setFocusedError("Referência da conta recebida da Recepção é inválida.");
        setLoading(false);
        return;
      }
      billingAccountsService.getFocused(requestedAccountId, parsedAppointmentId)
        .then((focusedAccount) => {
          setAccounts([focusedAccount]);
          setStats(billingAccountsService.stats([focusedAccount]));
          setDetail(focusedAccount);
        })
        .catch((error) => {
          setAccounts([]);
          setStats(billingAccountsService.stats([]));
          setFocusedError(String(error));
        })
        .finally(() => setLoading(false));
      return;
    }
    billingAccountsService.list({
        status: statusFilter !== "all" ? statusFilter : undefined,
        billing_type: typeFilter !== "all" ? typeFilter : undefined,
        onlyPending: pendingOnly || undefined,
      })
      .then((nextAccounts) => {
        setAccounts(nextAccounts);
        setStats(billingAccountsService.stats(nextAccounts));
      })
      .catch((e) => toast({ title: "Erro ao carregar faturamento", description: String(e), variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [statusFilter, typeFilter, pendingOnly, hasFocusedHandoff, requestedAccountId, requestedAppointmentId, parsedAppointmentId]);

  useEffect(load, [load]);

  const loadCompetences = useCallback(async () => {
    setCompetencesLoading(true);
    setCompetencesError(null);
    try {
      setCompetences(await billingAccountsService.listCompetences());
    } catch (error) {
      setCompetencesError(String(error));
    } finally {
      setCompetencesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "competences") void loadCompetences();
  }, [activeTab, loadCompetences]);

  const loadAuditQueue = useCallback(async () => {
    setAuditLoading(true);
    setAuditError(null);
    try {
      setAuditQueue(await billingAccountsService.listAuditQueue());
    } catch (error) {
      setAuditError(String(error));
    } finally {
      setAuditLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "audit") void loadAuditQueue();
  }, [activeTab, loadAuditQueue]);

  const reviewAccount = async () => {
    if (!detail) return;
    setReviewing(true);
    try {
      const readiness = await billingAccountsService.review(detail);
      setDetail((current) => current ? {
        ...current,
        status: readiness.status,
        version: readiness.version,
        has_pending_issues: readiness.blocking_count > 0,
        readiness,
      } : current);
      toast({
        title: readiness.can_close ? "Conta revisada sem bloqueios" : "Conta revisada com pendências",
        description: readiness.can_close
          ? "A conferência financeira foi atualizada."
          : `${readiness.blocking_count} pendência(s) bloqueadora(s) encontrada(s).`,
      });
      load();
    } catch (error) {
      toast({ title: "Não foi possível revisar a conta", description: String(error), variant: "destructive" });
    } finally {
      setReviewing(false);
    }
  };

  const reopenAccount = async () => {
    if (!detail) return;
    setReopening(true);
    try {
      const result = await billingAccountsService.reopen(detail, reopenReason);
      setDetail((current) => current ? {
        ...current,
        status: result.status,
        version: result.version,
        is_reopened: true,
      } : current);
      setReopenReason("");
      toast({ title: "Conta reaberta", description: "A operação foi registrada na trilha de auditoria." });
      load();
    } catch (error) {
      toast({ title: "Não foi possível reabrir a conta", description: String(error), variant: "destructive" });
    } finally {
      setReopening(false);
    }
  };

  const updateCompetence = async () => {
    if (!selectedCompetence) return;
    setUpdatingCompetence(true);
    try {
      const result = selectedCompetence.status === "open"
        ? await billingAccountsService.closeCompetence(selectedCompetence, competenceReason)
        : await billingAccountsService.reopenCompetence(selectedCompetence, competenceReason);
      toast({
        title: result.status === "closed" ? "Competência fechada" : "Competência reaberta",
        description: "A operação foi registrada com versão e trilha de auditoria.",
      });
      setSelectedCompetence(null);
      setCompetenceReason("");
      await loadCompetences();
    } catch (error) {
      toast({ title: "Não foi possível atualizar a competência", description: String(error), variant: "destructive" });
    } finally {
      setUpdatingCompetence(false);
    }
  };

  const claimAudit = async (item: BillingAuditQueueItem) => {
    setUpdatingAudit(true);
    try {
      await billingAccountsService.claimAudit(item);
      toast({ title: "Conta assumida para auditoria" });
      await loadAuditQueue();
    } catch (error) {
      toast({ title: "Não foi possível assumir a auditoria", description: String(error), variant: "destructive" });
    } finally {
      setUpdatingAudit(false);
    }
  };

  const decideAudit = async (decision: "approved" | "returned" | "escalated") => {
    if (!selectedAudit) return;
    setUpdatingAudit(true);
    try {
      await billingAccountsService.decideAudit(selectedAudit, decision, auditOpinion, auditEvidence);
      toast({
        title: decision === "approved"
          ? "Conta aprovada para envio"
          : decision === "returned" ? "Conta devolvida para correção" : "Conta escalada",
      });
      setSelectedAudit(null);
      setAuditOpinion("");
      setAuditEvidence("");
      await loadAuditQueue();
      load();
    } catch (error) {
      toast({ title: "Não foi possível concluir a auditoria", description: String(error), variant: "destructive" });
    } finally {
      setUpdatingAudit(false);
    }
  };

  const filtered = accounts.filter((a) => !search || a.patient_name?.toLowerCase().includes(search.toLowerCase()) || a.guide_number?.toLowerCase().includes(search.toLowerCase()));

  if (loading) return <LoadingState />;

  if (focusedError) {
    return (
      <div className="space-y-6 animate-fade-in">
        <PageHeader title="Faturamento" description="Pré-contas abertas pelos atendimentos da Recepção" />
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-4">
          <p className="font-medium text-destructive">Conta da recepção não localizada</p>
          <p className="text-sm text-muted-foreground">{focusedError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Faturamento" description="Pré-contas abertas pelos atendimentos da Recepção" />

      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <Card><CardContent className="p-3"><p className="text-lg font-bold">{stats.total}</p><p className="text-[10px] text-muted-foreground">Contas (amostra)</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-lg font-bold">{stats.abertas}</p><p className="text-[10px] text-muted-foreground">Abertas</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-lg font-bold text-success">{stats.prontas}</p><p className="text-[10px] text-muted-foreground">Prontas p/ envio</p></CardContent></Card>
        <Card><CardContent className="p-3 flex items-center gap-1"><AlertTriangle className="h-4 w-4 text-warning" /><div><p className="text-lg font-bold text-warning">{stats.comPendencia}</p><p className="text-[10px] text-muted-foreground">Com pendência</p></div></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-lg font-bold text-primary">{stats.enviadas}</p><p className="text-[10px] text-muted-foreground">Enviadas</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-lg font-bold text-success">{stats.pagas}</p><p className="text-[10px] text-muted-foreground">Pagas</p></CardContent></Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList aria-label="Visões do faturamento">
          <TabsTrigger value="accounts">Pré-contas</TabsTrigger>
          <TabsTrigger value="audit">Auditoria</TabsTrigger>
          <TabsTrigger value="competences">Competências</TabsTrigger>
        </TabsList>

        <TabsContent value="accounts" className="space-y-3">
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
                          <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setDetail(a)} title="Conferir"><Receipt className="h-3 w-3" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="audit">
          {auditLoading ? (
            <LoadingState />
          ) : auditError ? (
            <div role="alert" className="flex flex-col items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4">
              <div>
                <p className="font-medium text-destructive">Não foi possível carregar a fila de auditoria</p>
                <p className="text-sm text-muted-foreground">{auditError}</p>
              </div>
              <Button variant="outline" onClick={() => void loadAuditQueue()}>Tentar novamente</Button>
            </div>
          ) : auditQueue.length === 0 ? (
            <EmptyState icon={ClipboardCheck} title="Nenhuma conta na fila de auditoria" />
          ) : (
            <div className="rounded-lg border bg-card overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Paciente</TableHead>
                    <TableHead>Guia</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Responsável</TableHead>
                    <TableHead>SLA</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="w-28"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auditQueue.map((item) => (
                    <TableRow key={item.account_id}>
                      <TableCell className="font-medium">{item.patient_name || "—"}</TableCell>
                      <TableCell className="text-xs font-mono">{item.guide_number || "—"}</TableCell>
                      <TableCell>
                        <Badge variant={item.sla_overdue ? "destructive" : "outline"}>
                          {item.review_status || BILLING_STATUS_LABELS[item.account_status] || item.account_status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{item.reviewer_name || "Não atribuída"}</TableCell>
                      <TableCell className={item.sla_overdue ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
                        <Clock className="mr-1 inline h-3 w-3" />
                        {item.deadline_at ? new Date(item.deadline_at).toLocaleString("pt-BR") : "Aguardando atribuição"}
                      </TableCell>
                      <TableCell className="text-right">{fmtBRL(item.total_net_amount)}</TableCell>
                      <TableCell>
                        {item.review_status === "assigned" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSelectedAudit(item);
                              setAuditOpinion("");
                              setAuditEvidence("");
                            }}
                          >
                            <ClipboardCheck className="h-4 w-4" />
                            Decidir
                          </Button>
                        ) : item.review_status == null || ["returned", "escalated"].includes(item.review_status) ? (
                          <Button size="sm" variant="outline" disabled={updatingAudit} onClick={() => void claimAudit(item)}>
                            <UserCheck className="h-4 w-4" />
                            Assumir
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="competences">
          {competencesLoading ? (
            <LoadingState />
          ) : competencesError ? (
            <div role="alert" className="flex flex-col items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4">
              <div>
                <p className="font-medium text-destructive">Não foi possível carregar as competências</p>
                <p className="text-sm text-muted-foreground">{competencesError}</p>
              </div>
              <Button variant="outline" onClick={() => void loadCompetences()}>Tentar novamente</Button>
            </div>
          ) : competences.length === 0 ? (
            <EmptyState icon={CalendarRange} title="Nenhuma competência disponível" />
          ) : (
            <div className="rounded-lg border bg-card overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Competência</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Contas</TableHead>
                    <TableHead>Última alteração</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {competences.map((competence) => (
                    <TableRow key={competence.competence_month}>
                      <TableCell className="font-medium">{competence.competence_month.slice(0, 7)}</TableCell>
                      <TableCell>
                        <Badge variant={competence.status === "closed" ? "secondary" : "outline"}>
                          {competence.status === "closed" ? "Fechada" : "Aberta"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{competence.account_count}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(competence.updated_at).toLocaleString("pt-BR")}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="icon"
                          variant="ghost"
                          title={competence.status === "open" ? "Fechar competência" : "Reabrir competência"}
                          onClick={() => {
                            setSelectedCompetence(competence);
                            setCompetenceReason("");
                          }}
                        >
                          {competence.status === "open"
                            ? <LockKeyhole className="h-4 w-4" />
                            : <RotateCcw className="h-4 w-4" />}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Conferência da conta */}
      <Dialog
        open={!!detail}
        onOpenChange={(open) => {
          if (open) return;
          setDetail(null);
        }}
      >
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
              <div role="status" className={detail.readiness.blocking_count > 0
                ? "rounded bg-warning/10 p-2 text-xs text-warning"
                : "rounded bg-success/10 p-2 text-xs text-success"
              }>
                {detail.readiness.blocking_count > 0
                  ? `${detail.readiness.blocking_count} pendência(s) bloqueadora(s): ${detail.readiness.issues.map((issue) => issue.code).join(", ")}`
                  : "Nenhuma pendência bloqueadora na última revisão."}
              </div>
              {(["pronta_envio", "baixada", "cancelada"] as const).includes(
                detail.status as "pronta_envio" | "baixada" | "cancelada",
              ) && (
                <div className="space-y-2 border-t pt-3">
                  <Label htmlFor="reopen-reason">Motivo da reabertura</Label>
                  <Textarea
                    id="reopen-reason"
                    value={reopenReason}
                    onChange={(event) => setReopenReason(event.target.value)}
                    placeholder="Informe o motivo auditável"
                  />
                  <Button
                    variant="outline"
                    onClick={() => void reopenAccount()}
                    disabled={reopening || !reopenReason.trim()}
                  >
                    {reopening ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                    Reabrir conta
                  </Button>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => void reviewAccount()} disabled={reviewing}>
              {reviewing && <Loader2 className="h-4 w-4 animate-spin" />}
              Revisar pendências
            </Button>
            <Button onClick={() => setDetail(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!selectedAudit}
        onOpenChange={(open) => {
          if (open || updatingAudit) return;
          setSelectedAudit(null);
          setAuditOpinion("");
          setAuditEvidence("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Decisão da auditoria</DialogTitle>
            <DialogDescription>
              {selectedAudit?.patient_name || "Conta"} · guia {selectedAudit?.guide_number || "não informada"}.
              Aprovação só será aceita sem pendências bloqueadoras.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="audit-opinion">Parecer</Label>
              <Textarea id="audit-opinion" value={auditOpinion} onChange={(event) => setAuditOpinion(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="audit-evidence">Evidência verificada</Label>
              <Textarea
                id="audit-evidence"
                value={auditEvidence}
                onChange={(event) => setAuditEvidence(event.target.value)}
                placeholder="Descreva guia, autorização, assinatura, laudo e valores conferidos"
              />
            </div>
          </div>
          <DialogFooter className="flex-wrap">
            <Button variant="outline" disabled={updatingAudit} onClick={() => setSelectedAudit(null)}>Cancelar</Button>
            <Button
              variant="destructive"
              disabled={updatingAudit || !auditOpinion.trim() || !auditEvidence.trim()}
              onClick={() => void decideAudit("returned")}
            >
              Devolver
            </Button>
            <Button
              variant="secondary"
              disabled={updatingAudit || !auditOpinion.trim() || !auditEvidence.trim()}
              onClick={() => void decideAudit("escalated")}
            >
              Escalar
            </Button>
            <Button
              disabled={updatingAudit || !auditOpinion.trim() || !auditEvidence.trim()}
              onClick={() => void decideAudit("approved")}
            >
              {updatingAudit && <Loader2 className="h-4 w-4 animate-spin" />}
              Aprovar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!selectedCompetence}
        onOpenChange={(open) => {
          if (open || updatingCompetence) return;
          setSelectedCompetence(null);
          setCompetenceReason("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedCompetence?.status === "open" ? "Fechar competência" : "Reabrir competência"}
            </DialogTitle>
            <DialogDescription>
              Competência {selectedCompetence?.competence_month.slice(0, 7)} com {selectedCompetence?.account_count} conta(s).
              A operação exige autenticação AAL2 e será auditada.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="competence-reason">Motivo</Label>
            <Textarea
              id="competence-reason"
              value={competenceReason}
              onChange={(event) => setCompetenceReason(event.target.value)}
              placeholder="Informe o motivo auditável"
              disabled={updatingCompetence}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSelectedCompetence(null)}
              disabled={updatingCompetence}
            >
              Cancelar
            </Button>
            <Button
              onClick={() => void updateCompetence()}
              disabled={updatingCompetence || !competenceReason.trim()}
            >
              {updatingCompetence && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

