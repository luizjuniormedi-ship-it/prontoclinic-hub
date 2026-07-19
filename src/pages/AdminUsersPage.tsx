import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Search, Edit, UserCheck, UserX, Shield, KeyRound, UserPlus } from "lucide-react";
import { userProfilesService, type UserProfileWithEmail } from "@/services/userProfilesService";
import { useToast } from "@/hooks/use-toast";

interface PermissionProfile {
  id: string;
  name: string;
  description: string;
}

export default function AdminUsersPage() {
  const { toast } = useToast();
  const [users, setUsers] = useState<UserProfileWithEmail[]>([]);
  const [profiles, setProfiles] = useState<PermissionProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterProfile, setFilterProfile] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserProfileWithEmail | null>(null);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({ email: "", full_name: "", role_name: "", phone: "", cpf: "", primary_unit_id: "" });
  const [form, setForm] = useState<{ full_name: string; phone: string; cpf: string; role_name: string; lg_ativo: boolean }>({
    full_name: "", phone: "", cpf: "", role_name: "", lg_ativo: true,
  });

  const load = async () => {
    setLoading(true);
    try {
      const [u, p] = await Promise.all([
        userProfilesService.getAll(),
        userProfilesService.getProfiles(),
      ]);
      setUsers(u);
      setProfiles(p);
    } catch (err) {
      toast({
        title: "Erro ao carregar usuários",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    const matchesSearch = !q || u.full_name.toLowerCase().includes(q) || (u.email ?? "").toLowerCase().includes(q) || (u.cpf ?? "").includes(q) || (u.role_name ?? "").toLowerCase().includes(q);
    const matchesStatus = filterStatus === "all" || (u.lg_ativo ? "active" : "inactive") === filterStatus;
    const matchesProfile = filterProfile === "all" || (u.role_name ?? "") === filterProfile;
    return matchesSearch && matchesStatus && matchesProfile;
  });

  const openEdit = (u: UserProfileWithEmail) => {
    setEditingUser(u);
    setForm({
      full_name: u.full_name,
      phone: u.phone ?? "",
      cpf: u.cpf ?? "",
      role_name: u.role_name ?? "",
      lg_ativo: u.lg_ativo,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!editingUser) return;
    if (!form.full_name.trim()) {
      toast({ title: "Nome obrigatório", variant: "destructive" });
      return;
    }
    try {
      await userProfilesService.update(editingUser.id, {
        full_name: form.full_name,
        role_name: form.role_name || null,
        phone: form.phone || null,
        cpf: form.cpf || null,
        lg_ativo: form.lg_ativo,
      });
      toast({ title: "Usuário atualizado" });
      setDialogOpen(false);
      void load();
    } catch (err) {
      toast({
        title: "Erro ao salvar",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };

  const openCreate = () => {
    setCreateForm({ email: "", full_name: "", role_name: profiles[0]?.id ?? "", phone: "", cpf: "", primary_unit_id: "" });
    setCreateDialogOpen(true);
  };

  const handleCreate = async () => {
    if (!createForm.email.trim() || !createForm.full_name.trim() || !createForm.role_name) {
      toast({ title: "Nome, e-mail e perfil são obrigatórios", variant: "destructive" });
      return;
    }
    try {
      setCreating(true);
      await userProfilesService.invite({
        email: createForm.email.trim(),
        full_name: createForm.full_name.trim(),
        role_name: createForm.role_name,
        phone: createForm.phone.trim() || null,
        cpf: createForm.cpf.trim() || null,
        primary_unit_id: createForm.primary_unit_id ? Number(createForm.primary_unit_id) : null,
      });
      toast({ title: "Convite enviado", description: "O usuário receberá o link de ativação por e-mail." });
      setCreateDialogOpen(false);
      void load();
    } catch (err) {
      toast({ title: "Erro ao convidar usuário", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const toggleStatus = async (u: UserProfileWithEmail) => {
    try {
      await userProfilesService.toggleAtivo(u.id, !u.lg_ativo);
      toast({ title: `Usuário ${u.lg_ativo ? "inativado" : "ativado"}` });
      void load();
    } catch (err) {
      toast({
        title: "Erro",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };

  const requirePasswordChange = async (u: UserProfileWithEmail) => {
    try {
      await userProfilesService.requirePasswordChange(u.id);
      toast({ title: "Troca de senha exigida", description: "O usuário deverá definir uma nova senha no próximo acesso." });
    } catch (err) {
      toast({ title: "Erro ao exigir troca de senha", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  };

  if (loading) return <div className="p-6 text-muted-foreground">Carregando...</div>;

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
            {profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button onClick={openCreate} className="shrink-0"><UserPlus className="mr-2 h-4 w-4" />Novo usuário</Button>
      </div>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Perfil</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Nenhum usuário encontrado</TableCell></TableRow>
            ) : filtered.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <div>
                    <p className="font-medium text-sm">{u.full_name}</p>
                    {u.email && <p className="text-xs text-muted-foreground">{u.email}</p>}
                  </div>
                </TableCell>
                <TableCell>
                  {u.role_name && (
                    <Badge variant="outline" className="gap-1">
                      <Shield className="h-3 w-3" />{u.role_name}
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={u.lg_ativo ? "default" : "secondary"} className={u.lg_ativo ? "bg-green-100 text-green-700 hover:bg-green-100" : "bg-muted text-muted-foreground"}>
                    {u.lg_ativo ? "Ativo" : "Inativo"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(u)} title="Editar"><Edit className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => void requirePasswordChange(u)} title="Exigir troca de senha no próximo acesso"><KeyRound className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => void toggleStatus(u)} title={u.lg_ativo ? "Inativar" : "Ativar"}>
                      {u.lg_ativo ? <UserX className="h-4 w-4 text-destructive" /> : <UserCheck className="h-4 w-4 text-green-600" />}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar Usuário</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Nome completo *</Label>
              <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>CPF</Label>
              <Input value={form.cpf} onChange={(e) => setForm({ ...form, cpf: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Telefone</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Perfil de acesso</Label>
              <Select value={form.role_name} onValueChange={(v) => setForm({ ...form, role_name: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.lg_ativo ? "active" : "inactive"} onValueChange={(v) => setForm({ ...form, lg_ativo: v === "active" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Ativo</SelectItem>
                  <SelectItem value="inactive">Inativo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={() => void handleSave()}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createDialogOpen} onOpenChange={(open) => { if (!creating) setCreateDialogOpen(open); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Cadastrar usuário</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>Nome completo *</Label><Input value={createForm.full_name} onChange={(e) => setCreateForm({ ...createForm, full_name: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>E-mail *</Label><Input type="email" value={createForm.email} onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5"><Label>CPF</Label><Input value={createForm.cpf} onChange={(e) => setCreateForm({ ...createForm, cpf: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Telefone</Label><Input value={createForm.phone} onChange={(e) => setCreateForm({ ...createForm, phone: e.target.value })} /></div>
            </div>
            <div className="space-y-1.5"><Label>Perfil *</Label><Select value={createForm.role_name} onValueChange={(v) => setCreateForm({ ...createForm, role_name: v })}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label>ID da unidade principal</Label><Input type="number" min="1" value={createForm.primary_unit_id} onChange={(e) => setCreateForm({ ...createForm, primary_unit_id: e.target.value })} placeholder="Opcional" /></div>
            <p className="text-xs text-muted-foreground">A conta será criada pelo endpoint administrativo seguro e o usuário receberá um convite para ativação.</p>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setCreateDialogOpen(false)} disabled={creating}>Cancelar</Button><Button onClick={() => void handleCreate()} disabled={creating}>{creating ? "Enviando..." : "Enviar convite"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
