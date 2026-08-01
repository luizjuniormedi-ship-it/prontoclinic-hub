import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, AlertTriangle, BookOpenCheck, ClipboardList, Play, Plus, RefreshCw, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { careProtocolService } from "@/services/careProtocolService";
import type {
  CareProtocolExecution,
  CareProtocolExecutionStep,
  ProtocolExecutionStatus,
} from "@/types/careProtocols";

const sampleContent = JSON.stringify({
  priority: "URGENT",
  steps: [
    {
      key: "avaliar-sinal",
      sequence: 1,
      title: "Avaliar sinal clínico",
      instructions: "Confirmar o sinal originado na triagem.",
      type: "OBSERVATION",
      required: true,
      assignedRole: "enfermagem",
      dueMinutes: 10,
    },
    {
      key: "acionar-equipe",
      sequence: 2,
      title: "Acionar equipe responsável",
      instructions: "Criar tarefa operacional sem prescrição automática.",
      type: "TASK",
      required: true,
      assignedRole: "medico",
      dueMinutes: 15,
    },
  ],
}, null, 2);

const executionLabels: Record<ProtocolExecutionStatus, string> = {
  PENDING: "Pendente",
  ACTIVE: "Ativo",
  PAUSED: "Pausado",
  COMPLETED: "Concluído",
  CANCELLED: "Cancelado",
};

function parseOptionalNumber(value: FormDataEntryValue | null): number | null {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error("Informe um identificador numérico válido");
  return parsed;
}

interface CareProtocolWorkspaceProps {
  canManageDefinitions: boolean;
}

