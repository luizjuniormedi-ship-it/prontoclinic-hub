import { useState } from "react";
import { Search, Stethoscope, FileText, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, ErrorState } from "@/components/StateViews";
import {
  clinicalTimelineService,
  type ClinicalTimelineEvent,
  type ClinicalTimelinePatient,
} from "@/services/clinicalTimelineService";
import { toast } from "@/hooks/use-toast";
import { formatDate } from "@/utils/formatters";

const EVENT_META: Record<string, { icon: typeof FileText; color: string; label: string }> = {
  atendimento: { icon: Stethoscope, color: "text-primary", label: "Atendimento" },
};

export default function ClinicalTimelinePage() {
  const [search, setSearch] = useState("");
  const [patients, setPatients] = useState<ClinicalTimelinePatient[]>([]);
  const [selected, setSelected] = useState<ClinicalTimelinePatient | null>(null);
  const [events, setEvents] = useState<ClinicalTimelineEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [timelineError, setTimelineError] = useState<string | null>(null);

  const doSearch = async () => {
    if (!search.trim()) return;
    setLoading(true);
    setSearchError(null);
    try {
      const result = await clinicalTimelineService.searchPatients(search);
      setPatients(result);
      if (result.length === 0) toast({ title: "Nenhum paciente encontrado" });
    } catch (e) {
      setPatients([]);
      setSearchError(e instanceof Error ? e.message : "Não foi possível buscar pacientes.");
    }
    finally { setLoading(false); }
  };

  const openPatient = async (p: ClinicalTimelinePatient) => {
    setSelected(p);
    setEvents([]);
    setTimelineError(null);
    setLoading(true);
    setTypeFilter("all");
    try {
      const tl = await clinicalTimelineService.getPatientTimeline(p.id);
      setEvents(tl);
    } catch (e) {
      setTimelineError(e instanceof Error ? e.message : "Não foi possível carregar a timeline clínica.");
    }
    finally { setLoading(false); }
  };

  const filtered = typeFilter === "all" ? events : events.filter((e) => e.event_type === typeFilter);
  const counts = events.reduce<Record<string, number>>((acc, e) => { acc[e.event_type] = (acc[e.event_type] || 0) + 1; return acc; }, {});

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Timeline Clínica"
        description="Atendimentos assinados e registros legados bloqueados"
      />

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
          {searchError && <ErrorState message={searchError} onRetry={doSearch} />}
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

          {loading ? <Card><CardContent className="p-6 text-center text-muted-foreground">Carregando timeline clínica...</CardContent></Card>
            : timelineError ? <ErrorState message={timelineError} onRetry={() => openPatient(selected)} />
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
                            <Badge variant="secondary" className="text-[10px]">
                              {e.status === "signed" ? "Assinado" : "Legado bloqueado"}
                            </Badge>
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

