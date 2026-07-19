import { useState } from "react";
import { Search, Stethoscope, FileText, Activity, Pill, FlaskConical, ShieldAlert, Clock, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/StateViews";
import { supabase } from "@/lib/supabase";
import { encountersService } from "@/services/encountersService";
import { printPrescription } from "@/utils/prescriptionPdf";
import { toast } from "@/hooks/use-toast";
import { formatDate } from "@/utils/formatters";

interface TimelineEvent { event_type: string; event_id: string; event_date: string | null; title: string | null; detail: string | null; professional: string | null; }

const EVENT_META: Record<string, { icon: typeof FileText; color: string; label: string }> = {
  atendimento: { icon: Stethoscope, color: "text-primary", label: "Atendimento" },
  laudo: { icon: FileText, color: "text-success", label: "Laudo" },
  diagnostico: { icon: Activity, color: "text-warning", label: "Diagnóstico" },
  prescricao: { icon: Pill, color: "text-primary", label: "Prescrição" },
  exame_lab: { icon: FlaskConical, color: "text-secondary", label: "Exame" },
  alergia: { icon: ShieldAlert, color: "text-destructive", label: "Alergia" },
};

export default function ClinicalTimelinePage() {
  const [search, setSearch] = useState("");
  const [patients, setPatients] = useState<Array<{ id: number; full_name: string }>>([]);
  const [selected, setSelected] = useState<{ id: number; full_name: string } | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const doSearch = async () => {
    if (!search.trim()) return;
    setLoading(true);
    try {
      const { data } = await supabase.from("patients").select("id, full_name")
        .ilike("full_name", `*${search.trim()}*`).eq("lg_ativo", true).limit(20);
      setPatients((data || []) as Array<{ id: number; full_name: string }>);
      if ((data || []).length === 0) toast({ title: "Nenhum paciente encontrado" });
    } catch (e) { toast({ title: "Erro na busca", description: String(e), variant: "destructive" }); }
    finally { setLoading(false); }
  };

  const openPatient = async (p: { id: number; full_name: string }) => {
    setSelected(p); setLoading(true); setTypeFilter("all");
    try {
      const tl = await encountersService.timeline(p.id);
      setEvents(tl);
      await encountersService.logAccess(p.id, "consultou_timeline");
    } catch (e) { toast({ title: "Erro ao carregar timeline", description: String(e), variant: "destructive" }); }
    finally { setLoading(false); }
  };

  const emitirReceita = async () => {
    if (!selected) return;
    try {
      const rxs = await encountersService.prescriptions(selected.id);
      const validation = "RX" + Math.random().toString(36).slice(2, 10).toUpperCase();
      printPrescription({
        patient_name: selected.full_name,
        medications: rxs[0]?.ds_prescricao || "Prescrição em branco — preencha no editor de atendimento.",
        physician_name: "Médico responsável",
        validation_code: validation,
        tipo: "simples",
      });
    } catch (e) { toast({ title: "Erro", description: String(e), variant: "destructive" }); }
  };

  const filtered = typeFilter === "all" ? events : events.filter((e) => e.event_type === typeFilter);
  const counts = events.reduce<Record<string, number>>((acc, e) => { acc[e.event_type] = (acc[e.event_type] || 0) + 1; return acc; }, {});

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Timeline Clínica" description="Histórico longitudinal completo do paciente" />

      {!selected ? (
        <>
          <div className="flex gap-2 max-w-md">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar paciente por nome..." className="pl-9" value={search}
                onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doSearch()} />
            </div>
            <Button onClick={doSearch} disabled={loading}>{loading ? "..." : "Buscar"}</Button>
          </div>
          {patients.length > 0 && (
            <div className="rounded-lg border bg-card divide-y max-w-md">
              {patients.map((p) => (
                <button key={p.id} onClick={() => openPatient(p)} className="w-full text-left px-4 py-2 hover:bg-muted/50 text-sm">
                  {p.full_name}
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={() => { setSelected(null); setEvents([]); }}>← Voltar</Button>
              <h2 className="text-lg font-semibold">{selected.full_name}</h2>
              <Badge variant="outline" className="text-[10px]">{events.length} eventos</Badge>
            </div>
            <Button size="sm" onClick={emitirReceita}><Printer className="h-4 w-4 mr-1" />Emitir receita</Button>
          </div>

          {/* Filtros por tipo */}
          <div className="flex gap-1 flex-wrap">
            <Button size="sm" variant={typeFilter === "all" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setTypeFilter("all")}>Todos ({events.length})</Button>
            {Object.entries(counts).map(([t, n]) => (
              <Button key={t} size="sm" variant={typeFilter === t ? "default" : "outline"} className="h-7 text-xs" onClick={() => setTypeFilter(t)}>
                {EVENT_META[t]?.label || t} ({n})
              </Button>
            ))}
          </div>

          {loading ? <Card><CardContent className="p-6 text-center text-muted-foreground">Carregando...</CardContent></Card>
            : filtered.length === 0 ? <EmptyState icon={Clock} title="Sem eventos" />
            : (
              <div className="space-y-2">
                {filtered.map((e, i) => {
                  const meta = EVENT_META[e.event_type] || { icon: Clock, color: "text-muted-foreground", label: e.event_type };
                  const Icon = meta.icon;
                  return (
                    <Card key={`${e.event_type}-${e.event_id}-${i}`}>
                      <CardContent className="p-3 flex items-start gap-3">
                        <div className={`mt-0.5 ${meta.color}`}><Icon className="h-4 w-4" /></div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-[10px]">{meta.label}</Badge>
                            <span className="text-xs text-muted-foreground">{e.event_date ? formatDate(e.event_date) : "—"}</span>
                            {e.professional && <span className="text-xs text-muted-foreground">· {e.professional}</span>}
                          </div>
                          <p className="text-sm font-medium mt-0.5 truncate">{e.title || "—"}</p>
                          {e.detail && <p className="text-xs text-muted-foreground truncate">{e.detail}</p>}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
        </>
      )}
    </div>
  );
}
