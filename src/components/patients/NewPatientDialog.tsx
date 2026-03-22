import { useState } from "react";
import { Plus, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Patient } from "@/types";
import { maskCPF, maskPhone } from "@/utils/masks";
import { validatePatient, stripNonDigits } from "@/services/patientsService";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patients: Patient[];
  onSave: (data: Omit<Patient, "id" | "createdAt" | "updatedAt">) => Promise<void>;
  saving: boolean;
  navigateToPatient: (id: string) => void;
}

export function NewPatientDialog({ open, onOpenChange, patients, onSave, saving, navigateToPatient }: Props) {
  const [formName, setFormName] = useState("");
  const [formCpf, setFormCpf] = useState("");
  const [formBirthDate, setFormBirthDate] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formGender, setFormGender] = useState<"M" | "F" | "O">("M");
  const [formInsurance, setFormInsurance] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const resetForm = () => {
    setFormName("");
    setFormCpf("");
    setFormBirthDate("");
    setFormPhone("");
    setFormEmail("");
    setFormGender("M");
    setFormInsurance("");
    setValidationError(null);
  };

  // Duplicate detection
  const cleanCpf = stripNonDigits(formCpf);
  const cleanPhone = stripNonDigits(formPhone);
  const duplicateByCpf = cleanCpf.length >= 6 ? patients.find((p) => p.cpf.includes(cleanCpf)) : undefined;
  const duplicateByPhone = cleanPhone.length >= 8 ? patients.find((p) => p.phone.includes(cleanPhone)) : undefined;
  const duplicate = duplicateByCpf || duplicateByPhone;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setValidationError(null);

    const patientData = {
      name: formName.trim(),
      cpf: stripNonDigits(formCpf),
      birthDate: formBirthDate,
      phone: stripNonDigits(formPhone),
      email: formEmail.trim(),
      gender: formGender,
      healthInsurance: formInsurance.trim() || undefined,
    };

    const error = validatePatient(patientData);
    if (error) {
      setValidationError(error);
      return;
    }

    await onSave(patientData as Omit<Patient, "id" | "createdAt" | "updatedAt">);
    resetForm();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) resetForm(); }}>
      <DialogTrigger asChild>
        <Button><Plus className="mr-2 h-4 w-4" />Novo Paciente</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Cadastrar Paciente</DialogTitle>
          <DialogDescription>Preencha os dados do paciente. Campos com * são obrigatórios.</DialogDescription>
        </DialogHeader>

        {duplicate && (
          <Card className="border-warning/30 bg-warning/5">
            <CardContent className="p-3">
              <div className="flex items-center gap-1.5 text-warning text-sm font-medium mb-1">
                <AlertTriangle className="h-4 w-4" />Possível duplicidade encontrada
              </div>
              <p className="text-xs">{duplicate.name} — {duplicate.cpf}</p>
              <p className="text-xs text-muted-foreground">{duplicate.phone}</p>
              <Button variant="link" size="sm" className="h-auto p-0 text-xs mt-1" onClick={() => { onOpenChange(false); navigateToPatient(duplicate.id); }}>
                Ver cadastro existente →
              </Button>
            </CardContent>
          </Card>
        )}

        {validationError && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {validationError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-2">
              <Label>Nome Completo *</Label>
              <Input placeholder="Nome do paciente" required value={formName} onChange={(e) => setFormName(e.target.value)} maxLength={200} />
            </div>
            <div className="space-y-2">
              <Label>CPF *</Label>
              <Input placeholder="000.000.000-00" required value={formCpf} onChange={(e) => setFormCpf(maskCPF(e.target.value))} maxLength={14} />
            </div>
            <div className="space-y-2">
              <Label>Data de Nascimento *</Label>
              <Input type="date" required value={formBirthDate} onChange={(e) => setFormBirthDate(e.target.value)} max={new Date().toISOString().split("T")[0]} />
            </div>
            <div className="space-y-2">
              <Label>Telefone *</Label>
              <Input placeholder="(00) 00000-0000" required value={formPhone} onChange={(e) => setFormPhone(maskPhone(e.target.value))} maxLength={15} />
            </div>
            <div className="space-y-2">
              <Label>Sexo *</Label>
              <Select value={formGender} onValueChange={(v) => setFormGender(v as "M" | "F" | "O")}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="M">Masculino</SelectItem>
                  <SelectItem value="F">Feminino</SelectItem>
                  <SelectItem value="O">Outro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>E-mail</Label>
              <Input type="email" placeholder="email@email.com" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} maxLength={255} />
            </div>
            <div className="space-y-2">
              <Label>Convênio</Label>
              <Input placeholder="Nome do convênio" value={formInsurance} onChange={(e) => setFormInsurance(e.target.value)} maxLength={100} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
