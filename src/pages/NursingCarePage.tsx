import { useEffect, useState, useCallback } from "react";
import { Pill, AlertTriangle, Syringe, ClipboardList, ShieldCheck, Plus, XCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState } from "@/components/StateViews";
import { nursingCareService, type MedAdmin, type NursingIncident, type NursingProcedure } from "@/services/nursingCareService";
import { supabase } from "@/lib/supabase";
import { toast } from "@/hooks/use-toast";
import { formatDate } from "@/utils/formatters";
import { useConfirm } from "@/hooks/useConfirm";

const medStatusColor: Record<string, string> = {
  em_preparo: "bg-warning/10 text-warning", administrado: "bg-success/10 text-success",
  recusado: "bg-destructive/10 text-destructive", pendente: "bg-muted text-muted-foreground",
};
const sevColor: Record<string, string> = {
  leve: "bg-muted text-muted-foreground", moderada: "bg-warning/10 text-warning",
  grave: "bg-destructive/10 text-destructive", critica: "bg-destructive/20 text-destructive",
};

export default function NursingCarePage() {
  const { promptText } = useConfirm();
  const [meds, setMeds] = useState<MedAdmin[]>([]);
  const [incidents, setIncidents] = useState<NursingIncident[]>([]);
  const [procedures, setProcedures] = useState<NursingProcedure[]>([]);
  const [stats, setStats] = useState({ medPendentes: 0, medAdministradas: 0, incidentesGraves: 0, procedimentos: 0 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // checagem beira-leito
  const [checkMed, setCheckMed] = useState<MedAdmin | null>(null);
  const [checks, setChecks] = useState<Array<{ certo: string; ok: boolean }>>([]);
  // nova intercorrência
  const [incOpen, setIncOpen] = useState(false);
  const [incForm, setIncForm] = useState({ patient_id: "", incident_type: "queda", severity: "moderada", description: "" });

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([nursingCareService.medications(), nursingCareService.incidents(), nursingCareService.procedures(), nursingCareService.stats()])
      .then(([m, i, p, s]) => { setMeds(m); setIncidents(i); setProcedures(p); setStats(s); })
      .catch((e) => toast({ title: "Erro ao carregar enfermagem", description: String(e), variant: "destructive" }))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const openBedside = async (m: MedAdmin) => {
    setCheckMed(m);
    try { setChecks(await nursingCareService.bedsideCheck(m.id, m.patient_id)); }
    catch (e) { toast({ title: "Erro na checagem", description: String(e), variant: "destructive" }); }
  };

  const confirmAdminister = async () => {
    if (!checkMed) return;
    setBusy(true);
    try { await nursingCareService.administer(checkMed.id); toast({ title: "Medicamento administrado", description: "Checagem beira-leito confirmada" }); setCheckMed(null); load(); }
    catch (e) { toast({ title: "Erro", description: String(e), variant: "destructive" }); }
    finally { setBusy(false); }
  };

  const refuseMed = async (m: MedAdmin) => {
    const reason = await promptText({ title: "Recusa de medicação", label: "Motivo da recusa", required: true });
    if (!reason) return;
    try { await nursingCareService.refuse(m.id, reason); toast({ title: "Recusa registrada" }); load(); }
    catch (e) { toast({ title: "Erro", description: String(e), variant: "destructive" }); }
  };

  const createIncident = async () => {
    if (!incForm.patient_id || !incForm.description.trim()) { toast({ title: "Preencha paciente e descrição", variant: "destructive" }); return; }
    setBusy(true);
    try {
      const inc = await nursingCareService.createIncident({ patient_id: Number(incForm.patient_id), incident_type: incForm.incident_type, severity: incForm.severity, description: incForm.description.trim() });
      toast({ title: "Intercorrência registrada", description: inc.medico_notificado ? "Médico notificado automaticamente" : "Registrada" });
      setIncOpen(false); setIncForm({ patient_id: "", incident_type: "queda", severity: "moderada", description: "" }); load();
    } catch (e) { toast({ title: "Erro", description: String(e), variant: "destructive" }); }
    finally { setBusy(false); }
  };

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Enfermagem — Cuidados" description="Medicação, procedimentos e intercorrências" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Card><CardContent className="p-3 flex items-center gap-2"><Pill className="h-4 w-4 text-warning" /><div><p className="text-lg font-bold text-warning">{stats.medPendentes}</p><p className="text-[10px] text-muted-foreground">Medicações pendentes</p></div></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-lg font-bold text-success">{stats.medAdministradas}</p><p className="text-[10px] text-muted-foreground">Administradas</p></CardContent></Card>
        <Card><CardContent className="p-3 flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-destructive" /><div><p className="text-lg font-bold text-destructive">{stats.incidentesGraves}</p><p className="text-[10px] text-muted-foreground">Intercorrências graves</p></div></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-lg font-bold">{stats.procedimentos}</p><p className="text-[10px] text-muted-foreground">Procedimentos</p></CardContent></Card>
      </div>

      <Tabs defaultValue="medicacao">
        <TabsList>
          <TabsTrigger value="medicacao">Medicação</TabsTrigger>
          <TabsTrigger value="intercorrencias">Intercorrências</TabsTrigger>
          <TabsTrigger value="procedimentos">Procedimentos</TabsTrigger>
        </TabsList>

        <TabsContent value="medicacao">
          <div className="rounded-lg border bg-card overflow-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Paciente</TableHead><TableHead>Medicamento</TableHead><TableHead>Dose/Via</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {meds.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="text-sm font-medium">{m.patient_name || "—"}</TableCell>
                    <TableCell className="text-sm">{m.medication}</TableCell>
                    <TableCell className="text-xs">{m.dose || "—"} {m.via || ""}</TableCell>
                    <TableCell><Badge variant="outline" className={`border-0 text-[10px] ${medStatusColor[m.status] || ""}`}>{m.status}</Badge></TableCell>
                    <TableCell>
                      {["em_preparo", "pendente"].includes(m.status) && (
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => openBedside(m)} title="Checagem beira-leito"><ShieldCheck className="h-3 w-3 text-primary" /></Button>
                          <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => refuseMed(m)} title="Recusa"><XCircle className="h-3 w-3 text-destructive" /></Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {meds.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground text-sm py-6">Sem medicações</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="intercorrencias" className="space-y-2">
          <div className="flex justify-end"><Button size="sm" onClick={() => setIncOpen(true)}><Plus className="h-4 w-4 mr-1" />Nova intercorrência</Button></div>
          <div className="rounded-lg border bg-card overflow-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Paciente</TableHead><TableHead>Tipo</TableHead><TableHead>Gravidade</TableHead><TableHead>Descrição</TableHead><TableHead>Médico</TableHead><TableHead>Data</TableHead></TableRow></TableHeader>
              <TableBody>
                {incidents.map((i) => (
                  <TableRow key={i.id} className={["grave", "critica"].includes(i.severity) ? "bg-destructive/5" : ""}>
                    <TableCell className="text-sm font-medium">{i.patient_name || "—"}</TableCell>
                    <TableCell className="text-xs">{i.incident_type}</TableCell>
                    <TableCell><Badge variant="outline" className={`border-0 text-[10px] ${sevColor[i.severity] || ""}`}>{i.severity}</Badge></TableCell>
                    <TableCell className="text-xs max-w-[240px] truncate">{i.description}</TableCell>
                    <TableCell>{i.medico_notificado ? <Badge variant="outline" className="text-[10px] bg-success/10 text-success border-0">notificado</Badge> : "—"}</TableCell>
                    <TableCell className="text-xs">{formatDate(i.created_at)}</TableCell>
                  </TableRow>
                ))}
                {incidents.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground text-sm py-6">Sem intercorrências</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="procedimentos">
          <div className="rounded-lg border bg-card overflow-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Tipo</TableHead><TableHead>Descrição</TableHead><TableHead>Faturável</TableHead><TableHead>Data</TableHead></TableRow></TableHeader>
              <TableBody>
                {procedures.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="text-sm">{p.procedure_type}</TableCell>
                    <TableCell className="text-xs">{p.description || "—"}</TableCell>
                    <TableCell>{p.faturavel ? <Badge variant="outline" className="text-[10px]">sim</Badge> : "—"}</TableCell>
                    <TableCell className="text-xs">{formatDate(p.performed_at)}</TableCell>
                  </TableRow>
                ))}
                {procedures.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground text-sm py-6">Sem procedimentos</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      {/* Checagem beira-leito */}
      <Dialog open={!!checkMed} onOpenChange={(v) => !v && setCheckMed(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Checagem Beira-Leito</DialogTitle></DialogHeader>
          <div className="space-y-2 py-2">
            <div className="rounded bg-muted/50 p-2 text-sm"><b>{checkMed?.patient_name}</b><br />{checkMed?.medication} · {checkMed?.dose} {checkMed?.via}</div>
            <div className="space-y-1">
              {checks.map((c, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  {c.ok ? <CheckCircle2 className="h-4 w-4 text-success" /> : <XCircle className="h-4 w-4 text-destructive" />}
                  <span className={c.ok ? "" : "text-destructive"}>{c.certo.replace(/_/g, " ")}</span>
                </div>
              ))}
            </div>
            {checks.some((c) => !c.ok) && <p className="text-[10px] text-destructive">Há itens não confirmados — revise antes de administrar.</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCheckMed(null)} disabled={busy}>Cancelar</Button>
            <Button onClick={confirmAdminister} disabled={busy || checks.some((c) => !c.ok)}>{busy ? "..." : "Confirmar administração"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Nova intercorrência */}
      <Dialog open={incOpen} onOpenChange={setIncOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Nova Intercorrência</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>ID do paciente *</Label><Input value={incForm.patient_id} onChange={(e) => setIncForm({ ...incForm, patient_id: e.target.value })} placeholder="ID" /></div>
            <div><Label>Tipo</Label>
              <Select value={incForm.incident_type} onValueChange={(v) => setIncForm({ ...incForm, incident_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["queda", "reacao_medicamentosa", "piora_clinica", "convulsao", "sincope", "pcr", "hipoglicemia", "sangramento", "evasao"].map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Gravidade</Label>
              <Select value={incForm.severity} onValueChange={(v) => setIncForm({ ...incForm, severity: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["leve", "moderada", "grave", "critica"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground mt-1">Grave/crítica notifica o médico automaticamente.</p>
            </div>
            <div><Label>Descrição *</Label><Textarea rows={3} value={incForm.description} onChange={(e) => setIncForm({ ...incForm, description: e.target.value })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setIncOpen(false)} disabled={busy}>Cancelar</Button><Button onClick={createIncident} disabled={busy}>{busy ? "..." : "Registrar"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
