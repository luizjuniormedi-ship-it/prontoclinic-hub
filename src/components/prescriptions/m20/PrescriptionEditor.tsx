import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CirclePause,
  FileClock,
  FileSignature,
  Pill,
  Plus,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { electronicPrescriptionService } from "@/services/electronicPrescriptionService";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import type {
  ElectronicPrescription,
  ElectronicPrescriptionItemInput,
  PharmaceuticalReviewStatus,
  PrescriptionItemType,
} from "@/types/electronicPrescriptions";
import { PrescriptionStatusBadge } from "./PrescriptionStatusBadge";

interface PrescriptionEditorProps {
  prescription: ElectronicPrescription;
  onChanged: (prescription: ElectronicPrescription) => void;
  canManage: boolean;
  canReview: boolean;
}

const EMPTY_ITEM: ElectronicPrescriptionItemInput = {
  itemType: "medication",
  medicationName: "",
  activeIngredient: "",
  dose: null,
  doseUnit: "",
  route: "",
  frequencyText: "",
  durationDays: null,
  instructions: "",
};

export function PrescriptionEditor({
  prescription,
  onChanged,
  canManage,
  canReview,
}: PrescriptionEditorProps) {
  const [item, setItem] = useState<ElectronicPrescriptionItemInput>(EMPTY_ITEM);
  const [reviewStatus, setReviewStatus] = useState<PharmaceuticalReviewStatus>("approved");
  const [reviewNotes, setReviewNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const openCriticalEvents = useMemo(() => {
    const resolved = new Set(
      prescription.safety_events
        .filter((event) => event.related_event_id && ["overridden", "resolved"].includes(event.event_type))
        .map((event) => event.related_event_id),
    );
    return prescription.safety_events.filter(
      (event) => event.event_type === "detected" && event.severity === "critical" && !resolved.has(event.id),
    );
  }, [prescription.safety_events]);

  const reload = async () => {
    const updated = await electronicPrescriptionService.getById(prescription.id);
    if (updated) onChanged(updated);
  };

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      await reload();
      toast({ title: success });
    } catch (error) {
      toast({
        title: "Operação não concluída",
        description: (error as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const saveItem = () => run(async () => {
    await electronicPrescriptionService.upsertItem(prescription.id, item);
    setItem(EMPTY_ITEM);
  }, "Item incluído");

  const transitionWithReason = (
    target: "suspended" | "cancelled" | "completed" | "expired",
    label: string,
  ) => {
    const reason = window.prompt(`Motivo para ${label.toLowerCase()}:`)?.trim();
    if ((target === "suspended" || target === "cancelled") && !reason) return;
    run(
      () => electronicPrescriptionService.transition(prescription.id, target, reason ?? null),
      `Prescrição ${label.toLowerCase()}`,
    );
  };

  const canEditItems = canManage
    && (prescription.status === "draft" || prescription.status === "validated");
  const canValidate = canManage
    && (prescription.status === "draft" || prescription.status === "validated");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <PrescriptionStatusBadge status={prescription.status} />
            <span className="text-xs text-muted-foreground">v{prescription.current_version}</span>
          </div>
          <p className="text-sm font-medium">Paciente #{prescription.patient_id}</p>
          <p className="text-xs text-muted-foreground">
            Unidade #{prescription.unit_id} · Prescritor #{prescription.prescriber_id}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canValidate && (
            <Button
              variant="outline"
              disabled={busy || prescription.items.length === 0}
              onClick={() => run(
                () => electronicPrescriptionService.validate(prescription.id),
                "Validação clínica concluída",
              )}
            >
              <ShieldAlert />Validar
            </Button>
          )}
          {canManage && prescription.status === "validated" && (
            <Button
              disabled={busy || openCriticalEvents.length > 0}
              onClick={() => run(
                () => electronicPrescriptionService.sign(prescription.id),
                "Prescrição assinada no servidor",
              )}
            >
              <FileSignature />Assinar
            </Button>
          )}
          {canManage && (prescription.status === "signed" || prescription.status === "suspended") && (
            <Button
              disabled={busy}
              onClick={() => run(
                () => electronicPrescriptionService.transition(prescription.id, "active"),
                "Prescrição ativada",
              )}
            >
              <CheckCircle2 />Ativar
            </Button>
          )}
          {canManage && prescription.status === "active" && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => transitionWithReason("suspended", "Suspensa")}
            >
              <CirclePause />Suspender
            </Button>
          )}
          {canManage && ["draft", "validated", "signed", "active", "suspended"].includes(prescription.status) && (
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => transitionWithReason("cancelled", "Cancelada")}
            >
              Cancelar
            </Button>
          )}
          {canManage && ["active", "suspended"].includes(prescription.status) && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => transitionWithReason("completed", "Concluída")}
            >
              Concluir
            </Button>
          )}
          {canManage && ["signed", "active", "suspended"].includes(prescription.status) && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => transitionWithReason("expired", "Expirada")}
            >
              Expirar
            </Button>
          )}
        </div>
      </div>

      {prescription.clinical_indication && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">Indicação clínica</p>
          <p className="text-sm">{prescription.clinical_indication}</p>
        </div>
      )}

      {prescription.signature_hash && (
        <Alert>
          <FileSignature className="h-4 w-4" />
          <AlertTitle>Atestação do servidor</AlertTitle>
          <AlertDescription className="break-all font-mono text-xs">
            {prescription.signature_hash}
          </AlertDescription>
        </Alert>
      )}

      <section aria-labelledby="m20-items-title" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 id="m20-items-title" className="text-base font-semibold">Itens</h2>
          <Badge variant="secondary">{prescription.items.length}</Badge>
        </div>
        {prescription.items.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Esquema</TableHead>
                <TableHead>Duração</TableHead>
                <TableHead className="w-12"><span className="sr-only">Ações</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {prescription.items.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>
                    <p className="font-medium">{entry.medication_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {entry.active_ingredient || entry.item_type}
                    </p>
                  </TableCell>
                  <TableCell>
                    {entry.item_type === "medication"
                      ? `${entry.dose} ${entry.dose_unit} · ${entry.route} · ${entry.frequency_text}`
                      : entry.instructions || "Sem instrução adicional"}
                  </TableCell>
                  <TableCell>{entry.duration_days ? `${entry.duration_days} dias` : "Conforme plano"}</TableCell>
                  <TableCell>
                    {canEditItems && (
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Remover item"
                        disabled={busy}
                        onClick={() => run(
                          () => electronicPrescriptionService.removeItem(prescription.id, entry.id),
                          "Item removido",
                        )}
                      >
                        <Trash2 />
                        <span className="sr-only">Remover item</span>
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {canEditItems && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm"><Pill />Novo item</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1">
                <Label>Tipo</Label>
                <Select
                  value={item.itemType}
                  onValueChange={(value) => setItem({ ...item, itemType: value as PrescriptionItemType })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="medication">Medicamento</SelectItem>
                    <SelectItem value="diet">Dieta</SelectItem>
                    <SelectItem value="care">Cuidado</SelectItem>
                    <SelectItem value="procedure">Procedimento</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="m20-item-name">Descrição</Label>
                <Input
                  id="m20-item-name"
                  value={item.medicationName}
                  onChange={(event) => setItem({ ...item, medicationName: event.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="m20-active-ingredient">Princípio ativo</Label>
                <Input
                  id="m20-active-ingredient"
                  value={item.activeIngredient ?? ""}
                  onChange={(event) => setItem({ ...item, activeIngredient: event.target.value })}
                />
              </div>
              {item.itemType === "medication" && (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="m20-dose">Dose</Label>
                    <Input
                      id="m20-dose"
                      type="number"
                      min="0"
                      step="0.0001"
                      value={item.dose ?? ""}
                      onChange={(event) => setItem({
                        ...item,
                        dose: event.target.value ? Number(event.target.value) : null,
                      })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="m20-dose-unit">Unidade</Label>
                    <Input
                      id="m20-dose-unit"
                      placeholder="mg, mL, UI"
                      value={item.doseUnit ?? ""}
                      onChange={(event) => setItem({ ...item, doseUnit: event.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="m20-route">Via</Label>
                    <Input
                      id="m20-route"
                      placeholder="Oral"
                      value={item.route ?? ""}
                      onChange={(event) => setItem({ ...item, route: event.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="m20-frequency">Frequência</Label>
                    <Input
                      id="m20-frequency"
                      placeholder="8/8 horas"
                      value={item.frequencyText ?? ""}
                      onChange={(event) => setItem({ ...item, frequencyText: event.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="m20-duration">Duração em dias</Label>
                    <Input
                      id="m20-duration"
                      type="number"
                      min="1"
                      value={item.durationDays ?? ""}
                      onChange={(event) => setItem({
                        ...item,
                        durationDays: event.target.value ? Number(event.target.value) : null,
                      })}
                    />
                  </div>
                </>
              )}
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="m20-instructions">Instruções</Label>
                <Input
                  id="m20-instructions"
                  value={item.instructions ?? ""}
                  onChange={(event) => setItem({ ...item, instructions: event.target.value })}
                />
              </div>
              <div className="flex items-end justify-end sm:col-span-2 lg:col-span-4">
                <Button disabled={busy} onClick={saveItem}><Plus />Adicionar</Button>
              </div>
            </CardContent>
          </Card>
        )}
      </section>

      <section aria-labelledby="m20-safety-title" className="space-y-3 border-t pt-4">
        <h2 id="m20-safety-title" className="text-base font-semibold">Segurança clínica</h2>
        {prescription.safety_events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum evento registrado.</p>
        ) : prescription.safety_events.map((event) => (
          <Alert key={event.id} variant={event.severity === "critical" ? "destructive" : "default"}>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{event.title}</AlertTitle>
            <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span>{event.rule_code} · {event.severity}</span>
              {event.event_type === "detected" && !prescription.safety_events.some(
                (resolution) => resolution.related_event_id === event.id
                  && ["overridden", "resolved"].includes(resolution.event_type),
              ) && canEditItems && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    const reason = window.prompt("Justificativa clínica:")?.trim();
                    if (!reason) return;
                    run(
                      () => electronicPrescriptionService.resolveSafetyEvent(event.id, "overridden", reason),
                      "Alerta tratado",
                    );
                  }}
                >
                  Registrar override
                </Button>
              )}
            </AlertDescription>
          </Alert>
        ))}
      </section>

      <section aria-labelledby="m20-review-title" className="space-y-3 border-t pt-4">
        <h2 id="m20-review-title" className="text-base font-semibold">Revisão farmacêutica</h2>
        {canReview && (
          <div className="grid gap-3 sm:grid-cols-[220px_1fr_auto]">
            <Select value={reviewStatus} onValueChange={(value) => setReviewStatus(value as PharmaceuticalReviewStatus)}>
              <SelectTrigger aria-label="Resultado da revisão"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="approved">Aprovada</SelectItem>
                <SelectItem value="changes_requested">Solicitar alteração</SelectItem>
                <SelectItem value="rejected">Rejeitada</SelectItem>
              </SelectContent>
            </Select>
            <Input
              aria-label="Parecer farmacêutico"
              placeholder="Parecer"
              value={reviewNotes}
              onChange={(event) => setReviewNotes(event.target.value)}
            />
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => run(async () => {
                await electronicPrescriptionService.recordPharmaceuticalReview({
                  prescriptionId: prescription.id,
                  reviewStatus,
                  notes: reviewNotes,
                });
                setReviewNotes("");
              }, "Revisão registrada")}
            >
              Registrar
            </Button>
          </div>
        )}
        {prescription.pharmaceutical_reviews.map((review) => (
          <div key={review.id} className="flex items-start justify-between gap-3 border-t py-2 text-sm">
            <div>
              <p className="font-medium">{review.review_status}</p>
              {review.notes && <p className="text-muted-foreground">{review.notes}</p>}
            </div>
            <time className="text-xs text-muted-foreground">{new Date(review.created_at).toLocaleString("pt-BR")}</time>
          </div>
        ))}
      </section>

      <section aria-labelledby="m20-history-title" className="space-y-2 border-t pt-4">
        <h2 id="m20-history-title" className="flex items-center gap-2 text-base font-semibold">
          <FileClock />Histórico imutável
        </h2>
        {prescription.versions.map((version) => (
          <div key={version.id} className="flex items-center justify-between gap-3 border-b py-2 text-sm">
            <span>v{version.version_number} · {version.action}</span>
            <time className="text-xs text-muted-foreground">{new Date(version.created_at).toLocaleString("pt-BR")}</time>
          </div>
        ))}
      </section>
    </div>
  );
}
