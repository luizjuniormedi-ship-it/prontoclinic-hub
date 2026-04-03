import { ShieldX } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

export default function AccessDeniedPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="rounded-full bg-destructive/10 p-4">
        <ShieldX className="h-12 w-12 text-destructive" />
      </div>
      <h1 className="text-2xl font-bold text-foreground">Acesso Negado</h1>
      <p className="text-muted-foreground max-w-md">
        Você não tem permissão para acessar este recurso.
        {user?.role_name && (
          <span className="block mt-1 text-sm">
            Seu perfil atual: <strong className="text-foreground">{user.role_name}</strong>
          </span>
        )}
      </p>
      <Button variant="outline" onClick={() => navigate("/")}>
        Voltar ao Dashboard
      </Button>
    </div>
  );
}
