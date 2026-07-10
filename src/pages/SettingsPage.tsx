import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { systemSettingsService } from "@/services/systemSettingsService";
import { Calendar, Clock, Package, RotateCcw, Shield, Banknote, Receipt } from "lucide-react";

const roles = [
  { name: "Administrador", description: "Acesso total ao sistema", color: "bg-destructive/10 text-destructive" },
  { name: "Recepção", description: "Agenda, check-in, cadastro de pacientes", color: "bg-primary/10 text-primary" },
  { name: "Médico", description: "Prontuário, agenda própria, atendimentos", color: "bg-success/10 text-success" },
  { name: "Enfermagem", description: "Sinais vitais, triagem, evolução", color: "bg-warning/10 text-warning" },
  { name: "Financeiro", description: "Cobranças, pagamentos, relatórios", color: "bg-secondary/10 text-secondary" },
];

export default function SettingsPage() {
  const { toast } = useToast();

  const [consultaInterval, setConsultaInterval] = useState("30");
  const [returnValidity, setReturnValidity] = useState("30");
  const [allowPackages, setAllowPackages] = useState(true);
  const [controlBalance, setControlBalance] = useState(true);
  const [packageValidity, setPackageValidity] = useState("90");
  const [autoConfirm, setAutoConfirm] = useState(false);
  const [emailNotifications, setEmailNotifications] = useState(true);

  const [durationConsulta, setDurationConsulta] = useState("30");
  const [durationRetorno, setDurationRetorno] = useState("20");
  const [durationExame, setDurationExame] = useState("30");
  const [durationTerapia, setDurationTerapia] = useState("50");
  const [durationProcedimento, setDurationProcedimento] = useState("60");

  const [defaultRemType, setDefaultRemType] = useState("fixed");
  const [defaultChValue, setDefaultChValue] = useState("12");
  const [defaultFixedConsulta, setDefaultFixedConsulta] = useState("200");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [agenda, financeiro, notif] = await Promise.all([
          systemSettingsService.getByCategory("agenda"),
          systemSettingsService.getByCategory("financeiro"),
          systemSettingsService.getByCategory("notificacao"),
        ]);
        if (agenda.intervalo_minimo_consulta != null) setConsultaInterval(String(agenda.intervalo_minimo_consulta));
        if (agenda.validade_retorno != null) setReturnValidity(String(agenda.validade_retorno));
        if (agenda.permitir_pacotes != null) setAllowPackages(Boolean(agenda.permitir_pacotes));
        if (agenda.controlar_saldo_pacote != null) setControlBalance(Boolean(agenda.controlar_saldo_pacote));
        if (agenda.validade_pacote != null) setPackageValidity(String(agenda.validade_pacote));
        if (agenda.auto_confirmar != null) setAutoConfirm(Boolean(agenda.auto_confirmar));
        if (agenda.duracao_consulta != null) setDurationConsulta(String(agenda.duracao_consulta));
        if (agenda.duracao_retorno != null) setDurationRetorno(String(agenda.duracao_retorno));
        if (agenda.duracao_exame != null) setDurationExame(String(agenda.duracao_exame));
        if (agenda.duracao_terapia != null) setDurationTerapia(String(agenda.duracao_terapia));
        if (agenda.duracao_procedimento != null) setDurationProcedimento(String(agenda.duracao_procedimento));
        if (financeiro.tipo_remuneracao_padrao != null) setDefaultRemType(String(financeiro.tipo_remuneracao_padrao));
        if (financeiro.valor_ch_padrao != null) setDefaultChValue(String(financeiro.valor_ch_padrao));
        if (financeiro.valor_fixo_consulta != null) setDefaultFixedConsulta(String(financeiro.valor_fixo_consulta));
        if (notif.email_ativo != null) setEmailNotifications(Boolean(notif.email_ativo));
      } catch (err) {
        toast({ title: "Erro ao carregar configuracoes", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
      } finally {
        setLoading(false);
      }
    })();
  }, [toast]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await systemSettingsService.setBulk("agenda", {
        intervalo_minimo_consulta: Number(consultaInterval),
        validade_retorno: Number(returnValidity),
        permitir_pacotes: allowPackages,
        controlar_saldo_pacote: controlBalance,
        validade_pacote: Number(packageValidity),
        auto_confirmar: autoConfirm,
        duracao_consulta: Number(durationConsulta),
        duracao_retorno: Number(durationRetorno),
        duracao_exame: Number(durationExame),
        duracao_terapia: Number(durationTerapia),
        duracao_procedimento: Number(durationProcedimento),
      });
      await systemSettingsService.setBulk("financeiro", {
        tipo_remuneracao_padrao: defaultRemType,
        valor_ch_padrao: Number(defaultChValue),
        valor_fixo_consulta: Number(defaultFixedConsulta),
      });
      await systemSettingsService.setBulk("notificacao", { email_ativo: emailNotifications });
      toast({ title: "Configurações salvas com sucesso!" });
    } catch (err) {
      toast({
        title: "Erro ao salvar",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Configurações" description="Regras clínicas, financeiras, agenda e pagamento médico" />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Clinical Rules */}
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Shield className="h-4 w-4 text-primary" />Regras Clínicas</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <div className="flex items-center gap-2"><Calendar className="h-3.5 w-3.5 text-muted-foreground" /><Label className="text-sm font-medium">Intervalo mínimo entre consultas</Label></div>
              <div className="flex items-center gap-2">
                <Input type="number" value={consultaInterval} onChange={(e) => setConsultaInterval(e.target.value)} className="w-20 h-8 text-sm" min="1" />
                <span className="text-sm text-muted-foreground">dias por especialidade</span>
              </div>
              <p className="text-[10px] text-muted-foreground">Bloqueia agendamento na mesma especialidade dentro deste período. Permite liberação com justificativa.</p>
            </div>
            <Separator />
            <div className="space-y-2">
              <div className="flex items-center gap-2"><RotateCcw className="h-3.5 w-3.5 text-muted-foreground" /><Label className="text-sm font-medium">Validade do retorno</Label></div>
              <div className="flex items-center gap-2">
                <Input type="number" value={returnValidity} onChange={(e) => setReturnValidity(e.target.value)} className="w-20 h-8 text-sm" min="1" />
                <span className="text-sm text-muted-foreground">dias após consulta de origem</span>
              </div>
            </div>
            <Separator />
            <div className="space-y-3">
              <div className="flex items-center gap-2"><Package className="h-3.5 w-3.5 text-muted-foreground" /><Label className="text-sm font-medium">Pacotes de Terapia</Label></div>
              <div className="flex items-center justify-between">
                <div><p className="text-sm">Permitir pacotes</p><p className="text-[10px] text-muted-foreground">Habilita agendamento por pacote</p></div>
                <Switch checked={allowPackages} onCheckedChange={setAllowPackages} />
              </div>
              <div className="flex items-center justify-between">
                <div><p className="text-sm">Controlar saldo</p><p className="text-[10px] text-muted-foreground">Alerta quando pacote sem saldo</p></div>
                <Switch checked={controlBalance} onCheckedChange={setControlBalance} />
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs">Validade padrão do pacote</Label>
                <Input type="number" value={packageValidity} onChange={(e) => setPackageValidity(e.target.value)} className="w-20 h-7 text-xs" min="30" />
                <span className="text-xs text-muted-foreground">dias</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Durations */}
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Clock className="h-4 w-4 text-primary" />Durações Padrão (minutos)</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1"><Label className="text-xs">Consulta</Label><Input type="number" value={durationConsulta} onChange={(e) => setDurationConsulta(e.target.value)} className="h-8 text-sm" min="10" step="5" /></div>
              <div className="space-y-1"><Label className="text-xs">Retorno</Label><Input type="number" value={durationRetorno} onChange={(e) => setDurationRetorno(e.target.value)} className="h-8 text-sm" min="10" step="5" /></div>
              <div className="space-y-1"><Label className="text-xs">Exame</Label><Input type="number" value={durationExame} onChange={(e) => setDurationExame(e.target.value)} className="h-8 text-sm" min="10" step="5" /></div>
              <div className="space-y-1"><Label className="text-xs">Terapia</Label><Input type="number" value={durationTerapia} onChange={(e) => setDurationTerapia(e.target.value)} className="h-8 text-sm" min="10" step="5" /></div>
              <div className="space-y-1 col-span-2"><Label className="text-xs">Procedimento</Label><Input type="number" value={durationProcedimento} onChange={(e) => setDurationProcedimento(e.target.value)} className="h-8 text-sm" min="10" step="5" /></div>
            </div>
            <Separator />
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div><p className="text-sm">Confirmação automática</p><p className="text-[10px] text-muted-foreground">Confirmar agendamentos automaticamente</p></div>
                <Switch checked={autoConfirm} onCheckedChange={setAutoConfirm} />
              </div>
              <div className="flex items-center justify-between">
                <div><p className="text-sm">Notificações por e-mail</p><p className="text-[10px] text-muted-foreground">Alertas sobre agendamentos e pendências</p></div>
                <Switch checked={emailNotifications} onCheckedChange={setEmailNotifications} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Professional Payment Config */}
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Banknote className="h-4 w-4 text-primary" />Pagamento Médico</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Tipo de remuneração padrão</Label>
              <Select value={defaultRemType} onValueChange={setDefaultRemType}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed">Valor Fixo</SelectItem>
                  <SelectItem value="package">Pacote</SelectItem>
                  <SelectItem value="ch">CH (Coeficiente de Honorários)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">Valor fixo padrão (consulta)</Label><Input type="number" value={defaultFixedConsulta} onChange={(e) => setDefaultFixedConsulta(e.target.value)} className="h-8 text-sm" /></div>
              <div className="space-y-1"><Label className="text-xs">Valor do CH (R$)</Label><Input type="number" value={defaultChValue} onChange={(e) => setDefaultChValue(e.target.value)} className="h-8 text-sm" /></div>
            </div>
            <p className="text-[10px] text-muted-foreground">Estes valores são usados como padrão ao configurar novos profissionais. Podem ser alterados individualmente.</p>
          </CardContent>
        </Card>

        {/* Billing Config */}
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Receipt className="h-4 w-4 text-primary" />Faturamento</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">Parâmetros básicos de produção faturável.</p>
            <div className="flex items-center justify-between">
              <div><p className="text-sm">Gerar faturamento automático</p><p className="text-[10px] text-muted-foreground">Criar registro de faturamento ao finalizar atendimento</p></div>
              <Switch defaultChecked />
            </div>
            <div className="flex items-center justify-between">
              <div><p className="text-sm">Preparar para convênios e TISS</p><p className="text-[10px] text-muted-foreground">Estrutura futura para guias e glosas</p></div>
              <Badge variant="outline" className="border-0 bg-muted text-muted-foreground text-[10px]">Em breve</Badge>
            </div>
          </CardContent>
        </Card>

        {/* RBAC */}
        <Card>
          <CardHeader><CardTitle className="text-base">Perfis de Usuário (RBAC)</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {roles.map((r) => (
              <div key={r.name} className="flex items-center justify-between py-2 border-b last:border-0">
                <div><Badge variant="outline" className={`${r.color} border-0`}>{r.name}</Badge><p className="text-xs text-muted-foreground mt-1">{r.description}</p></div>
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
              <div><p className="text-muted-foreground text-xs">Versão</p><p className="font-medium">2.0.0</p></div>
              <div><p className="text-muted-foreground text-xs">Arquitetura</p><p className="font-medium">Multiempresa / Multiunidade</p></div>
              <div><p className="text-muted-foreground text-xs">Suporte</p><p className="font-medium">suporte@prontomedic.com</p></div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Button onClick={handleSave} disabled={saving || loading} className="w-full max-w-md">
        {saving ? "Salvando..." : loading ? "Carregando..." : "Salvar Configurações"}
      </Button>
    </div>
  );
}
