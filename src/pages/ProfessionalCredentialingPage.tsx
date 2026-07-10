import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/StateViews";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { Network } from "lucide-react";

interface CredentialRow {
  id: string;
  professional_id: string;
  insurance_company_id: string;
  lg_clinica: boolean | null;
  lg_credenciado: boolean | null;
  lg_ativo: boolean | null;
  ds_observacao: string | null;
  dt_inicio_vinculo: string | null;
  dt_fim_vinculo: string | null;
}

const PAGE_SIZE = 50;

export default function ProfessionalCredentialingPage() {
  const [rows, setRows] = useState<CredentialRow[]>([]);
  const [professionalNames, setProfessionalNames] = useState<Record<string, string>>({});
  const [insuranceNames, setInsuranceNames] = useState<Record<string, string>>({});
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CredentialRow | null>(null);
  const [form, setForm] = useState({ credenciado: true, ativo: true, inicio: "", fim: "", observacao: "" });
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from("professional_insurances")
        .select("id, professional_id, insurance_company_id, lg_clinica, lg_credenciado, lg_ativo, ds_observacao, dt_inicio_vinculo, dt_fim_vinculo", { count: "exact" });
      if (status === "credentialed") query = query.eq("lg_credenciado", true).eq("lg_ativo", true);
      if (status === "pending") query = query.eq("lg_credenciado", false).eq("lg_ativo", true);
      if (status === "inactive") query = query.eq("lg_ativo", false);
      const { data, error: queryError, count } = await query
        .order("professional_id")
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      if (queryError) throw queryError;
      const result = (data || []) as CredentialRow[];
      const professionalIds = Array.from(new Set(result.map((row) => row.professional_id)));
      const insuranceIds = Array.from(new Set(result.map((row) => row.insurance_company_id)));
      const [{ data: professionals, error: professionalsError }, { data: insurances, error: insurancesError }] = await Promise.all([
        professionalIds.length ? supabase.from("professionals").select("id, full_name").in("id", professionalIds) : Promise.resolve({ data: [], error: null }),
        insuranceIds.length ? supabase.from("insurance_companies").select("id, name").in("id", insuranceIds) : Promise.resolve({ data: [], error: null }),
      ]);
      if (professionalsError) throw professionalsError;
      if (insurancesError) throw insurancesError;
      setRows(result);
      setTotal(count || 0);
      setProfessionalNames(Object.fromEntries((professionals || []).map((p: any) => [String(p.id), p.full_name])));
      setInsuranceNames(Object.fromEntries((insurances || []).map((i: any) => [String(i.id), i.name])));
    } catch (caught) {
      setError((caught as Error).message || "Erro ao carregar credenciamentos");
    } finally {
      setLoading(false);
    }
  }, [page, status]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(0); }, [status]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const summary = useMemo(() => `${total.toLocaleString("pt-BR")} vínculos encontrados`, [total]);

  const openEdit = (row: CredentialRow) => {
    setEditing(row);
    setForm({
      credenciado: row.lg_credenciado !== false,
      ativo: row.lg_ativo !== false,
      inicio: row.dt_inicio_vinculo || "",
      fim: row.dt_fim_vinculo || "",
      observacao: row.ds_observacao || "",
    });
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const { error: updateError } = await supabase.from("professional_insurances").update({
        lg_credenciado: form.credenciado,
        lg_ativo: form.ativo,
        dt_inicio_vinculo: form.inicio || null,
        dt_fim_vinculo: form.fim || null,
        ds_observacao: form.observacao.trim() || null,
        updated_at: new Date().toISOString(),
      }).eq("id", editing.id);
      if (updateError) throw updateError;
      toast({ title: "Credenciamento atualizado" });
      setEditing(null);
      await load();
    } catch (caught) {
      toast({ title: "Erro ao atualizar", description: (caught as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Credenciamento de Profissionais" description={summary} />
      <div className="flex items-center gap-2">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[210px]" aria-label="Filtrar credenciamentos"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="credentialed">Credenciados ativos</SelectItem>
            <SelectItem value="pending">Pendentes ativos</SelectItem>
            <SelectItem value="inactive">Inativos</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {loading ? <TableSkeleton rows={8} cols={6} /> : rows.length === 0 ? (
        <EmptyState icon={Network} title="Nenhum vínculo encontrado" />
      ) : (
        <div className="rounded-lg border bg-card overflow-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Profissional</TableHead><TableHead>Convênio</TableHead><TableHead>Clínica</TableHead><TableHead>Credenciamento</TableHead><TableHead>Vigência</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>{rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">{professionalNames[row.professional_id] || `Profissional #${row.professional_id}`}</TableCell>
                <TableCell>{insuranceNames[row.insurance_company_id] || `Convênio #${row.insurance_company_id}`}</TableCell>
                <TableCell>{row.lg_clinica ? "Sim" : "Não"}</TableCell>
                <TableCell><Badge variant="outline" className={row.lg_ativo === false ? "text-muted-foreground" : row.lg_credenciado === false ? "text-warning" : "text-success"}>{row.lg_ativo === false ? "Inativo" : row.lg_credenciado === false ? "Pendente" : "Credenciado"}</Badge></TableCell>
                <TableCell className="text-xs">{row.dt_inicio_vinculo || "—"} a {row.dt_fim_vinculo || "aberto"}</TableCell>
                <TableCell><Button size="sm" variant="outline" onClick={() => openEdit(row)}>Editar</Button></TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        </div>
      )}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Página {page + 1} de {totalPages}</p>
        <div className="flex gap-2"><Button variant="outline" disabled={page === 0 || loading} onClick={() => setPage((p) => p - 1)}>Anterior</Button><Button variant="outline" disabled={page >= totalPages - 1 || loading} onClick={() => setPage((p) => p + 1)}>Próxima</Button></div>
      </div>
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar credenciamento</DialogTitle><DialogDescription>{editing ? `${professionalNames[editing.professional_id] || "Profissional"} — ${insuranceNames[editing.insurance_company_id] || "Convênio"}` : ""}</DialogDescription></DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3"><div><Label>Status</Label><Select value={form.credenciado ? "yes" : "no"} onValueChange={(value) => setForm((f) => ({ ...f, credenciado: value === "yes" }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="yes">Credenciado</SelectItem><SelectItem value="no">Pendente</SelectItem></SelectContent></Select></div><div><Label>Vínculo</Label><Select value={form.ativo ? "yes" : "no"} onValueChange={(value) => setForm((f) => ({ ...f, ativo: value === "yes" }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="yes">Ativo</SelectItem><SelectItem value="no">Inativo</SelectItem></SelectContent></Select></div></div>
            <div className="grid grid-cols-2 gap-3"><div><Label>Início</Label><Input type="date" value={form.inicio} onChange={(e) => setForm((f) => ({ ...f, inicio: e.target.value }))} /></div><div><Label>Fim</Label><Input type="date" value={form.fim} onChange={(e) => setForm((f) => ({ ...f, fim: e.target.value }))} /></div></div>
            <div><Label>Observação</Label><Textarea value={form.observacao} onChange={(e) => setForm((f) => ({ ...f, observacao: e.target.value }))} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button><Button disabled={saving} onClick={save}>{saving ? "Salvando..." : "Salvar"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
