import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { maskCPF, maskPhone } from "@/utils/masks";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

// Matches the real Supabase patients table columns exactly
export interface PatientFormData {
  full_name: string;
  cpf: string;
  birth_date: string;
  sex: string;
  phone: string;
  email: string;
  marital_status: string;
  responsible_name: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  insurance_plan_id: string;
  insurance_card_number: string;
  allergies: string;
  clinical_alerts: string;
  admin_notes: string;
  clinical_notes: string;
}

const emptyForm: PatientFormData = {
  full_name: "", cpf: "", birth_date: "", sex: "M",
  phone: "", email: "", marital_status: "",
  responsible_name: "", emergency_contact_name: "", emergency_contact_phone: "",
  insurance_plan_id: "", insurance_card_number: "",
  allergies: "", clinical_alerts: "", admin_notes: "", clinical_notes: "",
};

interface Props {
  initialData?: Partial<PatientFormData>;
  onSubmit: (data: PatientFormData) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
  validationError?: string | null;
}

/**
 * Lightweight per-field validator. Returns true if field is valid.
 * Extend with Zod schema when form grows. We mark fields with
 * `aria-invalid` and pair with `aria-describedby` to the error node.
 */
function validateField(field: keyof PatientFormData, value: string): string | null {
  if (field === "full_name" && value.trim().length < 3) {
    return "Informe o nome completo (mínimo 3 caracteres).";
  }
  if (field === "cpf") {
    const digits = value.replace(/\D/g, "");
    if (digits && digits.length !== 11) return "CPF deve ter 11 dígitos.";
  }
  if (field === "phone") {
    const digits = value.replace(/\D/g, "");
    if (digits && (digits.length < 10 || digits.length > 11)) {
      return "Telefone deve ter DDD + número.";
    }
  }
  if (field === "email" && value) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "E-mail inválido.";
  }
  return null;
}

