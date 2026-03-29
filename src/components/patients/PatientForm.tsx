import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { maskCPF, maskPhone } from "@/utils/masks";
import { Loader2 } from "lucide-react";

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

export function PatientForm({ initialData, onSubmit, onCancel, saving, validationError }: Props) {
  const [form, setForm] = useState<PatientFormData>({ ...emptyForm, ...initialData });

  const set = (field: keyof PatientFormData, value: string) => setForm((f) => ({ ...f, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit(form);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {validationError && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{validationError}</div>
      )}

      {/* Dados Pessoais */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Dados Pessoais</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="md:col-span-2 lg:col-span-3 space-y-1.5">
            <Label className="text-xs">Nome Completo *</Label>
            <Input required placeholder="Nome completo do paciente" value={form.full_name} onChange={(e) => set("full_name", e.target.value)} maxLength={200} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">CPF *</Label>
            <Input required placeholder="000.000.000-00" value={maskCPF(form.cpf)} onChange={(e) => set("cpf", e.target.value.replace(/\D/g, ""))} maxLength={14} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Data de Nascimento *</Label>
            <Input type="date" required value={form.birth_date} onChange={(e) => set("birth_date", e.target.value)} max={new Date().toISOString().split("T")[0]} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Sexo *</Label>
            <Select value={form.sex} onValueChange={(v) => set("sex", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="M">Masculino</SelectItem>
                <SelectItem value="F">Feminino</SelectItem>
                <SelectItem value="O">Outro</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Estado Civil</Label>
            <Select value={form.marital_status || ""} onValueChange={(v) => set("marital_status", v)}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="solteiro">Solteiro(a)</SelectItem>
                <SelectItem value="casado">Casado(a)</SelectItem>
                <SelectItem value="divorciado">Divorciado(a)</SelectItem>
                <SelectItem value="viuvo">Viúvo(a)</SelectItem>
                <SelectItem value="uniao_estavel">União Estável</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Responsável</Label>
            <Input placeholder="Nome do responsável" value={form.responsible_name} onChange={(e) => set("responsible_name", e.target.value)} maxLength={200} />
          </div>
        </CardContent>
      </Card>

      {/* Contato */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Contato</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Telefone Principal *</Label>
            <Input required placeholder="(00) 00000-0000" value={maskPhone(form.phone)} onChange={(e) => set("phone", e.target.value.replace(/\D/g, ""))} maxLength={15} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">E-mail</Label>
            <Input type="email" placeholder="email@email.com" value={form.email} onChange={(e) => set("email", e.target.value)} maxLength={255} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Contato de Emergência</Label>
            <Input placeholder="Nome" value={form.emergency_contact_name} onChange={(e) => set("emergency_contact_name", e.target.value)} maxLength={200} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Tel. Emergência</Label>
            <Input placeholder="(00) 00000-0000" value={maskPhone(form.emergency_contact_phone)} onChange={(e) => set("emergency_contact_phone", e.target.value.replace(/\D/g, ""))} maxLength={15} />
          </div>
        </CardContent>
      </Card>

      {/* Convênio */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Convênio</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Convênio</Label>
            <Input placeholder="Nome do convênio" value={form.insurance_plan_id} onChange={(e) => set("insurance_plan_id", e.target.value)} maxLength={100} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Nº Carteirinha</Label>
            <Input placeholder="Número da carteirinha" value={form.insurance_card_number} onChange={(e) => set("insurance_card_number", e.target.value)} maxLength={50} />
          </div>
        </CardContent>
      </Card>

      {/* Clínico */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Informações Clínicas</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Alergias</Label>
            <Textarea placeholder="Ex: Dipirona, Penicilina, Látex" value={form.allergies} onChange={(e) => set("allergies", e.target.value)} maxLength={500} rows={2} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Alertas Clínicos</Label>
            <Textarea placeholder="Ex: Diabético, Hipertenso, Gestante" value={form.clinical_alerts} onChange={(e) => set("clinical_alerts", e.target.value)} maxLength={500} rows={2} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Notas Clínicas</Label>
            <Textarea placeholder="Observações clínicas" value={form.clinical_notes} onChange={(e) => set("clinical_notes", e.target.value)} maxLength={1000} rows={2} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Notas Administrativas</Label>
            <Textarea placeholder="Observações administrativas" value={form.admin_notes} onChange={(e) => set("admin_notes", e.target.value)} maxLength={1000} rows={2} />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {saving ? "Salvando..." : "Salvar Paciente"}
        </Button>
      </div>
    </form>
  );
}
