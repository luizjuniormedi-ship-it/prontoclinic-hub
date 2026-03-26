import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Users, User, AlertTriangle, Calendar } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, LoadingState, ErrorState } from "@/components/StateViews";
import { patientsService } from "@/services/patientsService";
import { Patient } from "@/types";
import { calculateAge } from "@/utils/formatters";

export default function MedicalRecordsPage() {
  const [search, setSearch] = useState("");
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    patientsService.getAll()
      .then((p) => { setPatients(p); setLoading(false); })
      .catch((err) => { setError(err.message); setLoading(false); });
  }, []);

  const filtered = patients.filter((p) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return p.name.toLowerCase().includes(q) || p.cpf.includes(q.replace(/\D/g, '')) || p.phone.includes(q.replace(/\D/g, ''));
  });

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={() => window.location.reload()} />;

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
              <Card key={p.id} className="cursor-pointer hover:shadow-md hover:border-primary/30 transition-all" onClick={() => navigate(`/patients/${p.id}`)}>
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
                  {p.clinicalAlerts && (
                    <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-warning/10 w-fit">
                      <AlertTriangle className="h-2.5 w-2.5 text-warning" />
                      <span className="text-[10px] text-warning font-medium">{p.clinicalAlerts}</span>
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
