import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { PatientForm, PatientFormData } from "@/components/patients/PatientForm";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function PatientCreatePage() {
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ id: string; full_name: string; cpf: string } | null>(null);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();

  const handleSubmit = async (data: PatientFormData) => {
    setValidationError(null);
    setDuplicate(null);

    if (!data.full_name.trim() || data.full_name.trim().length < 2) {
      setValidationError("Nome completo é obrigatório (mínimo 2 caracteres)."); return;
    }
    const cleanCpf = data.cpf.replace(/\D/g, "");
    if (!cleanCpf || cleanCpf.length !== 11) {
      setValidationError("CPF deve conter 11 dígitos."); return;
    }
    if (!data.birth_date) {
      setValidationError("Data de nascimento é obrigatória."); return;
    }
    if (!data.phone.replace(/\D/g, "")) {
      setValidationError("Telefone principal é obrigatório."); return;
    }

    // Check CPF uniqueness
    const { data: existing } = await supabase.from("patients").select("id, full_name, cpf").eq("cpf", cleanCpf).limit(1);
    if (existing && existing.length > 0) {
      setDuplicate(existing[0]);
      setValidationError("Já existe um paciente com este CPF cadastrado.");
      return;
    }

    // Check name+birthdate similarity (warning only)
    const { data: similar } = await supabase
      .from("patients").select("id, full_name, cpf")
      .ilike("full_name", `%${data.full_name.trim().split(" ")[0]}%`)
      .eq("birth_date", data.birth_date).limit(1);
    if (similar && similar.length > 0) {
      setDuplicate(similar[0]);
    }

    setSaving(true);
    try {
      const row: Record<string, any> = {
        full_name: data.full_name.trim(),
        cpf: cleanCpf,
        birth_date: data.birth_date,
        sex: data.sex,
        phone: data.phone.replace(/\D/g, ""),
        email: data.email.trim() || null,
        marital_status: data.marital_status || null,
        responsible_name: data.responsible_name.trim() || null,
        emergency_contact_name: data.emergency_contact_name.trim() || null,
        emergency_contact_phone: data.emergency_contact_phone.replace(/\D/g, "") || null,
        insurance_plan_id: data.insurance_plan_id.trim() || null,
        insurance_card_number: data.insurance_card_number.trim() || null,
        allergies: data.allergies.trim() || null,
        clinical_alerts: data.clinical_alerts.trim() || null,
        admin_notes: data.admin_notes.trim() || null,
        clinical_notes: data.clinical_notes.trim() || null,
        company_id: user?.company_id || null,
        registration_status: "complete",
      };

      const { error } = await supabase.from("patients").insert(row);
      if (error) {
        if (error.code === "23505") { setValidationError("Já existe um paciente com este CPF."); return; }
        throw error;
      }
      toast({ title: "Paciente cadastrado com sucesso!" });
      navigate("/patients");
    } catch (err) {
      toast({ title: "Erro ao cadastrar", description: (err as Error).message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Novo Paciente" description="Cadastre um novo paciente no sistema" />
      {duplicate && (
        <Card className="border-warning/30 bg-warning/5">
          <CardContent className="p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" />
              <div>
                <p className="text-sm font-medium text-warning">Possível duplicidade</p>
                <p className="text-xs text-muted-foreground">{duplicate.full_name} — CPF: {duplicate.cpf}</p>
              </div>
            </div>
            <Button variant="link" size="sm" onClick={() => navigate(`/patients/${duplicate.id}`)}>Ver cadastro →</Button>
          </CardContent>
        </Card>
      )}
      <PatientForm onSubmit={handleSubmit} onCancel={() => navigate("/patients")} saving={saving} validationError={validationError} />
    </div>
  );
}
