import { useEffect, useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Users, AlertTriangle, Plus, ChevronLeft, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/PageHeader";
import { TableSkeleton, EmptyState, ErrorState } from "@/components/StateViews";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import { formatCPF, calculateAge } from "@/utils/formatters";
import { maskPhone } from "@/utils/masks";
import { useDebounce } from "@/hooks/useDebounce";
import { friendlyError } from "@/utils/friendlyError";

interface PatientRow {
  id: string;
  full_name: string;
  cpf: string | null;
  birth_date: string | null;
  phone: string | null;
  email: string | null;
  sex: string | null;
  insurance_plan_id: string | null;
  allergies: string | null;
  clinical_alerts: string | null;
  lg_ativo: boolean | null;
}

const PAGE_SIZE = 20;

export default function PatientsPage() {
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [insuranceNames, setInsuranceNames] = useState<Record<string, string>>({});
  const navigate = useNavigate();
  const debouncedSearch = useDebounce(search, 300);

  // Load insurance names once
  useEffect(() => {
    supabase.from("insurance_companies").select("id, name").limit(2000).then(({ data }) => {
      if (data) {
        const map: Record<string, string> = {};
        data.forEach((i: any) => { map[String(i.id)] = i.name; });
        setInsuranceNames(map);
      }
    });
  }, []);

  const loadPatients = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      let query = supabase
        .from("patients")
        .select("id, full_name, cpf, birth_date, phone, email, sex, insurance_plan_id, allergies, clinical_alerts, lg_ativo", { count: "exact" });

      if (debouncedSearch.trim()) {
        const q = debouncedSearch.trim();
        const digits = q.replace(/\D/g, "");
        if (digits.length >= 3 && digits.length === q.replace(/\s/g, "").length) {
          query = query.or(`cpf.ilike.%${digits}%,phone.ilike.%${digits}%`);
        } else {
          query = query.ilike("full_name", `%${q.replace(/[%_]/g, "")}%`);
        }
      }

      const { data, error: e, count } = await query
        .order("full_name")
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (e) throw e;
      setPatients(data || []);
      setTotal(count || 0);
    } catch (err) {
      setError(friendlyError(err, "Carregar pacientes"));
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, page]);

  useEffect(() => { setPage(0); }, [debouncedSearch]);
  useEffect(() => { loadPatients(); }, [loadPatients]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  if (loading && patients.length === 0) return <div className="space-y-6"><PageHeader title="Pacientes" description="Carregando..." /><TableSkeleton rows={6} cols={6} /></div>;
  if (error) return <ErrorState message={error} onRetry={loadPatients} />;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Pacientes"
        description={`${total} pacientes cadastrados`}
        actions={
          <Button onClick={() => navigate("/patients/new")}>
            <Plus className="mr-2 h-4 w-4" />Novo Paciente
          </Button>
        }
      />

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Buscar por nome, CPF ou telefone..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {patients.length === 0 ? (
        <EmptyState icon={Users} title="Nenhum paciente encontrado" description={search ? "Tente ajustar a busca." : "Cadastre o primeiro paciente."} />
      ) : (
        <>
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
                {patients.map((p) => (
                  <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/patients/${p.id}`)}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{p.full_name}</span>
                        {p.allergies && <AlertTriangle className="h-3 w-3 text-destructive" />}
                        {p.clinical_alerts && <AlertTriangle className="h-3 w-3 text-warning" />}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">{p.cpf ? formatCPF(p.cpf) : "—"}</TableCell>
                    <TableCell>{p.birth_date ? `${calculateAge(p.birth_date)}a` : "—"}</TableCell>
                    <TableCell className="text-xs">{p.phone ? maskPhone(p.phone) : "—"}</TableCell>
                    <TableCell className="text-xs">{p.insurance_plan_id ? (insuranceNames[String(p.insurance_plan_id)] || "Conv. #" + p.insurance_plan_id) : <span className="text-muted-foreground">Particular</span>}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] border-0 text-foreground ${p.lg_ativo === false ? "bg-destructive/15" : "bg-success/15"}`}>
                        {p.lg_ativo === false ? "Inativo" : "Ativo"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">Página {page + 1} de {totalPages}</p>
              <div className="flex gap-1">
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={page === 0} onClick={() => setPage(page - 1)} title="Página anterior">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)} title="Próxima página">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
