import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { Calendar, Clock, Package, RotateCcw, Shield } from "lucide-react";

const roles = [
  { name: "Administrador", description: "Acesso total ao sistema", color: "bg-destructive/10 text-destructive" },
  { name: "Recepção", description: "Agenda, check-in, cadastro de pacientes", color: "bg-primary/10 text-primary" },
  { name: "Médico", description: "Prontuário, agenda própria, atendimentos", color: "bg-success/10 text-success" },
  { name: "Enfermagem", description: "Sinais vitais, triagem, evolução", color: "bg-warning/10 text-warning" },
  { name: "Financeiro", description: "Cobranças, pagamentos, relatórios", color: "bg-secondary/10 text-secondary" },
];

export default function SettingsPage() {
  const { toast } = useToast();

  // Configurable rules
  const [consultaInterval, setConsultaInterval] = useState("30");
  const [returnValidity, setReturnValidity] = useState("30");
  const [allowPackages, setAllowPackages] = useState(true);
  const [controlBalance, setControlBalance] = useState(true);
  const [autoConfirm, setAutoConfirm] = useState(false);
  const [emailNotifications, setEmailNotifications] = useState(true);

  // Default durations
  const [durationConsulta, setDurationConsulta] = useState("30");
  const [durationRetorno, setDurationRetorno] = useState("20");
  const [durationTerapia, setDurationTerapia] = useState("50");
  const [durationProcedimento, setDurationProcedimento] = useState("60");

  const handleSave = () => {
    toast({ title: "Configurações salvas com sucesso!" });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Configurações" description="Gerencie regras clínicas, perfis e preferências" />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Clinical Rules */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />Regras Clínicas
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Consulta interval */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                <Label className="text-sm font-medium">Intervalo mínimo entre consultas</Label>
              </div>
              <div className="flex items-center gap-2">
                <Input type="number" value={consultaInterval} onChange={(e) => setConsultaInterval(e.target.value)} className="w-20 h-8 text-sm" min="1" />
                <span className="text-sm text-muted-foreground">dias por especialidade</span>
              </div>
              <p className="text-[10px] text-muted-foreground">Bloqueia agendamento de consulta na mesma especialidade dentro deste período. Permite liberação com justificativa.</p>
            </div>

            <Separator />

            {/* Return validity */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />
                <Label className="text-sm font-medium">Validade do retorno</Label>
              </div>
              <div className="flex items-center gap-2">
                <Input type="number" value={returnValidity} onChange={(e) => setReturnValidity(e.target.value)} className="w-20 h-8 text-sm" min="1" />
                <span className="text-sm text-muted-foreground">dias após a consulta de origem</span>
              </div>
              <p className="text-[10px] text-muted-foreground">Retornos expirados são marcados automaticamente.</p>
            </div>

            <Separator />

            {/* Therapy packages */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Package className="h-3.5 w-3.5 text-muted-foreground" />
                <Label className="text-sm font-medium">Pacotes de Terapia</Label>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm">Permitir pacotes de sessões</p>
                  <p className="text-[10px] text-muted-foreground">Habilita agendamento por pacote</p>
                </div>
                <Switch checked={allowPackages} onCheckedChange={setAllowPackages} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm">Controlar saldo de sessões</p>
                  <p className="text-[10px] text-muted-foreground">Alerta quando pacote sem saldo</p>
                </div>
                <Switch checked={controlBalance} onCheckedChange={setControlBalance} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Default durations */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />Durações Padrão (minutos)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-xs">Consulta</Label>
                <Input type="number" value={durationConsulta} onChange={(e) => setDurationConsulta(e.target.value)} className="h-8 text-sm" min="10" step="5" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Retorno</Label>
                <Input type="number" value={durationRetorno} onChange={(e) => setDurationRetorno(e.target.value)} className="h-8 text-sm" min="10" step="5" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Terapia</Label>
                <Input type="number" value={durationTerapia} onChange={(e) => setDurationTerapia(e.target.value)} className="h-8 text-sm" min="10" step="5" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Procedimento</Label>
                <Input type="number" value={durationProcedimento} onChange={(e) => setDurationProcedimento(e.target.value)} className="h-8 text-sm" min="10" step="5" />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">Estes valores são usados como padrão ao criar novos agendamentos. Podem ser alterados individualmente.</p>

            <Separator />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm">Confirmação automática</p>
                  <p className="text-[10px] text-muted-foreground">Confirmar agendamentos automaticamente</p>
                </div>
                <Switch checked={autoConfirm} onCheckedChange={setAutoConfirm} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm">Notificações por e-mail</p>
                  <p className="text-[10px] text-muted-foreground">Alertas sobre agendamentos e pendências</p>
                </div>
                <Switch checked={emailNotifications} onCheckedChange={setEmailNotifications} />
              </div>
            </div>

            <Button onClick={handleSave} className="w-full">Salvar Configurações</Button>
          </CardContent>
        </Card>

        {/* RBAC */}
        <Card>
          <CardHeader><CardTitle className="text-base">Perfis de Usuário (RBAC)</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {roles.map((r) => (
              <div key={r.name} className="flex items-center justify-between py-2 border-b last:border-0">
                <div>
                  <Badge variant="outline" className={`${r.color} border-0`}>{r.name}</Badge>
                  <p className="text-xs text-muted-foreground mt-1">{r.description}</p>
                </div>
                <Button variant="outline" size="sm" className="h-7 text-xs">Editar</Button>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* About */}
        <Card>
          <CardHeader><CardTitle className="text-base">Sobre o Sistema</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><p className="text-muted-foreground text-xs">Sistema</p><p className="font-medium">PRONTOMEDIC</p></div>
              <div><p className="text-muted-foreground text-xs">Versão</p><p className="font-medium">1.1.0</p></div>
              <div><p className="text-muted-foreground text-xs">Licença</p><p className="font-medium">Comercial</p></div>
              <div><p className="text-muted-foreground text-xs">Suporte</p><p className="font-medium">suporte@prontomedic.com</p></div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
