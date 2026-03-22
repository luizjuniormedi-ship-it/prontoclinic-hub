import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Search, Plus, Edit, UserCheck, UserX, Shield } from "lucide-react";
import { mockSystemUsers, mockPermissionProfiles } from "@/services/adminMockData";
import { mockProfessionals } from "@/services/mockData";
import { SystemUser } from "@/types/admin";
import { useToast } from "@/hooks/use-toast";

const emptyUser: Omit<SystemUser, "id" | "createdAt" | "updatedAt"> = {
  name: "", email: "", login: "", phone: "", cpf: "", role: "", unit: "",
  status: "active", profileId: "", profileName: "", notes: "",
};

export default function AdminUsersPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterProfile, setFilterProfile] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<Partial<SystemUser> | null>(null);
  const [form, setForm] = useState(emptyUser);

  const users = mockSystemUsers.filter((u) => {
    const q = search.toLowerCase();
    const matchesSearch = !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.cpf.includes(q) || u.role.toLowerCase().includes(q);
    const matchesStatus = filterStatus === "all" || u.status === filterStatus;
    const matchesProfile = filterProfile === "all" || u.profileId === filterProfile;
    return matchesSearch && matchesStatus && matchesProfile;
  });

  const openNew = () => { setEditingUser(null); setForm(emptyUser); setDialogOpen(true); };
  const openEdit = (u: SystemUser) => {
    setEditingUser(u);
    setForm({ name: u.name, email: u.email, login: u.login, phone: u.phone, cpf: u.cpf, role: u.role, unit: u.unit, status: u.status, profileId: u.profileId, profileName: u.profileName, linkedProfessionalId: u.linkedProfessionalId, linkedProfessionalName: u.linkedProfessionalName, notes: u.notes });
    setDialogOpen(true);
  };

  const handleSave = () => {
    if (!form.name || !form.email || !form.login || !form.profileId) {
      toast({ title: "Preencha os campos obrigatórios", variant: "destructive" }); return;
    }
    toast({ title: editingUser ? "Usuário atualizado" : "Usuário cadastrado" });
    setDialogOpen(false);
  };

  const toggleStatus = (u: SystemUser) => {
    toast({ title: `Usuário ${u.status === "active" ? "inativado" : "ativado"}` });
  };

  const updateField = (field: string, value: string) => {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      if (field === "profileId") {
        const p = mockPermissionProfiles.find((pr) => pr.id === value);
        next.profileName = p?.name || "";
      }
      if (field === "linkedProfessionalId") {
        const pr = mockProfessionals.find((p) => p.id === value);
        next.linkedProfessionalName = pr?.name || "";
      }
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Usuários do Sistema" description="Gestão de usuários e acessos" />

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por nome, e-mail, CPF ou cargo..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="active">Ativos</SelectItem>
            <SelectItem value="inactive">Inativos</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterProfile} onValueChange={setFilterProfile}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Perfil" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os perfis</SelectItem>
            {mockPermissionProfiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button onClick={openNew}><Plus className="h-4 w-4 mr-1" />Novo Usuário</Button>
      </div>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead className="hidden md:table-cell">E-mail</TableHead>
              <TableHead className="hidden lg:table-cell">Cargo</TableHead>
              <TableHead>Perfil</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Nenhum usuário encontrado</TableCell></TableRow>
            ) : users.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <div>
                    <p className="font-medium text-sm">{u.name}</p>
                    <p className="text-xs text-muted-foreground">{u.login}</p>
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell text-sm">{u.email}</TableCell>
                <TableCell className="hidden lg:table-cell text-sm">{u.role}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="gap-1">
                    <Shield className="h-3 w-3" />{u.profileName}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={u.status === "active" ? "default" : "secondary"} className={u.status === "active" ? "bg-green-100 text-green-700 hover:bg-green-100" : "bg-muted text-muted-foreground"}>
                    {u.status === "active" ? "Ativo" : "Inativo"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(u)} title="Editar"><Edit className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => toggleStatus(u)} title={u.status === "active" ? "Inativar" : "Ativar"}>
                      {u.status === "active" ? <UserX className="h-4 w-4 text-destructive" /> : <UserCheck className="h-4 w-4 text-green-600" />}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingUser ? "Editar Usuário" : "Novo Usuário"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Nome completo *</Label>
              <Input value={form.name} onChange={(e) => updateField("name", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Login *</Label>
              <Input value={form.login} onChange={(e) => updateField("login", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>E-mail *</Label>
              <Input type="email" value={form.email} onChange={(e) => updateField("email", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Telefone</Label>
              <Input value={form.phone} onChange={(e) => updateField("phone", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>CPF</Label>
              <Input value={form.cpf} onChange={(e) => updateField("cpf", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Cargo/Função</Label>
              <Input value={form.role} onChange={(e) => updateField("role", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Unidade</Label>
              <Input value={form.unit} onChange={(e) => updateField("unit", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Perfil de acesso *</Label>
              <Select value={form.profileId} onValueChange={(v) => updateField("profileId", v)}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {mockPermissionProfiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Profissional vinculado</Label>
              <Select value={form.linkedProfessionalId || "none"} onValueChange={(v) => updateField("linkedProfessionalId", v === "none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Nenhum" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {mockProfessionals.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => updateField("status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Ativo</SelectItem>
                  <SelectItem value="inactive">Inativo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label>Observações</Label>
              <Textarea value={form.notes || ""} onChange={(e) => updateField("notes", e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
