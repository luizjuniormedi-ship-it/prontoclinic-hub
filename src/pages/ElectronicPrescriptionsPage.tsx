import { useState } from "react";
import { FilePlus2, Search } from "lucide-react";
import { PrescriptionEditor, PrescriptionStatusBadge } from "@/components/prescriptions/m20";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { clinicalPermissionsFor } from "@/config/clinicalModulePermissions";
import { electronicPrescriptionService } from "@/services/electronicPrescriptionService";
import type { ElectronicPrescription } from "@/types/electronicPrescriptions";

interface DraftForm {
  patientId: string;
  unitId: string;
  prescriberId: string;
  encounterId: string;
  medicalRecordId: string;
  clinicalIndication: string;
  notes: string;
}

const EMPTY_DRAFT: DraftForm = {
  patientId: "",
  unitId: "",
  prescriberId: "",
  encounterId: "",
  medicalRecordId: "",
  clinicalIndication: "",
  notes: "",
};

export default function ElectronicPrescriptionsPage() {
  const [patientSearch, setPatientSearch] = useState("");
  const [prescriptions, setPrescriptions] = useState<ElectronicPrescription[]>([]);
  const [selected, setSelected] = useState<ElectronicPrescription | null>(null);
  const [draft, setDraft] = useState<DraftForm>(EMPTY_DRAFT);
  const [showDraft, setShowDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();
  const permissions = clinicalPermissionsFor(user?.role_name).m20;

  const search = async (patientIdValue = patientSearch) => {
    const patientId = Number(patientIdValue);
    if (!Number.isInteger(patientId) || patientId <= 0) {
      toast({ title: "Paciente inválido", description: "Informe o identificador do paciente.", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const rows = await electronicPrescriptionService.list({ patientId });
      setPrescriptions(rows);
      if (selected) {
        setSelected(rows.find((row) => row.id === selected.id) ?? null);
      }
    } catch (error) {
      toast({ title: "Não foi possível consultar", description: (error as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const createDraft = async () => {
    setBusy(true);
    try {
      const created = await electronicPrescriptionService.create({
        patientId: Number(draft.patientId),
        unitId: Number(draft.unitId),
        prescriberId: Number(draft.prescriberId),
        encounterId: draft.encounterId || null,
        medicalRecordId: draft.medicalRecordId ? Number(draft.medicalRecordId) : null,
        clinicalIndication: draft.clinicalIndication,
        notes: draft.notes,
      });
      setPatientSearch(String(created.patient_id));
      setDraft(EMPTY_DRAFT);
      setShowDraft(false);
      setSelected(created);
      const rows = await electronicPrescriptionService.list({ patientId: created.patient_id });
      setPrescriptions(rows);
      toast({ title: "Prescrição criada", description: "Rascunho clínico disponível para inclusão de itens." });
    } catch (error) {
      toast({ title: "Não foi possível criar", description: (error as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const handleChanged = (updated: ElectronicPrescription) => {
    setSelected(updated);
    setPrescriptions((current) => current.map((row) => row.id === updated.id ? updated : row));
  };

  if (selected) {
    return (
      <div className="space-y-6 animate-fade-in">
        <PageHeader
          title="Prescrição eletrônica"
          description={`Identificador ${selected.id}`}
          actions={<Button variant="outline" onClick={() => setSelected(null)}>Voltar</Button>}
        />
        <PrescriptionEditor
          prescription={selected}
          onChanged={handleChanged}
          canManage={permissions.canManage}
          canReview={permissions.canReview}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Prescrição eletrônica"
        description="Prescrições por paciente"
        actions={permissions.canCreate ? (
          <Button onClick={() => setShowDraft((value) => !value)}>
            <FilePlus2 />Nova prescrição
          </Button>
        ) : undefined}
      />

      {permissions.canCreate && showDraft && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Novo rascunho</CardTitle></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="m20-patient-id">Paciente</Label>
              <Input
                id="m20-patient-id"
                type="number"
                min="1"
                value={draft.patientId}
                onChange={(event) => setDraft({ ...draft, patientId: event.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="m20-unit-id">Unidade</Label>
              <Input
                id="m20-unit-id"
                type="number"
                min="1"
                value={draft.unitId}
                onChange={(event) => setDraft({ ...draft, unitId: event.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="m20-prescriber-id">Prescritor</Label>
              <Input
                id="m20-prescriber-id"
                type="number"
                min="1"
                value={draft.prescriberId}
                onChange={(event) => setDraft({ ...draft, prescriberId: event.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="m20-encounter-id">Atendimento</Label>
              <Input
                id="m20-encounter-id"
                value={draft.encounterId}
                onChange={(event) => setDraft({ ...draft, encounterId: event.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="m20-record-id">Prontuário</Label>
              <Input
                id="m20-record-id"
                type="number"
                min="1"
                value={draft.medicalRecordId}
                onChange={(event) => setDraft({ ...draft, medicalRecordId: event.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="m20-indication">Indicação clínica</Label>
              <Input
                id="m20-indication"
                value={draft.clinicalIndication}
                onChange={(event) => setDraft({ ...draft, clinicalIndication: event.target.value })}
              />
            </div>
            <div className="space-y-1 sm:col-span-2 lg:col-span-3">
              <Label htmlFor="m20-notes">Observações</Label>
              <Textarea
                id="m20-notes"
                value={draft.notes}
                onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
              />
            </div>
            <div className="flex justify-end gap-2 sm:col-span-2 lg:col-span-3">
              <Button variant="outline" disabled={busy} onClick={() => setShowDraft(false)}>Cancelar</Button>
              <Button disabled={busy} onClick={createDraft}>Criar rascunho</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex max-w-lg gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Identificador do paciente"
            className="pl-9"
            type="number"
            min="1"
            placeholder="Paciente"
            value={patientSearch}
            onChange={(event) => setPatientSearch(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") search(); }}
          />
        </div>
        <Button variant="outline" disabled={busy} onClick={() => search()}>Consultar</Button>
      </div>

      {prescriptions.length === 0 ? (
        <div className="border-t py-10 text-center text-sm text-muted-foreground">
          Nenhuma prescrição carregada.
        </div>
      ) : (
        <div className="divide-y border-y">
          {prescriptions.map((prescription) => (
            <button
              key={prescription.id}
              type="button"
              className="flex w-full items-center justify-between gap-3 px-2 py-4 text-left hover:bg-muted/50"
              onClick={() => setSelected(prescription)}
            >
              <div>
                <p className="font-medium">{prescription.clinical_indication || `Prescrição ${prescription.id.slice(0, 8)}`}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(prescription.created_at).toLocaleString("pt-BR")} · {prescription.items.length} itens
                </p>
              </div>
              <PrescriptionStatusBadge status={prescription.status} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
