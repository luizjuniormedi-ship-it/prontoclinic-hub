/**
 * FirstLoginWizard.tsx
 *
 * Wizard de 3 passos exibido ao primeiro admin de uma clínica para acelerar
 * a configuração inicial. Persiste o estado em `localStorage` (chave
 * `onboarding_completed`) para não reaparecer após conclusão ou descarte.
 *
 * Passos:
 *   1. Bem-vindo + dados da empresa (nome, CNPJ, endereço)
 *   2. Cadastro do primeiro médico (pode pular)
 *   3. Configuração do primeiro horário de atendimento (pode pular)
 *
 * Uso: renderizar <FirstLoginWizard /> próximo da raiz da aplicação logada.
 * O componente se auto-monta quando detecta `!localStorage.getItem('onboarding_completed')`
 * e após `currentUser.firstLogin === true` (sinal opcional vindo do backend).
 */

import { useEffect, useMemo, useState } from "react";
import {
  Building2, Stethoscope, Clock, ChevronRight, ChevronLeft, X, PartyPopper, SkipForward,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";

const STORAGE_KEY = "onboarding_completed";

type ClinicForm = {
  companyName: string;
  cnpj: string;
  address: string;
};

type DoctorForm = {
  fullName: string;
  crm: string;
  specialty: string;
};

type ScheduleForm = {
  professionalName: string;
  weekday: string; // 0=Dom..6=Sáb
  startTime: string;
  endTime: string;
};

const STEPS = [
  { id: 1, title: "Clínica", icon: Building2, description: "Dados da empresa" },
  { id: 2, title: "Médico", icon: Stethoscope, description: "Primeiro profissional" },
  { id: 3, title: "Horário", icon: Clock, description: "Primeiro slot" },
] as const;

const WEEKDAYS = [
  { value: "1", label: "Segunda-feira" },
  { value: "2", label: "Terça-feira" },
  { value: "3", label: "Quarta-feira" },
  { value: "4", label: "Quinta-feira" },
  { value: "5", label: "Sexta-feira" },
  { value: "6", label: "Sábado" },
  { value: "0", label: "Domingo" },
];

function formatCNPJ(v: string): string {
  return v
    .replace(/\D/g, "")
    .slice(0, 14)
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

export function FirstLoginWizard() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const { toast } = useToast();

  const [clinic, setClinic] = useState<ClinicForm>({ companyName: "", cnpj: "", address: "" });
  const [doctor, setDoctor] = useState<DoctorForm>({ fullName: "", crm: "", specialty: "" });
  const [schedule, setSchedule] = useState<ScheduleForm>({
    professionalName: "",
    weekday: "1",
    startTime: "08:00",
    endTime: "17:00",
  });

  // Mostra apenas se ainda não completou o onboarding.
  // Em produção, convém também condicionar ao `currentUser.firstLogin === true`.
  useEffect(() => {
    try {
      const completed = window.localStorage.getItem(STORAGE_KEY);
      if (!completed) setOpen(true);
    } catch {
      /* localStorage indisponível — mostra mesmo assim */
      setOpen(true);
    }
  }, []);

  const progress = useMemo(() => Math.round(((step - 1) / STEPS.length) * 100), [step]);

  const complete = () => {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ completedAt: new Date().toISOString(), clinic, doctor, schedule }),
      );
    } catch {
      /* ignore */
    }
    setOpen(false);
    toast({
      title: "Configuração inicial concluída!",
      description: "Sua clínica está pronta para começar a atender.",
    });
  };

  const skip = () => {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ completedAt: new Date().toISOString(), skipped: true }),
      );
    } catch {
      /* ignore */
    }
    setOpen(false);
  };

  const next = () => {
    if (step === 1) {
      if (!clinic.companyName.trim()) {
        toast({ title: "Informe o nome da empresa", variant: "destructive" });
        return;
      }
    } else if (step === 2) {
      // Opcional — pode pular
    } else if (step === 3) {
      // Opcional — pode pular
    }
    setStep((s) => Math.min(STEPS.length, s + 1));
  };

  const back = () => setStep((s) => Math.max(1, s - 1));

  const CurrentStepIcon = STEPS[step - 1]?.icon ?? Building2;

  return (
    <Dialog open={open} onOpenChange={() => {/* impede fechar sem ação explícita */}}>
      <DialogContent
        className="max-w-2xl"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        aria-describedby="onboarding-desc"
      >
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="rounded-md bg-primary/10 p-2">
              <CurrentStepIcon className="h-5 w-5 text-primary" aria-hidden="true" />
            </div>
            <div>
              <DialogTitle className="text-lg">
                {step === 1 && "Bem-vindo! Vamos configurar sua clínica em 3 passos"}
                {step === 2 && "Cadastre seu primeiro médico"}
                {step === 3 && "Configure seu primeiro horário"}
              </DialogTitle>
              <DialogDescription id="onboarding-desc">
                Passo {step} de {STEPS.length} — {STEPS[step - 1]?.description}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Indicador de progresso */}
        <div className="space-y-2">
          <Progress value={progress + Math.round(100 / STEPS.length)} aria-label="Progresso do onboarding" />
          <ol className="flex justify-between text-xs" aria-label="Etapas">
            {STEPS.map((s) => (
              <li
                key={s.id}
                className={
                  s.id === step
                    ? "font-semibold text-primary"
                    : s.id < step
                    ? "text-muted-foreground"
                    : "text-muted-foreground/60"
                }
              >
                {s.id}. {s.title}
              </li>
            ))}
          </ol>
        </div>

        {/* Conteúdo por passo */}
        <div className="min-h-[200px] py-2">
          {step === 1 && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="md:col-span-2 space-y-1.5">
                <Label htmlFor="companyName">Nome da empresa *</Label>
                <Input
                  id="companyName"
                  value={clinic.companyName}
                  onChange={(e) => setClinic((c) => ({ ...c, companyName: e.target.value }))}
                  placeholder="Clínica Exemplo Ltda."
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cnpj">CNPJ</Label>
                <Input
                  id="cnpj"
                  value={clinic.cnpj}
                  onChange={(e) => setClinic((c) => ({ ...c, cnpj: formatCNPJ(e.target.value) }))}
                  placeholder="00.000.000/0000-00"
                  inputMode="numeric"
                />
              </div>
              <div className="md:col-span-2 space-y-1.5">
                <Label htmlFor="address">Endereço</Label>
                <Input
                  id="address"
                  value={clinic.address}
                  onChange={(e) => setClinic((c) => ({ ...c, address: e.target.value }))}
                  placeholder="Rua, número, bairro, cidade/UF"
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="md:col-span-2 space-y-1.5">
                <Label htmlFor="docName">Nome completo</Label>
                <Input
                  id="docName"
                  value={doctor.fullName}
                  onChange={(e) => setDoctor((d) => ({ ...d, fullName: e.target.value }))}
                  placeholder="Dr(a). Nome Sobrenome"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="docCrm">CRM</Label>
                <Input
                  id="docCrm"
                  value={doctor.crm}
                  onChange={(e) => setDoctor((d) => ({ ...d, crm: e.target.value }))}
                  placeholder="CRM/SP 123456"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="docSpec">Especialidade</Label>
                <Input
                  id="docSpec"
                  value={doctor.specialty}
                  onChange={(e) => setDoctor((d) => ({ ...d, specialty: e.target.value }))}
                  placeholder="Clínica Geral, Cardiologia..."
                />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="md:col-span-2 space-y-1.5">
                <Label htmlFor="profName">Profissional</Label>
                <Input
                  id="profName"
                  value={schedule.professionalName}
                  onChange={(e) => setSchedule((s) => ({ ...s, professionalName: e.target.value }))}
                  placeholder={doctor.fullName || "Nome do profissional"}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="weekday">Dia da semana</Label>
                <select
                  id="weekday"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={schedule.weekday}
                  onChange={(e) => setSchedule((s) => ({ ...s, weekday: e.target.value }))}
                >
                  {WEEKDAYS.map((d) => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="start">Início</Label>
                  <Input
                    id="start"
                    type="time"
                    value={schedule.startTime}
                    onChange={(e) => setSchedule((s) => ({ ...s, startTime: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="end">Fim</Label>
                  <Input
                    id="end"
                    type="time"
                    value={schedule.endTime}
                    onChange={(e) => setSchedule((s) => ({ ...s, endTime: e.target.value }))}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex-row justify-between sm:justify-between gap-2">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={skip}
              aria-label="Pular onboarding"
            >
              <X className="mr-1 h-3.5 w-3.5" />
              Pular tudo
            </Button>
          </div>
          <div className="flex gap-2">
            {step > 1 && (
              <Button type="button" variant="outline" size="sm" onClick={back}>
                <ChevronLeft className="mr-1 h-3.5 w-3.5" />
                Voltar
              </Button>
            )}
            {step === 2 && (
              <Button type="button" variant="ghost" size="sm" onClick={next}>
                <SkipForward className="mr-1 h-3.5 w-3.5" />
                Pular por agora
              </Button>
            )}
            {step === 3 && (
              <Button type="button" variant="ghost" size="sm" onClick={next}>
                <SkipForward className="mr-1 h-3.5 w-3.5" />
                Pular
              </Button>
            )}
            {step < STEPS.length ? (
              <Button type="button" size="sm" onClick={next}>
                Próximo
                <ChevronRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button type="button" size="sm" onClick={complete}>
                <PartyPopper className="mr-1 h-3.5 w-3.5" />
                Concluir
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default FirstLoginWizard;