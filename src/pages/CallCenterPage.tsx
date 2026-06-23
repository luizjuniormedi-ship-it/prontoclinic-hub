import { useEffect, useState } from "react";
import { Phone, Search, Plus, UserPlus, Calendar, CheckCircle, XCircle, PhoneMissed, MessageSquare } from "lucide-react";
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
import { catalogService } from "@/services/catalogService";
import { patientsService } from "@/services/patientsService";
import { preCadastroService } from "@/services/preCadastroService";
import { CallCenterContactStatus, Specialty } from "@/types";
import { useToast } from "@/hooks/use-toast";

const contactStatusLabels: Record<CallCenterContactStatus, string> = {
  agendado: "Agendado", confirmado: "Confirmado", cancelado: "Cancelado",
  remarcado: "Remarcado", nao_atendeu: "Não Atendeu", recado: "Recado",
};
const contactStatusColors: Record<CallCenterContactStatus, string> = {
  agendado: "bg-primary/10 text-primary", confirmado: "bg-success/10 text-success",
  cancelado: "bg-destructive/10 text-destructive", remarcado: "bg-warning/10 text-warning",
  nao_atendeu: "bg-muted text-muted-foreground", recado: "bg-secondary/10 text-secondary",
};

export default function CallCenterPage() {
  const [records, setRecords] = useState<Array<{
    id: string;
    patientName: string;
    cpf?: string | null;
    phone: string;
    specialtyName: string;
    unitName: string;
    contactStatus: CallCenterContactStatus;
    notes?: string;
    createdAt: string;
  }>>([]);
  const [units, setUnits] = useState<{ id: string; name: string }[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [unitFilter, setUnitFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    // Call Center trabalha com pré-cadastros (leads) — fonte real no Supabase
    Promise.all([
      preCadastroService.listar(),
      catalogService.units.getAll(),
      catalogService.specialties.getAll(),
    ]).then(([preCadastros, u, s]) => {
      const recordsFormatados = preCadastros.map((p) => ({
        id: String(p.id),
        patientName: p.nm_paciente,
        cpf: p.nr_cpf,
        phone: p.nr_telefone,
        specialtyName: p.especialidade ?? "—",
        unitName: u[0]?.name ?? "—",
        contactStatus: (p.tp_status === "confirmado" ? "confirmado" : p.tp_status === "cancelado" ? "cancelado" : "agendado") as CallCenterContactStatus,
        notes: p.ds_observacao,
        createdAt: p.created_at,
      }));
      setRecords(recordsFormatados);
      setUnits(u.map((unit) => ({ id: unit.id, name: unit.name })));
      setSpecialties(s);
      setLoading(false);
    }).catch((err) => {
      console.error("Erro ao carregar call center:", err);
      toast({ title: "Erro ao carregar dados", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
      setLoading(false);
    });
  }, [toast]);

  const filtered = records.filter((r) => {
    const q = search.toLowerCase();
    const matchSearch = !search || r.patientName.toLowerCase().includes(q) || (r.cpf && r.cpf.includes(q)) || r.phone.includes(q);
    const matchStatus = statusFilter === "all" || r.contactStatus === statusFilter;
    const matchUnit = unitFilter === "all" || r.unitId === unitFilter;
    return matchSearch && matchStatus && matchUnit;
  });

  const stats = {
    total: records.length,
    agendados: records.filter((r) => r.contactStatus === "agendado").length,
    confirmados: records.filter((r) => r.contactStatus === "confirmado").length,
    naoAtendeu: records.filter((r) => r.contactStatus === "nao_atendeu").length,
  };

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Call Center" description="Pré-cadastro, agendamento e confirmação" actions={
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setDialogOpen(true)}><UserPlus className="mr-2 h-4 w-4" />Pré-Cadastro</Button>
          <Button onClick={() => setDialogOpen(true)}><Plus className="mr-2 h-4 w-4" />Novo Contato</Button>
        </div>
      } />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Card><CardContent className="p-3 flex items-center gap-2"><Phone className="h-4 w-4 text-primary" /><div><p className="text-lg font-bold">{stats.total}</p><p className="text-[10px] text-muted-foreground">Total contatos</p></div></CardContent></Card>
        <Card><CardContent className="p-3 flex items-center gap-2"><Calendar className="h-4 w-4 text-primary" /><div><p className="text-lg font-bold text-primary">{stats.agendados}</p><p className="text-[10px] text-muted-foreground">Agendados</p></div></CardContent></Card>
        <Card><CardContent className="p-3 flex items-center gap-2"><CheckCircle className="h-4 w-4 text-success" /><div><p className="text-lg font-bold text-success">{stats.confirmados}</p><p className="text-[10px] text-muted-foreground">Confirmados</p></div></CardContent></Card>
        <Card><CardContent className="p-3 flex items-center gap-2"><PhoneMissed className="h-4 w-4 text-muted-foreground" /><div><p className="text-lg font-bold text-muted-foreground">{stats.naoAtendeu}</p><p className="text-[10px] text-muted-foreground">Não atendeu</p></div></CardContent></Card>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por nome, CPF ou telefone..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {(Object.keys(contactStatusLabels) as CallCenterContactStatus[]).map((s) => <SelectItem key={s} value={s}>{contactStatusLabels[s]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={unitFilter} onValueChange={setUnitFilter}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Unidade" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            {units.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {filtered.length === 0 ? <EmptyState icon={Phone} title="Nenhum registro" description="Nenhum contato encontrado." /> : (
        <div className="rounded-lg border bg-card overflow-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Paciente</TableHead><TableHead>Telefone</TableHead><TableHead>Unidade</TableHead><TableHead>Especialidade</TableHead><TableHead>Tipo</TableHead><TableHead>Status</TableHead><TableHead>Operador</TableHead><TableHead>Observações</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium text-sm">{r.patientName}</p>
                      {r.cpf && <p className="text-[10px] text-muted-foreground">{r.cpf}</p>}
                      {r.patientId && <Badge variant="outline" className="text-[9px] bg-success/10 text-success border-0 mt-0.5">Cadastrado</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">{r.phone}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.unitName || "—"}</TableCell>
                  <TableCell className="text-xs">{r.specialtyName || "—"}</TableCell>
                  <TableCell className="text-xs">{r.appointmentType || "—"}</TableCell>
                  <TableCell><Badge variant="outline" className={`border-0 text-[10px] ${contactStatusColors[r.contactStatus]}`}>{contactStatusLabels[r.contactStatus]}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.operatorName}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[120px] truncate">{r.notes || "—"}</TableCell>
                  <TableCell><Button variant="ghost" size="sm" className="h-7 text-xs">Ações</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* New contact dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Novo Contato / Pré-Cadastro</DialogTitle><DialogDescription>Registre um contato ou pré-cadastre um paciente.</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Nome do Paciente *</Label><Input placeholder="Nome completo" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>CPF</Label><Input placeholder="000.000.000-00" /></div>
              <div className="space-y-2"><Label>Telefone *</Label><Input placeholder="(00) 00000-0000" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Data Nascimento</Label><Input type="date" /></div>
              <div className="space-y-2"><Label>Convênio</Label><Input placeholder="Convênio" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Unidade</Label>
                <Select><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{units.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Especialidade</Label>
                <Select><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{specialties.map((s) => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2"><Label>Status do Contato</Label>
              <Select><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(contactStatusLabels) as CallCenterContactStatus[]).map((s) => <SelectItem key={s} value={s}>{contactStatusLabels[s]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Observações</Label><Textarea placeholder="Notas do contato..." rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={() => { toast({ title: "Contato registrado!" }); setDialogOpen(false); }}>Registrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
