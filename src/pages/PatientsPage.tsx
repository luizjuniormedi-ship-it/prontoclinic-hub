import { useEffect, useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Users, AlertTriangle, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/PageHeader";
import { TableSkeleton, EmptyState, ErrorState } from "@/components/StateViews";
import { Badge } from "@/components/ui/badge";
import { patientsService } from "@/services/patientsService";
import { Patient } from "@/types";
import { formatCPF, calculateAge } from "@/utils/formatters";
import { maskPhone } from "@/utils/masks";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/useDebounce";
import { NewPatientDialog } from "@/components/patients/NewPatientDialog";

export default function PatientsPage() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const loadPatients = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await patientsService.getAll();
      setPatients(data);
    } catch (err: any) {
      setError(err.message || "Erro ao carregar pacientes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPatients();
  }, [loadPatients]);

  const debouncedSearch = useDebounce(search, 300);

  // Client-side filter with debounced search
  const filtered = useMemo(() => patients.filter((p) => {
    if (!debouncedSearch.trim()) return true;
    const q = debouncedSearch.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      p.cpf.includes(q.replace(/\D/g, '')) ||
      p.phone.includes(q.replace(/\D/g, ''))
    );
  }), [patients, debouncedSearch]);

  const isComplete = (p: Patient) => !!(p.name && p.cpf && p.birthDate && p.phone && p.email && p.gender);

  const handleCreate = async (patientData: Omit<Patient, "id" | "createdAt" | "updatedAt">) => {
    try {
      setSaving(true);
      await patientsService.create(patientData);
      toast({ title: "Paciente cadastrado com sucesso!" });
      setDialogOpen(false);
      await loadPatients();
    } catch (err: any) {
      toast({ title: "Erro ao cadastrar", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="space-y-6"><PageHeader title="Pacientes" description="Carregando..." /><TableSkeleton rows={6} cols={6} /></div>;
  if (error) return <ErrorState message={error} onRetry={loadPatients} />;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Pacientes"
        description={`${patients.length} pacientes cadastrados`}
        actions={
          <NewPatientDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            patients={patients}
            onSave={handleCreate}
            saving={saving}
            navigateToPatient={(id) => navigate(`/patients/${id}`)}
          />
        }
      />

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Buscar por nome, CPF ou telefone..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Users} title="Nenhum paciente encontrado" description={search ? "Tente ajustar os filtros de busca." : "Cadastre o primeiro paciente clicando em 'Novo Paciente'."} />
      ) : (
        <div className="rounded-lg border bg-card overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>CPF</TableHead>
                <TableHead>Idade</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Convênio</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p) => {
                const complete = isComplete(p);
                return (
                  <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/patients/${p.id}`)}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{p.name}</span>
                        {p.allergies && <AlertTriangle className="h-3 w-3 text-destructive" />}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">{p.cpf ? formatCPF(p.cpf) : '—'}</TableCell>
                    <TableCell>{p.birthDate ? `${calculateAge(p.birthDate)}a` : '—'}</TableCell>
                    <TableCell className="text-xs">{p.phone ? maskPhone(p.phone) : '—'}</TableCell>
                    <TableCell className="text-xs">{p.healthInsurance || <span className="text-muted-foreground">Particular</span>}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] border-0 ${complete ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
                        {complete ? "Completo" : "Incompleto"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
