import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

const roles = [
  { name: "Administrador", description: "Acesso total ao sistema", color: "bg-destructive/10 text-destructive" },
  { name: "Recepção", description: "Agenda, check-in, cadastro de pacientes", color: "bg-primary/10 text-primary" },
  { name: "Médico", description: "Prontuário, agenda própria, atendimentos", color: "bg-success/10 text-success" },
  { name: "Enfermagem", description: "Sinais vitais, triagem, evolução", color: "bg-warning/10 text-warning" },
  { name: "Financeiro", description: "Cobranças, pagamentos, relatórios", color: "bg-secondary/10 text-secondary" },
];

export default function SettingsPage() {
  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Configurações" description="Gerencie preferências e perfis de acesso" />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-lg">Perfis de Usuário (RBAC)</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {roles.map((r) => (
              <div key={r.name} className="flex items-center justify-between py-2 border-b last:border-0">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={`${r.color} border-0`}>{r.name}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{r.description}</p>
                </div>
                <Button variant="outline" size="sm">Editar</Button>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-lg">Preferências</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div><Label>Notificações por e-mail</Label><p className="text-xs text-muted-foreground">Receba alertas sobre agendamentos</p></div>
              <Switch defaultChecked />
            </div>
            <div className="flex items-center justify-between">
              <div><Label>Confirmação automática</Label><p className="text-xs text-muted-foreground">Confirmar agendamentos automaticamente</p></div>
              <Switch />
            </div>
            <div className="flex items-center justify-between">
              <div><Label>Tempo padrão de consulta</Label><p className="text-xs text-muted-foreground">30 minutos</p></div>
              <Button variant="outline" size="sm">Alterar</Button>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-lg">Sobre o Sistema</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div><p className="text-muted-foreground">Sistema</p><p className="font-medium">PRONTOMEDIC</p></div>
              <div><p className="text-muted-foreground">Versão</p><p className="font-medium">1.0.0 MVP</p></div>
              <div><p className="text-muted-foreground">Licença</p><p className="font-medium">Comercial</p></div>
              <div><p className="text-muted-foreground">Suporte</p><p className="font-medium">suporte@prontomedic.com</p></div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
