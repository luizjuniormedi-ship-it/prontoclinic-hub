import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ClipboardList, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExamRequestForm } from "@/components/exams/m22/ExamRequestForm";
import { ExamRequestStatusBadge } from "@/components/exams/m22/ExamRequestStatusBadge";
import { ExamRequestWorkflow } from "@/components/exams/m22/ExamRequestWorkflow";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { clinicalPermissionsFor } from "@/config/clinicalModulePermissions";
import { examRequestService } from "@/services/examRequestService";
import type {
  CreateExamRequestInput,
  DispatchExamRequestItemInput,
  ExamRequestStatus,
  TransitionExamRequestItemInput,
} from "@/types/examRequests";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

function isValidUnitId(value: number | null): value is number {
  return Number.isSafeInteger(value) && value > 0;
}

export default function ExamRequestsPage() {
  const [status, setStatus] = useState<ExamRequestStatus | "">("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user, companyId, activeUnitId } = useAuth();
  const permissions = clinicalPermissionsFor(user?.role_name).m22;
  const contextualUnitId = isValidUnitId(activeUnitId) ? activeUnitId : null;
  const hasContext = Boolean(companyId?.trim()) && contextualUnitId !== null;

  const query = useQuery({
    queryKey: ["m22-exam-requests", companyId, contextualUnitId, status],
    queryFn: () => examRequestService.list({ unitId: contextualUnitId ?? undefined, status: status || undefined }),
    enabled: hasContext,
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["m22-exam-requests"] });
  };

  const create = useMutation({
    mutationFn: (input: CreateExamRequestInput) => {
      if (contextualUnitId === null) throw new Error("Contexto de unidade indisponível");
      return examRequestService.create({ ...input, unitId: contextualUnitId });
    },
    onSuccess: async (request) => {
      setSelectedId(request.id);
      await invalidate();
      toast({ title: "Requisição criada como rascunho" });
    },
    onError: (error: Error) => toast({
      title: "Não foi possível criar a requisição",
      description: error.message,
      variant: "destructive",
    }),
  });

  const sign = useMutation({
    mutationFn: (requestId: string) => examRequestService.sign(requestId),
    onSuccess: async () => {
      await invalidate();
      toast({ title: "Requisição assinada" });
    },
    onError: (error: Error) => toast({
      title: "Assinatura rejeitada",
      description: error.message,
      variant: "destructive",
    }),
  });

  const cancel = useMutation({
    mutationFn: ({ requestId, reason }: { requestId: string; reason: string }) => (
      examRequestService.cancel(requestId, reason)
    ),
    onSuccess: async () => {
      await invalidate();
      toast({ title: "Requisição cancelada" });
    },
    onError: (error: Error) => toast({
      title: "Cancelamento rejeitado",
      description: error.message,
      variant: "destructive",
    }),
  });

  const dispatch = useMutation({
    mutationFn: (input: DispatchExamRequestItemInput) => examRequestService.dispatch(input),
    onSuccess: async () => {
      await invalidate();
      toast({ title: "Item despachado para o executor" });
    },
    onError: (error: Error) => toast({
      title: "Despacho rejeitado",
      description: error.message,
      variant: "destructive",
    }),
  });

  const transition = useMutation({
    mutationFn: (input: TransitionExamRequestItemInput) => examRequestService.transition(input),
    onSuccess: async () => {
      await invalidate();
      toast({ title: "Status do item atualizado" });
    },
    onError: (error: Error) => toast({
      title: "Transição rejeitada",
      description: error.message,
      variant: "destructive",
    }),
  });

  const rows = useMemo(() => query.data ?? [], [query.data]);
  const selected = rows.find(({ id }) => id === selectedId) ?? null;
  const isWorking = sign.isPending || cancel.isPending || dispatch.isPending || transition.isPending;

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ClipboardList className="h-6 w-6" />
            Solicitação de exames
          </h1>
          <p className="text-muted-foreground">
            Requisições clínicas integradas aos executores LIS, DICOM e especialidades.
          </p>
        </div>
        <Button variant="outline" size="icon" title="Atualizar" onClick={() => void query.refetch()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {!hasContext && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Contexto de acesso indisponível</AlertTitle>
          <AlertDescription>Selecione uma empresa e uma unidade válidas para acessar solicitações de exames.</AlertDescription>
        </Alert>
      )}

      {hasContext && contextualUnitId !== null && permissions.canCreate && (
        <Card>
          <CardHeader>
            <CardTitle>Nova requisição</CardTitle>
          </CardHeader>
          <CardContent>
            <ExamRequestForm
              unitId={contextualUnitId}
              isSubmitting={create.isPending}
              onSubmit={(input) => create.mutate(input)}
            />
          </CardContent>
        </Card>
      )}

      {hasContext && <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="m22-status-filter" className="text-sm font-medium">Status</label>
        <select
          id="m22-status-filter"
          className="h-10 rounded-md border bg-background px-3 text-sm"
          value={status}
          onChange={(event) => setStatus(event.target.value as ExamRequestStatus | "")}
        >
          <option value="">Todos</option>
          <option value="DRAFT">Rascunho</option>
          <option value="SIGNED">Assinada</option>
          <option value="PARTIALLY_DISPATCHED">Despacho parcial</option>
          <option value="DISPATCHED">Despachada</option>
          <option value="COMPLETED">Concluída</option>
          <option value="CANCELLED">Cancelada</option>
        </select>
      </div>}

      {hasContext && <Card>
        <CardHeader>
          <CardTitle>Requisições ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {query.isLoading ? (
            <p className="p-6 text-center">Carregando...</p>
          ) : query.isError ? (
            <p className="p-6 text-center text-destructive">{(query.error as Error).message}</p>
          ) : rows.length === 0 ? (
            <p className="p-6 text-center text-muted-foreground">Nenhuma requisição encontrada.</p>
          ) : rows.map((request) => (
            <button
              key={request.id}
              type="button"
              className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-muted/50"
              onClick={() => setSelectedId(request.id)}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{request.clinical_indication}</span>
                <span className="block text-sm text-muted-foreground">
                  Paciente #{request.patient_id} · Unidade #{request.unit_id} · {request.priority}
                </span>
              </span>
              <ExamRequestStatusBadge status={request.status} />
            </button>
          ))}
        </CardContent>
      </Card>}

      {hasContext && selected && (
        <Card>
          <CardContent className="p-5">
            <ExamRequestWorkflow
              request={selected}
              isWorking={isWorking}
              onSign={(requestId) => sign.mutate(requestId)}
              onCancel={(requestId, reason) => cancel.mutate({ requestId, reason })}
              onDispatch={(input) => dispatch.mutate(input)}
              onTransition={(input) => transition.mutate(input)}
              canSign={permissions.canSign}
              canCancel={permissions.canCancel}
              canDispatch={permissions.canDispatch}
              canTransition={permissions.canTransition}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
