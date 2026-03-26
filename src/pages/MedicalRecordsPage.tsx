import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Users, User, AlertTriangle, Plus, FileText } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, LoadingState, ErrorState } from "@/components/StateViews";
import { patientsService } from "@/services/patientsService";
import { medicalRecordsService, DbMedicalRecord } from "@/services/medicalRecordsService";
import { professionalsLookup, DbProfessional } from "@/services/appointmentsService";
import { Patient } from "@/types";
import { calculateAge, formatDate } from "@/utils/formatters";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

export default function MedicalRecordsPage() {
  const [search, setSearch] = useState("");
  const [patients, setPatients] = useState<Patient[]>([]);
  const [professionals, setProfessionals] = useState<DbProfessional[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [records, setRecords] = useState<DbMedicalRecord[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [newRecordOpen, setNewRecordOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  // New record form
  const [professionalId, setProfessionalId] = useState("");
  const [anamnesis, setAnamnesis] = useState("");
  const [evolution, setEvolution] = useState("");
  const [vitalSigns, setVitalSigns] = useState({
    bloodPressure: "", heartRate: "", temperature: "", weight: "", height: "", oxygenSaturation: "",
  });
  const [notes, setNotes] = useState("");

  useEffect(() => {
    Promise.all([patientsService.getAll(), professionalsLookup.getAll()])
      .then(([p, pr]) => { setPatients(p); setProfessionals(pr); setLoading(false); })
      .catch((err) => { setError(err.message); setLoading(false); });
  }, []);

  const loadRecords = useCallback(async (patientId: string) => {
    setRecordsLoading(true);
    try {
      const data = await medicalRecordsService.getByPatient(patientId);
      setRecords(data);
    } catch (err: any) {
      toast({ title: "Erro ao carregar prontuários", description: err.message, variant: "destructive" });
    } finally {
      setRecordsLoading(false);
    }
  }, [toast]);

  const handleSelectPatient = (p: Patient) => {
    setSelectedPatient(p);
    loadRecords(p.id);
  };

  const resetForm = () => {
    setProfessionalId("");
    setAnamnesis("");
    setEvolution("");
    setVitalSigns({ bloodPressure: "", heartRate: "", temperature: "", weight: "", height: "", oxygenSaturation: "" });
    setNotes("");
  };

  const handleCreateRecord = async () => {
    if (!selectedPatient) return;
    if (!anamnesis.trim() && !evolution.trim()) {
      toast({ title: "Preencha anamnese ou evolução", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const vs: Record<string, any> = {};
      if (vitalSigns.bloodPressure) vs.bloodPressure = vitalSigns.bloodPressure;
      if (vitalSigns.heartRate) vs.heartRate = Number(vitalSigns.heartRate);
      if (vitalSigns.temperature) vs.temperature = Number(vitalSigns.temperature);
      if (vitalSigns.weight) vs.weight = Number(vitalSigns.weight);
      if (vitalSigns.height) vs.height = Number(vitalSigns.height);
      if (vitalSigns.oxygenSaturation) vs.oxygenSaturation = Number(vitalSigns.oxygenSaturation);

      await medicalRecordsService.create({
        patient_id: selectedPatient.id,
        professional_id: professionalId || undefined,
        company_id: user?.company_id || undefined,
        unit_id: user?.primary_unit_id || undefined,
        anamnesis: anamnesis.trim() || undefined,
        evolution: evolution.trim() || undefined,
        vital_signs: Object.keys(vs).length > 0 ? vs : undefined,
        notes: notes.trim() || undefined,
      });

      toast({ title: "Registro salvo com sucesso!" });
      setNewRecordOpen(false);
      resetForm();
      loadRecords(selectedPatient.id);
    } catch (err: any) {
      toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const filtered = patients.filter((p) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return p.name.toLowerCase().includes(q) || p.cpf.includes(q.replace(/\D/g, '')) || p.phone.includes(q.replace(/\D/g, ''));
  });

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={() => window.location.reload()} />;

  // If patient is selected, show records
  if (selectedPatient) {
    return (
      <div className="space-y-6 animate-fade-in">
        <PageHeader
          title={`Prontuário — ${selectedPatient.name}`}
          description={`${calculateAge(selectedPatient.birthDate)} anos • ${selectedPatient.gender === "M" ? "Masc." : selectedPatient.gender === "F" ? "Fem." : "Outro"}`}
          actions={
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setSelectedPatient(null); setRecords([]); }}>Voltar</Button>
              <Button onClick={() => { resetForm(); setNewRecordOpen(true); }}>
                <Plus className="mr-2 h-4 w-4" />Novo Registro
              </Button>
            </div>
          }
        />

        {/* Alerts */}
        {(selectedPatient.allergies || selectedPatient.clinicalAlerts) && (
          <div className="flex gap-2 flex-wrap">
            {selectedPatient.allergies && (
              <Badge variant="outline" className="bg-destructive/10 text-destructive border-0 gap-1">
                <AlertTriangle className="h-3 w-3" />Alergia: {selectedPatient.allergies}
              </Badge>
            )}
            {selectedPatient.clinicalAlerts && (
              <Badge variant="outline" className="bg-warning/10 text-warning border-0 gap-1">
                <AlertTriangle className="h-3 w-3" />{selectedPatient.clinicalAlerts}
              </Badge>
            )}
          </div>
        )}

        {recordsLoading ? <LoadingState /> : records.length === 0 ? (
          <EmptyState icon={FileText} title="Nenhum registro encontrado" description="Clique em 'Novo Registro' para criar o primeiro prontuário." />
        ) : (
          <div className="space-y-3">
            {records.map((r) => {
              const prof = professionals.find((p) => p.id === r.professional_id);
              const vs = r.vital_signs as Record<string, any> | null;
              return (
                <Card key={r.id}>
                  <CardHeader className="py-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-medium">
                        {formatDate(r.record_date.split('T')[0])}
                        {prof && <span className="text-muted-foreground font-normal"> — {prof.full_name}</span>}
                      </CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0 space-y-3">
                    {r.anamnesis && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">Anamnese</p>
                        <p className="text-sm whitespace-pre-wrap">{r.anamnesis}</p>
                      </div>
                    )}
                    {r.evolution && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">Evolução</p>
                        <p className="text-sm whitespace-pre-wrap">{r.evolution}</p>
                      </div>
                    )}
                    {vs && Object.keys(vs).length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">Sinais Vitais</p>
                        <div className="flex gap-3 flex-wrap text-xs">
                          {vs.bloodPressure && <span>PA: <strong>{vs.bloodPressure}</strong></span>}
                          {vs.heartRate && <span>FC: <strong>{vs.heartRate} bpm</strong></span>}
                          {vs.temperature && <span>Temp: <strong>{vs.temperature}°C</strong></span>}
                          {vs.weight && <span>Peso: <strong>{vs.weight} kg</strong></span>}
                          {vs.height && <span>Altura: <strong>{vs.height} cm</strong></span>}
                          {vs.oxygenSaturation && <span>SpO2: <strong>{vs.oxygenSaturation}%</strong></span>}
                        </div>
                      </div>
                    )}
                    {r.notes && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">Observações</p>
                        <p className="text-sm text-muted-foreground">{r.notes}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* New record dialog */}
        <Dialog open={newRecordOpen} onOpenChange={setNewRecordOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Novo Registro — {selectedPatient.name}</DialogTitle>
              <DialogDescription>Preencha os campos do prontuário.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs">Profissional</Label>
                <Select value={professionalId} onValueChange={setProfessionalId}>
                  <SelectTrigger><SelectValue placeholder="Selecione o profissional" /></SelectTrigger>
                  <SelectContent>
                    {professionals.map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Anamnese</Label>
                <Textarea rows={4} placeholder="Queixa principal, história..." value={anamnesis} onChange={(e) => setAnamnesis(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Evolução</Label>
                <Textarea rows={4} placeholder="Evolução clínica..." value={evolution} onChange={(e) => setEvolution(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs font-medium">Sinais Vitais</Label>
                <div className="grid grid-cols-3 gap-3 mt-2">
                  <div className="space-y-1"><Label className="text-[10px]">Pressão Arterial</Label><Input placeholder="120/80" value={vitalSigns.bloodPressure} onChange={(e) => setVitalSigns({ ...vitalSigns, bloodPressure: e.target.value })} /></div>
                  <div className="space-y-1"><Label className="text-[10px]">FC (bpm)</Label><Input type="number" placeholder="72" value={vitalSigns.heartRate} onChange={(e) => setVitalSigns({ ...vitalSigns, heartRate: e.target.value })} /></div>
                  <div className="space-y-1"><Label className="text-[10px]">Temp (°C)</Label><Input type="number" step="0.1" placeholder="36.5" value={vitalSigns.temperature} onChange={(e) => setVitalSigns({ ...vitalSigns, temperature: e.target.value })} /></div>
                  <div className="space-y-1"><Label className="text-[10px]">Peso (kg)</Label><Input type="number" step="0.1" placeholder="70" value={vitalSigns.weight} onChange={(e) => setVitalSigns({ ...vitalSigns, weight: e.target.value })} /></div>
                  <div className="space-y-1"><Label className="text-[10px]">Altura (cm)</Label><Input type="number" placeholder="170" value={vitalSigns.height} onChange={(e) => setVitalSigns({ ...vitalSigns, height: e.target.value })} /></div>
                  <div className="space-y-1"><Label className="text-[10px]">SpO2 (%)</Label><Input type="number" placeholder="98" value={vitalSigns.oxygenSaturation} onChange={(e) => setVitalSigns({ ...vitalSigns, oxygenSaturation: e.target.value })} /></div>
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Observações</Label>
                <Textarea rows={2} placeholder="Notas adicionais..." value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setNewRecordOpen(false)}>Cancelar</Button>
              <Button onClick={handleCreateRecord} disabled={saving}>{saving ? "Salvando..." : "Salvar Registro"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // Patient list
  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Prontuário Eletrônico" description="Selecione um paciente para acessar o prontuário" />

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Buscar por nome, CPF ou telefone..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Users} title="Nenhum paciente encontrado" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => {
            const age = p.birthDate ? calculateAge(p.birthDate) : null;
            return (
              <Card key={p.id} className="cursor-pointer hover:shadow-md hover:border-primary/30 transition-all" onClick={() => handleSelectPatient(p)}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <User className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">{p.name}</p>
                        <p className="text-xs text-muted-foreground">{age != null ? `${age}a • ` : ""}{p.gender === "M" ? "Masc." : p.gender === "F" ? "Fem." : "Outro"} • {p.healthInsurance || "Particular"}</p>
                      </div>
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
