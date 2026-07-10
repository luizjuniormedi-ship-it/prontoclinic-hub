import { useEffect, useState, useCallback } from "react";
import { FileText, Search, AlertTriangle, PenLine, CheckCircle2, Send, RotateCcw, ShieldCheck, Printer } from "lucide-react";
import { printReport } from "@/utils/reportPdf";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState } from "@/components/StateViews";
import { reportsService, STATUS_LABELS, STATUS_COLORS, type Report, type ReportType, type ReportStatus } from "@/services/reportsService";
import { toast } from "@/hooks/use-toast";
import { formatDate } from "@/utils/formatters";

const priorityColors: Record<string, string> = {
  urgente: "bg-destructive/10 text-destructive", prioritario: "bg-warning/10 text-warning", rotina: "bg-muted text-muted-foreground",
};

export default function RadiologyReportsPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [types, setTypes] = useState<ReportType[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [stats, setStats] = useState({ total: 0, pendentes: 0, liberados: 0, criticos: 0, atrasados: 0 });

  const [editor, setEditor] = useState<Report | null>(null);
  const [form, setForm] = useState({ technique: "", findings: "", conclusion: "", recommendation: "" });
  const [signDialog, setSignDialog] = useState<Report | null>(null);
  const [signName, setSignName] = useState("");
  const [signCrm, setSignCrm] = useState("");
  const [rectifyDialog, setRectifyDialog] = useState<Report | null>(null);
  const [rectifyMotivo, setRectifyMotivo] = useState("");
  const [criticalDialog, setCriticalDialog] = useState<Report | null>(null);
  const [criticalDesc, setCriticalDesc] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      reportsService.list({
        status: statusFilter !== "all" ? statusFilter : undefined,
        type_id: typeFilter !== "all" ? Number(typeFilter) : undefined,
        priority: priorityFilter !== "all" ? priorityFilter : undefined,
      }),
      reportsService.listTypes(),
      reportsService.stats(),
    ]).then(([r, t, s]) => { setReports(r); setTypes(t); setStats(s); })
      .catch((e) => toast({ title: "Erro ao carregar laudos", description: String(e), variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [statusFilter, typeFilter, priorityFilter]);

  useEffect(load, [load]);

  const [quickTemplates, setQuickTemplates] = useState<Array<{ id: number; nome: string; technique: string | null; findings: string | null; conclusion: string | null }>>([]);

  const openEditor = async (r: Report) => {
    setEditor(r);
    setForm({ technique: r.technique || "", findings: r.findings || "", conclusion: r.conclusion || "", recommendation: r.recommendation || "" });
    setQuickTemplates([]);
    if (r.report_type_id) {
      try { setQuickTemplates(await reportsService.quickTemplates(r.report_type_id)); } catch { /* opcional */ }
    }
  };

  const applyTemplate = (tplId: string) => {
    const tpl = quickTemplates.find((t) => String(t.id) === tplId);
    if (tpl) setForm({ technique: tpl.technique || "", findings: tpl.findings || "", conclusion: tpl.conclusion || "", recommendation: form.recommendation });
  };

  const saveEditor = async () => {
    if (!editor) return;
    setBusy(true);
    try {
      await reportsService.saveDraft(editor.id, form);
      toast({ title: "Laudo salvo", description: "Enviado para revisão" });
      setEditor(null); load();
    } catch (e) { toast({ title: "Erro ao salvar", description: String(e), variant: "destructive" }); }
    finally { setBusy(false); }
  };

  const confirmSign = async () => {
    if (!signDialog || !signName.trim()) { toast({ title: "Informe o radiologista", variant: "destructive" }); return; }
    setBusy(true);
    try {
      await reportsService.sign(signDialog.id, signName.trim(), signCrm.trim());
      await reportsService.release(signDialog.id);
      toast({ title: "Laudo assinado e liberado", description: `Por ${signName.trim()}` });
      setSignDialog(null); setSignName(""); setSignCrm(""); load();
    } catch (e) { toast({ title: "Erro ao assinar", description: String(e), variant: "destructive" }); }
    finally { setBusy(false); }
  };

  const confirmRectify = async () => {
    if (!rectifyDialog || !rectifyMotivo.trim()) { toast({ title: "Informe o motivo", variant: "destructive" }); return; }
    setBusy(true);
    try {
      await reportsService.rectify(rectifyDialog, rectifyMotivo.trim());
      toast({ title: "Laudo em retificação", description: "Nova versão criada, versão anterior preservada" });
      setRectifyDialog(null); setRectifyMotivo(""); load();
    } catch (e) { toast({ title: "Erro", description: String(e), variant: "destructive" }); }
    finally { setBusy(false); }
  };

  const confirmCritical = async () => {
    if (!criticalDialog || !criticalDesc.trim()) { toast({ title: "Descreva o achado crítico", variant: "destructive" }); return; }
    setBusy(true);
    try {
      await reportsService.flagCritical(criticalDialog.id, criticalDesc.trim(), "whatsapp");
      toast({ title: "Achado crítico registrado", description: "Médico solicitante notificado" });
      setCriticalDialog(null); setCriticalDesc(""); load();
    } catch (e) { toast({ title: "Erro", description: String(e), variant: "destructive" }); }
    finally { setBusy(false); }
  };

  const deliver = async (r: Report) => {
    try {
      await reportsService.logDelivery(r.id, "portal", "paciente");
      toast({ title: "Laudo entregue", description: "Disponível no portal do paciente" });
      load();
    } catch (e) { toast({ title: "Erro", description: String(e), variant: "destructive" }); }
  };

  const filtered = reports.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (r.patient_name?.toLowerCase().includes(q) || r.title?.toLowerCase().includes(q) || r.validation_code?.toLowerCase().includes(q));
  });

  const isSigned = (s: ReportStatus) => ["assinado", "liberado", "entregue"].includes(s);
  const canSign = (s: ReportStatus) => ["em_revisao", "aguardando_assinatura", "aguardando_laudo", "em_digitacao"].includes(s);

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Laudos" description="Fila de laudos, edição, assinatura e liberação" />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Card><CardContent className="p-3"><p className="text-lg font-bold">{stats.total}</p><p className="text-[10px] text-muted-foreground">Total (amostra)</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-lg font-bold text-warning">{stats.pendentes}</p><p className="text-[10px] text-muted-foreground">Pendentes</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-lg font-bold text-success">{stats.liberados}</p><p className="text-[10px] text-muted-foreground">Liberados</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-lg font-bold text-destructive">{stats.atrasados}</p><p className="text-[10px] text-muted-foreground">Atrasados (SLA)</p></CardContent></Card>
        <Card><CardContent className="p-3 flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-destructive" /><div><p className="text-lg font-bold text-destructive">{stats.criticos}</p><p className="text-[10px] text-muted-foreground">Achados críticos</p></div></CardContent></Card>
      </div>

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar paciente, exame ou código..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[170px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent><SelectItem value="all">Todos os status</SelectItem>
            {(Object.keys(STATUS_LABELS) as ReportStatus[]).map((s) => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Tipo" /></SelectTrigger>
          <SelectContent><SelectItem value="all">Todos os tipos</SelectItem>
            {types.map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-[130px]"><SelectValue placeholder="Prioridade" /></SelectTrigger>
          <SelectContent><SelectItem value="all">Todas</SelectItem>
            <SelectItem value="urgente">Urgente</SelectItem><SelectItem value="prioritario">Prioritário</SelectItem><SelectItem value="rotina">Rotina</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? <EmptyState icon={FileText} title="Nenhum laudo encontrado" /> : (
        <div className="rounded-lg border bg-card overflow-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Paciente</TableHead><TableHead>Exame</TableHead><TableHead>Tipo</TableHead>
              <TableHead>Status</TableHead><TableHead>Prioridade</TableHead><TableHead>Data</TableHead><TableHead>Código</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={r.id} className={r.has_critical_finding ? "bg-destructive/5" : ""}>
                  <TableCell className="font-medium text-sm">
                    {r.has_critical_finding && <AlertTriangle className="h-3 w-3 text-destructive inline mr-1" />}
                    {r.patient_name || "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate">{r.title || "—"}</TableCell>
                  <TableCell className="text-xs">{r.type_name || "—"}</TableCell>
                  <TableCell><Badge variant="outline" className={`border-0 text-[10px] ${STATUS_COLORS[r.status]}`}>{STATUS_LABELS[r.status]}</Badge></TableCell>
                  <TableCell><Badge variant="outline" className={`border-0 text-[10px] ${priorityColors[r.priority]}`}>{r.priority}</Badge></TableCell>
                  <TableCell className="text-xs">{formatDate(r.created_at)}</TableCell>
                  <TableCell className="text-[10px] font-mono text-muted-foreground">{r.validation_code || "—"}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => openEditor(r)} title="Editar/Ver"><PenLine className="h-3 w-3" /></Button>
                      <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => printReport(r)} title="Imprimir/PDF"><Printer className="h-3 w-3" /></Button>
                      {canSign(r.status) && <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => { setSignName(r.signed_by_name || ""); setSignCrm(r.signed_by_crm || ""); setSignDialog(r); }} title="Assinar"><CheckCircle2 className="h-3 w-3 text-success" /></Button>}
                      {r.status === "liberado" && <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => deliver(r)} title="Entregar"><Send className="h-3 w-3 text-primary" /></Button>}
                      {isSigned(r.status) && <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setRectifyDialog(r)} title="Retificar"><RotateCcw className="h-3 w-3 text-warning" /></Button>}
                      {!r.has_critical_finding && <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setCriticalDialog(r)} title="Marcar achado crítico"><AlertTriangle className="h-3 w-3 text-destructive" /></Button>}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Editor de laudo (estruturado) */}
      <Dialog open={!!editor} onOpenChange={(v) => !v && setEditor(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editor?.title || "Laudo"} {editor?.is_rectified && <Badge variant="outline" className="ml-2 text-[10px]">Retificado v{editor?.version}</Badge>}</DialogTitle>
            <DialogDescription>{editor?.patient_name} · {editor?.type_name} · {editor && STATUS_LABELS[editor.status]}</DialogDescription>
          </DialogHeader>
          {editor && (
            <div className="grid grid-cols-2 gap-2 text-xs border-b pb-2">
              <div>
                <Label className="text-[10px] text-muted-foreground">Médico executor / laudador</Label>
                <p className="font-medium">{editor.executor_name || editor.signed_by_name || "—"}{editor.executor_crm ? ` (${editor.executor_crm})` : ""}</p>
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">Médico solicitante</Label>
                <p className="font-medium">{editor.requester_name || "—"}</p>
              </div>
            </div>
          )}
          {editor && isSigned(editor.status) ? (
            <div className="space-y-3 text-sm">
              <div><Label className="text-xs text-muted-foreground">Técnica</Label><p className="whitespace-pre-wrap">{editor.technique || "—"}</p></div>
              <div><Label className="text-xs text-muted-foreground">Achados</Label><p className="whitespace-pre-wrap">{editor.findings || "—"}</p></div>
              <div><Label className="text-xs text-muted-foreground">Conclusão / Impressão</Label><p className="whitespace-pre-wrap font-medium">{editor.conclusion || "—"}</p></div>
              <div className="rounded bg-muted/50 p-2 text-xs flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-success" />Assinado por {editor.signed_by_name} ({editor.signed_by_crm}) · Código {editor.validation_code}</div>
              <p className="text-[10px] text-muted-foreground">Laudo assinado é somente-leitura. Use "Retificar" para gerar nova versão.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {quickTemplates.length > 0 && (
                <div className="flex items-center gap-2 rounded-md bg-muted/50 p-2">
                  <Label className="text-xs whitespace-nowrap">Laudo normal / modelo:</Label>
                  <Select onValueChange={applyTemplate}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Aplicar modelo..." /></SelectTrigger>
                    <SelectContent>{quickTemplates.map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.nome}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
              <div><Label className="text-xs">Técnica</Label><Textarea rows={2} value={form.technique} onChange={(e) => setForm({ ...form, technique: e.target.value })} /></div>
              <div><Label className="text-xs">Achados</Label><Textarea rows={6} value={form.findings} onChange={(e) => setForm({ ...form, findings: e.target.value })} /></div>
              <div><Label className="text-xs">Conclusão / Impressão</Label><Textarea rows={3} value={form.conclusion} onChange={(e) => setForm({ ...form, conclusion: e.target.value })} /></div>
              <div><Label className="text-xs">Recomendação</Label><Textarea rows={2} value={form.recommendation} onChange={(e) => setForm({ ...form, recommendation: e.target.value })} /></div>
            </div>
          )}
          {editor && !isSigned(editor.status) && (
            <DialogFooter><Button variant="outline" onClick={() => setEditor(null)}>Fechar</Button><Button onClick={saveEditor} disabled={busy}>{busy ? "Salvando..." : "Salvar e enviar p/ revisão"}</Button></DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* Assinatura */}
      <Dialog open={!!signDialog} onOpenChange={(v) => !v && setSignDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Assinar Laudo</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="rounded-lg bg-muted/50 p-3 text-sm"><p className="font-medium">{signDialog?.patient_name}</p><p className="text-xs text-muted-foreground truncate">{signDialog?.conclusion || signDialog?.title}</p></div>
            <div className="space-y-1.5"><Label>Radiologista *</Label><Input value={signName} onChange={(e) => setSignName(e.target.value)} placeholder="Nome completo" autoFocus /></div>
            <div className="space-y-1.5"><Label>CRM / RQE</Label><Input value={signCrm} onChange={(e) => setSignCrm(e.target.value)} placeholder="CRM-RJ 00000" /></div>
            <p className="text-[10px] text-muted-foreground">A assinatura registra data/hora, libera o laudo e o torna somente-leitura.</p>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setSignDialog(null)} disabled={busy}>Cancelar</Button><Button onClick={confirmSign} disabled={busy}>{busy ? "Assinando..." : "Assinar e liberar"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Retificação */}
      <Dialog open={!!rectifyDialog} onOpenChange={(v) => !v && setRectifyDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Retificar Laudo</DialogTitle><DialogDescription>Cria uma nova versão preservando a anterior.</DialogDescription></DialogHeader>
          <div className="space-y-1.5 py-2"><Label>Motivo da retificação *</Label><Textarea rows={3} value={rectifyMotivo} onChange={(e) => setRectifyMotivo(e.target.value)} placeholder="Ex: correção de medida do nódulo" /></div>
          <DialogFooter><Button variant="outline" onClick={() => setRectifyDialog(null)} disabled={busy}>Cancelar</Button><Button onClick={confirmRectify} disabled={busy}>{busy ? "..." : "Retificar"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Achado crítico */}
      <Dialog open={!!criticalDialog} onOpenChange={(v) => !v && setCriticalDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-destructive" />Achado Crítico</DialogTitle><DialogDescription>Notifica o médico solicitante e registra ciência.</DialogDescription></DialogHeader>
          <div className="space-y-1.5 py-2"><Label>Descrição do achado *</Label><Textarea rows={3} value={criticalDesc} onChange={(e) => setCriticalDesc(e.target.value)} placeholder="Ex: suspeita de neoplasia, TEP, pneumotórax..." /></div>
          <DialogFooter><Button variant="outline" onClick={() => setCriticalDialog(null)} disabled={busy}>Cancelar</Button><Button variant="destructive" onClick={confirmCritical} disabled={busy}>{busy ? "..." : "Registrar e alertar"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
