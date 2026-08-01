/**
 * PreCadastroPage.tsx
 *
 * Pagina PUBLICA (sem autenticacao) para o paciente se cadastrar na clinica.
 *
 * Implementado como wizard de 4 passos para reduzir a sobrecarga cognitiva:
 *   1. Dados pessoais  (nome, CPF, data nasc, sexo)
 *   2. Contato         (email, telefone, WhatsApp)
 *   3. Endereco        (CEP com busca ViaCEP + logradouro, numero, etc.)
 *   4. Termo LGPD      (aceite + submit)
 *
 * Migracao de pacientes definitivos e feita por admin/recepcao.
 */

import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import {
  Heart, Loader2, CheckCircle2, Mail, UserPlus, ShieldCheck,
  ChevronLeft, ChevronRight, FileText, AlertCircle, User, Phone, MapPin, ScrollText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { friendlyError } from "@/utils/friendlyError";
import {
  preCadastroService,
  GENDER, UF_BRASIL,
  VERSAO_TERMO_PRE_CADASTRO,
  type PreCadastroFormData,
  type PreCadastroFormErrors,
} from "@/services/preCadastroService";

const initialData: PreCadastroFormData = {
  full_name: "",
  email: "",
  phone: "",
  whatsapp: "",
  cpf: "",
  birth_date: "",
  gender: "M",
  cep: "",
  logradouro: "",
  numero: "",
  complemento: "",
  bairro: "",
  cidade: "",
  uf: "SP",
  lg_aceite_termo: false as unknown as true,
  versao_termo: VERSAO_TERMO_PRE_CADASTRO,
};

const STEPS = [
  { id: 1, title: "Dados pessoais", icon: User, fields: ["full_name", "cpf", "birth_date", "gender"] as (keyof PreCadastroFormData)[] },
  { id: 2, title: "Contato", icon: Phone, fields: ["email", "phone", "whatsapp"] as (keyof PreCadastroFormData)[] },
  { id: 3, title: "Endereço", icon: MapPin, fields: ["cep", "logradouro", "numero", "bairro", "cidade", "uf"] as (keyof PreCadastroFormData)[] },
  { id: 4, title: "Termo LGPD", icon: ScrollText, fields: ["lg_aceite_termo"] as (keyof PreCadastroFormData)[] },
];

function formatCPF(value: string): string {
  return value
    .replace(/\D/g, "")
    .slice(0, 11)
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}

function formatPhone(value: string): string {
  const d = value.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 10) {
    return d.replace(/(\d{2})(\d{4})(\d{0,4})/, "($1) $2-$3").trim();
  }
  return d.replace(/(\d{2})(\d{5})(\d{0,4})/, "($1) $2-$3").trim();
}

function formatCEP(value: string): string {
  return value
    .replace(/\D/g, "")
    .slice(0, 8)
    .replace(/(\d{5})(\d)/, "$1-$2");
}

