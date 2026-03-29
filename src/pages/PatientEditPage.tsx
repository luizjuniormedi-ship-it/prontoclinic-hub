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
        social_name: data.social_name || "",
        cpf: data.cpf || "",
        rg: data.rg || "",
        cns: data.cns || "",
        birth_date: data.birth_date || "",
        sex: data.sex || "M",
        phone: data.phone || "",
        phone_secondary: data.phone_secondary || "",
        email: data.email || "",
        zip_code: data.zip_code || "",
        address_street: data.address_street || "",
        address_number: data.address_number || "",
        address_complement: data.address_complement || "",
        address_neighborhood: data.address_neighborhood || "",
        address_city: data.address_city || "",
        address_state: data.address_state || "",
        mother_name: data.mother_name || "",
        guardian_name: data.guardian_name || "",
        insurance_plan_id: data.insurance_plan_id || "",
        insurance_card_number: data.insurance_card_number || "",
        insurance_card_expiry: data.insurance_card_expiry || "",
        observations: data.observations || "",
        clinical_alerts: data.clinical_alerts || "",
        allergies: data.allergies || "",
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

    // Check CPF uniqueness excluding self
    const { data: existing } = await supabase
      .from("patients").select("id").eq("cpf", cleanCpf).neq("id", id).limit(1);
    if (existing && existing.length > 0) {
      setValidationError("Já existe outro paciente com este CPF."); return;
    }

    setSaving(true);
    try {
      const row: Record<string, any> = {
        full_name: data.full_name.trim(),
        social_name: data.social_name.trim() || null,
        cpf: cleanCpf,
        rg: data.rg.trim() || null,
        cns: data.cns.trim() || null,
        birth_date: data.birth_date,
        sex: data.sex,
        phone: data.phone.replace(/\D/g, ""),
        phone_secondary: data.phone_secondary.replace(/\D/g, "") || null,
        email: data.email.trim() || null,
        zip_code: data.zip_code.replace(/\D/g, "") || null,
        address_street: data.address_street.trim() || null,
        address_number: data.address_number.trim() || null,
        address_complement: data.address_complement.trim() || null,
        address_neighborhood: data.address_neighborhood.trim() || null,
        address_city: data.address_city.trim() || null,
        address_state: data.address_state.trim() || null,
        mother_name: data.mother_name.trim() || null,
        guardian_name: data.guardian_name.trim() || null,
        insurance_plan_id: data.insurance_plan_id.trim() || null,
        insurance_card_number: data.insurance_card_number.trim() || null,
        insurance_card_expiry: data.insurance_card_expiry || null,
        observations: data.observations.trim() || null,
        clinical_alerts: data.clinical_alerts.trim() || null,
        allergies: data.allergies.trim() || null,
        updated_at: new Date().toISOString(),
      };

      const { error: updateError } = await supabase.from("patients").update(row).eq("id", id);
      if (updateError) throw updateError;
      toast({ title: "Paciente atualizado com sucesso!" });
      navigate(`/patients/${id}`);
    } catch (err: any) {
      toast({ title: "Erro ao atualizar", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
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
