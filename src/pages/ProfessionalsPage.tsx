import { useEffect, useState, useCallback } from "react";
import { Plus, Search, Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState, ErrorState } from "@/components/StateViews";
import { ProfessionalStatusBadge } from "@/components/StatusBadge";
import { professionalsLookup, specialtiesLookup, DbProfessional, DbSpecialty } from "@/services/appointmentsService";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";

export default function ProfessionalsPage() {
  const [professionals, setProfessionals] = useState<DbProfessional[]>([]);
  const [specialties, setSpecialties] = useState<DbSpecialty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DbProfessional | null>(null);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  // Form fields
  const [fullName, setFullName] = useState("");
  const [category, setCategory] = useState("");
  const [councilType, setCouncilType] = useState("");
  const [councilNumber, setCouncilNumber] = useState("");
  const [cpf, setCpf] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("active");
  const [defaultDuration, setDefaultDuration] = useState("30");

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [profs, specs] = await Promise.all([
        professionalsLookup.getAll(),
        specialtiesLookup.getAll(),
      ]);
      setProfessionals(profs);
      setSpecialties(specs);
    } catch (err) {
      setError((err as Error).message || "Erro ao carregar profissionais");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const filtered = professionals.filter((p) => {
    const q = search.toLowerCase();
    const matchesSearch = !search || p.full_name.toLowerCase().includes(q) || (p.category || "").toLowerCase().includes(q) || (p.council_type || "").toLowerCase().includes(q) || (p.council_number || "").toLowerCase().includes(q);
    const matchesStatus = statusFilter === "all" || p.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const resetForm = () => {
    setFullName(""); setCategory(""); setCouncilType(""); setCouncilNumber("");
    setCpf(""); setPhone(""); setEmail(""); setStatus("active"); setDefaultDuration("30");
    setEditing(null);
  };

  const openEdit = (p: DbProfessional) => {
    setEditing(p);
    setFullName(p.full_name); setCategory(p.category || ""); setCouncilType(p.council_type || "");
    setCouncilNumber(p.council_number || ""); setCpf(p.cpf || ""); setPhone(p.phone || "");
    setEmail(p.email || ""); setStatus(p.status || "active");
    setDefaultDuration(String(p.default_duration_minutes || 30));
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!fullName || !category || !councilType || !councilNumber) {
      toast({ title: "Preencha os campos obrigatórios", variant: "destructive" });
      return;
    }
    try {
      setSaving(true);
      const row: Record<string, any> = {
        full_name: fullName,
        category,
        council_type: councilType,
        council_number: councilNumber,
        cpf: cpf || null,
        phone: phone || null,
        email: email || null,
        status,
        default_duration_minutes: parseInt(defaultDuration) || 30,
      };

      if (editing) {
        row.updated_at = new Date().toISOString();
        const { error: err } = await supabase
          .from('professionals')
          .update(row)
          .eq('id', editing.id);
        if (err) throw new Error((err as Error).message);
        toast({ title: "Profissional atualizado!" });
      } else {
        const { error: err } = await supabase
          .from('professionals')
          .insert(row);
        if (err) throw new Error((err as Error).message);
        toast({ title: "Profissional cadastrado!" });
      }
      resetForm();
      setDialogOpen(false);
      await loadData();
    } catch (err) {
      toast({ title: "Erro", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => { resetForm(); setDialogOpen(false); };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadData} />;

  const activeCount = professionals.filter((p) => p.status === "active").length;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Profissionais"
        description={`${professionals.length} profissionais (${activeCount} ativos)`}
        actions={
          <Button onClick={() => { resetForm(); setDialogOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" />Novo Profissional
          </Button>
        }
      />

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por nome, função ou conselho..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[120px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="active">Ativos</SelectItem>
            <SelectItem value="inactive">Inativos</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Stethoscope} title="Nenhum profissional encontrado" />
      ) : (
        <div className="rounded-lg border bg-card overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Conselho</TableHead>
                <TableHead>Duração</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p) => (
                <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50" onClick={() => openEdit(p)}>
                  <TableCell>
                    <div>
                      <p className="font-medium text-sm">{p.full_name}</p>
                      <p className="text-[10px] text-muted-foreground">{p.email || "—"}</p>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{p.category || "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{p.council_type} {p.council_number}</TableCell>
                  <TableCell className="text-xs">{p.default_duration_minutes || 30}min</TableCell>
                  <TableCell><ProfessionalStatusBadge status={(p.status as "active" | "inactive") || "active"} /></TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={(e) => { e.stopPropagation(); openEdit(p); }}>Editar</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(v) => { if (!v) handleClose(); else setDialogOpen(v); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar Profissional" : "Novo Profissional"}</DialogTitle>
            <DialogDescription>Preencha os dados do profissional de saúde.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome Completo *</Label>
              <Input placeholder="Nome do profissional" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Categoria/Função *</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Médico">Médico</SelectItem>
                    <SelectItem value="Médica">Médica</SelectItem>
                    <SelectItem value="Fisioterapeuta">Fisioterapeuta</SelectItem>
                    <SelectItem value="Psicólogo">Psicólogo</SelectItem>
                    <SelectItem value="Psicóloga">Psicóloga</SelectItem>
                    <SelectItem value="Enfermeiro">Enfermeiro(a)</SelectItem>
                    <SelectItem value="Nutricionista">Nutricionista</SelectItem>
                    <SelectItem value="Fonoaudiólogo">Fonoaudiólogo(a)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Ativo</SelectItem>
                    <SelectItem value="inactive">Inativo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Conselho *</Label>
                <Select value={councilType} onValueChange={setCouncilType}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CRM">CRM</SelectItem>
                    <SelectItem value="CREFITO">CREFITO</SelectItem>
                    <SelectItem value="CRP">CRP</SelectItem>
                    <SelectItem value="COREN">COREN</SelectItem>
                    <SelectItem value="CRN">CRN</SelectItem>
                    <SelectItem value="CRFa">CRFa</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Nº do Conselho *</Label>
                <Input placeholder="12345-UF" value={councilNumber} onChange={(e) => setCouncilNumber(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>CPF</Label>
                <Input placeholder="000.000.000-00" value={cpf} onChange={(e) => setCpf(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Telefone</Label>
                <Input placeholder="(00) 00000-0000" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>E-mail</Label>
              <Input type="email" placeholder="email@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Duração padrão (min)</Label>
              <Input type="number" value={defaultDuration} onChange={(e) => setDefaultDuration(e.target.value)} min="10" step="5" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleClose}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Salvando..." : editing ? "Salvar" : "Cadastrar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
