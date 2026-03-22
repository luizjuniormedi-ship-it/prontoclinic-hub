import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Phone, Mail, AlertTriangle, Calendar, User, Edit, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LoadingState, ErrorState } from "@/components/StateViews";
import { patientsService, validatePatient } from "@/services/patientsService";
import { Patient } from "@/types";
import { formatDate, calculateAge, formatCPF } from "@/utils/formatters";
import { maskCPF, maskPhone } from "@/utils/masks";
import { useToast } from "@/hooks/use-toast";

export default function PatientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Edit form state
  const [editData, setEditData] = useState<Partial<Patient>>({});

  const loadPatient = async () => {
    if (!id) return;
    try {
      setLoading(true);
      setError(null);
      const p = await patientsService.getById(id);
      if (!p) {
        setError("Paciente não encontrado.");
        return;
      }
      setPatient(p);
    } catch (err: any) {
      setError(err.message || "Erro ao carregar paciente.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPatient();
  }, [id]);

  const startEditing = () => {
    if (!patient) return;
    setEditData({
      name: patient.name,
      cpf: patient.cpf,
      birthDate: patient.birthDate,
      phone: patient.phone,
      email: patient.email,
      gender: patient.gender,
      healthInsurance: patient.healthInsurance || "",
      healthInsuranceNumber: patient.healthInsuranceNumber || "",
      allergies: patient.allergies || "",
      clinicalAlerts: patient.clinicalAlerts || "",
    });
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setEditData({});
  };

  const handleSave = async () => {
    if (!id || !patient) return;

    const validationError = validatePatient(editData);
    if (validationError) {
      toast({ title: "Erro de validação", description: validationError, variant: "destructive" });
      return;
    }

    try {
      setSaving(true);
      const updated = await patientsService.update(id, editData);
      setPatient(updated);
      setEditing(false);
      toast({ title: "Paciente atualizado com sucesso!" });
    } catch (err: any) {
      toast({ title: "Erro ao atualizar", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingState />;
  if (error || !patient) return <ErrorState message={error || "Paciente não encontrado."} onRetry={() => navigate("/patients")} />;

  const isComplete = !!(patient.name && patient.cpf && patient.birthDate && patient.phone && patient.email && patient.gender);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Clinical header */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
              <User className="h-6 w-6 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold">{patient.name}</h1>
                <Badge variant="outline" className={`text-[10px] border-0 ${isComplete ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
                  {isComplete ? "Completo" : "Incompleto"}
                </Badge>
              </div>
              <div className="flex items-center gap-3 text-sm text-muted-foreground mt-0.5 flex-wrap">
                {patient.birthDate && <span>{calculateAge(patient.birthDate)} anos</span>}
                <span>•</span>
                <span>{patient.gender === "M" ? "Masculino" : patient.gender === "F" ? "Feminino" : "Outro"}</span>
                <span>•</span>
                <span>{patient.healthInsurance || "Particular"}</span>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            {editing ? (
              <>
                <Button variant="outline" size="sm" onClick={cancelEditing} disabled={saving}>
                  <X className="mr-1 h-3 w-3" />Cancelar
                </Button>
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  <Save className="mr-1 h-3 w-3" />{saving ? "Salvando..." : "Salvar"}
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={startEditing}>
                  <Edit className="mr-1 h-3 w-3" />Editar
                </Button>
                <Button variant="outline" size="sm" onClick={() => navigate("/patients")}>
                  <ArrowLeft className="mr-1 h-3 w-3" />Voltar
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Alerts row */}
        <div className="flex items-center gap-3 mt-3 flex-wrap">
          {patient.allergies && (
            <div className="flex items-center gap-1 px-2 py-1 rounded bg-destructive/10">
              <AlertTriangle className="h-3 w-3 text-destructive" />
              <span className="text-xs text-destructive font-medium">Alergia: {patient.allergies}</span>
            </div>
          )}
          {patient.clinicalAlerts && (
            <div className="px-2 py-1 rounded bg-destructive/10">
              <span className="text-xs text-destructive font-medium">Alerta: {patient.clinicalAlerts}</span>
            </div>
          )}
        </div>
      </div>

      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Dados Cadastrais</TabsTrigger>
          <TabsTrigger value="clinical">Informações Clínicas</TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="mt-4">
          {editing ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">Dados Pessoais</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Nome Completo *</Label>
                    <Input value={editData.name || ""} onChange={(e) => setEditData({ ...editData, name: e.target.value })} maxLength={200} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">CPF *</Label>
                    <Input value={maskCPF(editData.cpf || "")} onChange={(e) => setEditData({ ...editData, cpf: e.target.value.replace(/\D/g, '') })} maxLength={14} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Data de Nascimento *</Label>
                    <Input type="date" value={editData.birthDate || ""} onChange={(e) => setEditData({ ...editData, birthDate: e.target.value })} max={new Date().toISOString().split("T")[0]} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Sexo *</Label>
                    <Select value={editData.gender} onValueChange={(v) => setEditData({ ...editData, gender: v as "M" | "F" | "O" })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="M">Masculino</SelectItem>
                        <SelectItem value="F">Feminino</SelectItem>
                        <SelectItem value="O">Outro</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">Contato e Convênio</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Telefone *</Label>
                    <Input value={maskPhone(editData.phone || "")} onChange={(e) => setEditData({ ...editData, phone: e.target.value.replace(/\D/g, '') })} maxLength={15} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">E-mail</Label>
                    <Input type="email" value={editData.email || ""} onChange={(e) => setEditData({ ...editData, email: e.target.value })} maxLength={255} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Convênio</Label>
                    <Input value={editData.healthInsurance || ""} onChange={(e) => setEditData({ ...editData, healthInsurance: e.target.value })} maxLength={100} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Nº Carteirinha</Label>
                    <Input value={editData.healthInsuranceNumber || ""} onChange={(e) => setEditData({ ...editData, healthInsuranceNumber: e.target.value })} maxLength={50} />
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-3">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">Dados Pessoais</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-muted-foreground" />{patient.phone ? maskPhone(patient.phone) : '—'}</div>
                  <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 text-muted-foreground" />{patient.email || '—'}</div>
                  <div className="pt-2 border-t space-y-1 text-xs">
                    <p><span className="text-muted-foreground">CPF:</span> {patient.cpf ? formatCPF(patient.cpf) : '—'}</p>
                    <p><span className="text-muted-foreground">Nascimento:</span> {patient.birthDate ? formatDate(patient.birthDate) : '—'}</p>
                    <p><span className="text-muted-foreground">Cadastrado em:</span> {patient.createdAt ? formatDate(patient.createdAt.split('T')[0]) : '—'}</p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">Convênio</CardTitle></CardHeader>
                <CardContent className="text-sm space-y-2">
                  <p className="font-medium">{patient.healthInsurance || "Particular"}</p>
                  {patient.healthInsuranceNumber && <p className="text-muted-foreground text-xs">Carteirinha: {patient.healthInsuranceNumber}</p>}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">Linha do Tempo</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    <span>Integração com agenda em desenvolvimento</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        <TabsContent value="clinical" className="mt-4">
          {editing ? (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Informações Clínicas</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs">Alergias</Label>
                  <Input placeholder="Ex: Dipirona, Penicilina" value={editData.allergies || ""} onChange={(e) => setEditData({ ...editData, allergies: e.target.value })} maxLength={500} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Alertas Clínicos</Label>
                  <Input placeholder="Ex: Diabético, Hipertenso" value={editData.clinicalAlerts || ""} onChange={(e) => setEditData({ ...editData, clinicalAlerts: e.target.value })} maxLength={500} />
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Informações Clínicas</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Alergias</p>
                  {patient.allergies ? (
                    <div className="flex items-center gap-1">
                      <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                      <span className="text-destructive font-medium">{patient.allergies}</span>
                    </div>
                  ) : (
                    <p className="text-muted-foreground">Nenhuma alergia registrada</p>
                  )}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Alertas Clínicos</p>
                  {patient.clinicalAlerts ? (
                    <span className="text-destructive font-medium">{patient.clinicalAlerts}</span>
                  ) : (
                    <p className="text-muted-foreground">Nenhum alerta clínico</p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
