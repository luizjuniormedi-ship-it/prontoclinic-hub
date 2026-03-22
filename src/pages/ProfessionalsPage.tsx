import { useEffect, useState } from "react";
import { Plus, Search, Stethoscope, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState } from "@/components/StateViews";
import { ProfessionalStatusBadge } from "@/components/StatusBadge";
import { api } from "@/services/api";
import { Professional, Specialty } from "@/types";
import { useToast } from "@/hooks/use-toast";

export default function ProfessionalsPage() {
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [specialtyFilter, setSpecialtyFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Professional | null>(null);
  const { toast } = useToast();

  // Form fields
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [selectedSpecialties, setSelectedSpecialties] = useState<string[]>([]);
  const [council, setCouncil] = useState("");
  const [councilNumber, setCouncilNumber] = useState("");
  const [cpf, setCpf] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"active" | "inactive">("active");
  const [agendaColor, setAgendaColor] = useState("#2563EB");
  const [defaultDuration, setDefaultDuration] = useState("30");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    Promise.all([api.getProfessionals(), api.getSpecialties()]).then(([p, s]) => {
      setProfessionals(p);
      setSpecialties(s);
      setLoading(false);
    });
  }, []);

  const filtered = professionals.filter((p) => {
    const q = search.toLowerCase();
    const matchesSearch = !search || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q) || p.specialties.some((s) => s.toLowerCase().includes(q)) || p.council.toLowerCase().includes(q) || p.councilNumber.toLowerCase().includes(q);
    const matchesStatus = statusFilter === "all" || p.status === statusFilter;
    const matchesSpecialty = specialtyFilter === "all" || p.specialties.includes(specialtyFilter);
    return matchesSearch && matchesStatus && matchesSpecialty;
  });

  const resetForm = () => {
    setName(""); setCategory(""); setSelectedSpecialties([]); setCouncil("");
    setCouncilNumber(""); setCpf(""); setPhone(""); setEmail("");
    setStatus("active"); setAgendaColor("#2563EB"); setDefaultDuration("30"); setNotes("");
    setEditing(null);
  };

  const openEdit = (p: Professional) => {
    setEditing(p);
    setName(p.name); setCategory(p.category); setSelectedSpecialties([...p.specialties]);
    setCouncil(p.council); setCouncilNumber(p.councilNumber); setCpf(p.cpf);
    setPhone(p.phone); setEmail(p.email); setStatus(p.status);
    setAgendaColor(p.agendaColor); setDefaultDuration(String(p.defaultDuration));
    setNotes(p.notes || "");
    setDialogOpen(true);
  };

  const handleSave = () => {
    if (!name || !category || !council || !councilNumber) {
      toast({ title: "Preencha os campos obrigatórios", variant: "destructive" });
      return;
    }
    toast({ title: editing ? "Profissional atualizado!" : "Profissional cadastrado!" });
    resetForm();
    setDialogOpen(false);
  };

  const handleClose = () => { resetForm(); setDialogOpen(false); };

  const toggleSpecialty = (spec: string) => {
    setSelectedSpecialties((prev) =>
      prev.includes(spec) ? prev.filter((s) => s !== spec) : [...prev, spec]
    );
  };

  if (loading) return <LoadingState />;

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

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por nome, função, especialidade ou conselho..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[120px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="active">Ativos</SelectItem>
            <SelectItem value="inactive">Inativos</SelectItem>
          </SelectContent>
        </Select>
        <Select value={specialtyFilter} onValueChange={setSpecialtyFilter}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Especialidade" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            {specialties.map((s) => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <EmptyState icon={Stethoscope} title="Nenhum profissional encontrado" description="Ajuste os filtros ou cadastre um novo profissional." />
      ) : (
        <div className="rounded-lg border bg-card overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cor</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Especialidades</TableHead>
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
                    <div className="h-4 w-4 rounded-full border" style={{ backgroundColor: p.agendaColor }} />
                  </TableCell>
                  <TableCell>
                    <div>
                      <p className="font-medium text-sm">{p.name}</p>
                      <p className="text-[10px] text-muted-foreground">{p.email}</p>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{p.category}</TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {p.specialties.map((s) => (
                        <Badge key={s} variant="outline" className="text-[10px] bg-primary/10 text-primary border-0">{s}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{p.council} {p.councilNumber}</TableCell>
                  <TableCell className="text-xs">{p.defaultDuration}min</TableCell>
                  <TableCell><ProfessionalStatusBadge status={p.status} /></TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={(e) => { e.stopPropagation(); openEdit(p); }}>Editar</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(v) => { if (!v) handleClose(); else setDialogOpen(v); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar Profissional" : "Novo Profissional"}</DialogTitle>
            <DialogDescription>Preencha os dados do profissional de saúde.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome Completo *</Label>
              <Input placeholder="Nome do profissional" value={name} onChange={(e) => setName(e.target.value)} />
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
                <Select value={status} onValueChange={(v) => setStatus(v as "active" | "inactive")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Ativo</SelectItem>
                    <SelectItem value="inactive">Inativo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Especialidades</Label>
              <div className="flex gap-1.5 flex-wrap">
                {specialties.map((s) => (
                  <Badge
                    key={s.id}
                    variant="outline"
                    className={`cursor-pointer text-xs transition-colors ${selectedSpecialties.includes(s.name) ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"}`}
                    onClick={() => toggleSpecialty(s.name)}
                  >
                    {s.name}
                  </Badge>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Conselho *</Label>
                <Select value={council} onValueChange={setCouncil}>
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

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Cor da Agenda</Label>
                <div className="flex items-center gap-2">
                  <input type="color" value={agendaColor} onChange={(e) => setAgendaColor(e.target.value)} className="h-8 w-10 rounded border cursor-pointer" />
                  <span className="text-xs text-muted-foreground">{agendaColor}</span>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Duração padrão (min)</Label>
                <Input type="number" value={defaultDuration} onChange={(e) => setDefaultDuration(e.target.value)} min="10" step="5" />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Observações</Label>
              <Textarea placeholder="Notas sobre horários, restrições..." value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleClose}>Cancelar</Button>
            <Button onClick={handleSave}>{editing ? "Salvar" : "Cadastrar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
