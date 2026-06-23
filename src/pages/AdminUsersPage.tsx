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
import { Search, Edit, UserCheck, UserX, Shield } from "lucide-react";
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
  const [editingUser, setEditingUser] = useState<UserProfileWithEmail | null>(null);
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
    </div>
  );
}