/**
 * PreCadastroForm.tsx
 *
 * Formulario wizard (4 steps) para pre-cadastro publico de paciente.
 *
 * Steps:
 *   1. Dados pessoais (nome, CPF, data nascimento, sexo)
 *   2. Contato (email, telefone, whatsapp)
 *   3. Endereco (CEP com busca ViaCEP, logradouro, numero, complemento, bairro, cidade, UF)
 *   4. Termo LGPD (modal com texto completo, checkbox obrigatorio)
 *
 * Validacoes:
 *   - CPF (modulo 11)
 *   - E-mail
 *   - CEP (busca automatica via ViaCEP API)
 *   - Data nascimento (nao pode ser futura, max 130 anos)
 *   - Telefone (formato BR)
 *
 * LGPD:
 *   - Modal com termo completo
 *   - Hash SHA-256 do texto aceito e enviado para o servidor
 *   - IP e user agent capturados (servico)
 *
 * Stack: shadcn/ui (Form, Input, Select, Checkbox, Dialog, Button, Card).
 */

import { useEffect, useMemo, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  Loader2,
  ChevronLeft,
  ChevronRight,
  Check,
  Search,
  MapPin,
  User,
  Mail,
  Phone,
  Shield,
  PartyPopper,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";

import { preCadastroService } from "@/services/preCadastroService";
import type { PreCadastroFormData, CriarPreCadastroResult } from "@/services/preCadastroService";
import {
  maskCPF,
  maskPhone,
  maskCEP,
} from "@/utils/masks";

// =============================================================================
// Schema Zod (espelha o service, com mensagens em PT-BR)
// =============================================================================

const cpfValido = (v: string) => {
  if (!v) return true;
  const cpf = v.replace(/\D/g, "");
  if (cpf.length !== 11) return false;
  if (/^(\d)\1+$/.test(cpf)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(cpf[i], 10) * (10 - i);
  let d1 = (sum * 10) % 11;
  if (d1 === 10) d1 = 0;
  if (d1 !== parseInt(cpf[9], 10)) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(cpf[i], 10) * (11 - i);
  let d2 = (sum * 10) % 11;
  if (d2 === 10) d2 = 0;
  return d2 === parseInt(cpf[10], 10);
};

const schema = z.object({
  full_name: z
    .string()
    .min(3, "Nome deve ter no minimo 3 caracteres")
    .max(200, "Nome muito longo"),
  cpf: z
    .string()
    .optional()
    .refine((v) => !v || cpfValido(v), "CPF invalido"),
  birth_date: z
    .string()
    .min(1, "Data de nascimento obrigatoria")
    .refine((v) => {
      const d = new Date(v + "T00:00:00");
      if (isNaN(d.getTime())) return false;
      const now = new Date();
      if (d > now) return false;
      const age = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
      return age >= 0 && age <= 130;
    }, "Data invalida (nao pode ser futura; max 130 anos)"),
  gender: z.enum(["M", "F", "O"], { required_error: "Sexo obrigatorio" }),
  email: z.string().email("E-mail invalido").max(255),
  phone: z
    .string()
    .min(10, "Telefone obrigatorio")
    .regex(/^\+?[\d\s()-]{10,20}$/, "Formato invalido"),
  whatsapp: z.string().optional(),
  cep: z
    .string()
    .min(8, "CEP obrigatorio")
    .regex(/^\d{5}-?\d{3}$/, "CEP invalido (formato: 00000-000)"),
  logradouro: z.string().min(2, "Logradouro obrigatorio"),
  numero: z.string().min(1, "Numero obrigatorio"),
  complemento: z.string().optional(),
  bairro: z.string().min(2, "Bairro obrigatorio"),
  cidade: z.string().min(2, "Cidade obrigatoria"),
  uf: z.string().length(2, "UF obrigatoria"),
  lg_aceite_termo: z.literal(true, {
    errorMap: () => ({ message: "Voce precisa aceitar o termo de uso" }),
  }),
});

type FormValues = z.infer<typeof schema>;

// =============================================================================
// Tipos auxiliares
// =============================================================================

type StepKey = 1 | 2 | 3 | 4;

interface ViaCepResponse {
  cep: string;
  logradouro: string;
  complemento: string;
  bairro: string;
  localidade: string;
  uf: string;
  ibge: string;
  erro?: boolean;
}

// =============================================================================
// Componente principal
// =============================================================================

export interface PreCadastroFormProps {
  /** ID da empresa alvo (omitir = resolve automaticamente) */
  companyId?: string;
  /** Callback apos envio bem-sucedido */
  onSuccess?: (result: CriarPreCadastroResult) => void;
  /** Callback ao cancelar */
  onCancel?: () => void;
}

const STEP_TITLES: Record<StepKey, string> = {
  1: "Dados pessoais",
  2: "Contato",
  3: "Endereco",
  4: "Termo de uso",
};

const UF_LIST = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA",
  "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN",
  "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];

export function PreCadastroForm({ companyId, onSuccess, onCancel }: PreCadastroFormProps) {
  const [step, setStep] = useState<StepKey>(1);
  const [submitting, setSubmitting] = useState(false);
  const [cepLoading, setCepLoading] = useState(false);
  const [termoOpen, setTermoOpen] = useState(false);
  const [successResult, setSuccessResult] = useState<CriarPreCadastroResult | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: "onBlur",
    defaultValues: {
      full_name: "",
      cpf: "",
      birth_date: "",
      gender: "M",
      email: "",
      phone: "",
      whatsapp: "",
      cep: "",
      logradouro: "",
      numero: "",
      complemento: "",
      bairro: "",
      cidade: "",
      uf: "",
      lg_aceite_termo: false as unknown as true, // forcar tipo
    },
  });

  const versaoTermo = useMemo(() => preCadastroService.getVersaoTermo(), []);
  const textoTermo = useMemo(() => preCadastroService.getTextoTermo(), []);

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  const goNext = async () => {
    let fieldsToValidate: (keyof FormValues)[] = [];
    if (step === 1) fieldsToValidate = ["full_name", "cpf", "birth_date", "gender"];
    if (step === 2) fieldsToValidate = ["email", "phone"];
    if (step === 3) fieldsToValidate = ["cep", "logradouro", "numero", "bairro", "cidade", "uf"];

    const ok = await form.trigger(fieldsToValidate);
    if (!ok) return;
    if (step < 4) setStep((s) => (s + 1) as StepKey);
  };

  const goPrev = () => {
    if (step > 1) setStep((s) => (s - 1) as StepKey);
    else onCancel?.();
  };

  // -------------------------------------------------------------------------
  // Busca CEP (ViaCEP)
  // -------------------------------------------------------------------------
  const handleCepBlur = async () => {
    const cep = form.getValues("cep").replace(/\D/g, "");
    if (cep.length !== 8) return;
    setCepLoading(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      if (!res.ok) throw new Error("CEP nao encontrado");
      const data = (await res.json()) as ViaCepResponse;
      if (data.erro) {
        toast.error("CEP nao encontrado");
        return;
      }
      form.setValue("logradouro", data.logradouro, { shouldValidate: true });
      form.setValue("bairro", data.bairro, { shouldValidate: true });
      form.setValue("cidade", data.localidade, { shouldValidate: true });
      form.setValue("uf", data.uf, { shouldValidate: true });
      form.setValue("complemento", data.complemento || "");
      toast.success("Endereco preenchido");
    } catch (err) {
      console.warn("[CEP] falha", err);
      toast.error("Nao foi possivel buscar o CEP");
    } finally {
      setCepLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  // Submit final
  // -------------------------------------------------------------------------
  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      const payload: PreCadastroFormData = {
        full_name: values.full_name.trim(),
        email: values.email.trim().toLowerCase(),
        phone: values.phone,
        whatsapp: values.whatsapp || values.phone,
        cpf: values.cpf || undefined,
        birth_date: values.birth_date,
        gender: values.gender,
        cep: values.cep.replace(/\D/g, ""),
        logradouro: values.logradouro,
        numero: values.numero,
        complemento: values.complemento,
        bairro: values.bairro,
        cidade: values.cidade,
        uf: values.uf as "AC" | "AL" | "AP" | "AM" | "BA" | "CE" | "DF" | "ES" | "GO" | "MA" | "MT" | "MS" | "MG" | "PA" | "PB" | "PR" | "PE" | "PI" | "RJ" | "RN" | "RS" | "RO" | "RR" | "SC" | "SP" | "SE" | "TO",
        lg_aceite_termo: true,
        versao_termo: versaoTermo,
      };

      const result = await preCadastroService.criar(payload, { companyId });
      setSuccessResult(result);
      toast.success("Pre-cadastro enviado! Verifique seu e-mail.");
      onSuccess?.(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao enviar pre-cadastro";
      toast.error(msg);
      console.error("[PreCadastroForm] submit falhou", err);
    } finally {
      setSubmitting(false);
    }
  });

  // -------------------------------------------------------------------------
  // Tela de sucesso
  // -------------------------------------------------------------------------
  if (successResult) {
    return (
      <Card className="mx-auto max-w-2xl">
        <CardContent className="flex flex-col items-center justify-center gap-4 p-12 text-center">
          <div className="rounded-full bg-green-100 p-4">
            <PartyPopper className="h-10 w-10 text-green-600" aria-hidden="true" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900">Pre-cadastro enviado!</h2>
          <p className="max-w-md text-slate-600">
            Enviamos um link de confirmacao para o seu e-mail. Clique no link para confirmar
            seu pre-cadastro (expira em 72 horas).
          </p>
          <Alert className="max-w-md border-amber-200 bg-amber-50 text-amber-900">
            <AlertDescription className="text-sm">
              Se nao encontrar o e-mail, verifique a caixa de spam. Caso o link expire,
              voce podera refazer o pre-cadastro.
            </AlertDescription>
          </Alert>
          <Button variant="outline" onClick={() => setSuccessResult(null)}>
            Fazer outro pre-cadastro
          </Button>
        </CardContent>
      </Card>
    );
  }

  // -------------------------------------------------------------------------
  // Render do form
  // -------------------------------------------------------------------------

  return (
    <Card className="mx-auto w-full max-w-2xl">
      {/* Header / Stepper */}
      <div className="border-b border-slate-200 p-6">
        <div className="mb-2 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900">Pre-cadastro de paciente</h1>
          <span className="text-sm font-medium text-slate-500">Etapa {step} de 4</span>
        </div>
        <div className="flex gap-2" role="progressbar" aria-valuemin={1} aria-valuemax={4} aria-valuenow={step}>
          {([1, 2, 3, 4] as const).map((s) => (
            <div
              key={s}
              className={`h-1.5 flex-1 rounded-full ${
                s <= step ? "bg-blue-600" : "bg-slate-200"
              }`}
            />
          ))}
        </div>
      </div>

      <form onSubmit={onSubmit} noValidate>
        <CardContent className="space-y-6 p-6">
          {/* STEP 1 — Dados pessoais */}
          {step === 1 && (
            <fieldset className="space-y-4">
              <legend className="mb-2 flex items-center gap-2 text-lg font-semibold text-slate-900">
                <User className="h-5 w-5" aria-hidden="true" /> Dados pessoais
              </legend>

              <Field label="Nome completo" required error={form.formState.errors.full_name?.message}>
                <Input
                  autoComplete="name"
                  placeholder="Maria da Silva"
                  {...form.register("full_name")}
                  aria-invalid={!!form.formState.errors.full_name}
                />
              </Field>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="CPF" error={form.formState.errors.cpf?.message}>
                  <Input
                    inputMode="numeric"
                    placeholder="000.000.000-00"
                    maxLength={14}
                    {...form.register("cpf")}
                    onChange={(e) => {
                      const onlyDigits = e.target.value.replace(/\D/g, "").slice(0, 11);
                      form.setValue("cpf", onlyDigits, { shouldValidate: true });
                      e.target.value = maskCPF(onlyDigits);
                    }}
                    aria-invalid={!!form.formState.errors.cpf}
                  />
                </Field>

                <Field label="Data de nascimento" required error={form.formState.errors.birth_date?.message}>
                  <Input
                    type="date"
                    max={new Date().toISOString().split("T")[0]}
                    {...form.register("birth_date")}
                    aria-invalid={!!form.formState.errors.birth_date}
                  />
                </Field>
              </div>

              <Field label="Sexo" required error={form.formState.errors.gender?.message}>
                <Controller
                  control={form.control}
                  name="gender"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger aria-invalid={!!form.formState.errors.gender}>
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="M">Masculino</SelectItem>
                        <SelectItem value="F">Feminino</SelectItem>
                        <SelectItem value="O">Outro</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
            </fieldset>
          )}

          {/* STEP 2 — Contato */}
          {step === 2 && (
            <fieldset className="space-y-4">
              <legend className="mb-2 flex items-center gap-2 text-lg font-semibold text-slate-900">
                <Mail className="h-5 w-5" aria-hidden="true" /> Contato
              </legend>

              <Field label="E-mail" required error={form.formState.errors.email?.message}>
                <Input
                  type="email"
                  autoComplete="email"
                  placeholder="seu@email.com"
                  {...form.register("email")}
                  aria-invalid={!!form.formState.errors.email}
                />
              </Field>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Telefone" required error={form.formState.errors.phone?.message}>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                    <Input
                      type="tel"
                      autoComplete="tel"
                      placeholder="(11) 99999-9999"
                      maxLength={20}
                      className="pl-10"
                      {...form.register("phone")}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/\D/g, "").slice(0, 11);
                        form.setValue("phone", digits, { shouldValidate: true });
                        e.target.value = maskPhone(digits);
                      }}
                      aria-invalid={!!form.formState.errors.phone}
                    />
                  </div>
                </Field>

                <Field label="WhatsApp (opcional)" error={form.formState.errors.whatsapp?.message}>
                  <Input
                    type="tel"
                    placeholder="(11) 99999-9999"
                    maxLength={20}
                    {...form.register("whatsapp")}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, "").slice(0, 11);
                      form.setValue("whatsapp", digits);
                      e.target.value = maskPhone(digits);
                    }}
                  />
                </Field>
              </div>

              <p className="text-sm text-slate-500">
                Seu e-mail sera usado para confirmar o pre-cadastro. Telefone/WhatsApp serao
                usados apenas para contato sobre agendamentos.
              </p>
            </fieldset>
          )}

          {/* STEP 3 — Endereco */}
          {step === 3 && (
            <fieldset className="space-y-4">
              <legend className="mb-2 flex items-center gap-2 text-lg font-semibold text-slate-900">
                <MapPin className="h-5 w-5" aria-hidden="true" /> Endereco
              </legend>

              <Field label="CEP" required error={form.formState.errors.cep?.message}>
                <div className="relative">
                  <Input
                    inputMode="numeric"
                    placeholder="00000-000"
                    maxLength={9}
                    {...form.register("cep")}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, "").slice(0, 8);
                      form.setValue("cep", digits, { shouldValidate: true });
                      e.target.value = maskCEP(digits);
                    }}
                    onBlur={handleCepBlur}
                    aria-invalid={!!form.formState.errors.cep}
                  />
                  {cepLoading && (
                    <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />
                  )}
                  {!cepLoading && (
                    <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
                  )}
                </div>
              </Field>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Field label="Logradouro" required className="md:col-span-2" error={form.formState.errors.logradouro?.message}>
                  <Input {...form.register("logradouro")} aria-invalid={!!form.formState.errors.logradouro} />
                </Field>
                <Field label="Numero" required error={form.formState.errors.numero?.message}>
                  <Input {...form.register("numero")} aria-invalid={!!form.formState.errors.numero} />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Complemento (opcional)" error={form.formState.errors.complemento?.message}>
                  <Input placeholder="Apto 12, Bloco B..." {...form.register("complemento")} />
                </Field>
                <Field label="Bairro" required error={form.formState.errors.bairro?.message}>
                  <Input {...form.register("bairro")} aria-invalid={!!form.formState.errors.bairro} />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Field label="Cidade" required className="md:col-span-2" error={form.formState.errors.cidade?.message}>
                  <Input {...form.register("cidade")} aria-invalid={!!form.formState.errors.cidade} />
                </Field>
                <Field label="UF" required error={form.formState.errors.uf?.message}>
                  <Controller
                    control={form.control}
                    name="uf"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger aria-invalid={!!form.formState.errors.uf}>
                          <SelectValue placeholder="UF" />
                        </SelectTrigger>
                        <SelectContent>
                          {UF_LIST.map((uf) => (
                            <SelectItem key={uf} value={uf}>{uf}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </Field>
              </div>
            </fieldset>
          )}

          {/* STEP 4 — Termo LGPD */}
          {step === 4 && (
            <fieldset className="space-y-4">
              <legend className="mb-2 flex items-center gap-2 text-lg font-semibold text-slate-900">
                <Shield className="h-5 w-5" aria-hidden="true" /> Termo de uso (LGPD)
              </legend>

              <Alert className="border-blue-200 bg-blue-50 text-blue-900">
                <Shield className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  Antes de finalizar, leia o termo de consentimento e confirme que
                  compreende como seus dados serao tratados.
                </AlertDescription>
              </Alert>

              <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-medium text-slate-700">
                  Versao do termo: <span className="font-mono">{versaoTermo}</span>
                </p>
                <Button
                  type="button"
                  variant="link"
                  className="mt-2 h-auto p-0"
                  onClick={() => setTermoOpen(true)}
                >
                  Ler termo completo
                </Button>
              </div>

              <Controller
                control={form.control}
                name="lg_aceite_termo"
                render={({ field }) => (
                  <div className="space-y-2">
                    <label className="flex items-start gap-3 text-sm text-slate-700">
                      <Checkbox
                        checked={field.value === true}
                        onCheckedChange={(v) => field.onChange(v === true)}
                        aria-invalid={!!form.formState.errors.lg_aceite_termo}
                        className="mt-0.5"
                      />
                      <span>
                        Li, compreendi e aceito o termo de consentimento para tratamento
                        dos meus dados pessoais conforme a LGPD (Lei 13.709/2018).
                      </span>
                    </label>
                    {form.formState.errors.lg_aceite_termo && (
                      <p className="text-sm text-red-600" role="alert">
                        {form.formState.errors.lg_aceite_termo.message}
                      </p>
                    )}
                  </div>
                )}
              />

              <div className="rounded-md bg-slate-50 p-4 text-sm">
                <p className="mb-2 font-medium text-slate-900">Resumo do pre-cadastro:</p>
                <ul className="space-y-1 text-slate-600">
                  <li><strong>Nome:</strong> {form.getValues("full_name") || "—"}</li>
                  <li><strong>E-mail:</strong> {form.getValues("email") || "—"}</li>
                  <li><strong>Telefone:</strong> {form.getValues("phone") || "—"}</li>
                  <li>
                    <strong>Endereco:</strong>{" "}
                    {[
                      form.getValues("logradouro"),
                      form.getValues("numero"),
                      form.getValues("bairro"),
                      form.getValues("cidade"),
                      form.getValues("uf"),
                    ]
                      .filter(Boolean)
                      .join(", ") || "—"}
                  </li>
                </ul>
              </div>
            </fieldset>
          )}
        </CardContent>

        {/* Footer — botoes de navegacao */}
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 p-6">
          <Button type="button" variant="outline" onClick={goPrev}>
            <ChevronLeft className="mr-2 h-4 w-4" />
            {step === 1 ? "Cancelar" : "Voltar"}
          </Button>

          {step < 4 ? (
            <Button type="button" onClick={goNext}>
              {STEP_TITLES[((step + 1) as StepKey)]}
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          ) : (
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Enviando...
                </>
              ) : (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  Enviar pre-cadastro
                </>
              )}
            </Button>
          )}
        </div>
      </form>

      {/* Modal do termo completo */}
      <Dialog open={termoOpen} onOpenChange={setTermoOpen}>
        <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Termo de Consentimento (LGPD)</DialogTitle>
            <DialogDescription>
              Versao: <span className="font-mono">{versaoTermo}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="whitespace-pre-wrap rounded-md bg-slate-50 p-4 text-sm leading-relaxed text-slate-800">
            {textoTermo}
          </div>
          <DialogFooter>
            <Button type="button" onClick={() => setTermoOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// =============================================================================
// Subcomponentes
// =============================================================================

interface FieldProps {
  label: string;
  required?: boolean;
  error?: string;
  className?: string;
  children: React.ReactNode;
}

function Field({ label, required, error, className, children }: FieldProps) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label className="text-sm font-medium text-slate-700">
        {label}
        {required && <span className="ml-0.5 text-red-500" aria-hidden="true">*</span>}
      </Label>
      {children}
      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export default PreCadastroForm;
