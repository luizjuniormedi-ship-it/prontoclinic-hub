import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Search, Plus, Edit, Copy, Shield, Lock, Users } from "lucide-react";
import { mockPermissionProfiles, mockSystemUsers } from "@/services/adminMockData";
import { PERMISSION_MODULES, PermissionProfile } from "@/types/admin";
import { useToast } from "@/hooks/use-toast";

export default function AdminProfilesPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PermissionProfile | null>(null);
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");

  const profiles = mockPermissionProfiles.filter((p) =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.description.toLowerCase().includes(search.toLowerCase())
  );

  const countUsers = (profileId: string) => mockSystemUsers.filter((u) => u.profileId === profileId).length;
  const countPermissions = (p: PermissionProfile) => Object.values(p.permissions).reduce((sum, arr) => sum + arr.length, 0);

  const openNew = () => { setEditing(null); setFormName(""); setFormDesc(""); setDialogOpen(true); };
  const openEdit = (p: PermissionProfile) => { setEditing(p); setFormName(p.name); setFormDesc(p.description); setDialogOpen(true); };
  const duplicate = (p: PermissionProfile) => {
    setEditing(null);
    setFormName(`${p.name} (Cópia)`);
    setFormDesc(p.description);
    setDialogOpen(true);
    toast({ title: "Perfil duplicado — edite e salve" });
  };

  const handleSave = () => {
    if (!formName) { toast({ title: "Informe o nome do perfil", variant: "destructive" }); return; }
    toast({ title: editing ? "Perfil atualizado" : "Perfil criado" });
    setDialogOpen(false);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Perfis de Permissão" description="Gerencie perfis de acesso e suas permissões" />

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar perfil..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Button onClick={openNew}><Plus className="h-4 w-4 mr-1" />Novo Perfil</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {profiles.map((p) => (
          <Card key={p.id} className="relative">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-primary" />
                  <CardTitle className="text-base">{p.name}</CardTitle>
                </div>
                <div className="flex gap-1">
                  {p.isSystem && <Badge variant="secondary" className="text-[10px] gap-1"><Lock className="h-3 w-3" />Sistema</Badge>}
                </div>
              </div>
              <p className="text-sm text-muted-foreground">{p.description}</p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-4 text-sm">
                <span className="flex items-center gap-1 text-muted-foreground"><Users className="h-3.5 w-3.5" />{countUsers(p.id)} usuários</span>
                <span className="flex items-center gap-1 text-muted-foreground"><Shield className="h-3.5 w-3.5" />{countPermissions(p)} permissões</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {PERMISSION_MODULES.filter((m) => (p.permissions[m.moduleKey]?.length || 0) > 0).map((m) => (
                  <Badge key={m.moduleKey} variant="outline" className="text-[10px]">{m.moduleLabel}</Badge>
                ))}
              </div>
              <div className="flex gap-2 pt-2 border-t">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => openEdit(p)}><Edit className="h-3.5 w-3.5 mr-1" />Editar</Button>
                <Button variant="outline" size="sm" className="flex-1" onClick={() => duplicate(p)}><Copy className="h-3.5 w-3.5 mr-1" />Duplicar</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Editar Perfil" : "Novo Perfil"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5"><Label>Nome do perfil *</Label><Input value={formName} onChange={(e) => setFormName(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Descrição</Label><Textarea value={formDesc} onChange={(e) => setFormDesc(e.target.value)} rows={2} /></div>
            <p className="text-sm text-muted-foreground">As permissões detalhadas podem ser configuradas na tela de <strong>Matriz de Permissões</strong>.</p>
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