export default function PreCadastroPage() {
  const [data, setData] = useState<PreCadastroFormData>(initialData);
  const [errors, setErrors] = useState<PreCadastroFormErrors>({});
  const [success, setSuccess] = useState<{ email: string; nome: string; link: string } | null>(null);
  const [termoOpen, setTermoOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [cepLoading, setCepLoading] = useState(false);
  const { toast } = useToast();

  const update = <K extends keyof PreCadastroFormData>(key: K, value: PreCadastroFormData[K]) => {
    setData((d) => ({ ...d, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const validateAll = (): boolean => {
    const errs = preCadastroService.validarForm(data);
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const validateStep = (currentStep: number): boolean => {
    const errs = preCadastroService.validarForm(data);
    const stepFields = STEPS[currentStep - 1]?.fields ?? [];
    const stepErrs: PreCadastroFormErrors = {};
    for (const f of stepFields) {
      if (errs[f]) stepErrs[f] = errs[f];
    }
    setErrors((prev) => ({ ...prev, ...stepErrs }));
    return Object.keys(stepErrs).length === 0;
  };

  const handleCepBlur = async () => {
    const cepDigits = data.cep.replace(/\D/g, "");
    if (cepDigits.length !== 8) return;
    setCepLoading(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cepDigits}/json/`);
      const json = await res.json();
      if (!json.erro) {
        setData((d) => ({
          ...d,
          logradouro: d.logradouro || json.logradouro || "",
          bairro: d.bairro || json.bairro || "",
          cidade: d.cidade || json.localidade || "",
          uf: (json.uf as PreCadastroFormData["uf"]) || d.uf,
        }));
        toast({ title: "Endereço preenchido automaticamente" });
      } else {
        toast({ title: "CEP não encontrado", variant: "destructive" });
      }
    } catch {
      toast({ title: "Não foi possível buscar o CEP — preencha manualmente" });
    } finally {
      setCepLoading(false);
    }
  };

  const next = () => {
    if (step < STEPS.length && validateStep(step)) setStep((s) => s + 1);
  };

  const back = () => setStep((s) => Math.max(1, s - 1));

  const mutation = useMutation({
    mutationFn: async (formData: PreCadastroFormData) => {
      return preCadastroService.criar(formData, { sendEmail: true });
    },
    onSuccess: (result) => {
      setSuccess({
        email: data.email,
        nome: data.full_name,
        link: result.linkConfirmacao,
      });
      toast({ title: "Pré-cadastro enviado! Verifique seu e-mail." });
    },
    onError: (err: Error) => {
      toast({ title: friendlyError(err, "Enviar pré-cadastro"), variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (!validateAll()) {
      toast({ title: "Verifique os campos do formulário.", variant: "destructive" });
      return;
    }
    mutation.mutate(data);
  };

  const textoTermo = useMemo(() => preCadastroService.getTextoTermo(), []);

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-secondary/5 p-4">
        <Card className="w-full max-w-lg shadow-lg animate-fade-in">
          <CardContent className="pt-8 text-center space-y-4">
            <div className="mx-auto rounded-full bg-success/10 p-4 w-fit">
              <CheckCircle2 className="h-10 w-10 text-success" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Pré-cadastro enviado!</h1>
            <p className="text-sm text-muted-foreground">
              Enviamos um link de confirmação para <strong>{success.email}</strong>.
              Verifique sua caixa de entrada (e a pasta de spam) — o link é válido por <strong>72 horas</strong>.
            </p>
            <div className="rounded-md bg-muted/50 p-3 text-left text-xs space-y-1">
              <p className="font-medium">Próximos passos:</p>
              <ol className="list-decimal pl-4 space-y-0.5 text-muted-foreground">
                <li>Abra o e-mail e clique no link de confirmação</li>
                <li>Confirme seus dados na próxima tela</li>
                <li>Aguarde o contato da clínica para finalizar seu cadastro</li>
              </ol>
            </div>
            <div className="text-[11px] text-muted-foreground flex items-center justify-center gap-1 pt-2">
              <ShieldCheck className="h-3 w-3" />
              Seus dados são protegidos pela LGPD.
            </div>
            <div className="pt-4 border-t">
              <Link to="/login" className="text-xs text-primary hover:underline">
                Voltar para o login
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const progress = (step / STEPS.length) * 100;
  const currentStep = STEPS[step - 1];
  const CurrentIcon = currentStep?.icon ?? User;

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-secondary/5">
      <div className="container mx-auto px-4 py-6 max-w-3xl">
        <header className="mb-6 flex items-center justify-between">
          <Link to="/login" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />
            Voltar para o login
          </Link>
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-primary p-1.5">
              <Heart className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-sm font-bold">PRONTOMEDIC</span>
          </div>
        </header>

        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="text-xl flex items-center gap-2">
              <UserPlus className="h-5 w-5" />
              Bem-vindo à Clínica — Pré-cadastro
            </CardTitle>
            <CardDescription>
              Preencha seus dados em {STEPS.length} passos rápidos. Após confirmar o e-mail, a clínica dará continuidade ao seu atendimento.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Indicador de progresso */}
            <div className="mb-5 space-y-2" aria-label="Progresso do pré-cadastro">
              <Progress value={progress} aria-label={`Passo ${step} de ${STEPS.length}`} />
              <ol className="flex justify-between text-xs">
                {STEPS.map((s) => (
                  <li
                    key={s.id}
                    className={
                      s.id === step
                        ? "font-semibold text-primary"
                        : s.id < step
                        ? "text-muted-foreground"
                        : "text-muted-foreground"
                    }
                    aria-current={s.id === step ? "step" : undefined}
                  >
                    <span className="inline-flex items-center gap-1">
                      <s.icon className="h-3 w-3" />
                      {s.title}
                    </span>
                  </li>
                ))}
              </ol>
            </div>

            {mutation.isError && (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Não foi possível concluir o pré-cadastro.</AlertTitle>
                <AlertDescription className="text-xs">
                  {friendlyError(mutation.error, "Enviar pré-cadastro", { silent: true })}
                </AlertDescription>
              </Alert>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (step < STEPS.length) next();
                else handleSubmit();
              }}
              noValidate
              className="space-y-5"
            >
              {/* Step 1 — Dados pessoais */}
              {step === 1 && (
                <fieldset className="space-y-3">
                  <legend className="text-sm font-semibold flex items-center gap-2">
                    <CurrentIcon className="h-4 w-4" />
                    Dados pessoais
                  </legend>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="md:col-span-2 space-y-1.5">
                      <Label htmlFor="full_name">Nome completo *</Label>
                      <Input
                        id="full_name"
                        value={data.full_name}
                        onChange={(e) => update("full_name", e.target.value)}
                        placeholder="Maria da Silva"
                        autoComplete="name"
                        autoFocus
                        aria-invalid={!!errors.full_name}
                      />
                      {errors.full_name && <p className="text-xs text-destructive">{errors.full_name}</p>}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="cpf">CPF</Label>
                      <Input
                        id="cpf"
                        value={data.cpf ?? ""}
                        onChange={(e) => update("cpf", formatCPF(e.target.value))}
                        placeholder="000.000.000-00"
                        inputMode="numeric"
                        aria-invalid={!!errors.cpf}
                      />
                      {errors.cpf && <p className="text-xs text-destructive">{errors.cpf}</p>}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="birth_date">Data de nascimento *</Label>
                      <Input
                        id="birth_date"
                        type="date"
                        value={data.birth_date}
                        onChange={(e) => update("birth_date", e.target.value)}
                        max={new Date().toISOString().split("T")[0]}
                        aria-invalid={!!errors.birth_date}
                      />
                      {errors.birth_date && <p className="text-xs text-destructive">{errors.birth_date}</p>}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="gender">Sexo *</Label>
                      <Select value={data.gender} onValueChange={(v) => update("gender", v as PreCadastroFormData["gender"])}>
                        <SelectTrigger id="gender" aria-invalid={!!errors.gender}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {GENDER.map((g) => (
                            <SelectItem key={g} value={g}>
                              {g === "M" ? "Masculino" : g === "F" ? "Feminino" : "Outro"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {errors.gender && <p className="text-xs text-destructive">{errors.gender}</p>}
                    </div>
                  </div>
                </fieldset>
              )}

              {/* Step 2 — Contato */}
              {step === 2 && (
                <fieldset className="space-y-3">
                  <legend className="text-sm font-semibold flex items-center gap-2">
                    <CurrentIcon className="h-4 w-4" />
                    Contato
                  </legend>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="md:col-span-2 space-y-1.5">
                      <Label htmlFor="email">E-mail *</Label>
                      <Input
                        id="email"
                        type="email"
                        value={data.email}
                        onChange={(e) => update("email", e.target.value)}
                        placeholder="seu@email.com"
                        autoComplete="email"
                        autoFocus
                        aria-invalid={!!errors.email}
                      />
                      {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="phone">Telefone *</Label>
                      <Input
                        id="phone"
                        value={data.phone}
                        onChange={(e) => update("phone", formatPhone(e.target.value))}
                        placeholder="(11) 99999-9999"
                        inputMode="tel"
                        autoComplete="tel"
                        aria-invalid={!!errors.phone}
                      />
                      {errors.phone && <p className="text-xs text-destructive">{errors.phone}</p>}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="whatsapp">WhatsApp</Label>
                      <Input
                        id="whatsapp"
                        value={data.whatsapp ?? ""}
                        onChange={(e) => update("whatsapp", formatPhone(e.target.value))}
                        placeholder="(11) 99999-9999"
                        inputMode="tel"
                        aria-invalid={!!errors.whatsapp}
                      />
                      {errors.whatsapp && <p className="text-xs text-destructive">{errors.whatsapp}</p>}
                    </div>
                  </div>
                </fieldset>
              )}

              {/* Step 3 — Endereço */}
              {step === 3 && (
                <fieldset className="space-y-3">
                  <legend className="text-sm font-semibold flex items-center gap-2">
                    <CurrentIcon className="h-4 w-4" />
                    Endereço
                  </legend>
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="cep">CEP *</Label>
                      <div className="relative">
                        <Input
                          id="cep"
                          value={data.cep}
                          onChange={(e) => update("cep", formatCEP(e.target.value))}
                          onBlur={handleCepBlur}
                          placeholder="00000-000"
                          inputMode="numeric"
                          aria-invalid={!!errors.cep}
                          autoFocus
                        />
                        {cepLoading && (
                          <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                        )}
                      </div>
                      {errors.cep && <p className="text-xs text-destructive">{errors.cep}</p>}
                    </div>
                    <div className="md:col-span-2 space-y-1.5">
                      <Label htmlFor="logradouro">Logradouro *</Label>
                      <Input
                        id="logradouro"
                        value={data.logradouro}
                        onChange={(e) => update("logradouro", e.target.value)}
                        placeholder="Rua / Av."
                        aria-invalid={!!errors.logradouro}
                      />
                      {errors.logradouro && <p className="text-xs text-destructive">{errors.logradouro}</p>}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="numero">Número *</Label>
                      <Input
                        id="numero"
                        value={data.numero}
                        onChange={(e) => update("numero", e.target.value)}
                        placeholder="123"
                        aria-invalid={!!errors.numero}
                      />
                      {errors.numero && <p className="text-xs text-destructive">{errors.numero}</p>}
                    </div>
                    <div className="md:col-span-2 space-y-1.5">
                      <Label htmlFor="complemento">Complemento</Label>
                      <Input
                        id="complemento"
                        value={data.complemento ?? ""}
                        onChange={(e) => update("complemento", e.target.value)}
                        placeholder="Apto 45, Bloco B"
                        aria-invalid={!!errors.complemento}
                      />
                      {errors.complemento && <p className="text-xs text-destructive">{errors.complemento}</p>}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="bairro">Bairro *</Label>
                      <Input
                        id="bairro"
                        value={data.bairro}
                        onChange={(e) => update("bairro", e.target.value)}
                        aria-invalid={!!errors.bairro}
                      />
                      {errors.bairro && <p className="text-xs text-destructive">{errors.bairro}</p>}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="cidade">Cidade *</Label>
                      <Input
                        id="cidade"
                        value={data.cidade}
                        onChange={(e) => update("cidade", e.target.value)}
                        aria-invalid={!!errors.cidade}
                      />
                      {errors.cidade && <p className="text-xs text-destructive">{errors.cidade}</p>}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="uf">UF *</Label>
                      <Select value={data.uf} onValueChange={(v) => update("uf", v as PreCadastroFormData["uf"])}>
                        <SelectTrigger id="uf" aria-invalid={!!errors.uf}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {UF_BRASIL.map((uf) => (
                            <SelectItem key={uf} value={uf}>{uf}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {errors.uf && <p className="text-xs text-destructive">{errors.uf}</p>}
                    </div>
                  </div>
                </fieldset>
              )}

              {/* Step 4 — Termo LGPD */}
              {step === 4 && (
                <fieldset className="space-y-3">
                  <legend className="text-sm font-semibold flex items-center gap-2">
                    <CurrentIcon className="h-4 w-4" />
                    Termo de consentimento
                  </legend>
                  <div className="rounded-md border p-3 space-y-2">
                    <div className="flex items-start gap-2">
                      <Checkbox
                        id="termo"
                        checked={data.lg_aceite_termo === true}
                        onCheckedChange={(checked) =>
                          update("lg_aceite_termo", checked === true ? true : (false as unknown as true))
                        }
                        aria-invalid={!!errors.lg_aceite_termo}
                      />
                      <div className="space-y-1 leading-tight">
                        <Label htmlFor="termo" className="text-sm font-medium cursor-pointer">
                          Li e aceito o termo de consentimento (LGPD) *
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Versão {VERSAO_TERMO_PRE_CADASTRO}. Autorizo a coleta e o tratamento dos meus dados para finalidades clínicas e regulatórias.
                        </p>
                      </div>
                    </div>
                    {errors.lg_aceite_termo && (
                      <p className="text-xs text-destructive">{errors.lg_aceite_termo}</p>
                    )}
                    <Dialog open={termoOpen} onOpenChange={setTermoOpen}>
                      <DialogTrigger asChild>
                        <Button type="button" variant="link" size="sm" className="px-0 h-auto">
                          <FileText className="h-3.5 w-3.5 mr-1" />
                          Ler o termo completo
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-2xl">
                        <DialogHeader>
                          <DialogTitle>Termo de Consentimento — Pré-cadastro</DialogTitle>
                          <DialogDescription>
                            Versão {VERSAO_TERMO_PRE_CADASTRO}
                          </DialogDescription>
                        </DialogHeader>
                        <ScrollArea className="h-72 rounded-md border p-3 bg-muted/30">
                          <pre className="whitespace-pre-wrap text-xs leading-relaxed font-sans">
                            {textoTermo}
                          </pre>
                        </ScrollArea>
                        <DialogFooter>
                          <DialogClose asChild>
                            <Button type="button" variant="outline">Fechar</Button>
                          </DialogClose>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>
                </fieldset>
              )}

              {/* Botões de navegação */}
              <div className="flex items-center justify-between gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={back}
                  disabled={step === 1}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  Voltar
                </Button>
                {step < STEPS.length ? (
                  <Button type="submit" disabled={mutation.isPending}>
                    Próximo
                    <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                ) : (
                  <Button type="submit" disabled={mutation.isPending}>
                    {mutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Enviando...
                      </>
                    ) : (
                      <>
                        <Mail className="mr-2 h-4 w-4" />
                        Enviar pré-cadastro
                      </>
                    )}
                  </Button>
                )}
              </div>

              <p className="text-[11px] text-muted-foreground text-center flex items-center justify-center gap-1">
                <ShieldCheck className="h-3 w-3" />
                Seus dados são criptografados e armazenados conforme a LGPD.
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// Pequeno helper exportado caso queiramos reusar fora
export { STEPS as _PRE_CADASTRO_STEPS };
