import { useState } from "react";
import { Ban, Send, Signature } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ExamRequestStatusBadge } from "./ExamRequestStatusBadge";
import type {
  DispatchExamRequestItemInput,
  ExamExecutorKind,
  ExamRequest,
  ExamRequestItem,
  ExamRequestItemStatus,
  TransitionExamRequestItemInput,
} from "@/types/examRequests";

interface DispatchDraft {
  executorKind: ExamExecutorKind;
  labOrderId: string;
  labOrderItemId: string;
  imagingOrderId: string;
  imagingOrderItemId: string;
}

function defaultExecutor(item: ExamRequestItem): ExamExecutorKind {
  if (item.domain === "LABORATORY") return "LIS";
  if (item.domain === "IMAGING") return "DICOM";
  return "SPECIALTY";
}

function defaultDispatchDraft(item: ExamRequestItem): DispatchDraft {
  return {
    executorKind: defaultExecutor(item),
    labOrderId: "",
    labOrderItemId: "",
    imagingOrderId: "",
    imagingOrderItemId: "",
  };
}

const transitionOptions: Partial<Record<ExamRequestItemStatus, ExamRequestItemStatus[]>> = {
  AUTHORIZATION_PENDING: ["READY", "CANCELLED"],
  READY: ["CANCELLED"],
  DISPATCHED: ["IN_PROGRESS", "COMPLETED", "FAILED", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "FAILED", "CANCELLED"],
  FAILED: ["READY", "CANCELLED"],
};

const DISPATCHABLE_REQUEST_STATUSES = new Set([
  "SIGNED",
  "PARTIALLY_DISPATCHED",
  "DISPATCHED",
]);

