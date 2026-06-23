import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Shield, Info } from "lucide-react";
import { userProfilesService, type UserProfileWithEmail } from "@/services/userProfilesService";
import { useToast } from "@/hooks/use-toast";

/**
 * AdminPermissionsPage — Visualização da matriz de permissões.
 *
 * NOTA: A matriz granular de permissões (módulo × ação) ainda está em
 * desenvolvimento. Quando o módulo permission_matrix for criado (migration
 * dedicada), esta página listará todas as regras com checkboxes editáveis.
 *
 * Por ora, esta página mostra:
 *   - Lista de perfis disponíveis (com descrição)
 *   - Quantidade de usuários por perfil
 *   - Aviso que a gestão granular depende da tabela permission_matrix
 */

interface ProfileWithStats {
  id: string;
  name: string;
  description: string;
  userCount: number;
  isSystem: boolean;
}

export default function AdminPermissionsPage() {
  const { toast } = useToast();
  const [profiles, setProfiles] = useState<ProfileWithStats[]>([]);
  const [users, setUsers] = useState<UserProfileWithEmail[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [profs, usrs] = await Promise.all([
          userProfilesService.getProfiles(),
          userProfilesService.getAll(),
        ]);
        const enriched: ProfileWithStats[] = profs.map((p) => ({
          ...p,
          userCount: usrs.filter((u) => (u.role_name ?? "") === p.id).length,
          isSystem: p.id === "admin",
        }));
        setProfiles(enriched);
        setUsers(usrs);
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

  if (loading) return <div className="p-6 text-muted-foreground">Carregando...</div>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Matriz de Permissões"
        description="Visualize perfis e o número de usuários atribuídos. Edição granular via permission_matrix (em breve)."
      />

      <Card className="border-amber-300 bg-amber-50">
        <CardContent className="p-4 flex items-start gap-3">
          <Info className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-amber-900">Matriz granular em desenvolvimento</p>
            <p className="text-amber-800 mt-1">
              A gestão de permissões por ação (criar/editar/excluir por módulo) será habilitada
              quando a tabela <code className="bg-amber-100 px-1 rounded">permission_matrix</code> for
              criada. Por enquanto, as permissões são derivadas de <code className="bg-amber-100 px-1 rounded">role_name</code> no <code className="bg-amber-100 px-1 rounded">user_profiles</code>, e o controle granular é feito via RLS nas policies do Supabase.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {profiles.map((p) => (
          <Card key={p.id}>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-primary" />
                  <CardTitle className="text-base">{p.name}</CardTitle>
                </div>
                {p.isSystem && (
                  <Badge variant="secondary" className="text-[10px] gap-1">
                    <AlertTriangle className="h-3 w-3" />Sistema
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{p.description}</p>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4 text-sm">
                <span>
                  <strong className="text-2xl">{p.userCount}</strong>{" "}
                  <span className="text-muted-foreground">usuários</span>
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Usuários sem perfil definido</CardTitle>
        </CardHeader>
        <CardContent>
          {users.filter((u) => !u.role_name).length === 0 ? (
            <p className="text-sm text-muted-foreground">Todos os usuários possuem perfil.</p>
          ) : (
            <ul className="space-y-2">
              {users
                .filter((u) => !u.role_name)
                .map((u) => (
                  <li key={u.id} className="text-sm">
                    <strong>{u.full_name}</strong> —{" "}
                    <span className="text-muted-foreground">sem role_name</span>
                  </li>
                ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}