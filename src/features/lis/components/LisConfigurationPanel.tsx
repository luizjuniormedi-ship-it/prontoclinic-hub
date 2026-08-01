import { type FormEvent, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, FlaskConical, Settings2 } from "lucide-react";

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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  upsertEquipment,
  upsertReferenceRange,
} from "@/features/lis/api/lisGateway";

interface LisConfigurationPanelProps {
  companyId: string;
  unitId: number;
  roleName?: string;
}

type IntegrationKind = "MANUAL" | "HL7" | "ASTM" | "API";
type EquipmentStatus = "ACTIVE" | "INACTIVE" | "MAINTENANCE" | "ERROR";
type ReferenceSex = "M" | "F" | "A";
type Submission = "equipment" | "reference";

type Feedback = {
  kind: "error" | "success";
  title: string;
  description: string;
} | null;

function normalizeRole(roleName?: string): string {
  return (roleName ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function canManageConfiguration(roleName?: string): boolean {
  return ["admin", "administrador", "administrator", "laboratorio", "laboratory", "lab", "diagnostico", "diagnostic"].includes(
    normalizeRole(roleName),
  );
}

function parsePositiveInteger(value: FormDataEntryValue | null, field: string): number {
  const parsed = Number(String(value ?? "").trim());
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${field} deve ser um número inteiro positivo.`);
  }
  return parsed;
}

function parseOptionalPositiveInteger(
  value: FormDataEntryValue | null,
  field: string,
): number | null {
  const normalized = String(value ?? "").trim();
  return normalized ? parsePositiveInteger(normalized, field) : null;
}

function parseNonNegativeInteger(
  value: FormDataEntryValue | null,
  field: string,
): number {
  const parsed = Number(String(value ?? "").trim());
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${field} deve ser um número inteiro maior ou igual a zero.`);
  }
  return parsed;
}

