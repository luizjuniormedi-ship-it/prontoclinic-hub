import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FlaskConical,
  PackageCheck,
  Send,
  ShieldCheck,
  TestTube2,
  Workflow,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  acknowledgeCriticalAlert,
  collectSpecimen,
  deliverOrder,
  recordQcRun,
  recordResults,
  transitionSpecimen,
  validateResult,
} from "@/features/lis/api/lisGateway";
import {
  roleHasCapability,
  type M23Capability,
  type M23Role,
} from "@/features/lis/model/permissions";

interface LisOperationsPanelProps {
  companyId: string;
  unitId: number;
  roleName?: string;
}

type Feedback = {
  kind: "error" | "success";
  title: string;
  description: string;
} | null;

type AsyncOperation =
  | "collect"
  | "transition"
  | "qc"
  | "result"
  | "validation"
  | "critical"
  | "delivery";

const specimenStatuses = [
  { value: "RECEIVED", label: "Recebida" },
  { value: "PROCESSING", label: "Em processamento" },
  { value: "STORED", label: "Armazenada" },
  { value: "REJECTED", label: "Rejeitada" },
  { value: "RECOLLECTION_REQUIRED", label: "Solicitar recoleta" },
  { value: "DISCARDED", label: "Descartada" },
] as const;

const validationActions = [
  { value: "TECHNICAL_VALIDATE", label: "Validação técnica" },
  { value: "MEDICAL_VALIDATE", label: "Validação médica" },
  { value: "RELEASE", label: "Liberação" },
] as const;

const deliveryMethods = [
  { value: "PORTAL", label: "Portal" },
  { value: "PRINTED", label: "Impresso" },
  { value: "PICKUP", label: "Retirada" },
  { value: "EMAIL_PENDING", label: "E-mail pendente" },
] as const;

function normalizeRole(roleName?: string): M23Role | null {
  const normalized = (roleName ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

  if (["admin", "administrador", "administrator"].includes(normalized)) {
    return "admin";
  }
  if (["medico", "doctor"].includes(normalized)) {
    return "medico";
  }
  if (["laboratorio", "laboratory", "lab"].includes(normalized)) {
    return "laboratorio";
  }
  if (["diagnostico", "radiologia", "diagnostic"].includes(normalized)) {
    return "diagnostico";
  }
  if (["gestor", "manager"].includes(normalized)) {
    return "gestor";
  }

  return null;
}

function parsePositiveInteger(value: string, fieldName: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} deve ser um número inteiro positivo.`);
  }
  return parsed;
}

function parseNumber(value: string, fieldName: string): number {
  const parsed = Number(value.replace(",", "."));
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldName} deve ser um número válido.`);
  }
  return parsed;
}

function parseOrderItemIds(value: string): number[] {
  const ids = value
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map((item) => parsePositiveInteger(item, "ID do item"));

  if (ids.length === 0) {
    throw new Error("Informe pelo menos um ID real de item do pedido.");
  }

  return [...new Set(ids)];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "A operação não pôde ser concluída.";
}

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function OperationSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4 border-t pt-4 first:border-t-0 first:pt-0">
      <div>
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

