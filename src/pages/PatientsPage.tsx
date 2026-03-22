import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Search, Users, AlertTriangle, CheckCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState } from "@/components/StateViews";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/services/api";
import { Patient, Appointment } from "@/types";
import { formatDate, calculateAge } from "@/utils/formatters";
import { useToast } from "@/hooks/use-toast";

export default function PatientsPage() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  // New patient form duplicate detection
  const [newCpf, setNewCpf] = useState("");
  const [newPhone, setNewPhone] = useState("");

  useEffect(() => {
    Promise.all([api.getPatients(), api.getAppointments()]).then(([p, a]) => {
      setPatients(p);
      setAppointments(a);
      setLoading(false);
    });
  }, []);

  const filtered = patients.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.cpf.includes(search) ||
    p.phone.includes(search)
  );

  // Duplicate detection
  const duplicateByCpf = newCpf.length >= 6 ? patients.find((p) => p.cpf.includes(newCpf)) : undefined;
  const duplicateByPhone = newPhone.length >= 8 ? patients.find((p) => p.phone.includes(newPhone)) : undefined;
  const duplicate = duplicateByCpf || duplicateByPhone;

  // Check profile completeness
  const isComplete = (p: Patient) => !!(p.name && p.cpf && p.birthDate && p.phone && p.email && p.gender);

  // Get last appointment for patient
  const getLastAppointment = (patientId: string) => {
    const patientApps = appointments
      .filter((a) => a.patientId === patientId && a.status === "completed")
      .sort((a, b) => b.date.localeCompare(a.date));
    return patientApps[0];
  };

  const handleCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    toast({ title: "Paciente cadastrado com sucesso!" });
    setDialogOpen(false);
    setNewCpf("");
    setNewPhone("");
  };

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Pacientes"
        description={`${patients.length} pacientes cadastrados`}
        actions={
          <Dialog open={dialogOpen} onOpenChange={(v) => { setDialogOpen(v); if (!v) { setNewCpf(""); setNewPhone(""); } }}>
            <DialogTrigger asChild>
              <Button><Plus className="mr-2 h-4 w-4" />Novo Paciente</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Cadastrar Paciente</DialogTitle>
                <DialogDescription>Preencha os dados do paciente. Campos com * são obrigatórios.</DialogDescription>
              </DialogHeader>

              {/* Duplicate alert */}
              {duplicate && (
                <Card className="border-warning/30 bg-warning/5">
                  <CardContent className="p-3">
                    <div className="flex items-center gap-1.5 text-warning text-sm font-medium mb-1">
                      <AlertTriangle className="h-4 w-4" />Possível duplicidade encontrada
                    </div>
                    <p className="text-xs">{duplicate.name} — {duplicate.cpf}</p>
                    <p className="text-xs text-muted-foreground">{duplicate.phone}</p>
                    <Button variant="link" size="sm" className="h-auto p-0 text-xs mt-1" onClick={() => { setDialogOpen(false); navigate(`/patients/${duplicate.id}`); }}>
                      Ver cadastro existente →
                    </Button>
                  </CardContent>
                </Card>
              )}

              <form onSubmit={handleCreate} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2 space-y-2">
                    <Label>Nome Completo *</Label>
                    <Input placeholder="Nome do paciente" required />
                  </div>
                  <div className="space-y-2">
                    <Label>CPF *</Label>
                    <Input placeholder="000.000.000-00" required value={newCpf} onChange={(e) => setNewCpf(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Data de Nascimento *</Label>
                    <Input type="date" required />
                  </div>
                  <div className="space-y-2">
                    <Label>Telefone *</Label>
                    <Input placeholder="(00) 00000-0000" required value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Sexo *</Label>
                    <Select>
                      <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="M">Masculino</SelectItem>
                        <SelectItem value="F">Feminino</SelectItem>
                        <SelectItem value="O">Outro</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>E-mail</Label>
                    <Input type="email" placeholder="email@email.com" />
                  </div>
                  <div className="space-y-2">
                    <Label>Convênio</Label>
                    <Input placeholder="Nome do convênio" />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
                  <Button type="submit">Salvar</Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Buscar por nome, CPF ou telefone..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Users} title="Nenhum paciente encontrado" description="Tente ajustar os filtros de busca." />
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
                <TableHead>Último atendimento</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p) => {
                const lastApp = getLastAppointment(p.id);
                const complete = isComplete(p);
                return (
                  <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/patients/${p.id}`)}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{p.name}</span>
                        {p.allergies && <AlertTriangle className="h-3 w-3 text-destructive" />}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">{p.cpf}</TableCell>
                    <TableCell>{calculateAge(p.birthDate)}a</TableCell>
                    <TableCell className="text-xs">{p.phone}</TableCell>
                    <TableCell className="text-xs">{p.healthInsurance || <span className="text-muted-foreground">Particular</span>}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] border-0 ${complete ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
                        {complete ? "Completo" : "Incompleto"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {lastApp ? (
                        <div className="text-xs">
                          <p>{formatDate(lastApp.date)}</p>
                          <p className="text-muted-foreground">{lastApp.specialty || lastApp.doctorName}</p>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
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
