import { useState } from "react";
import { Search, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/StateViews";
import { useNavigate } from "react-router-dom";
import { mockPatients } from "@/services/mockData";

export default function MedicalRecordsPage() {
  const [search, setSearch] = useState("");
  const navigate = useNavigate();

  const filtered = mockPatients.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()) || p.cpf.includes(search)
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Prontuário Eletrônico" description="Selecione um paciente para acessar o prontuário" />

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Buscar paciente..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Users} title="Nenhum paciente encontrado" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <Card key={p.id} className="cursor-pointer hover:shadow-md hover:border-primary/30 transition-all" onClick={() => navigate(`/patients/${p.id}`)}>
              <CardContent className="p-4">
                <p className="font-medium">{p.name}</p>
                <p className="text-sm text-muted-foreground">{p.cpf}</p>
                <p className="text-xs text-muted-foreground mt-1">{p.healthInsurance || "Particular"}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
