import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { PatientForm, PatientFormData } from "@/components/patients/PatientForm";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { LoadingState, ErrorState } from "@/components/StateViews";

export default function PatientEditPage() {
  const { id } = useParams<{ id: string }>();
  const [initialData, setInitialData] = useState<Partial<PatientFormData> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    if (!id) return;
    supabase.from("patients").select("*").eq("id", id).maybeSingle().then(({ data, error: e }) => {
      if (e || !data) { setError("Paciente não encontrado"); setLoading(false); return; }
      setInitialData({
        full_name: data.full_name || "",
        cpf: data.cpf || "",
        birth_date: data.birth_date || "",
        sex: data.sex || "M",
        phone: data.phone || "",
        email: data.email || "",
        marital_status: data.marital_status || "",
        responsible_name: data.responsible_name || "",
        emergency_contact_name: data.emergency_contact_name || "",
        emergency_contact_phone: data.emergency_contact_phone || "",
        insurance_plan_id: data.insurance_plan_id || "",
        insurance_card_number: data.insurance_card_number || "",
        allergies: data.allergies || "",
        clinical_alerts: data.clinical_alerts || "",
        admin_notes: data.admin_notes || "",
        clinical_notes: data.clinical_notes || "",
      });
      setLoading(false);
    });
  }, [id]);

  const handleSubmit = async (data: PatientFormData) => {
    if (!id) return;
    setValidationError(null);

    if (!data.full_name.trim() || data.full_name.trim().length < 2) {
      setValidationError("Nome completo é obrigatório."); return;
    }
    const cleanCpf = data.cpf.replace(/\D/g, "");
    if (!cleanCpf || cleanCpf.length !== 11) {
      setValidationError("CPF deve conter 11 dígitos."); return;
    }

    const { data: existing } = await supabase.from("patients").select("id").eq("cpf", cleanCpf).neq("id", id).limit(1);
    if (existing && existing.length > 0) {
      setValidationError("Já existe outro paciente com este CPF."); return;
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
        registration_status: "complete",
        updated_at: new Date().toISOString(),
      };

      const { error: updateError } = await supabase.from("patients").update(row).eq("id", id);
      if (updateError) throw updateError;
      toast({ title: "Paciente atualizado com sucesso!" });
      navigate(`/patients/${id}`);
    } catch (err: any) {
      toast({ title: "Erro ao atualizar", description: err.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={() => navigate("/patients")} />;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Editar Paciente" description="Atualize os dados do paciente" />
      <PatientForm initialData={initialData!} onSubmit={handleSubmit} onCancel={() => navigate(`/patients/${id}`)} saving={saving} validationError={validationError} />
    </div>
  );
}
