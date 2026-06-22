import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Users, User, AlertTriangle, FileText } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, LoadingState, ErrorState } from "@/components/StateViews";
import { supabase } from "@/lib/supabase";
import { medicalRecordsService, DbMedicalRecord } from "@/services/medicalRecordsService";
import { professionalsLookup, DbProfessional } from "@/services/appointmentsService";
import { calculateAge, formatDate } from "@/utils/formatters";
import { useDebounce } from "@/hooks/useDebounce";
import { useToast } from "@/hooks/use-toast";

interface PatientRow { id: string; full_name: string; birth_date: string | null; sex: string | null; allergies: string | null; clinical_alerts: string | null; insurance_plan_id: string | null; }

export default function MedicalRecordsPage() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [professionals, setProfessionals] = useState<DbProfessional[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPatient, setSelectedPatient] = useState<PatientRow | null>(null);
  const [records, setRecords] = useState<DbMedicalRecord[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      supabase.from("patients").select("id, full_name, birth_date, sex, allergies, clinical_alerts, insurance_plan_id").order("full_name"),
      professionalsLookup.getAll(),
    ]).then(([{ data, error: e }, profs]) => {
      if (e) { setError(e.message); setLoading(false); return; }
      setPatients(data || []);
      setProfessionals(profs);
      setLoading(false);
    }).catch((err) => { setError((err as Error).message); setLoading(false); });
  }, []);

  const loadRecords = useCallback(async (patientId: string) => {
    setRecordsLoading(true);
    try {
      const data = await medicalRecordsService.getByPatient(patientId);
      setRecords(data);
    } catch (err) {
      toast({ title: "Erro ao carregar prontuários", description: (err as Error).message, variant: "destructive" });
    } finally { setRecordsLoading(false); }
  }, [toast]);

  const handleSelectPatient = (p: PatientRow) => {
    setSelectedPatient(p);
    loadRecords(p.id);
  };

  const filtered = patients.filter((p) => {
    if (!debouncedSearch.trim()) return true;
    const q = debouncedSearch.toLowerCase();
    return p.full_name.toLowerCase().includes(q);
  });

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={() => window.location.reload()} />;

  if (selectedPatient) {
    const age = selectedPatient.birth_date ? calculateAge(selectedPatient.birth_date) : null;
    return (
      <div className="space-y-6 animate-fade-in">
        <PageHeader
          title={`Prontuário — ${selectedPatient.full_name}`}
          description={`${age ? `${age} anos` : ""} • ${selectedPatient.sex === "M" ? "Masc." : selectedPatient.sex === "F" ? "Fem." : "Outro"}`}
          actions={
            <button className="text-sm text-primary hover:underline" onClick={() => { setSelectedPatient(null); setRecords([]); }}>← Voltar</button>
          }
        />

        {(selectedPatient.allergies || selectedPatient.clinical_alerts) && (
          <div className="flex gap-2 flex-wrap">
            {selectedPatient.allergies && <Badge variant="outline" className="bg-destructive/10 text-destructive border-0 gap-1"><AlertTriangle className="h-3 w-3" />Alergia: {selectedPatient.allergies}</Badge>}
            {selectedPatient.clinical_alerts && <Badge variant="outline" className="bg-warning/10 text-warning border-0 gap-1"><AlertTriangle className="h-3 w-3" />{selectedPatient.clinical_alerts}</Badge>}
          </div>
        )}

        {recordsLoading ? <LoadingState /> : records.length === 0 ? (
          <EmptyState icon={FileText} title="Nenhum registro" description="Este paciente ainda não possui prontuário." />
        ) : (
          <div className="space-y-3">
            {records.map((r) => {
              const prof = professionals.find((p) => p.id === r.professional_id);
              const vs = r.vital_signs as Record<string, any> | null;
              return (
                <Card key={r.id}>
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm font-medium">
                      {formatDate(r.record_date.split("T")[0])}
                      {prof && <span className="text-muted-foreground font-normal"> — {prof.full_name}</span>}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0 space-y-3">
                    {r.anamnesis && <div><p className="text-xs font-medium text-muted-foreground mb-1">Anamnese</p><p className="text-sm whitespace-pre-wrap">{r.anamnesis}</p></div>}
                    {r.evolution && <div><p className="text-xs font-medium text-muted-foreground mb-1">Evolução</p><p className="text-sm whitespace-pre-wrap">{r.evolution}</p></div>}
                    {vs && Object.keys(vs).length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">Sinais Vitais</p>
                        <div className="flex gap-3 flex-wrap text-xs">
                          {vs.bloodPressure && <span>PA: <strong>{vs.bloodPressure}</strong></span>}
                          {vs.heartRate && <span>FC: <strong>{vs.heartRate} bpm</strong></span>}
                          {vs.temperature && <span>Temp: <strong>{vs.temperature}°C</strong></span>}
                          {vs.weight && <span>Peso: <strong>{vs.weight} kg</strong></span>}
                        </div>
                      </div>
                    )}
                    {r.notes && <div><p className="text-xs font-medium text-muted-foreground mb-1">Observações</p><p className="text-sm text-muted-foreground">{r.notes}</p></div>}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Prontuário Eletrônico" description="Selecione um paciente para acessar o prontuário" />
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Buscar por nome..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {filtered.length === 0 ? <EmptyState icon={Users} title="Nenhum paciente encontrado" /> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => {
            const age = p.birth_date ? calculateAge(p.birth_date) : null;
            return (
              <Card key={p.id} className="cursor-pointer hover:shadow-md hover:border-primary/30 transition-all" onClick={() => handleSelectPatient(p)}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0"><User className="h-4 w-4 text-primary" /></div>
                    <div>
                      <p className="font-medium text-sm">{p.full_name}</p>
                      <p className="text-xs text-muted-foreground">{age != null ? `${age}a • ` : ""}{p.sex === "M" ? "Masc." : p.sex === "F" ? "Fem." : "Outro"} • {p.insurance_plan_id || "Particular"}</p>
                    </div>
                  </div>
                  {p.allergies && (
                    <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-destructive/10 w-fit">
                      <AlertTriangle className="h-2.5 w-2.5 text-destructive" />
                      <span className="text-[10px] text-destructive font-medium">{p.allergies}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
