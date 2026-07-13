import { useEffect, useState, useCallback } from "react";
import { Stethoscope, Search, AlertTriangle, ShieldAlert, CheckCircle2, Activity, ClipboardList } from "lucide-react";
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
import { LoadingState, EmptyState, ErrorState } from "@/components/StateViews";
import { encountersService, ENCOUNTER_MUTATION_BLOCK_REASON, ENC_STATUS_LABELS, type Encounter, type Diagnosis, type Allergy, type Problem, type Medication, type SafetyAlert } from "@/services/encountersService";
import { toast } from "@/hooks/use-toast";
import { formatDate } from "@/utils/formatters";

const isSigned = (s: string) => ["assinado", "finalizado"].includes(s);

export default function EncountersPage() {
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openingEncounterId, setOpeningEncounterId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const [detail, setDetail] = useState<Encounter | null>(null);
  const [diagnoses, setDiagnoses] = useState<Diagnosis[]>([]);
  const [allergies, setAllergies] = useState<Allergy[]>([]);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [form, setForm] = useState({ chief_complaint: "", summary: "" });

  // prescrição com checagem de segurança
  const [rxMed, setRxMed] = useState("");
  const [rxAlerts, setRxAlerts] = useState<SafetyAlert[]>([]);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    encountersService.list({ status: statusFilter !== "all" ? statusFilter : undefined })
      .then(setEncounters)
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Nao foi possivel carregar os atendimentos."))
      .finally(() => setLoading(false));
  }, [statusFilter]);

  useEffect(load, [load]);

  const openDetail = async (e: Encounter) => {
    setOpeningEncounterId(e.id);
    setDiagnoses([]); setAllergies([]); setProblems([]); setMedications([]);
    setRxMed(""); setRxAlerts([]);
    try {
      if (e.patient_id) {
        const [dx, al, pr, md] = await Promise.all([
          encountersService.diagnoses(e.id),
          encountersService.allergies(e.patient_id),
          encountersService.problems(e.patient_id),
          encountersService.medications(e.patient_id),
        ]);
        setDiagnoses(dx); setAllergies(al); setProblems(pr); setMedications(md);
      }
      setForm({ chief_complaint: e.chief_complaint || "", summary: e.summary || "" });
      setDetail(e);
    } catch (error) {
      toast({
        title: "Erro ao abrir prontuario",
        description: error instanceof Error ? error.message : "Nao foi possivel carregar os dados clinicos.",
        variant: "destructive",
      });
    } finally {
      setOpeningEncounterId(null);
    }
  };

  const checkRx = async () => {
    if (!detail?.patient_id || !rxMed.trim()) return;
    try {
      const alerts = await encountersService.checkPrescriptionSafety(detail.patient_id, rxMed.trim());
      setRxAlerts(alerts);
      if (alerts.length === 0) toast({ title: "Prescrição segura", description: "Nenhum alerta de alergia ou interação" });
      else toast({ title: `${alerts.length} alerta(s) de segurança`, variant: "destructive" });
    } catch (e) { toast({ title: "Erro", description: String(e), variant: "destructive" }); }
  };


  const filtered = encounters.filter((e) => !search || e.patient_name?.toLowerCase().includes(search.toLowerCase()));

  if (loading) return <LoadingState />;
  if (loadError) return <ErrorState message={loadError} onRetry={load} />;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Prontuário / Atendimentos" description="Atendimento clínico com segurança de prescrição" />

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar paciente..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[190px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent><SelectItem value="all">Todos os status</SelectItem>
            {Object.entries(ENC_STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? <EmptyState icon={Stethoscope} title="Nenhum atendimento encontrado" /> : (
        <div className="rounded-lg border bg-card overflow-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Paciente</TableHead><TableHead>Tipo</TableHead><TableHead>Status</TableHead>
              <TableHead>Data</TableHead><TableHead>Assinado por</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-medium text-sm">{e.patient_name || "—"}</TableCell>
                  <TableCell className="text-xs">{e.encounter_type}</TableCell>
                  <TableCell><Badge variant="outline" className="border-0 text-[10px]">{ENC_STATUS_LABELS[e.status] || e.status}</Badge></TableCell>
                  <TableCell className="text-xs">{formatDate(e.created_at)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{e.signed_by_name || "—"}</TableCell>
                  <TableCell><Button size="sm" variant="ghost" className="h-6 text-[10px]" disabled={openingEncounterId === e.id} onClick={() => void openDetail(e)}>{openingEncounterId === e.id ? "Carregando..." : "Abrir"}</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Atendimento clínico */}
      <Dialog open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{detail?.patient_name} · {detail?.encounter_type}</DialogTitle>
            <DialogDescription>{detail && (ENC_STATUS_LABELS[detail.status] || detail.status)}</DialogDescription>
          </DialogHeader>

          {/* Resumo clínico fixo (alergias/problemas/medicações) */}
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="rounded bg-destructive/10 p-2">
              <p className="font-medium flex items-center gap-1 text-destructive"><ShieldAlert className="h-3 w-3" />Alergias</p>
              {allergies.length === 0 ? <p className="text-muted-foreground">Nenhuma</p> : allergies.map((a) => <p key={a.id}>{a.allergen} ({a.severity})</p>)}
            </div>
            <div className="rounded bg-warning/10 p-2">
              <p className="font-medium flex items-center gap-1 text-warning"><Activity className="h-3 w-3" />Problemas ativos</p>
              {problems.length === 0 ? <p className="text-muted-foreground">Nenhum</p> : problems.map((p) => <p key={p.id}>{p.problem_description}</p>)}
            </div>
            <div className="rounded bg-primary/10 p-2">
              <p className="font-medium flex items-center gap-1 text-primary"><ClipboardList className="h-3 w-3" />Medicações</p>
              {medications.length === 0 ? <p className="text-muted-foreground">Nenhuma</p> : medications.map((m) => <p key={m.id}>{m.medication}</p>)}
            </div>
          </div>

          {detail && isSigned(detail.status) ? (
            <div className="space-y-2 text-sm">
              <div><Label className="text-xs text-muted-foreground">Queixa principal</Label><p>{detail.chief_complaint || "—"}</p></div>
              <div><Label className="text-xs text-muted-foreground">Evolução</Label><p className="whitespace-pre-wrap">{detail.summary || "—"}</p></div>
              <div className="rounded bg-success/10 p-2 text-xs flex items-center gap-2 text-success"><CheckCircle2 className="h-4 w-4" />Assinado por {detail.signed_by_name}</div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded border border-warning/30 bg-warning/10 p-3 text-xs text-warning">{ENCOUNTER_MUTATION_BLOCK_REASON}</div>
              <div><Label className="text-xs">Queixa principal</Label><Input value={form.chief_complaint} disabled /></div>
              <div><Label className="text-xs">Evolução (anamnese, exame, conduta)</Label><Textarea rows={5} value={form.summary} disabled /></div>

              {/* Diagnósticos */}
              <div>
                <Label className="text-xs">Diagnósticos (CID)</Label>
                <div className="flex flex-wrap gap-1 mt-1">
                  {diagnoses.map((d) => <Badge key={d.id} variant="outline" className="text-[10px]">{d.cid_code} {d.diagnosis_type === "principal" ? "(principal)" : ""}</Badge>)}
                </div>
              </div>

              {/* Prescrição com checagem de segurança */}
              <div>
                <Label className="text-xs">Prescrição — checagem de segurança</Label>
                <div className="flex gap-2 mt-1">
                  <Input placeholder="Medicamento (ex: Dipirona 500mg)" value={rxMed} onChange={(e) => setRxMed(e.target.value)} />
                  <Button size="sm" variant="outline" onClick={checkRx}><ShieldAlert className="h-3 w-3 mr-1" />Verificar</Button>
                </div>
                {rxAlerts.length > 0 && (
                  <div className="space-y-1 mt-1">
                    {rxAlerts.map((a, i) => (
                      <div key={i} className="rounded bg-destructive/10 p-2 text-xs text-destructive flex items-center gap-2">
                        <AlertTriangle className="h-3 w-3 flex-shrink-0" />{a.descricao}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {detail && !isSigned(detail.status) && (
            <DialogFooter>
              <Button variant="outline" disabled>Salvar evolução</Button>
              <Button disabled title={ENCOUNTER_MUTATION_BLOCK_REASON}>Assinar atendimento</Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
