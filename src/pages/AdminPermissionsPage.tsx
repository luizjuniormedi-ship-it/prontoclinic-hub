import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Shield, Save } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  rolePermissionsService,
  MODULE_LABELS,
  ACTION_LABELS,
  type RolePermission,
  type PermissionAction,
} from "@/services/rolePermissionsService";
import { userProfilesService, type UserProfileWithEmail } from "@/services/userProfilesService";
import { useToast } from "@/hooks/use-toast";

const ACTIONS: PermissionAction[] = ["can_view", "can_create", "can_edit", "can_delete", "can_export"];

interface Role {
  id: number;
  name: string;
  label: string;
  description: string;
  userCount: number;
}

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrador",
  medico: "Médico",
  recepcao: "Recepção",
  enfermagem: "Enfermagem",
  laboratorio: "Laboratório",
  financeiro: "Financeiro",
  farmacia: "Farmácia",
};

export default function AdminPermissionsPage() {
  const { toast } = useToast();
  const [permissions, setPermissions] = useState<RolePermission[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [users, setUsers] = useState<UserProfileWithEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<number | null>(null);
  const [activeRole, setActiveRole] = useState<string>("admin");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [perms, profs, usrs] = await Promise.all([
          rolePermissionsService.getAll(),
          userProfilesService.getRoles(),
          userProfilesService.getAll(),
        ]);
        setPermissions(perms);
        setUsers(usrs);
        const enriched: Role[] = profs.map((p) => ({
          id: p.id,
          name: p.name,
          label: ROLE_LABELS[p.name] ?? p.name,
          description: p.description,
          userCount: usrs.filter((u) => (u.role_name ?? "") === p.name).length,
        }));
        setRoles(enriched);
      } catch (err) {
        toast({
          title: "Erro ao carregar matriz",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [toast]);

  const modules = useMemo(() => {
    const set = new Set<string>();
    for (const p of permissions) set.add(p.module);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [permissions]);

  const roleIdByName = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of roles) {
      map.set(r.name, r.id);
    }
    return map;
  }, [roles]);

  const permsByRole = useMemo(() => {
    const map: Record<string, Map<string, RolePermission>> = {};
    for (const r of roles) {
      const roleId = roleIdByName.get(r.name);
      const rowMap = new Map<string, RolePermission>();
      for (const p of permissions) {
        if (p.role_id === roleId) rowMap.set(p.module, p);
      }
      map[r.name] = rowMap;
    }
    return map;
  }, [permissions, roles, roleIdByName]);

  const toggle = async (roleName: string, module: string, action: PermissionAction, value: boolean) => {
    const roleId = roleIdByName.get(roleName);
    if (!roleId) return;
    const existing = permsByRole[roleName]?.get(module);
    setSaving(existing?.id ?? -1);
    try {
      const saved = await rolePermissionsService.upsert({
        id: existing?.id,
        role_id: roleId,
        module,
        can_view: existing?.can_view ?? false,
        can_create: existing?.can_create ?? false,
        can_edit: existing?.can_edit ?? false,
        can_delete: existing?.can_delete ?? false,
        can_export: existing?.can_export ?? false,
        [action]: value,
      });
      setPermissions((prev) => {
        const filtered = prev.filter((p) => p.id !== saved.id);
        return [...filtered, saved].sort((a, b) => a.role_id - b.role_id || a.module.localeCompare(b.module));
      });
      toast({ title: "Permissão atualizada", description: `${ROLE_LABELS[roleName] ?? roleName} · ${MODULE_LABELS[module] ?? module} · ${ACTION_LABELS[action]}` });
    } catch (err) {
      toast({
        title: "Erro ao salvar",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(null);
    }
  };

  if (loading) return <div className="p-6 text-muted-foreground">Carregando matriz de permissões...</div>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Matriz de Permissões"
        description="Configure o que cada perfil pode fazer em cada módulo. Alterações são salvas automaticamente."
      />

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {roles.map((r) => (
          <Card key={r.name} className={activeRole === r.name ? "border-primary" : ""}>
            <CardContent className="p-3 text-center">
              <Shield className="h-4 w-4 mx-auto text-primary mb-1" />
              <p className="text-xs font-medium">{r.label}</p>
              <p className="text-lg font-bold">{r.userCount}</p>
              <p className="text-[10px] text-muted-foreground">usuários</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs value={activeRole} onValueChange={setActiveRole}>
        <TabsList className="flex-wrap h-auto">
          {roles.map((r) => (
            <TabsTrigger key={r.name} value={r.name} className="gap-1">
              {r.label}
              <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{permsByRole[r.name]?.size ?? 0}</Badge>
            </TabsTrigger>
          ))}
        </TabsList>

        {roles.map((r) => (
          <TabsContent key={r.name} value={r.name}>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Shield className="h-4 w-4 text-primary" />
                  {r.label}
                  <Badge variant="outline" className="text-[10px] font-normal">{r.description}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="border rounded-md overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-[160px]">Módulo</TableHead>
                        {ACTIONS.map((a) => (
                          <TableHead key={a} className="text-center w-20">{ACTION_LABELS[a]}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {modules.map((module) => {
                        const perm = permsByRole[r.name]?.get(module);
                        return (
                          <TableRow key={module}>
                            <TableCell className="font-medium text-sm">{MODULE_LABELS[module] ?? module}</TableCell>
                            {ACTIONS.map((a) => (
                              <TableCell key={a} className="text-center">
                                <Checkbox
                                  checked={perm?.[a] ?? false}
                                  disabled={saving !== null}
                                  onCheckedChange={(v) => void toggle(r.name, module, a, Boolean(v))}
                                />
                              </TableCell>
                            ))}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                <p className="mt-3 text-xs text-muted-foreground flex items-center gap-1">
                  <Save className="h-3 w-3" />
                  Alterações são salvas automaticamente na tabela role_permissions.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
