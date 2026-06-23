import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Search, Shield, Lock, Users } from "lucide-react";
import { userProfilesService } from "@/services/userProfilesService";
import { useToast } from "@/hooks/use-toast";

interface ProfileWithCount {
  id: string;
  name: string;
  description: string;
  userCount: number;
  permissions: number;
  isSystem: boolean;
}

export default function AdminProfilesPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [profiles, setProfiles] = useState<ProfileWithCount[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [profs, users] = await Promise.all([
          userProfilesService.getProfiles(),
          userProfilesService.getAll(),
        ]);
        // Enriquece com contagem de usuários por role
        const enriched: ProfileWithCount[] = profs.map((p) => {
          const count = users.filter((u) => (u.role_name ?? "") === p.id).length;
          // Permissões estimadas: 1 por módulo (em produção, viriam de uma tabela permission_matrix)
          return {
            ...p,
            userCount: count,
            permissions: 8, // valor estimado — substituir por count real quando houver tabela
            isSystem: p.id === "admin",
          };
        });
        setProfiles(enriched);
      } catch (err) {
        toast({
          title: "Erro ao carregar perfis",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [toast]);

  const filtered = profiles.filter((p) =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.description.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <div className="p-6 text-muted-foreground">Carregando...</div>;

  return (
    <div className="space-y-6">
      <PageHeader title="Perfis de Permissão" description="Gerencie perfis de acesso e suas permissões" />

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar perfil..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map((p) => (
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
                <span className="flex items-center gap-1 text-muted-foreground"><Users className="h-3.5 w-3.5" />{p.userCount} usuários</span>
                <span className="flex items-center gap-1 text-muted-foreground"><Shield className="h-3.5 w-3.5" />{p.permissions} permissões</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">Nenhum perfil encontrado.</div>
      )}
    </div>
  );
}