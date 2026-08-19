import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  EXAM_DOMAINS,
  type CreateExamRequestInput,
  type CreateExamRequestItemInput,
  type ExamCodeSystem,
  type ExamDomain,
  type ExamRequestPriority,
} from "@/types/examRequests";

interface DraftItem extends CreateExamRequestItemInput {
  key: string;
}

const domainLabels: Record<ExamDomain, string> = {
  LABORATORY: "Laboratório",
  IMAGING: "Imagem",
  CARDIOLOGY: "Cardiologia",
  ENDOSCOPY: "Endoscopia",
  PATHOLOGY: "Anatomia patológica",
};

function newDraftItem(): DraftItem {
  return {
    key: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    domain: "LABORATORY",
    codeSystem: "LOCAL",
    description: "",
    quantity: 1,
    preparationRequired: false,
    authorizationRequired: false,
    details: {},
  };
}

function numberOrNull(value: FormDataEntryValue | null): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `m22-${Date.now()}-${Math.random()}`;
}

export function ExamRequestForm({
  unitId,
  isSubmitting,
  onSubmit,
}: {
  unitId: number;
  isSubmitting: boolean;
  onSubmit: (input: CreateExamRequestInput) => Promise<void> | void;
}) {
  const [items, setItems] = useState<DraftItem[]>([newDraftItem()]);
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);

  const updateItem = (key: string, patch: Partial<DraftItem>) => {
    setItems((current) => current.map((item) => (
      item.key === key ? { ...item, ...patch } : item
    )));
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const patientId = numberOrNull(form.get("patient_id"));
    const requesterProfessionalId = numberOrNull(form.get("requester_professional_id"));
    if (!patientId || !requesterProfessionalId) return;

    try {
      await onSubmit({
        unitId,
        patientId,
        encounterId: String(form.get("encounter_id") || "").trim() || null,
        appointmentId: numberOrNull(form.get("appointment_id")),
        requesterProfessionalId,
        clinicalIndication: String(form.get("clinical_indication") || ""),
        diagnosisCode: String(form.get("diagnosis_code") || "").trim() || null,
        priority: String(form.get("priority") || "ROUTINE") as ExamRequestPriority,
        idempotencyKey,
        items: items.map(({ key: _key, ...item }) => item),
      });
    } catch {
      return;
    }
    formElement.reset();
    setItems([newDraftItem()]);
    setIdempotencyKey(newIdempotencyKey());
  };

  return (
    <form className="space-y-5" onSubmit={submit}>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="m22-patient">Paciente ID</Label>
          <Input id="m22-patient" name="patient_id" type="number" min="1" required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="m22-requester">Profissional solicitante ID</Label>
          <Input id="m22-requester" name="requester_professional_id" type="number" min="1" required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="m22-appointment">Agendamento ID</Label>
          <Input id="m22-appointment" name="appointment_id" type="number" min="1" />
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label htmlFor="m22-encounter">Atendimento UUID</Label>
          <Input id="m22-encounter" name="encounter_id" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="m22-cid">CID</Label>
          <Input id="m22-cid" name="diagnosis_code" maxLength={20} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="m22-priority">Prioridade</Label>
          <select
            id="m22-priority"
            name="priority"
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            defaultValue="ROUTINE"
          >
            <option value="ROUTINE">Rotina</option>
            <option value="URGENT">Urgente</option>
            <option value="EMERGENCY">Emergência</option>
          </select>
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="m22-indication">Indicação clínica</Label>
        <Textarea id="m22-indication" name="clinical_indication" required />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold">Itens solicitados</h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setItems((current) => [...current, newDraftItem()])}
          >
            <Plus className="h-4 w-4" />
            Adicionar item
          </Button>
        </div>

        {items.map((item, index) => (
          <div key={item.key} className="grid gap-3 border-t pt-4 md:grid-cols-2 lg:grid-cols-6">
            <div className="space-y-1">
              <Label htmlFor={`m22-domain-${item.key}`}>Domínio</Label>
              <select
                id={`m22-domain-${item.key}`}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={item.domain}
                onChange={(event) => updateItem(item.key, {
                  domain: event.target.value as ExamDomain,
                })}
              >
                {EXAM_DOMAINS.map((domain) => (
                  <option key={domain} value={domain}>{domainLabels[domain]}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`m22-system-${item.key}`}>Código</Label>
              <select
                id={`m22-system-${item.key}`}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={item.codeSystem}
                onChange={(event) => updateItem(item.key, {
                  codeSystem: event.target.value as ExamCodeSystem,
                })}
              >
                <option value="LOCAL">Local</option>
                <option value="TUSS">TUSS</option>
                <option value="LOINC">LOINC</option>
              </select>
            </div>
            <div className="space-y-1 lg:col-span-2">
              <Label htmlFor={`m22-description-${item.key}`}>Descrição</Label>
              <Input
                id={`m22-description-${item.key}`}
                required
                value={item.description}
                onChange={(event) => updateItem(item.key, { description: event.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`m22-catalog-${item.key}`}>Código do catálogo</Label>
              <Input
                id={`m22-catalog-${item.key}`}
                value={item.catalogCode ?? ""}
                onChange={(event) => updateItem(item.key, { catalogCode: event.target.value })}
              />
            </div>
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1 space-y-1">
                <Label htmlFor={`m22-quantity-${item.key}`}>Quantidade</Label>
                <Input
                  id={`m22-quantity-${item.key}`}
                  type="number"
                  min="1"
                  max="99"
                  value={item.quantity ?? 1}
                  onChange={(event) => updateItem(item.key, {
                    quantity: Number(event.target.value),
                  })}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                title={`Remover item ${index + 1}`}
                disabled={items.length === 1}
                onClick={() => setItems((current) => current.filter(({ key }) => key !== item.key))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <label className="flex min-h-10 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={item.preparationRequired ?? false}
                onChange={(event) => updateItem(item.key, {
                  preparationRequired: event.target.checked,
                })}
              />
              Exige preparo
            </label>
            <div className="space-y-1 lg:col-span-2">
              <Label htmlFor={`m22-preparation-${item.key}`}>Instruções de preparo</Label>
              <Input
                id={`m22-preparation-${item.key}`}
                required={item.preparationRequired}
                value={item.preparationInstructions ?? ""}
                onChange={(event) => updateItem(item.key, {
                  preparationInstructions: event.target.value,
                })}
              />
            </div>
            <label className="flex min-h-10 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={item.authorizationRequired ?? false}
                onChange={(event) => updateItem(item.key, {
                  authorizationRequired: event.target.checked,
                })}
              />
              Exige autorização
            </label>
            <div className="space-y-1">
              <Label htmlFor={`m22-authorization-${item.key}`}>Autorização UUID</Label>
              <Input
                id={`m22-authorization-${item.key}`}
                value={item.authorizationId ?? ""}
                onChange={(event) => updateItem(item.key, {
                  authorizationId: event.target.value,
                })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`m22-tiss-${item.key}`}>Guia TISS UUID</Label>
              <Input
                id={`m22-tiss-${item.key}`}
                value={item.tissGuideId ?? ""}
                onChange={(event) => updateItem(item.key, {
                  tissGuideId: event.target.value,
                })}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Criando..." : "Criar requisição"}
        </Button>
      </div>
    </form>
  );
}