export function ExamRequestWorkflow({
  request,
  isWorking,
  onSign,
  onCancel,
  onDispatch,
  onTransition,
  canSign,
  canCancel,
  canDispatch,
  canTransition,
}: {
  request: ExamRequest;
  isWorking: boolean;
  onSign: (requestId: string) => Promise<void> | void;
  onCancel: (requestId: string, reason: string) => Promise<void> | void;
  onDispatch: (input: DispatchExamRequestItemInput) => Promise<void> | void;
  onTransition: (input: TransitionExamRequestItemInput) => Promise<void> | void;
  canSign: boolean;
  canCancel: boolean;
  canDispatch: boolean;
  canTransition: boolean;
}) {
  const [cancelReason, setCancelReason] = useState("");
  const [dispatchDrafts, setDispatchDrafts] = useState<Record<string, DispatchDraft>>({});
  const [transitionReasons, setTransitionReasons] = useState<Record<string, string>>({});
  const items = request.exam_request_items ?? [];

  const updateDispatch = (item: ExamRequestItem, patch: Partial<DispatchDraft>) => {
    setDispatchDrafts((current) => ({
      ...current,
      [item.id]: {
        ...(current[item.id] ?? defaultDispatchDraft(item)),
        ...patch,
      },
    }));
  };

  const dispatch = (item: ExamRequestItem) => {
    const draft = dispatchDrafts[item.id] ?? defaultDispatchDraft(item);
    void onDispatch({
      requestItemId: item.id,
      executorKind: draft.executorKind,
      labOrderId: Number(draft.labOrderId) || null,
      labOrderItemId: Number(draft.labOrderItemId) || null,
      imagingOrderId: draft.imagingOrderId.trim() || null,
      imagingOrderItemId: draft.imagingOrderItemId.trim() || null,
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <h2 className="text-lg font-semibold">Requisição {request.id.slice(0, 8)}</h2>
            <ExamRequestStatusBadge status={request.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            Paciente #{request.patient_id} · Unidade #{request.unit_id} · {request.clinical_indication}
          </p>
        </div>
        {canSign && request.status === "DRAFT" && (
          <Button disabled={isWorking} onClick={() => void onSign(request.id)}>
            <Signature className="h-4 w-4" />
            Assinar
          </Button>
        )}
      </div>

      {canCancel && request.status !== "COMPLETED" && request.status !== "CANCELLED" && (
        <div className="flex flex-wrap items-end gap-2 border-y py-3">
          <div className="min-w-64 flex-1 space-y-1">
            <Label htmlFor={`m22-cancel-${request.id}`}>Motivo do cancelamento</Label>
            <Input
              id={`m22-cancel-${request.id}`}
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
            />
          </div>
          <Button
            variant="destructive"
            disabled={isWorking || !cancelReason.trim()}
            onClick={() => void onCancel(request.id, cancelReason)}
          >
            <Ban className="h-4 w-4" />
            Cancelar requisição
          </Button>
        </div>
      )}

      <div className="space-y-4">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum item carregado.</p>
        ) : items.map((item) => {
          const draft = dispatchDrafts[item.id] ?? defaultDispatchDraft(item);
          const availableTransitions = transitionOptions[item.status] ?? [];
          return (
            <section key={item.id} className="space-y-3 border-t pt-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{item.description}</p>
                  <p className="text-sm text-muted-foreground">
                    {item.domain} · {item.code_system} {item.catalog_code || "sem código"}
                  </p>
                </div>
                <ExamRequestStatusBadge status={item.status} />
              </div>

              {canDispatch
                && DISPATCHABLE_REQUEST_STATUSES.has(request.status)
                && (item.status === "READY" || item.status === "FAILED") && (
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
                  <div className="space-y-1">
                    <Label htmlFor={`m22-executor-${item.id}`}>Executor</Label>
                    <select
                      id={`m22-executor-${item.id}`}
                      className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                      value={draft.executorKind}
                      onChange={(event) => updateDispatch(item, {
                        executorKind: event.target.value as ExamExecutorKind,
                      })}
                    >
                      {item.domain === "LABORATORY" && <option value="LIS">LIS</option>}
                      {(item.domain === "IMAGING" || item.domain === "CARDIOLOGY") && (
                        <option value="DICOM">DICOM</option>
                      )}
                      {(item.domain === "CARDIOLOGY"
                        || item.domain === "ENDOSCOPY"
                        || item.domain === "PATHOLOGY") && (
                        <option value="SPECIALTY">Especialidade</option>
                      )}
                    </select>
                  </div>
                  {draft.executorKind === "LIS" && (
                    <>
                      <div className="space-y-1">
                        <Label htmlFor={`m22-lab-order-${item.id}`}>Pedido LIS</Label>
                        <Input
                          id={`m22-lab-order-${item.id}`}
                          type="number"
                          min="1"
                          value={draft.labOrderId}
                          onChange={(event) => updateDispatch(item, { labOrderId: event.target.value })}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`m22-lab-item-${item.id}`}>Item LIS</Label>
                        <Input
                          id={`m22-lab-item-${item.id}`}
                          type="number"
                          min="1"
                          value={draft.labOrderItemId}
                          onChange={(event) => updateDispatch(item, { labOrderItemId: event.target.value })}
                        />
                      </div>
                    </>
                  )}
                  {draft.executorKind === "DICOM" && (
                    <>
                      <div className="space-y-1">
                        <Label htmlFor={`m22-dicom-order-${item.id}`}>Pedido DICOM UUID</Label>
                        <Input
                          id={`m22-dicom-order-${item.id}`}
                          value={draft.imagingOrderId}
                          onChange={(event) => updateDispatch(item, { imagingOrderId: event.target.value })}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`m22-dicom-item-${item.id}`}>Item DICOM UUID</Label>
                        <Input
                          id={`m22-dicom-item-${item.id}`}
                          value={draft.imagingOrderItemId}
                          onChange={(event) => updateDispatch(item, {
                            imagingOrderItemId: event.target.value,
                          })}
                        />
                      </div>
                    </>
                  )}
                  <div className="flex items-end">
                    <Button
                      className="w-full"
                      disabled={isWorking}
                      onClick={() => dispatch(item)}
                    >
                      <Send className="h-4 w-4" />
                      Despachar
                    </Button>
                  </div>
                </div>
              )}

              {canTransition && availableTransitions.length > 0 && (
                <form
                  className="flex flex-wrap items-end gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    void onTransition({
                      requestItemId: item.id,
                      toStatus: String(form.get("status")) as ExamRequestItemStatus,
                      reason: transitionReasons[item.id] || null,
                    });
                  }}
                >
                  <div className="space-y-1">
                    <Label htmlFor={`m22-transition-${item.id}`}>Próximo status</Label>
                    <select
                      id={`m22-transition-${item.id}`}
                      name="status"
                      className="h-10 rounded-md border bg-background px-3 text-sm"
                    >
                      {availableTransitions.map((status) => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
                  </div>
                  <div className="min-w-64 flex-1 space-y-1">
                    <Label htmlFor={`m22-transition-reason-${item.id}`}>Motivo, quando exigido</Label>
                    <Input
                      id={`m22-transition-reason-${item.id}`}
                      value={transitionReasons[item.id] ?? ""}
                      onChange={(event) => setTransitionReasons((current) => ({
                        ...current,
                        [item.id]: event.target.value,
                      }))}
                    />
                  </div>
                  <Button type="submit" variant="outline" disabled={isWorking}>
                    Atualizar item
                  </Button>
                </form>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