export function CareProtocolWorkspace({
  canManageDefinitions,
}: CareProtocolWorkspaceProps) {
  const [definitionDialog, setDefinitionDialog] = useState(false);
  const [versionDialog, setVersionDialog] = useState(false);
  const [executionDialog, setExecutionDialog] = useState(false);
  const [selectedDefinitionId, setSelectedDefinitionId] = useState<string | null>(null);
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null);
  const [stepReason, setStepReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const definitions = useQuery({
    queryKey: ["m21-protocol-definitions"],
    queryFn: () => careProtocolService.listDefinitions(),
  });
  const versions = useQuery({
    queryKey: ["m21-protocol-versions", selectedDefinitionId],
    queryFn: () => selectedDefinitionId
      ? careProtocolService.listVersions(selectedDefinitionId)
      : Promise.resolve([]),
    enabled: !!selectedDefinitionId,
  });
  const executions = useQuery({
    queryKey: ["m21-protocol-executions"],
    queryFn: () => careProtocolService.listExecutions(),
  });
  const bundle = useQuery({
    queryKey: ["m21-protocol-execution", selectedExecutionId],
    queryFn: () => selectedExecutionId
      ? careProtocolService.getExecutionBundle(selectedExecutionId)
      : Promise.reject(new Error("Execução não selecionada")),
    enabled: !!selectedExecutionId,
  });

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["m21-protocol-definitions"] }),
      queryClient.invalidateQueries({ queryKey: ["m21-protocol-versions"] }),
      queryClient.invalidateQueries({ queryKey: ["m21-protocol-executions"] }),
      queryClient.invalidateQueries({ queryKey: ["m21-protocol-execution"] }),
    ]);
  };

  const mutationOptions = (success: string, close?: () => void) => ({
    onSuccess: async () => {
      close?.();
      setActionError(null);
      await invalidate();
      toast({ title: success });
    },
    onError: (error: Error) => {
      setActionError(error.message);
      toast({ title: "Operação rejeitada", description: error.message, variant: "destructive" as const });
    },
  });

  const createDefinition = useMutation({
    mutationFn: (input: Parameters<typeof careProtocolService.createDefinition>[0]) =>
      careProtocolService.createDefinition(input),
    ...mutationOptions("Definição criada", () => setDefinitionDialog(false)),
  });
  const publishVersion = useMutation({
    mutationFn: (input: Parameters<typeof careProtocolService.publishVersion>[0]) =>
      careProtocolService.publishVersion(input),
    ...mutationOptions("Versão imutável publicada", () => setVersionDialog(false)),
  });
  const startExecution = useMutation({
    mutationFn: (input: Parameters<typeof careProtocolService.startExecution>[0]) =>
      careProtocolService.startExecution(input),
    ...mutationOptions("Protocolo iniciado", () => setExecutionDialog(false)),
  });
  const transitionExecution = useMutation({
    mutationFn: (input: {
      execution: CareProtocolExecution;
      status: ProtocolExecutionStatus;
      reason?: string;
    }) => careProtocolService.transitionExecution(
      input.execution.id,
      input.execution.status,
      input.status,
      input.reason,
    ),
    ...mutationOptions("Estado da execução atualizado"),
  });
  const transitionStep = useMutation({
    mutationFn: (input: {
      step: CareProtocolExecutionStep;
      status: CareProtocolExecutionStep["status"];
      reason?: string;
    }) => careProtocolService.transitionStep(input.step.id, input.step.status, input.status, input.reason),
    ...mutationOptions("Passo atualizado"),
  });
  const addObservation = useMutation({
    mutationFn: (input: Parameters<typeof careProtocolService.addObservation>[0]) =>
      careProtocolService.addObservation(input),
    ...mutationOptions("Observação registrada"),
  });
  const raiseAlert = useMutation({
    mutationFn: (input: Parameters<typeof careProtocolService.raiseAlert>[0]) =>
      careProtocolService.raiseAlert(input),
    ...mutationOptions("Alerta registrado"),
  });
  const addOverride = useMutation({
    mutationFn: (input: Parameters<typeof careProtocolService.addOverride>[0]) =>
      careProtocolService.addOverride(input),
    ...mutationOptions("Override auditável registrado"),
  });
  const escalate = useMutation({
    mutationFn: (input: Parameters<typeof careProtocolService.escalate>[0]) =>
      careProtocolService.escalate(input),
    ...mutationOptions("Escalonamento registrado"),
  });

  const activeDefinitions = useMemo(
    () => (definitions.data ?? []).filter((definition) => definition.status === "ACTIVE" && definition.active_version_id),
    [definitions.data],
  );

  const submitDefinition = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    createDefinition.mutate({
      unitId: parseOptionalNumber(form.get("unit_id")),
      code: String(form.get("code") ?? ""),
      name: String(form.get("name") ?? ""),
      category: String(form.get("category") ?? "CLINICAL"),
      description: String(form.get("description") ?? ""),
    });
  };

  const submitVersion = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedDefinitionId) return;
    const form = new FormData(event.currentTarget);
    const rawContent = String(form.get("content") ?? "");
    try {
      publishVersion.mutate({
        definitionId: selectedDefinitionId,
        content: JSON.parse(rawContent),
        changeSummary: String(form.get("change_summary") ?? ""),
      });
    } catch {
      setActionError("O conteúdo da versão não é um JSON válido");
    }
  };

  const submitExecution = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const versionId = String(form.get("version_id") ?? "");
    const unitId = parseOptionalNumber(form.get("unit_id"));
    const patientId = parseOptionalNumber(form.get("patient_id"));
    if (!unitId || !patientId) {
      setActionError("Unidade e paciente são obrigatórios");
      return;
    }
    startExecution.mutate({
      protocolVersionId: versionId,
      unitId,
      patientId,
      encounterId: String(form.get("encounter_id") ?? "").trim() || null,
      sourceSignalType: String(form.get("source_signal_type") ?? "").trim() || null,
      sourceSignalId: String(form.get("source_signal_id") ?? "").trim() || null,
      sourceSignalPayload: {},
    });
  };

  return (
    <div className="space-y-5">
      {actionError && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4" />
          <span>{actionError}</span>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
          {canManageDefinitions && (
            <Button onClick={() => setDefinitionDialog(true)}><Plus />Nova definição</Button>
          )}
        <Button variant="outline" onClick={() => void invalidate()}><RefreshCw />Atualizar</Button>
      </div>

      <section aria-labelledby="m21-catalog-title">
        <div className="mb-3">
          <h2 id="m21-catalog-title" className="text-lg font-semibold">Catálogo e versões</h2>
          <p className="text-sm text-muted-foreground">Versões publicadas são imutáveis e não aceitam passos de prescrição automática.</p>
        </div>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Código</TableHead><TableHead>Protocolo</TableHead><TableHead>Unidade</TableHead><TableHead>Status</TableHead><TableHead>Versão</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {definitions.isLoading && <TableRow><TableCell colSpan={6} className="py-8 text-center">Carregando...</TableCell></TableRow>}
                {definitions.isError && <TableRow><TableCell colSpan={6} className="py-8 text-center text-destructive">{(definitions.error as Error).message}</TableCell></TableRow>}
                {!definitions.isLoading && !definitions.isError && (definitions.data?.length ?? 0) === 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Nenhum protocolo cadastrado.</TableCell></TableRow>}
                {definitions.data?.map((definition) => (
                  <TableRow key={definition.id}>
                    <TableCell className="font-mono text-xs">{definition.code}</TableCell>
                    <TableCell><strong>{definition.name}</strong><div className="text-xs text-muted-foreground">{definition.description || definition.category}</div></TableCell>
                    <TableCell>{definition.unit_id ?? "Corporativo"}</TableCell>
                    <TableCell><Badge variant={definition.status === "ACTIVE" ? "default" : "secondary"}>{definition.status}</Badge></TableCell>
                    <TableCell>{definition.active_version_id ? "Publicada" : "Sem versão"}</TableCell>
                <TableCell>
                  {canManageDefinitions ? (
                    <Button size="sm" variant="outline" onClick={() => { setSelectedDefinitionId(definition.id); setVersionDialog(true); }}>Publicar versão</Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">Somente leitura</span>
                  )}
                </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="m21-executions-title">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div><h2 id="m21-executions-title" className="text-lg font-semibold">Execuções clínicas</h2><p className="text-sm text-muted-foreground">Vinculadas a empresa, unidade, paciente, atendimento e versão publicada.</p></div>
          <Button variant="outline" disabled={activeDefinitions.length === 0} onClick={() => setExecutionDialog(true)}><Play />Iniciar protocolo</Button>
        </div>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Paciente</TableHead><TableHead>Unidade</TableHead><TableHead>Sinal M19</TableHead><TableHead>Status</TableHead><TableHead>Início</TableHead></TableRow></TableHeader>
              <TableBody>
                {executions.isLoading && <TableRow><TableCell colSpan={5} className="py-8 text-center">Carregando...</TableCell></TableRow>}
                {executions.isError && <TableRow><TableCell colSpan={5} className="py-8 text-center text-destructive">{(executions.error as Error).message}</TableCell></TableRow>}
                {!executions.isLoading && !executions.isError && (executions.data?.length ?? 0) === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Nenhuma execução encontrada.</TableCell></TableRow>}
                {executions.data?.map((execution) => (
                  <TableRow key={execution.id} className="cursor-pointer" onClick={() => setSelectedExecutionId(execution.id)}>
                    <TableCell>#{execution.patient_id}</TableCell>
                    <TableCell>#{execution.unit_id}</TableCell>
                    <TableCell>{execution.source_signal_type ? `${execution.source_signal_type} / ${execution.source_signal_id || "-"}` : "Manual"}</TableCell>
                    <TableCell><Badge variant={execution.status === "ACTIVE" ? "default" : "outline"}>{executionLabels[execution.status]}</Badge></TableCell>
                    <TableCell>{new Date(execution.created_at).toLocaleString("pt-BR")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      {bundle.data && (
        <section aria-labelledby="m21-selected-title" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 id="m21-selected-title" className="text-lg font-semibold">Execução #{bundle.data.execution.id.slice(0, 8)}</h2><p className="text-sm text-muted-foreground">Ações clínicas auditadas e protegidas por transições atômicas.</p></div>
            <div className="flex flex-wrap gap-2">
              {bundle.data.execution.status === "ACTIVE" && <Button variant="outline" onClick={() => transitionExecution.mutate({ execution: bundle.data.execution, status: "PAUSED", reason: "Pausa operacional registrada na interface" })}>Pausar</Button>}
              {bundle.data.execution.status === "PAUSED" && <Button variant="outline" onClick={() => transitionExecution.mutate({ execution: bundle.data.execution, status: "ACTIVE" })}>Retomar</Button>}
              {bundle.data.execution.status === "ACTIVE" && <Button onClick={() => transitionExecution.mutate({ execution: bundle.data.execution, status: "COMPLETED" })}>Concluir</Button>}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,1fr)]">
            <div className="space-y-3">
              {bundle.data.steps.map((step) => (
                <div key={step.id} className="rounded-md border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div><div className="flex items-center gap-2"><ClipboardList className="h-4 w-4 text-primary" /><strong className="text-sm">{step.sequence_number}. {step.title}</strong>{step.required && <Badge variant="outline">Obrigatório</Badge>}</div><p className="mt-1 text-sm text-muted-foreground">{step.instructions || "Sem instruções adicionais."}</p></div>
                    <Badge variant={step.status === "COMPLETED" ? "default" : "secondary"}>{step.status}</Badge>
                  </div>
                  {bundle.data.execution.status === "ACTIVE" && !["COMPLETED", "SKIPPED"].includes(step.status) && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {step.status === "PENDING" && <Button size="sm" variant="outline" onClick={() => transitionStep.mutate({ step, status: "IN_PROGRESS" })}>Iniciar</Button>}
                      <Button size="sm" onClick={() => transitionStep.mutate({ step, status: "COMPLETED" })}>Concluir</Button>
                      <Button size="sm" variant="outline" onClick={() => transitionStep.mutate({ step, status: "BLOCKED", reason: stepReason || "Bloqueio registrado na interface" })}>Bloquear</Button>
                      <Button size="sm" variant="outline" onClick={() => transitionStep.mutate({ step, status: "SKIPPED", reason: stepReason || "Salto clínico justificado na interface" })}>Pular</Button>
                      {step.required && <Button size="sm" variant="outline" onClick={() => addOverride.mutate({ executionId: step.execution_id, stepId: step.id, type: "SKIP_REQUIRED_STEP", reason: stepReason || "Exceção clínica autorizada e auditada" })}><ShieldAlert />Autorizar salto</Button>}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="space-y-4">
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Activity />Registrar observação</CardTitle><CardDescription>Dados anexados à execução sem sobrescrever histórico.</CardDescription></CardHeader>
                <CardContent>
                  <form className="space-y-3" onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    addObservation.mutate({
                      executionId: bundle.data.execution.id,
                      type: String(form.get("observation_type") ?? ""),
                      notes: String(form.get("notes") ?? ""),
                      value: { source: "manual" },
                    });
                    event.currentTarget.reset();
                  }}>
                    <Input name="observation_type" required placeholder="Tipo da observação" />
                    <Textarea name="notes" placeholder="Observação clínica" />
                    <Button type="submit" className="w-full" variant="outline">Registrar</Button>
                  </form>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle />Registrar alerta</CardTitle><CardDescription>Alerta operacional; não prescreve nem altera medicação.</CardDescription></CardHeader>
                <CardContent>
                  <form className="space-y-3" onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    raiseAlert.mutate({
                      executionId: bundle.data.execution.id,
                      code: String(form.get("code") ?? ""),
                      severity: String(form.get("severity") ?? "WARNING") as "INFO" | "WARNING" | "CRITICAL",
                      message: String(form.get("message") ?? ""),
                    });
                    event.currentTarget.reset();
                  }}>
                    <Input name="code" required placeholder="Código do alerta" />
                    <Label htmlFor="m21-severity">Severidade</Label>
                    <select id="m21-severity" name="severity" className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option>INFO</option><option>WARNING</option><option>CRITICAL</option></select>
                    <Textarea name="message" required placeholder="Mensagem do alerta" />
                    <Button type="submit" className="w-full" variant="outline">Criar alerta</Button>
                  </form>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldAlert />Escalonar responsabilidade</CardTitle><CardDescription>Encaminha a execução para avaliação humana; não gera prescrição automática.</CardDescription></CardHeader>
                <CardContent>
                  <form className="space-y-3" onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    escalate.mutate({
                      executionId: bundle.data.execution.id,
                      level: Number(form.get("level") ?? 1),
                      targetRole: String(form.get("target_role") ?? ""),
                      reason: String(form.get("reason") ?? ""),
                    });
                    event.currentTarget.reset();
                  }}>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div><Label htmlFor="m21-escalation-level">Nível</Label><Input id="m21-escalation-level" name="level" type="number" min="1" max="5" defaultValue="1" required /></div>
                      <div><Label htmlFor="m21-escalation-role">Perfil de destino</Label><Input id="m21-escalation-role" name="target_role" placeholder="medico" required /></div>
                    </div>
                    <Textarea name="reason" required placeholder="Motivo do escalonamento" />
                    <Button type="submit" className="w-full" variant="outline">Escalonar</Button>
                  </form>
                </CardContent>
              </Card>

              <div className="space-y-1">
                <Label htmlFor="m21-step-reason">Motivo para bloqueio ou override</Label>
                <Textarea id="m21-step-reason" value={stepReason} onChange={(event) => setStepReason(event.target.value)} placeholder="Justificativa auditável" />
              </div>
            </div>
          </div>
        </section>
      )}

      <Dialog
        open={canManageDefinitions && definitionDialog}
        onOpenChange={(open) => setDefinitionDialog(canManageDefinitions && open)}
      >
        <DialogContent>
          <DialogHeader><DialogTitle>Nova definição de protocolo</DialogTitle><DialogDescription>Unidade vazia cria um protocolo corporativo; a empresa é derivada da sessão.</DialogDescription></DialogHeader>
          <form className="space-y-4" onSubmit={submitDefinition}>
            <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="m21-code">Código</Label><Input id="m21-code" name="code" required /></div><div><Label htmlFor="m21-unit">Unidade ID</Label><Input id="m21-unit" name="unit_id" type="number" min="1" /></div></div>
            <div><Label htmlFor="m21-name">Nome</Label><Input id="m21-name" name="name" required /></div>
            <div><Label htmlFor="m21-category">Categoria</Label><Input id="m21-category" name="category" defaultValue="CLINICAL" /></div>
            <div><Label htmlFor="m21-description">Descrição</Label><Textarea id="m21-description" name="description" /></div>
            <DialogFooter><Button type="button" variant="ghost" onClick={() => setDefinitionDialog(false)}>Cancelar</Button><Button type="submit" disabled={createDefinition.isPending}>Criar</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={canManageDefinitions && versionDialog}
        onOpenChange={(open) => setVersionDialog(canManageDefinitions && open)}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Publicar versão imutável</DialogTitle><DialogDescription>A publicação ativa a versão e bloqueia alterações posteriores.</DialogDescription></DialogHeader>
          <form className="space-y-4" onSubmit={submitVersion}>
            <div><Label htmlFor="m21-summary">Resumo da mudança</Label><Input id="m21-summary" name="change_summary" required /></div>
            <div><Label htmlFor="m21-content">Conteúdo JSON</Label><Textarea id="m21-content" name="content" className="min-h-72 font-mono text-xs" defaultValue={sampleContent} required /></div>
            <DialogFooter><Button type="button" variant="ghost" onClick={() => setVersionDialog(false)}>Cancelar</Button><Button type="submit" disabled={publishVersion.isPending}><BookOpenCheck />Publicar</Button></DialogFooter>
          </form>
          {versions.data?.length ? <p className="text-xs text-muted-foreground">Versão atual: {versions.data[0].version_number}</p> : null}
        </DialogContent>
      </Dialog>

      <Dialog open={executionDialog} onOpenChange={setExecutionDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Iniciar protocolo</DialogTitle><DialogDescription>O sinal M19 é opcional e serve apenas como origem auditável.</DialogDescription></DialogHeader>
          <form className="space-y-4" onSubmit={submitExecution}>
            <div><Label htmlFor="m21-version">Versão ativa</Label><select id="m21-version" name="version_id" required className="h-10 w-full rounded-md border bg-background px-3 text-sm">{activeDefinitions.map((definition) => <option key={definition.id} value={definition.active_version_id || ""}>{definition.code} - {definition.name}</option>)}</select></div>
            <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="m21-exec-unit">Unidade ID</Label><Input id="m21-exec-unit" name="unit_id" type="number" min="1" required /></div><div><Label htmlFor="m21-patient">Paciente ID</Label><Input id="m21-patient" name="patient_id" type="number" min="1" required /></div></div>
            <div><Label htmlFor="m21-encounter">Atendimento UUID</Label><Input id="m21-encounter" name="encounter_id" /></div>
            <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="m21-signal-type">Tipo do sinal M19</Label><Input id="m21-signal-type" name="source_signal_type" placeholder="TRIAGE_RECLASSIFICATION" /></div><div><Label htmlFor="m21-signal-id">ID do sinal</Label><Input id="m21-signal-id" name="source_signal_id" /></div></div>
            <DialogFooter><Button type="button" variant="ghost" onClick={() => setExecutionDialog(false)}>Cancelar</Button><Button type="submit" disabled={startExecution.isPending}><Play />Iniciar</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