export function PatientForm({ initialData, onSubmit, onCancel, saving, validationError }: Props) {
  const [form, setForm] = useState<PatientFormData>({ ...emptyForm, ...initialData });
  const [insurancePlans, setInsurancePlans] = useState<Array<{ id: string; name: string }>>([]);
  const [errors, setErrors] = useState<Partial<Record<keyof PatientFormData, string>>>({});
  const [touched, setTouched] = useState<Partial<Record<keyof PatientFormData, boolean>>>({});

  useEffect(() => {
    let active = true;
    void supabase
      .from("insurance_plans")
      .select("id, name")
      .eq("lg_ativo", true)
      .order("name")
      .then(({ data }) => {
        if (active) setInsurancePlans((data || []).map((plan) => ({ id: String(plan.id), name: plan.name })));
      });
    return () => { active = false; };
  }, []);

  const set = (field: keyof PatientFormData, value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
    if (touched[field]) {
      const msg = validateField(field, value);
      setErrors((e) => ({ ...e, [field]: msg ?? undefined }));
    }
  };

  const onBlurField = (field: keyof PatientFormData) => {
    setTouched((t) => ({ ...t, [field]: true }));
    const msg = validateField(field, form[field]);
    setErrors((e) => ({ ...e, [field]: msg ?? undefined }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Validate everything before submit
    const next: typeof errors = {};
    (Object.keys(form) as (keyof PatientFormData)[]).forEach((k) => {
      const msg = validateField(k, form[k]);
      if (msg) next[k] = msg;
    });
    setErrors(next);
    setTouched(
      Object.keys(form).reduce((acc, k) => ({ ...acc, [k]: true }), {} as typeof touched)
    );
    if (Object.values(next).some(Boolean)) return;
    await onSubmit(form);
  };

  // Helper to render an input field with label + error wiring
  const Field = ({
    id,
    label,
    required,
    children,
    fieldKey,
    describedBy,
  }: {
    id: string;
    label: string;
    required?: boolean;
    children: React.ReactNode;
    fieldKey: keyof PatientFormData;
    describedBy?: string;
  }) => {
    const err = errors[fieldKey];
    const errId = `${id}-error`;
    const composedDescribedBy = [describedBy, err ? errId : null].filter(Boolean).join(" ") || undefined;
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id} className="text-xs">
          {label}
          {required && (
            <>
              {" "}
              <span className="text-destructive" aria-hidden="true">*</span>
              <span className="sr-only"> (obrigatório)</span>
            </>
          )}
        </Label>
        <div data-field={fieldKey} aria-describedby={composedDescribedBy}>
          {children}
        </div>
        {err && (
          <p id={errId} role="alert" className="text-xs text-destructive">
            {err}
          </p>
        )}
      </div>
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate aria-label="Formulário de cadastro de paciente">
      {validationError && (
        <div
          role="alert"
          className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
        >
          {validationError}
        </div>
      )}

      {/* Dados Pessoais */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base" id="dados-pessoais-title">Dados Pessoais</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="md:col-span-2 lg:col-span-3">
            <Field id="full_name" label="Nome Completo" required fieldKey="full_name">
              <Input
                id="full_name"
                required
                placeholder="Nome completo do paciente"
                value={form.full_name}
                onChange={(e) => set("full_name", e.target.value)}
                onBlur={() => onBlurField("full_name")}
                maxLength={200}
                aria-required="true"
                aria-invalid={!!errors.full_name}
              />
            </Field>
          </div>
          <Field id="cpf" label="CPF" required fieldKey="cpf">
            <Input
              id="cpf"
              required
              inputMode="numeric"
              autoComplete="off"
              placeholder="000.000.000-00"
              value={maskCPF(form.cpf)}
              onChange={(e) => set("cpf", e.target.value.replace(/\D/g, ""))}
              onBlur={() => onBlurField("cpf")}
              maxLength={14}
              aria-required="true"
              aria-invalid={!!errors.cpf}
            />
          </Field>
          <Field id="birth_date" label="Data de Nascimento" required fieldKey="birth_date">
            <Input
              id="birth_date"
              type="date"
              required
              value={form.birth_date}
              onChange={(e) => set("birth_date", e.target.value)}
              max={new Date().toISOString().split("T")[0]}
              aria-required="true"
              aria-invalid={!!errors.birth_date}
            />
          </Field>
          <Field id="sex" label="Sexo" required fieldKey="sex">
            <Select value={form.sex} onValueChange={(v) => set("sex", v)}>
              <SelectTrigger id="sex" aria-required="true" aria-label="Sexo">
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="M">Masculino</SelectItem>
                <SelectItem value="F">Feminino</SelectItem>
                <SelectItem value="O">Outro</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field id="marital_status" label="Estado Civil" fieldKey="marital_status">
            <Select value={form.marital_status || ""} onValueChange={(v) => set("marital_status", v)}>
              <SelectTrigger id="marital_status" aria-label="Estado civil">
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="solteiro">Solteiro(a)</SelectItem>
                <SelectItem value="casado">Casado(a)</SelectItem>
                <SelectItem value="divorciado">Divorciado(a)</SelectItem>
                <SelectItem value="viuvo">Viúvo(a)</SelectItem>
                <SelectItem value="uniao_estavel">União Estável</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field id="responsible_name" label="Responsável" fieldKey="responsible_name">
            <Input
              id="responsible_name"
              placeholder="Nome do responsável"
              value={form.responsible_name}
              onChange={(e) => set("responsible_name", e.target.value)}
              onBlur={() => onBlurField("responsible_name")}
              maxLength={200}
              aria-invalid={!!errors.responsible_name}
            />
          </Field>
        </CardContent>
      </Card>

      {/* Contato */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Contato</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Field id="phone" label="Telefone Principal" required fieldKey="phone">
            <Input
              id="phone"
              required
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="(00) 00000-0000"
              value={maskPhone(form.phone)}
              onChange={(e) => set("phone", e.target.value.replace(/\D/g, ""))}
              onBlur={() => onBlurField("phone")}
              maxLength={15}
              aria-required="true"
              aria-invalid={!!errors.phone}
            />
          </Field>
          <Field id="email" label="E-mail" fieldKey="email">
            <Input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="email@email.com"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              onBlur={() => onBlurField("email")}
              maxLength={255}
              aria-invalid={!!errors.email}
            />
          </Field>
          <Field id="emergency_contact_name" label="Contato de Emergência" fieldKey="emergency_contact_name">
            <Input
              id="emergency_contact_name"
              placeholder="Nome do contato de emergência"
              value={form.emergency_contact_name}
              onChange={(e) => set("emergency_contact_name", e.target.value)}
              onBlur={() => onBlurField("emergency_contact_name")}
              maxLength={200}
              aria-invalid={!!errors.emergency_contact_name}
            />
          </Field>
          <Field id="emergency_contact_phone" label="Tel. Emergência" fieldKey="emergency_contact_phone">
            <Input
              id="emergency_contact_phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="(00) 00000-0000"
              value={maskPhone(form.emergency_contact_phone)}
              onChange={(e) => set("emergency_contact_phone", e.target.value.replace(/\D/g, ""))}
              onBlur={() => onBlurField("emergency_contact_phone")}
              maxLength={15}
              aria-invalid={!!errors.emergency_contact_phone}
            />
          </Field>
        </CardContent>
      </Card>

      {/* Convênio */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Convênio</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field id="insurance_plan_id" label="Plano de convênio" fieldKey="insurance_plan_id">
            <Select value={form.insurance_plan_id || "none"} onValueChange={(value) => set("insurance_plan_id", value === "none" ? "" : value)}>
              <SelectTrigger id="insurance_plan_id" aria-label="Plano de convênio">
                <SelectValue placeholder="Selecione o plano" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Particular / sem convênio</SelectItem>
                {insurancePlans.map((plan) => (
                  <SelectItem key={plan.id} value={plan.id}>{plan.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field id="insurance_card_number" label="Nº Carteirinha" fieldKey="insurance_card_number">
            <Input
              id="insurance_card_number"
              placeholder="Número da carteirinha"
              value={form.insurance_card_number}
              onChange={(e) => set("insurance_card_number", e.target.value)}
              maxLength={50}
            />
          </Field>
        </CardContent>
      </Card>

      {/* Clínico */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Informações Clínicas</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field id="allergies" label="Alergias" fieldKey="allergies">
            <Textarea
              id="allergies"
              placeholder="Ex: Dipirona, Penicilina, Látex"
              value={form.allergies}
              onChange={(e) => set("allergies", e.target.value)}
              maxLength={500}
              rows={2}
              aria-describedby="allergies-hint"
            />
            <p id="allergies-hint" className="text-xs text-muted-foreground">
              Liste medicamentos ou substâncias que o paciente não pode receber.
            </p>
          </Field>
          <Field id="clinical_alerts" label="Alertas Clínicos" fieldKey="clinical_alerts">
            <Textarea
              id="clinical_alerts"
              placeholder="Ex: Diabético, Hipertenso, Gestante"
              value={form.clinical_alerts}
              onChange={(e) => set("clinical_alerts", e.target.value)}
              maxLength={500}
              rows={2}
            />
          </Field>
          <Field id="clinical_notes" label="Notas Clínicas" fieldKey="clinical_notes">
            <Textarea
              id="clinical_notes"
              placeholder="Observações clínicas"
              value={form.clinical_notes}
              onChange={(e) => set("clinical_notes", e.target.value)}
              maxLength={1000}
              rows={2}
            />
          </Field>
          <Field id="admin_notes" label="Notas Administrativas" fieldKey="admin_notes">
            <Textarea
              id="admin_notes"
              placeholder="Observações administrativas"
              value={form.admin_notes}
              onChange={(e) => set("admin_notes", e.target.value)}
              maxLength={1000}
              rows={2}
            />
          </Field>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={saving} aria-busy={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          {saving ? "Salvando..." : "Salvar Paciente"}
        </Button>
      </div>
    </form>
  );
}