import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { maskCPF, maskPhone } from "@/utils/masks";
import { maskCEP } from "@/utils/masks";
import { Loader2 } from "lucide-react";

export interface PatientFormData {
  full_name: string;
  social_name: string;
  cpf: string;
  rg: string;
  cns: string;
  birth_date: string;
  sex: string;
  phone: string;
  phone_secondary: string;
  email: string;
  zip_code: string;
  address_street: string;
  address_number: string;
  address_complement: string;
  address_neighborhood: string;
  address_city: string;
  address_state: string;
  mother_name: string;
  guardian_name: string;
  insurance_plan_id: string;
  insurance_card_number: string;
  insurance_card_expiry: string;
  observations: string;
  clinical_alerts: string;
  allergies: string;
}

const emptyForm: PatientFormData = {
  full_name: "", social_name: "", cpf: "", rg: "", cns: "",
  birth_date: "", sex: "M", phone: "", phone_secondary: "", email: "",
  zip_code: "", address_street: "", address_number: "", address_complement: "",
  address_neighborhood: "", address_city: "", address_state: "",
  mother_name: "", guardian_name: "",
  insurance_plan_id: "", insurance_card_number: "", insurance_card_expiry: "",
  observations: "", clinical_alerts: "", allergies: "",
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

  const fetchCEP = async (cep: string) => {
    const clean = cep.replace(/\D/g, "");
    if (clean.length !== 8) return;
    try {
      const res = await fetch(`https://viacep.com.br/ws/${clean}/json/`);
      const data = await res.json();
      if (!data.erro) {
        setForm((f) => ({
          ...f,
          address_street: data.logradouro || f.address_street,
          address_neighborhood: data.bairro || f.address_neighborhood,
          address_city: data.localidade || f.address_city,
          address_state: data.uf || f.address_state,
        }));
      }
    } catch { /* ignore */ }
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
          <div className="md:col-span-2 space-y-1.5">
            <Label className="text-xs">Nome Completo *</Label>
            <Input required placeholder="Nome completo do paciente" value={form.full_name} onChange={(e) => set("full_name", e.target.value)} maxLength={200} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Nome Social</Label>
            <Input placeholder="Nome social" value={form.social_name} onChange={(e) => set("social_name", e.target.value)} maxLength={200} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">CPF *</Label>
            <Input required placeholder="000.000.000-00" value={maskCPF(form.cpf)} onChange={(e) => set("cpf", e.target.value.replace(/\D/g, ""))} maxLength={14} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">RG</Label>
            <Input placeholder="RG" value={form.rg} onChange={(e) => set("rg", e.target.value)} maxLength={20} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">CNS</Label>
            <Input placeholder="Cartão Nacional de Saúde" value={form.cns} onChange={(e) => set("cns", e.target.value.replace(/\D/g, ""))} maxLength={15} />
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
            <Label className="text-xs">Nome da Mãe</Label>
            <Input placeholder="Nome da mãe" value={form.mother_name} onChange={(e) => set("mother_name", e.target.value)} maxLength={200} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Responsável</Label>
            <Input placeholder="Nome do responsável" value={form.guardian_name} onChange={(e) => set("guardian_name", e.target.value)} maxLength={200} />
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
            <Label className="text-xs">Telefone Secundário</Label>
            <Input placeholder="(00) 00000-0000" value={maskPhone(form.phone_secondary)} onChange={(e) => set("phone_secondary", e.target.value.replace(/\D/g, ""))} maxLength={15} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">E-mail</Label>
            <Input type="email" placeholder="email@email.com" value={form.email} onChange={(e) => set("email", e.target.value)} maxLength={255} />
          </div>
        </CardContent>
      </Card>

      {/* Endereço */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Endereço</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">CEP</Label>
            <Input
              placeholder="00000-000"
              value={maskCEP(form.zip_code)}
              onChange={(e) => set("zip_code", e.target.value.replace(/\D/g, ""))}
              onBlur={(e) => fetchCEP(e.target.value)}
              maxLength={9}
            />
          </div>
          <div className="lg:col-span-2 space-y-1.5">
            <Label className="text-xs">Logradouro</Label>
            <Input placeholder="Rua, Av., etc." value={form.address_street} onChange={(e) => set("address_street", e.target.value)} maxLength={200} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Número</Label>
            <Input placeholder="Nº" value={form.address_number} onChange={(e) => set("address_number", e.target.value)} maxLength={10} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Complemento</Label>
            <Input placeholder="Apto, Sala, etc." value={form.address_complement} onChange={(e) => set("address_complement", e.target.value)} maxLength={100} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Bairro</Label>
            <Input placeholder="Bairro" value={form.address_neighborhood} onChange={(e) => set("address_neighborhood", e.target.value)} maxLength={100} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Cidade</Label>
            <Input placeholder="Cidade" value={form.address_city} onChange={(e) => set("address_city", e.target.value)} maxLength={100} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Estado</Label>
            <Input placeholder="UF" value={form.address_state} onChange={(e) => set("address_state", e.target.value)} maxLength={2} />
          </div>
        </CardContent>
      </Card>

      {/* Convênio */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Convênio</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Convênio</Label>
            <Input placeholder="Nome do convênio" value={form.insurance_plan_id} onChange={(e) => set("insurance_plan_id", e.target.value)} maxLength={100} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Nº Carteirinha</Label>
            <Input placeholder="Número da carteirinha" value={form.insurance_card_number} onChange={(e) => set("insurance_card_number", e.target.value)} maxLength={50} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Validade</Label>
            <Input type="date" value={form.insurance_card_expiry} onChange={(e) => set("insurance_card_expiry", e.target.value)} />
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
          <div className="md:col-span-2 space-y-1.5">
            <Label className="text-xs">Observações</Label>
            <Textarea placeholder="Observações gerais sobre o paciente" value={form.observations} onChange={(e) => set("observations", e.target.value)} maxLength={1000} rows={3} />
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
