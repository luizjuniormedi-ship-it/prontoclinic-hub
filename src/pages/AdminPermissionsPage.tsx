import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Shield, User, Save, AlertTriangle, Plus, Minus } from "lucide-react";
import { mockPermissionProfiles, mockSystemUsers, mockUserOverrides } from "@/services/adminMockData";
import { PERMISSION_MODULES } from "@/types/admin";
import { useToast } from "@/hooks/use-toast";

export default function AdminPermissionsPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("profiles");
  const [selectedProfile, setSelectedProfile] = useState(mockPermissionProfiles[0]?.id || "");
  const [selectedUser, setSelectedUser] = useState(mockSystemUsers[0]?.id || "");

  const profile = mockPermissionProfiles.find((p) => p.id === selectedProfile);
  const user = mockSystemUsers.find((u) => u.id === selectedUser);
  const userProfile = user ? mockPermissionProfiles.find((p) => p.id === user.profileId) : null;
  const userOverride = user ? mockUserOverrides.find((o) => o.userId === user.id) : null;

  const hasProfilePermission = (moduleKey: string, actionKey: string) =>
    profile?.permissions[moduleKey]?.includes(actionKey) || false;

  const getUserEffective = (moduleKey: string, actionKey: string) => {
    if (userOverride?.blocks[moduleKey]?.includes(actionKey)) return "blocked";
    if (userProfile?.permissions[moduleKey]?.includes(actionKey)) return "profile";
    if (userOverride?.grants[moduleKey]?.includes(actionKey)) return "granted";
    return "none";
  };

  const handleSave = () => toast({ title: "Permissões salvas com sucesso" });

  return (
    <div className="space-y-6">
      <PageHeader title="Matriz de Permissões" description="Configure permissões por perfil e exceções individuais" />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="profiles" className="gap-1"><Shield className="h-4 w-4" />Por Perfil</TabsTrigger>
          <TabsTrigger value="users" className="gap-1"><User className="h-4 w-4" />Exceções por Usuário</TabsTrigger>
        </TabsList>

        <TabsContent value="profiles" className="space-y-4 mt-4">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            <Select value={selectedProfile} onValueChange={setSelectedProfile}>
              <SelectTrigger className="w-[240px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {mockPermissionProfiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {profile && <p className="text-sm text-muted-foreground">{profile.description}</p>}
            <Button className="ml-auto" onClick={handleSave}><Save className="h-4 w-4 mr-1" />Salvar</Button>
          </div>

          {profile && (
            <div className="space-y-4">
              {PERMISSION_MODULES.map((mod) => (
                <Card key={mod.moduleKey}>
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm font-semibold">{mod.moduleLabel}</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="flex flex-wrap gap-x-6 gap-y-2">
                      {mod.actions.map((action) => {
                        const checked = hasProfilePermission(mod.moduleKey, action.key);
                        return (
                          <label key={action.key} className="flex items-center gap-2 text-sm cursor-pointer">
                            <Checkbox checked={checked} />
                            <span>{action.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="users" className="space-y-4 mt-4">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            <Select value={selectedUser} onValueChange={setSelectedUser}>
              <SelectTrigger className="w-[280px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {mockSystemUsers.filter((u) => u.status === "active").map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name} — {u.profileName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button className="ml-auto" onClick={handleSave}><Save className="h-4 w-4 mr-1" />Salvar</Button>
          </div>

          {user && userProfile && (
            <>
              <div className="flex items-center gap-4 p-3 bg-muted/50 rounded-lg text-sm">
                <span>Perfil base: <strong>{userProfile.name}</strong></span>
                {userOverride && (
                  <Badge variant="outline" className="gap-1 text-amber-600 border-amber-300">
                    <AlertTriangle className="h-3 w-3" />Possui exceções
                  </Badge>
                )}
              </div>

              <div className="border rounded-lg overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[160px]">Módulo</TableHead>
                      <TableHead>Permissão</TableHead>
                      <TableHead className="w-[100px] text-center">Perfil</TableHead>
                      <TableHead className="w-[100px] text-center">Efetivo</TableHead>
                      <TableHead className="w-[120px] text-center">Exceção</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {PERMISSION_MODULES.map((mod) =>
                      mod.actions.map((action, idx) => {
                        const eff = getUserEffective(mod.moduleKey, action.key);
                        return (
                          <TableRow key={`${mod.moduleKey}-${action.key}`}>
                            {idx === 0 && (
                              <TableCell rowSpan={mod.actions.length} className="font-medium text-sm align-top border-r">
                                {mod.moduleLabel}
                              </TableCell>
                            )}
                            <TableCell className="text-sm">{action.label}</TableCell>
                            <TableCell className="text-center">
                              {userProfile.permissions[mod.moduleKey]?.includes(action.key)
                                ? <Badge variant="outline" className="bg-green-50 text-green-700 text-[10px]">Sim</Badge>
                                : <span className="text-muted-foreground text-xs">—</span>}
                            </TableCell>
                            <TableCell className="text-center">
                              {eff === "blocked" ? (
                                <Badge className="bg-red-100 text-red-700 text-[10px] hover:bg-red-100">Bloqueado</Badge>
                              ) : eff === "granted" ? (
                                <Badge className="bg-blue-100 text-blue-700 text-[10px] hover:bg-blue-100">Liberado</Badge>
                              ) : eff === "profile" ? (
                                <Badge variant="outline" className="bg-green-50 text-green-700 text-[10px]">Sim</Badge>
                              ) : (
                                <span className="text-muted-foreground text-xs">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-center">
                              <div className="flex justify-center gap-1">
                                <Button variant="ghost" size="icon" className="h-6 w-6" title="Liberar">
                                  <Plus className="h-3 w-3 text-blue-600" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-6 w-6" title="Bloquear">
                                  <Minus className="h-3 w-3 text-red-600" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