export function LisOperationsPanel({
  companyId,
  unitId,
  roleName,
}: LisOperationsPanelProps) {
  const role = useMemo(() => normalizeRole(roleName), [roleName]);
  const [busyOperation, setBusyOperation] = useState<AsyncOperation | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [lastBarcode, setLastBarcode] = useState<string | null>(null);

  const [transitionStatus, setTransitionStatus] = useState("RECEIVED");
  const [validationAction, setValidationAction] = useState("TECHNICAL_VALIDATE");
  const [deliveryMethod, setDeliveryMethod] = useState("PORTAL");

  const contextIsValid = companyId.trim().length > 0 && Number.isSafeInteger(unitId) && unitId > 0;

  function can(capability: M23Capability): boolean {
    return contextIsValid && role !== null && roleHasCapability(role, capability);
  }

  function validationIsAllowed(action: string): boolean {
    if (!contextIsValid || role === null) {
      return false;
    }
    if (action === "RELEASE") {
      return roleHasCapability(role, "release_result");
    }
    if (action === "MEDICAL_VALIDATE") {
      return (
        roleHasCapability(role, "validate_result") &&
        (role === "admin" || role === "medico")
      );
    }
    return roleHasCapability(role, "validate_result");
  }

  async function runOperation(
    operation: AsyncOperation,
    successTitle: string,
    action: () => Promise<unknown>,
  ) {
    setBusyOperation(operation);
    setFeedback(null);
    try {
      await action();
      setFeedback({
        kind: "success",
        title: successTitle,
        description: "A operação foi registrada com auditoria no fluxo M23.",
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        title: "Não foi possível concluir",
        description: errorMessage(error),
      });
    } finally {
      setBusyOperation(null);
    }
  }

  function submitCollection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void runOperation("collect", "Amostra coletada", async () => {
      const result = await collectSpecimen({
        orderId: parsePositiveInteger(String(form.get("orderId") ?? ""), "Pedido"),
        specimenType: String(form.get("specimenType") ?? "").trim(),
        containerType: String(form.get("containerType") ?? "").trim(),
        orderItemIds: parseOrderItemIds(String(form.get("orderItemIds") ?? "")),
        accessionNumber: String(form.get("accessionNumber") ?? "").trim() || null,
      });
      setLastBarcode(result.barcode);
    });
  }

  function submitTransition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void runOperation("transition", "Estado da amostra atualizado", () =>
      transitionSpecimen({
        specimenId: String(form.get("specimenId") ?? "").trim(),
        status: transitionStatus,
        reason: String(form.get("transitionReason") ?? "").trim() || null,
      }),
    );
  }

  function submitQc(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void runOperation("qc", "Controle de qualidade registrado", () =>
      recordQcRun({
        equipmentId: String(form.get("equipmentId") ?? "").trim(),
        controlName: String(form.get("controlName") ?? "").trim(),
        controlLot: String(form.get("controlLot") ?? "").trim(),
        controlLevel: String(form.get("controlLevel") ?? "").trim(),
        measuredValue: parseNumber(String(form.get("measuredValue") ?? ""), "Valor medido"),
        targetValue: parseNumber(String(form.get("targetValue") ?? ""), "Valor alvo"),
        minimumValue: parseNumber(String(form.get("minimumValue") ?? ""), "Limite mínimo"),
        maximumValue: parseNumber(String(form.get("maximumValue") ?? ""), "Limite máximo"),
        notes: String(form.get("qcNotes") ?? "").trim() || null,
      }),
    );
  }

  function submitResult(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const numericValue = String(form.get("numericValue") ?? "").trim();
    const textValue = String(form.get("textValue") ?? "").trim();

    void runOperation("result", "Resultado registrado", () => {
      if (!numericValue && !textValue) {
        throw new Error("Informe um resultado numérico ou textual.");
      }

      return recordResults({
        orderItemId: parsePositiveInteger(
          String(form.get("resultOrderItemId") ?? ""),
          "Item do pedido",
        ),
        equipmentId: String(form.get("resultEquipmentId") ?? "").trim() || null,
        results: [
          {
            parameter: String(form.get("parameter") ?? "").trim(),
            numeric_value: numericValue ? parseNumber(numericValue, "Resultado") : null,
            text_value: textValue || null,
            unit: String(form.get("unit") ?? "").trim() || null,
            reference_min: String(form.get("referenceMin") ?? "").trim()
              ? parseNumber(String(form.get("referenceMin")), "Referência mínima")
              : null,
            reference_max: String(form.get("referenceMax") ?? "").trim()
              ? parseNumber(String(form.get("referenceMax")), "Referência máxima")
              : null,
            reagent_lot: String(form.get("reagentLot") ?? "").trim() || null,
            note: String(form.get("resultNote") ?? "").trim() || null,
          },
        ],
      });
    });
  }

  function submitValidation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void runOperation("validation", "Etapa de validação registrada", () =>
      validateResult({
        orderItemId: parsePositiveInteger(
          String(form.get("validationOrderItemId") ?? ""),
          "Item do pedido",
        ),
        action: validationAction,
        note: String(form.get("validationNote") ?? "").trim() || null,
      }),
    );
  }

  function submitCritical(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void runOperation("critical", "Comunicação crítica registrada", () =>
      acknowledgeCriticalAlert({
        alertId: parsePositiveInteger(String(form.get("alertId") ?? ""), "Alerta"),
        communicationMethod: String(form.get("communicationMethod") ?? "").trim(),
        note: String(form.get("criticalNote") ?? "").trim() || null,
      }),
    );
  }

  function submitDelivery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const protocol = String(form.get("deliveryProtocol") ?? "").trim();
    void runOperation("delivery", "Entrega registrada", () =>
      deliverOrder({
        orderId: parsePositiveInteger(String(form.get("deliveryOrderId") ?? ""), "Pedido"),
        deliveryMethod,
        recipient: String(form.get("recipient") ?? "").trim() || null,
        metadata: protocol ? { protocol } : {},
      }),
    );
  }

  const collectAllowed = can("collect_specimen");
  const transitionAllowed =
    transitionStatus === "RECEIVED"
      ? can("receive_specimen")
      : transitionStatus === "REJECTED" || transitionStatus === "RECOLLECTION_REQUIRED"
        ? can("reject_specimen")
        : can("process_specimen");
  const qcAllowed = can("manage_quality_control");
  const resultAllowed = can("enter_result");
  const criticalAllowed =
    can("acknowledge_critical") && can("communicate_critical");
  const deliveryAllowed = can("deliver_result");

  return (
    <div className="space-y-4" data-company-id={companyId} data-unit-id={unitId}>
      <div className="flex flex-col gap-2 border-b pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Operação laboratorial</h2>
          <p className="text-sm text-muted-foreground">
            Unidade {unitId} · perfil {roleName || "não informado"}
          </p>
        </div>
        {!contextIsValid || role === null ? (
          <p className="text-sm font-medium text-destructive">
            Contexto de empresa, unidade ou perfil inválido.
          </p>
        ) : null}
      </div>

      {feedback ? (
        <Alert variant={feedback.kind === "error" ? "destructive" : "default"}>
          {feedback.kind === "error" ? <AlertTriangle /> : <CheckCircle2 />}
          <AlertTitle>{feedback.title}</AlertTitle>
          <AlertDescription>{feedback.description}</AlertDescription>
        </Alert>
      ) : null}

      <Tabs defaultValue="specimen" className="space-y-4">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-6">
          <TabsTrigger value="specimen">Amostras</TabsTrigger>
          <TabsTrigger value="qc">QC</TabsTrigger>
          <TabsTrigger value="results">Resultados</TabsTrigger>
          <TabsTrigger value="validation">Validação</TabsTrigger>
          <TabsTrigger value="critical">Críticos</TabsTrigger>
          <TabsTrigger value="delivery">Entrega</TabsTrigger>
        </TabsList>

        <TabsContent value="specimen" className="space-y-6">
          <OperationSection
            title="Coleta e identificação"
            description="Vincule a amostra somente a itens reais do pedido."
          >
            <form onSubmit={submitCollection} className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <Field id="m23-order-id" label="Pedido">
                  <Input id="m23-order-id" name="orderId" inputMode="numeric" required />
                </Field>
                <Field id="m23-accession-number" label="Acesso / barcode opcional">
                  <Input id="m23-accession-number" name="accessionNumber" />
                </Field>
                <Field id="m23-specimen-type" label="Material">
                  <Input
                    id="m23-specimen-type"
                    name="specimenType"
                    placeholder="SANGUE"
                    required
                  />
                </Field>
                <Field id="m23-container-type" label="Tubo / recipiente">
                  <Input
                    id="m23-container-type"
                    name="containerType"
                    placeholder="EDTA"
                    required
                  />
                </Field>
                <Field id="m23-order-item-ids" label="IDs dos itens">
                  <Input
                    id="m23-order-item-ids"
                    name="orderItemIds"
                    placeholder="101, 102"
                    required
                  />
                </Field>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="submit"
                  disabled={!collectAllowed || busyOperation !== null}
                  title={collectAllowed ? undefined : "Perfil sem permissão para coleta"}
                >
                  <TestTube2 />
                  Coletar amostra
                </Button>
                {lastBarcode ? (
                  <output className="text-sm font-medium" aria-live="polite">
                    Barcode gerado: {lastBarcode}
                  </output>
                ) : null}
              </div>
            </form>
          </OperationSection>

          <OperationSection
            title="Triagem e processamento"
            description="Registre cada mudança de estado; rejeição e recoleta exigem motivo."
          >
            <form onSubmit={submitTransition} className="space-y-3">
              <div className="grid gap-3 md:grid-cols-3">
                <Field id="m23-specimen-id" label="ID da amostra">
                  <Input id="m23-specimen-id" name="specimenId" required />
                </Field>
                <Field id="m23-specimen-status" label="Novo estado">
                  <Select value={transitionStatus} onValueChange={setTransitionStatus}>
                    <SelectTrigger id="m23-specimen-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {specimenStatuses.map((status) => (
                        <SelectItem key={status.value} value={status.value}>
                          {status.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field id="m23-transition-reason" label="Motivo">
                  <Input id="m23-transition-reason" name="transitionReason" />
                </Field>
              </div>
              <Button
                type="submit"
                variant="secondary"
                disabled={!transitionAllowed || busyOperation !== null}
                title={transitionAllowed ? undefined : "Perfil sem permissão para esta transição"}
              >
                <Workflow />
                Atualizar amostra
              </Button>
            </form>
          </OperationSection>
        </TabsContent>

        <TabsContent value="qc">
          <OperationSection
            title="Controle de qualidade"
            description="O resultado do controle pode bloquear a liberação do equipamento."
          >
            <form onSubmit={submitQc} className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <Field id="m23-equipment-id" label="ID do equipamento">
                  <Input id="m23-equipment-id" name="equipmentId" required />
                </Field>
                <Field id="m23-control-name" label="Controle">
                  <Input id="m23-control-name" name="controlName" required />
                </Field>
                <Field id="m23-control-lot" label="Lote">
                  <Input id="m23-control-lot" name="controlLot" required />
                </Field>
                <Field id="m23-control-level" label="Nível">
                  <Input id="m23-control-level" name="controlLevel" required />
                </Field>
                <Field id="m23-measured-value" label="Valor medido">
                  <Input id="m23-measured-value" name="measuredValue" inputMode="decimal" required />
                </Field>
                <Field id="m23-target-value" label="Valor alvo">
                  <Input id="m23-target-value" name="targetValue" inputMode="decimal" required />
                </Field>
                <Field id="m23-minimum-value" label="Limite mínimo">
                  <Input id="m23-minimum-value" name="minimumValue" inputMode="decimal" required />
                </Field>
                <Field id="m23-maximum-value" label="Limite máximo">
                  <Input id="m23-maximum-value" name="maximumValue" inputMode="decimal" required />
                </Field>
              </div>
              <Field id="m23-qc-notes" label="Observações">
                <Textarea id="m23-qc-notes" name="qcNotes" className="min-h-20" />
              </Field>
              <Button
                type="submit"
                disabled={!qcAllowed || busyOperation !== null}
                title={qcAllowed ? undefined : "Perfil sem permissão para controle de qualidade"}
              >
                <FlaskConical />
                Registrar controle
              </Button>
            </form>
          </OperationSection>
        </TabsContent>

        <TabsContent value="results">
          <OperationSection
            title="Entrada de resultados"
            description="Registre valor numérico ou textual para um item real do pedido."
          >
            <form onSubmit={submitResult} className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <Field id="m23-result-item-id" label="Item do pedido">
                  <Input id="m23-result-item-id" name="resultOrderItemId" inputMode="numeric" required />
                </Field>
                <Field id="m23-result-equipment-id" label="Equipamento opcional">
                  <Input id="m23-result-equipment-id" name="resultEquipmentId" />
                </Field>
                <Field id="m23-parameter" label="Parâmetro">
                  <Input id="m23-parameter" name="parameter" required />
                </Field>
                <Field id="m23-result-unit" label="Unidade">
                  <Input id="m23-result-unit" name="unit" />
                </Field>
                <Field id="m23-numeric-value" label="Resultado numérico">
                  <Input id="m23-numeric-value" name="numericValue" inputMode="decimal" />
                </Field>
                <Field id="m23-text-value" label="Resultado textual">
                  <Input id="m23-text-value" name="textValue" />
                </Field>
                <Field id="m23-reference-min" label="Referência mínima">
                  <Input id="m23-reference-min" name="referenceMin" inputMode="decimal" />
                </Field>
                <Field id="m23-reference-max" label="Referência máxima">
                  <Input id="m23-reference-max" name="referenceMax" inputMode="decimal" />
                </Field>
                <Field id="m23-reagent-lot" label="Lote do reagente">
                  <Input id="m23-reagent-lot" name="reagentLot" />
                </Field>
              </div>
              <Field id="m23-result-note" label="Observações">
                <Textarea id="m23-result-note" name="resultNote" className="min-h-20" />
              </Field>
              <Button
                type="submit"
                disabled={!resultAllowed || busyOperation !== null}
                title={resultAllowed ? undefined : "Perfil sem permissão para registrar resultados"}
              >
                <Send />
                Registrar resultado
              </Button>
            </form>
          </OperationSection>
        </TabsContent>

        <TabsContent value="validation">
          <OperationSection
            title="Validação e liberação"
            description="A ordem técnica → médica → liberação é verificada novamente no servidor."
          >
            <form onSubmit={submitValidation} className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <Field id="m23-validation-item-id" label="Item do pedido">
                  <Input
                    id="m23-validation-item-id"
                    name="validationOrderItemId"
                    inputMode="numeric"
                    required
                  />
                </Field>
                <Field id="m23-validation-action" label="Etapa">
                  <Select value={validationAction} onValueChange={setValidationAction}>
                    <SelectTrigger id="m23-validation-action" aria-label="Etapa">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {validationActions.map((action) => (
                        <SelectItem key={action.value} value={action.value}>
                          {action.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <Field id="m23-validation-note" label="Nota de validação">
                <Textarea
                  id="m23-validation-note"
                  name="validationNote"
                  className="min-h-20"
                />
              </Field>
              <Button
                type="submit"
                disabled={!validationIsAllowed(validationAction) || busyOperation !== null}
                title={
                  validationIsAllowed(validationAction)
                    ? undefined
                    : "Perfil sem permissão para esta etapa"
                }
              >
                <ShieldCheck />
                Confirmar etapa
              </Button>
            </form>
          </OperationSection>
        </TabsContent>

        <TabsContent value="critical">
          <OperationSection
            title="Comunicação de resultado crítico"
            description="Informe o canal utilizado e registre evidência objetiva da comunicação."
          >
            <form onSubmit={submitCritical} className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <Field id="m23-alert-id" label="ID do alerta">
                  <Input id="m23-alert-id" name="alertId" inputMode="numeric" required />
                </Field>
                <Field id="m23-communication-method" label="Canal">
                  <Input
                    id="m23-communication-method"
                    name="communicationMethod"
                    placeholder="TELEFONE"
                    required
                  />
                </Field>
              </div>
              <Field id="m23-critical-note" label="Registro da comunicação">
                <Textarea
                  id="m23-critical-note"
                  name="criticalNote"
                  className="min-h-20"
                  required
                />
              </Field>
              <Button
                type="submit"
                variant="destructive"
                disabled={!criticalAllowed || busyOperation !== null}
                title={criticalAllowed ? undefined : "Perfil sem permissão para comunicar críticos"}
              >
                <AlertTriangle />
                Registrar comunicação
              </Button>
            </form>
          </OperationSection>
        </TabsContent>

        <TabsContent value="delivery">
          <OperationSection
            title="Entrega do resultado"
            description="Somente pedidos liberados podem ser entregues."
          >
            <form onSubmit={submitDelivery} className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <Field id="m23-delivery-order-id" label="Pedido">
                  <Input
                    id="m23-delivery-order-id"
                    name="deliveryOrderId"
                    inputMode="numeric"
                    required
                  />
                </Field>
                <Field id="m23-delivery-method" label="Forma de entrega">
                  <Select value={deliveryMethod} onValueChange={setDeliveryMethod}>
                    <SelectTrigger id="m23-delivery-method">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {deliveryMethods.map((method) => (
                        <SelectItem key={method.value} value={method.value}>
                          {method.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field id="m23-recipient" label="Destinatário">
                  <Input id="m23-recipient" name="recipient" />
                </Field>
                <Field id="m23-delivery-protocol" label="Protocolo">
                  <Input id="m23-delivery-protocol" name="deliveryProtocol" />
                </Field>
              </div>
              <Button
                type="submit"
                disabled={!deliveryAllowed || busyOperation !== null}
                title={deliveryAllowed ? undefined : "Perfil sem permissão para entregar resultados"}
              >
                <PackageCheck />
                Registrar entrega
              </Button>
            </form>
          </OperationSection>
        </TabsContent>
      </Tabs>
    </div>
  );
}