function parseOptionalNumber(
  value: FormDataEntryValue | null,
  field: string,
): number | null {
  const normalized = String(value ?? "").trim().replace(",", ".");
  if (!normalized) {
    return null;
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${field} deve ser um número válido.`);
  }
  return parsed;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "A operação não pôde ser concluída.";
}

export function LisConfigurationPanel({
  companyId,
  unitId,
  roleName,
}: LisConfigurationPanelProps) {
  const maySubmit = useMemo(() => canManageConfiguration(roleName), [roleName]);
  const contextIsValid =
    companyId.trim().length > 0 && Number.isSafeInteger(unitId) && unitId > 0;
  const formIsEnabled = maySubmit && contextIsValid;

  const [busy, setBusy] = useState<Submission | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [integrationKind, setIntegrationKind] = useState<IntegrationKind>("MANUAL");
  const [equipmentStatus, setEquipmentStatus] = useState<EquipmentStatus>("ACTIVE");
  const [equipmentActive, setEquipmentActive] = useState(true);
  const [referenceSex, setReferenceSex] = useState<ReferenceSex>("A");
  const [referenceActive, setReferenceActive] = useState(true);

  async function submit(
    kind: Submission,
    successTitle: string,
    operation: () => Promise<unknown>,
  ) {
    if (!formIsEnabled) {
      return;
    }

    setBusy(kind);
    setFeedback(null);
    try {
      await operation();
      setFeedback({
        kind: "success",
        title: successTitle,
        description: "Configuração registrada no fluxo seguro do M23.",
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        title: "Não foi possível salvar",
        description: errorMessage(error),
      });
    } finally {
      setBusy(null);
    }
  }

  function submitEquipment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void submit("equipment", "Equipamento salvo", () =>
      upsertEquipment({
        equipmentId: String(form.get("equipmentId") ?? "").trim() || null,
        unitId,
        payload: {
          code: String(form.get("equipmentCode") ?? "").trim(),
          name: String(form.get("equipmentName") ?? "").trim(),
          integration_kind: integrationKind,
          status: equipmentStatus,
          active: equipmentActive,
        },
      }),
    );
  }

  function submitReference(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void submit("reference", "Faixa de referência salva", async () => {
      const minimumAge = parseNonNegativeInteger(
        form.get("minimumAge"),
        "Idade mínima",
      );
      const maximumAge = parseNonNegativeInteger(
        form.get("maximumAge"),
        "Idade máxima",
      );
      if (maximumAge < minimumAge) {
        throw new Error("Idade máxima deve ser maior ou igual à idade mínima.");
      }

      return upsertReferenceRange({
        referenceId: parseOptionalPositiveInteger(
          form.get("referenceId"),
          "ID da referência",
        ),
        examId: parsePositiveInteger(form.get("examId"), "Exame"),
        payload: {
          parameter: String(form.get("parameter") ?? "").trim(),
          minimumValue: parseOptionalNumber(form.get("minimumValue"), "Valor mínimo"),
          maximumValue: parseOptionalNumber(form.get("maximumValue"), "Valor máximo"),
          unit: String(form.get("referenceUnit") ?? "").trim() || null,
          sex: referenceSex,
          minimumAge,
          maximumAge,
          active: referenceActive,
        },
      });
    });
  }

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <Settings2 className="h-5 w-5" aria-hidden="true" />
          <h2 className="text-lg font-semibold">Configuração operacional LIS</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Unidade {unitId} · empresa {companyId}
        </p>
      </header>

      {!formIsEnabled && (
        <Alert>
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>Somente leitura</AlertTitle>
          <AlertDescription>
            Este perfil pode consultar a configuração, mas apenas administração,
            laboratório ou diagnóstico podem alterá-la.
          </AlertDescription>
        </Alert>
      )}

      {feedback && (
        <Alert variant={feedback.kind === "error" ? "destructive" : "default"}>
          {feedback.kind === "success" ? (
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          ) : (
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
          )}
          <AlertTitle>{feedback.title}</AlertTitle>
          <AlertDescription>{feedback.description}</AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="equipment">
        <TabsList>
          <TabsTrigger value="equipment">Equipamentos</TabsTrigger>
          <TabsTrigger value="references">Faixas de referência</TabsTrigger>
        </TabsList>

        <TabsContent value="equipment" className="space-y-4 pt-3">
          <div>
            <h3 className="text-base font-semibold">Equipamento laboratorial</h3>
            <p className="text-sm text-muted-foreground">
              Informe um ID existente para editar ou deixe-o vazio para cadastrar.
            </p>
          </div>

          <form className="space-y-4" onSubmit={submitEquipment}>
            <fieldset
              className="grid gap-4 md:grid-cols-2"
              disabled={!formIsEnabled || busy !== null}
            >
              <div className="space-y-1.5">
                <Label htmlFor="lis-equipment-id">ID do equipamento</Label>
                <Input
                  id="lis-equipment-id"
                  name="equipmentId"
                  placeholder="UUID para edição"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lis-equipment-code">Código</Label>
                <Input id="lis-equipment-code" name="equipmentCode" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lis-equipment-name">Nome</Label>
                <Input id="lis-equipment-name" name="equipmentName" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lis-integration-kind">Integração</Label>
                <Select
                  value={integrationKind}
                  onValueChange={(value) => setIntegrationKind(value as IntegrationKind)}
                >
                  <SelectTrigger id="lis-integration-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MANUAL">Manual</SelectItem>
                    <SelectItem value="HL7">HL7</SelectItem>
                    <SelectItem value="ASTM">ASTM</SelectItem>
                    <SelectItem value="API">API</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lis-equipment-status">Estado operacional</Label>
                <Select
                  value={equipmentStatus}
                  onValueChange={(value) => setEquipmentStatus(value as EquipmentStatus)}
                >
                  <SelectTrigger id="lis-equipment-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">Ativo</SelectItem>
                    <SelectItem value="INACTIVE">Inativo</SelectItem>
                    <SelectItem value="MAINTENANCE">Em manutenção</SelectItem>
                    <SelectItem value="ERROR">Com erro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-3 self-end pb-2">
                <Switch
                  id="lis-equipment-active"
                  checked={equipmentActive}
                  onCheckedChange={setEquipmentActive}
                />
                <Label htmlFor="lis-equipment-active">Equipamento ativo</Label>
              </div>
            </fieldset>
            <Button type="submit" disabled={!formIsEnabled || busy !== null}>
              <FlaskConical className="mr-2 h-4 w-4" aria-hidden="true" />
              {busy === "equipment" ? "Salvando..." : "Salvar equipamento"}
            </Button>
          </form>
        </TabsContent>

        <TabsContent value="references" className="space-y-4 pt-3">
          <div>
            <h3 className="text-base font-semibold">Faixa de referência</h3>
            <p className="text-sm text-muted-foreground">
              Use o ID para editar. Desative a faixa para inativá-la sem excluir o
              histórico.
            </p>
          </div>

          <form className="space-y-4" onSubmit={submitReference}>
            <fieldset
              className="grid gap-4 md:grid-cols-3"
              disabled={!formIsEnabled || busy !== null}
            >
              <div className="space-y-1.5">
                <Label htmlFor="lis-reference-id">ID da referência</Label>
                <Input
                  id="lis-reference-id"
                  name="referenceId"
                  type="number"
                  min={1}
                  placeholder="Para edição"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lis-reference-exam">ID do exame</Label>
                <Input
                  id="lis-reference-exam"
                  name="examId"
                  type="number"
                  min={1}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lis-reference-parameter">Parâmetro</Label>
                <Input id="lis-reference-parameter" name="parameter" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lis-reference-minimum">Valor mínimo</Label>
                <Input
                  id="lis-reference-minimum"
                  name="minimumValue"
                  inputMode="decimal"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lis-reference-maximum">Valor máximo</Label>
                <Input
                  id="lis-reference-maximum"
                  name="maximumValue"
                  inputMode="decimal"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lis-reference-unit">Unidade de medida</Label>
                <Input id="lis-reference-unit" name="referenceUnit" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lis-reference-sex">Sexo</Label>
                <Select
                  value={referenceSex}
                  onValueChange={(value) => setReferenceSex(value as ReferenceSex)}
                >
                  <SelectTrigger id="lis-reference-sex">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="A">Todos</SelectItem>
                    <SelectItem value="M">Masculino</SelectItem>
                    <SelectItem value="F">Feminino</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lis-reference-minimum-age">Idade mínima</Label>
                <Input
                  id="lis-reference-minimum-age"
                  name="minimumAge"
                  type="number"
                  min={0}
                  defaultValue={0}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lis-reference-maximum-age">Idade máxima</Label>
                <Input
                  id="lis-reference-maximum-age"
                  name="maximumAge"
                  type="number"
                  min={0}
                  defaultValue={120}
                  required
                />
              </div>
              <div className="flex items-center gap-3 self-end pb-2">
                <Switch
                  id="lis-reference-active"
                  checked={referenceActive}
                  onCheckedChange={setReferenceActive}
                />
                <Label htmlFor="lis-reference-active">Faixa ativa</Label>
              </div>
            </fieldset>
            <Button type="submit" disabled={!formIsEnabled || busy !== null}>
              {busy === "reference" ? "Salvando..." : "Salvar faixa de referência"}
            </Button>
          </form>
        </TabsContent>
      </Tabs>
    </div>
  );
}
