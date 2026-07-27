import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  receptionCompletionService,
  type ReceptionTermCatalogItem,
} from "@/services/receptionCompletionService";

interface Props {
  patientId: string;
  appointmentId?: string;
  unitId?: string;
  mode?: "full" | "checkin";
  onOperationCompleted?: () => Promise<void> | void;
}

export function ReceptionPatientOperationsPanel({
  patientId,
  appointmentId: initialAppointmentId,
  unitId: initialUnitId,
  mode = "full",
  onOperationCompleted,
}: Props) {
  const [appointmentId, setAppointmentId] = useState(
    initialAppointmentId || "",
  );
  const [unitId, setUnitId] = useState(initialUnitId || "");
  const [terms, setTerms] = useState<ReceptionTermCatalogItem[]>([]);
  const [selectedTermId, setSelectedTermId] = useState("");
  const [manifestationConfirmed, setManifestationConfirmed] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [catalogRequest, setCatalogRequest] = useState(0);
  const [documentType, setDocumentType] = useState("laudo");
  const [documentNotes, setDocumentNotes] = useState("");
  const [pickupId, setPickupId] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientCpf, setRecipientCpf] = useState("");
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  useEffect(() => {
    if (initialAppointmentId) setAppointmentId(initialAppointmentId);
  }, [initialAppointmentId]);
  useEffect(() => {
    if (initialUnitId) setUnitId(initialUnitId);
  }, [initialUnitId]);
  useEffect(() => {
    let active = true;
    setCatalogLoading(true);
    setCatalogError("");

    void receptionCompletionService
      .listActiveTerms()
      .then((catalog) => {
        if (!active) return;
        setTerms(catalog);
        setSelectedTermId("");
        setManifestationConfirmed(false);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setTerms([]);
        setCatalogError(
          error instanceof Error
            ? error.message
            : "Não foi possível carregar os termos",
        );
      })
      .finally(() => {
        if (active) setCatalogLoading(false);
      });

    return () => {
      active = false;
    };
  }, [catalogRequest]);

  const selectedTerm = terms.find((term) => term.id === selectedTermId);

  const run = async (action: () => Promise<unknown>, title: string) => {
    setBusy(true);
    try {
      await action();
      toast({ title });
      if (onOperationCompleted) {
        try {
          await onOperationCompleted();
        } catch (error) {
          toast({
            title: "Registro concluído; atualização pendente",
            description: (error as Error).message,
            variant: "destructive",
          });
        }
      }
      return true;
    } catch (error) {
      toast({
        title: "Operação não concluída",
        description: error instanceof Error ? error.message : "Erro inesperado",
        variant: "destructive",
      });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleTermAcceptance = async () => {
    if (!selectedTerm || !manifestationConfirmed) return;

    const completed = await run(
      () =>
        receptionCompletionService.acceptTerm(
          patientId,
          selectedTerm,
          appointmentId || undefined,
          "manifestacao_presencial_confirmada",
        ),
      "Termo aceito e auditado",
    );

    if (completed) setManifestationConfirmed(false);
  };

  return (
    <section
      className="space-y-4 rounded-md border p-4"
      aria-labelledby="reception-operations-title"
    >
      <div>
        <h3 id="reception-operations-title" className="text-sm font-semibold">
          {mode === "checkin" ? "Aceites do check-in" : "Operações de recepção"}
        </h3>
        <p className="text-xs text-muted-foreground">
          {mode === "checkin"
            ? "Registre os termos exigidos antes de concluir. Valores ficam pendentes até confirmação no Financeiro."
            : "Registre termos, retiradas e atendimentos espontâneos. Pagamentos são confirmados somente no Financeiro."}
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {mode === "full" && (
          <div className="space-y-2">
            <Label htmlFor="reception-appointment">
              Agendamento relacionado
            </Label>
            <Input
              id="reception-appointment"
              value={appointmentId}
              onChange={(e) => setAppointmentId(e.target.value)}
              placeholder="ID do agendamento"
            />
          </div>
        )}
        {mode === "full" && (
          <div className="space-y-2">
            <Label htmlFor="reception-unit">
              Unidade (atendimento espontâneo)
            </Label>
            <Input
              id="reception-unit"
              value={unitId}
              onChange={(e) => setUnitId(e.target.value)}
              placeholder="ID da unidade"
            />
          </div>
        )}
        <div className="space-y-3">
          <Label htmlFor="reception-term-catalog">Aceite de termo</Label>
          <Select
            value={selectedTermId}
            onValueChange={(termId) => {
              setSelectedTermId(termId);
              setManifestationConfirmed(false);
            }}
            disabled={busy || catalogLoading || terms.length === 0}
          >
            <SelectTrigger
              id="reception-term-catalog"
              aria-label="Termo versionado do catálogo"
            >
              <SelectValue
                placeholder={
                  catalogLoading ? "Carregando termos..." : "Selecione o termo"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {terms.map((term) => (
                <SelectItem key={term.id} value={term.id}>
                  {term.title} — versão {term.version}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {catalogError && (
            <div className="space-y-2">
              <p role="alert" className="text-sm text-destructive">
                {catalogError}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setCatalogRequest((request) => request + 1)}
              >
                Tentar novamente
              </Button>
            </div>
          )}

          {!catalogLoading && !catalogError && terms.length === 0 && (
            <p role="status" className="text-sm text-muted-foreground">
              Nenhum termo ativo foi publicado para esta empresa.
            </p>
          )}

          {selectedTerm && (
            <div className="space-y-3">
              <div className="text-sm">
                <p className="font-medium">{selectedTerm.title}</p>
                <p className="text-xs text-muted-foreground">
                  Código {selectedTerm.code} · versão {selectedTerm.version}
                </p>
              </div>
              <div
                role="document"
                aria-label={`Conteúdo do termo ${selectedTerm.title}`}
                tabIndex={0}
                className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm"
              >
                {selectedTerm.content}
              </div>
              <div className="flex items-start gap-2">
                <Checkbox
                  id="reception-term-manifestation"
                  checked={manifestationConfirmed}
                  onCheckedChange={(checked) =>
                    setManifestationConfirmed(checked === true)
                  }
                  disabled={busy}
                />
                <Label
                  htmlFor="reception-term-manifestation"
                  className="cursor-pointer text-sm font-normal leading-5"
                >
                  Confirmo que o conteúdo foi apresentado e que o paciente ou
                  responsável manifestou concordância.
                </Label>
              </div>
            </div>
          )}

          <Button
            type="button"
            className="w-full"
            disabled={busy || !selectedTerm || !manifestationConfirmed}
            onClick={() => void handleTermAcceptance()}
          >
            Registrar aceite
          </Button>
        </div>
        {mode === "full" && (
          <div className="space-y-2">
            <Label htmlFor="reception-document">Retirada de documento</Label>
            <Input
              id="reception-document"
              value={documentType}
              onChange={(e) => setDocumentType(e.target.value)}
              placeholder="Tipo do documento"
            />
            <Textarea
              aria-label="Observação da retirada"
              value={documentNotes}
              onChange={(e) => setDocumentNotes(e.target.value)}
              placeholder="Observação"
            />
            <Button
              className="w-full"
              disabled={busy || !documentType}
              onClick={() =>
                void run(async () => {
                  const id =
                    await receptionCompletionService.requestDocumentPickup(
                      patientId,
                      documentType,
                      appointmentId || undefined,
                      documentNotes || undefined,
                    );
                  setPickupId(String(id));
                }, "Retirada solicitada")
              }
            >
              Solicitar retirada
            </Button>
            <Input
              aria-label="ID da retirada"
              value={pickupId}
              onChange={(e) => setPickupId(e.target.value)}
              placeholder="ID da retirada para entrega"
            />
            <Input
              aria-label="Nome do recebedor"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              placeholder="Nome de quem recebeu"
            />
            <Input
              aria-label="CPF do recebedor"
              value={recipientCpf}
              onChange={(e) => setRecipientCpf(e.target.value)}
              placeholder="CPF de quem recebeu"
            />
            <Button
              variant="outline"
              className="w-full"
              disabled={busy || !pickupId || !recipientName || !recipientCpf}
              onClick={() =>
                void run(
                  () =>
                    receptionCompletionService.releaseDocumentPickup(
                      pickupId,
                      recipientName,
                      recipientCpf,
                    ),
                  "Entrega registrada e auditada",
                )
              }
            >
              Registrar entrega
            </Button>
          </div>
        )}
        {mode === "full" && (
          <div className="space-y-2 md:col-span-2">
            <Label>Atendimento espontâneo</Label>
            <Button
              disabled={busy || !unitId}
              onClick={() =>
                void run(
                  () =>
                    receptionCompletionService.createWalkin(
                      patientId,
                      Number(unitId),
                      undefined,
                      undefined,
                    ),
                  "Atendimento espontâneo criado",
                )
              }
            >
              Criar encaixe de recepção
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
