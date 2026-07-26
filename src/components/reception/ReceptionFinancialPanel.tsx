import { useEffect, useMemo, useState } from "react";
import {
  Banknote,
  CheckCircle2,
  CreditCard,
  FileCheck2,
  Landmark,
  Pencil,
  ReceiptText,
  WalletCards,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { Textarea } from "@/components/ui/textarea";
import { ExplainedActionButton } from "@/components/actions/ExplainedActionButton";
import {
  isReceptionGuideValid,
  receptionCheckoutService,
  type CollectionPolicy,
  type ReceptionCheckoutSummary,
  type ReceptionGuideType,
  type ReceptionPayerType,
  type ReceptionPaymentMethod,
} from "@/services/receptionCheckoutService";
import { useToast } from "@/hooks/use-toast";

interface ReceptionFinancialPanelProps {
  appointmentId: string;
  summary: ReceptionCheckoutSummary | null | undefined;
  onChanged: () => Promise<void>;
}

const payerLabels: Record<ReceptionPayerType, string> = {
  particular: "Particular",
  convenio: "Convênio",
  misto: "Convênio + particular",
  pacote: "Pacote",
  cortesia: "Cortesia autorizada",
  empresa: "Empresa ou parceiro",
};

const collectionLabels: Record<CollectionPolicy, string> = {
  before_checkin: "Receber antes do check-in",
  accounts_receivable: "Enviar saldo ao Contas a Receber",
  waived: "Sem cobrança ao paciente",
};

const guideLabels: Record<ReceptionGuideType, string> = {
  consulta: "Guia de consulta",
  sp_sadt: "Guia SP/SADT",
  internacao: "Solicitação de internação",
  honorario: "Honorário individual",
  outras_despesas: "Outras despesas",
};

const paymentLabels: Record<ReceptionPaymentMethod, string> = {
  dinheiro: "Dinheiro",
  pix: "Pix",
  debito: "Cartão de débito",
  credito: "Cartão de crédito",
  boleto: "Boleto",
  outro: "Outra forma",
};

function money(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value || 0);
}

function todayPlus(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export function ReceptionFinancialPanel({
  appointmentId,
  summary,
  onChanged,
}: ReceptionFinancialPanelProps) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [payerType, setPayerType] = useState<ReceptionPayerType>("particular");
  const [collectionPolicy, setCollectionPolicy] = useState<CollectionPolicy>("before_checkin");
  const [grossAmount, setGrossAmount] = useState("0");
  const [discountAmount, setDiscountAmount] = useState("0");
  const [patientAmount, setPatientAmount] = useState("0");
  const [insuranceAmount, setInsuranceAmount] = useState("0");
  const [dueDate, setDueDate] = useState(todayPlus(30));
  const [checkoutNotes, setCheckoutNotes] = useState("");
  const [guideType, setGuideType] = useState<ReceptionGuideType>("consulta");
  const [tissVersionId, setTissVersionId] = useState("");
  const [manualGuideNumber, setManualGuideNumber] = useState("");
  const [signatureMethod, setSignatureMethod] = useState("tablet");
  const [paymentMethod, setPaymentMethod] = useState<ReceptionPaymentMethod>("dinheiro");
  const [paymentAmount, setPaymentAmount] = useState("0");
  const [paymentReference, setPaymentReference] = useState("");
  const [installmentCount, setInstallmentCount] = useState("1");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [openingBalance, setOpeningBalance] = useState("0");
  const [paymentAttemptKey, setPaymentAttemptKey] = useState("");
  const [guideValidationErrors, setGuideValidationErrors] = useState<string[]>([]);

  useEffect(() => {
    if (!summary) return;
    setPayerType(summary.payer_type);
    setCollectionPolicy(summary.collection_policy);
    setGrossAmount(String(summary.gross_amount));
    setDiscountAmount(String(summary.discount_amount));
    setPatientAmount(String(summary.patient_responsibility_amount));
    setInsuranceAmount(String(summary.insurance_responsibility_amount));
    setPaymentAmount(String(summary.patient_pending_amount));
    setGuideType(summary.guide?.type || summary.suggested_guide_type || "consulta");
    setGuideValidationErrors(summary.guide?.validation_errors ?? []);
    const firstVersion = summary.active_tiss_versions[0];
    setTissVersionId(summary.guide ? "" : firstVersion ? String(firstVersion.id) : "");
    if (!summary.prepared) setEditing(true);
  }, [summary]);

  const gross = Number(grossAmount) || 0;
  const discount = Number(discountAmount) || 0;
  const amountsValid = gross >= 0 && discount >= 0 && discount <= gross;
  const net = amountsValid ? gross - discount : 0;
  const patientResponsibility = Number(patientAmount) || 0;
  const insuranceResponsibility = Number(insuranceAmount) || 0;
  const responsibilitiesValid = amountsValid
    && patientResponsibility >= 0
    && insuranceResponsibility >= 0
    && Math.abs((patientResponsibility + insuranceResponsibility) - net) <= 0.01;
  const paymentNeedsReference = paymentMethod !== "dinheiro";
  const paymentValue = Number(paymentAmount) || 0;
  const openingValue = Number(openingBalance) || 0;
  const guideNeedsSignature = Boolean(summary?.guide?.requires_signature);

  const accountStatus = useMemo(() => {
    if (!summary?.prepared) return { label: "Não preparada", variant: "destructive" as const };
    if (summary.patient_pending_amount > 0 && summary.collection_policy === "before_checkin") {
      return { label: "Pagamento pendente", variant: "destructive" as const };
    }
    if (summary.patient_pending_amount > 0) {
      return { label: "Contas a receber", variant: "outline" as const };
    }
    return { label: "Regularizada", variant: "secondary" as const };
  }, [summary]);

  const run = async (
    action: string,
    operation: () => Promise<unknown>,
    success: string,
  ): Promise<boolean> => {
    try {
      setBusyAction(action);
      await operation();
      await onChanged();
      toast({ title: success });
      return true;
    } catch (error) {
      toast({
        title: "Não foi possível concluir a ação",
        description: (error as Error).message,
        variant: "destructive",
      });
      return false;
    } finally {
      setBusyAction(null);
    }
  };

  const applyPayerDefaults = (value: ReceptionPayerType) => {
    setPayerType(value);
    if (value === "particular") {
      setPatientAmount(String(net));
      setInsuranceAmount("0");
      setCollectionPolicy(net > 0 ? "before_checkin" : "waived");
      return;
    }
    if (value === "cortesia") {
      setPatientAmount("0");
      setInsuranceAmount("0");
      setDiscountAmount(String(gross));
      setCollectionPolicy("waived");
      return;
    }
    const suggestedPatient = summary?.copay_amount ?? 0;
    setPatientAmount(String(Math.min(suggestedPatient, net)));
    setInsuranceAmount(String(Math.max(net - suggestedPatient, 0)));
    setCollectionPolicy(suggestedPatient > 0 ? "before_checkin" : "waived");
  };

  const prepareCheckout = async () => {
    const succeeded = await run("prepare", () => receptionCheckoutService.prepare({
      appointmentId,
      payerType,
      grossAmount: gross,
      discountAmount: discount,
      patientResponsibility,
      insuranceResponsibility,
      collectionPolicy,
      dueDate: collectionPolicy === "accounts_receivable" ? dueDate : undefined,
      notes: checkoutNotes,
    }), "Cobrança preparada e enviada aos módulos responsáveis");
    if (succeeded) setEditing(false);
  };

  const registerPayment = async () => {
    const attemptKey = paymentAttemptKey || `reception-${appointmentId}-${crypto.randomUUID()}`;
    if (!paymentAttemptKey) setPaymentAttemptKey(attemptKey);

    const succeeded = await run("payment", () => receptionCheckoutService.registerPayment({
      appointmentId,
      amount: paymentValue,
      paymentMethod,
      idempotencyKey: attemptKey,
      externalReference: paymentReference,
      installmentCount: Number(installmentCount) || 1,
      notes: paymentNotes,
    }), "Pagamento registrado e título atualizado");

    if (succeeded) {
      setPaymentAttemptKey("");
      setPaymentReference("");
      setPaymentNotes("");
    }
  };

  const validateGuide = async () => {
    if (!summary?.guide) return;

    try {
      setBusyAction("guide-validate");
      const nextSummary = await receptionCheckoutService.validateGuide(summary.guide.id);
      const validationErrors = nextSummary.guide?.validation_errors ?? [];
      setGuideValidationErrors(validationErrors);
      await onChanged();

      if (!isReceptionGuideValid(nextSummary)) {
        toast({
          title: "Guia TISS com pendências",
          description: validationErrors.length > 0
            ? validationErrors.join(" ")
            : "A validação não confirmou uma guia válida para assinatura ou faturamento.",
          variant: "destructive",
        });
        return;
      }

      toast({ title: "Guia TISS validada sem pendências" });
    } catch (error) {
      toast({
        title: "Não foi possível validar a guia TISS",
        description: (error as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusyAction(null);
    }
  };

  if (!summary) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground" role="status">
          Carregando pagador, valores, guia e pagamentos...
        </CardContent>
      </Card>
    );
  }

  return (
    <section aria-labelledby="reception-financial-title" className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id="reception-financial-title" className="text-sm font-semibold">Pagador, guia e cobrança</h3>
          <p className="text-xs text-muted-foreground">
            A Recepção prepara e recebe; o Faturamento completa a conta; o Financeiro concilia o dinheiro.
          </p>
        </div>
        <Badge variant={accountStatus.variant}>{accountStatus.label}</Badge>
      </div>

      {editing ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Preparar cobrança</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="reception-payer">Quem pagará?</Label>
                <Select value={payerType} onValueChange={(value) => applyPayerDefaults(value as ReceptionPayerType)}>
                  <SelectTrigger id="reception-payer"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(payerLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="reception-collection-policy">Como tratar o valor do paciente?</Label>
                <Select value={collectionPolicy} onValueChange={(value) => setCollectionPolicy(value as CollectionPolicy)}>
                  <SelectTrigger id="reception-collection-policy"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(collectionLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MoneyInput id="reception-gross" label="Valor bruto" value={grossAmount} onChange={setGrossAmount} />
              <MoneyInput id="reception-discount" label="Desconto" value={discountAmount} onChange={setDiscountAmount} />
              <MoneyInput id="reception-patient-amount" label="Responsabilidade do paciente" value={patientAmount} onChange={setPatientAmount} />
              <MoneyInput id="reception-insurance-amount" label="Responsabilidade do convênio" value={insuranceAmount} onChange={setInsuranceAmount} />
            </div>

            <div className={`rounded-md border p-3 text-xs ${amountsValid && responsibilitiesValid ? "border-success/30 bg-success/5" : "border-destructive/30 bg-destructive/5"}`}>
              Valor líquido: <strong>{money(net)}</strong> · Paciente + convênio: <strong>{money(patientResponsibility + insuranceResponsibility)}</strong>
              {!amountsValid && (
                <p className="mt-1 text-destructive">
                  O desconto deve ser maior ou igual a zero e não pode superar o valor bruto.
                </p>
              )}
              {!responsibilitiesValid && <p className="mt-1 text-destructive">A soma das responsabilidades deve ser igual ao valor líquido.</p>}
            </div>

            {collectionPolicy === "accounts_receivable" && (
              <div className="space-y-2">
                <Label htmlFor="reception-due-date">Vencimento do título</Label>
                <Input id="reception-due-date" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="reception-checkout-notes">Observação</Label>
              <Textarea
                id="reception-checkout-notes"
                value={checkoutNotes}
                onChange={(event) => setCheckoutNotes(event.target.value)}
                placeholder="Justificativa de desconto, pacote, cortesia ou condição de cobrança"
              />
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              {summary.prepared && (
                <ExplainedActionButton
                  label="Cancelar edição"
                  description="Descarta as alterações ainda não salvas e mantém a cobrança atual."
                  variant="outline"
                  onClick={() => setEditing(false)}
                  disabled={Boolean(busyAction)}
                />
              )}
              <ExplainedActionButton
                label="Preparar cobrança"
                description="Abre ou atualiza a pré-conta, separa a responsabilidade por pagador e cria o título do paciente quando necessário."
                icon={ReceiptText}
                loading={busyAction === "prepare"}
                loadingLabel="Preparando..."
                disabled={!amountsValid || !responsibilitiesValid || Boolean(busyAction)}
                disabledReason={
                  !amountsValid
                    ? "O desconto não pode superar o valor bruto."
                    : !responsibilitiesValid
                      ? "Corrija a divisão entre paciente e convênio antes de continuar."
                      : undefined
                }
                onClick={() => void prepareCheckout()}
              />
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <SummaryValue label="Pagador" value={payerLabels[summary.payer_type]} />
              <SummaryValue label="Valor líquido" value={money(summary.net_amount)} />
              <SummaryValue label="Paciente" value={money(summary.patient_responsibility_amount)} />
              <SummaryValue label="Convênio" value={money(summary.insurance_responsibility_amount)} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
              <p className="text-xs text-muted-foreground">
                {collectionLabels[summary.collection_policy]}
                {summary.receivable?.due_date ? ` · Vencimento ${new Date(`${summary.receivable.due_date}T12:00:00`).toLocaleDateString("pt-BR")}` : ""}
              </p>
              <ExplainedActionButton
                label="Editar cobrança"
                description="Permite corrigir pagador, desconto e responsabilidades sem criar uma segunda conta."
                icon={Pencil}
                size="sm"
                variant="outline"
                onClick={() => setEditing(true)}
                disabled={Boolean(busyAction)}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {summary.prepared && summary.requires_tiss_guide && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <FileCheck2 className="h-4 w-4" aria-hidden="true" />Guia TISS individual
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!summary.guide ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="reception-guide-type">Tipo de guia</Label>
                    <Select value={guideType} onValueChange={(value) => setGuideType(value as ReceptionGuideType)}>
                      <SelectTrigger id="reception-guide-type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(guideLabels).map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reception-tiss-version">Versão TISS</Label>
                    <Select value={tissVersionId} onValueChange={setTissVersionId}>
                      <SelectTrigger id="reception-tiss-version"><SelectValue placeholder="Selecione a versão vigente" /></SelectTrigger>
                      <SelectContent>
                        {summary.active_tiss_versions.map((version) => (
                          <SelectItem key={version.id} value={String(version.id)}>{version.version}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reception-manual-guide">Número externo, quando fornecido pela operadora</Label>
                  <Input
                    id="reception-manual-guide"
                    value={manualGuideNumber}
                    onChange={(event) => setManualGuideNumber(event.target.value)}
                    placeholder="Deixe vazio para numeração automática"
                  />
                </div>
                <div className="flex justify-end">
                  <ExplainedActionButton
                    label="Gerar guia TISS"
                    description="Cria a guia individual na versão selecionada e a vincula ao paciente, atendimento e pré-conta."
                    icon={FileCheck2}
                    loading={busyAction === "guide-generate"}
                    loadingLabel="Gerando..."
                    disabled={!tissVersionId || Boolean(busyAction)}
                    disabledReason={!tissVersionId ? "Selecione uma versão TISS ativa para gerar a guia." : undefined}
                    onClick={() => void run(
                      "guide-generate",
                      () => receptionCheckoutService.generateGuide(
                        appointmentId,
                        guideType,
                        Number(tissVersionId),
                        manualGuideNumber,
                      ),
                      "Guia TISS gerada e vinculada à conta",
                    )}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <SummaryValue label="Número" value={summary.guide.number} />
                  <SummaryValue label="Tipo" value={guideLabels[summary.guide.type]} />
                  <SummaryValue label="Versão" value={summary.guide.version} />
                  <SummaryValue label="Status" value={summary.guide.status.replace(/_/g, " ")} />
                </div>
                {guideValidationErrors.length > 0 && (
                  <div
                    className="rounded-md border border-destructive/30 bg-destructive/5 p-3"
                    role="alert"
                    aria-label="Pendências da validação TISS"
                  >
                    <p className="text-xs font-semibold text-destructive">
                      A guia ainda não está válida:
                    </p>
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-destructive">
                      {guideValidationErrors.map((validationError, index) => (
                        <li key={`${validationError}-${index}`}>{validationError}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
                  {summary.guide.status === "generated" && (
                    <ExplainedActionButton
                      label="Validar guia"
                      description="Confere os campos obrigatórios antes da assinatura ou uso no faturamento."
                      icon={FileCheck2}
                      loading={busyAction === "guide-validate"}
                      disabled={Boolean(busyAction)}
                      onClick={() => void validateGuide()}
                    />
                  )}
                  {summary.guide.status === "validated" && guideNeedsSignature && (
                    <>
                      <p className="w-full text-xs text-muted-foreground">
                        Este registro informa apenas o método declarado. Nenhuma imagem, biometria ou artefato de assinatura é capturado por esta tela.
                      </p>
                      <Select value={signatureMethod} onValueChange={setSignatureMethod}>
                        <SelectTrigger className="w-[180px]" aria-label="Método de assinatura"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="tablet">Método informado: tablet</SelectItem>
                          <SelectItem value="digital">Método informado: digital</SelectItem>
                          <SelectItem value="physical">Método informado: guia física</SelectItem>
                          <SelectItem value="biometric">Método informado: biometria</SelectItem>
                        </SelectContent>
                      </Select>
                      <ExplainedActionButton
                        label="Registrar método da assinatura"
                        description="Registra somente o método informado, o usuário e o momento. Esta ação não captura nem armazena o artefato da assinatura."
                        icon={CheckCircle2}
                        loading={busyAction === "guide-sign"}
                        disabled={Boolean(busyAction)}
                        onClick={() => void run(
                          "guide-sign",
                          () => receptionCheckoutService.signGuide(summary.guide!.id, signatureMethod),
                          "Método da assinatura registrado",
                        )}
                      />
                    </>
                  )}
                  {summary.guide.status === "signed" && (
                    <Badge variant="secondary" className="gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />Método de assinatura registrado
                    </Badge>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {summary.prepared && summary.patient_responsibility_amount > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <WalletCards className="h-4 w-4" aria-hidden="true" />Pagamento do paciente
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <SummaryValue label="Devido" value={money(summary.patient_responsibility_amount)} />
              <SummaryValue label="Recebido" value={money(summary.patient_paid_amount)} />
              <SummaryValue label="Saldo" value={money(summary.patient_pending_amount)} emphasize={summary.patient_pending_amount > 0} />
              <SummaryValue label="Destino" value={summary.collection_policy === "accounts_receivable" ? "Contas a Receber" : "Recepção"} />
            </div>

            {summary.patient_pending_amount <= 0 ? (
              <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/5 p-3 text-sm text-success">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />Pagamento do paciente regularizado.
              </div>
            ) : (
              <>
                {summary.collection_policy === "accounts_receivable" && (
                  <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                    O título foi criado no Contas a Receber. O check-in não será bloqueado, mas o saldo continuará visível para cobrança e conciliação.
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <MoneyInput id="reception-payment-amount" label="Valor a receber agora" value={paymentAmount} onChange={setPaymentAmount} />
                  <div className="space-y-2">
                    <Label htmlFor="reception-payment-method">Forma de pagamento</Label>
                    <Select value={paymentMethod} onValueChange={(value) => setPaymentMethod(value as ReceptionPaymentMethod)}>
                      <SelectTrigger id="reception-payment-method"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(paymentLabels).map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {paymentMethod === "credito" && (
                    <div className="space-y-2">
                      <Label htmlFor="reception-installments">Parcelas</Label>
                      <Select value={installmentCount} onValueChange={setInstallmentCount}>
                        <SelectTrigger id="reception-installments"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: 12 }, (_, index) => index + 1).map((count) => (
                            <SelectItem key={count} value={String(count)}>{count}x</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {paymentNeedsReference && (
                    <div className="space-y-2">
                      <Label htmlFor="reception-payment-reference">Comprovante, NSU ou referência</Label>
                      <Input
                        id="reception-payment-reference"
                        value={paymentReference}
                        onChange={(event) => setPaymentReference(event.target.value)}
                        placeholder="Obrigatório para esta forma"
                      />
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="reception-payment-notes">Observação do pagamento</Label>
                  <Input
                    id="reception-payment-notes"
                    value={paymentNotes}
                    onChange={(event) => setPaymentNotes(event.target.value)}
                    placeholder="Opcional"
                  />
                </div>

                {paymentMethod === "dinheiro" && !summary.cash_session_open && (
                  <div className="flex flex-col gap-2 rounded-md border border-warning/30 bg-warning/5 p-3 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <p className="text-sm font-medium">Caixa fechado</p>
                      <p className="text-xs text-muted-foreground">Abra o caixa para registrar dinheiro e incluir o valor no fechamento do operador.</p>
                    </div>
                    <div className="flex items-end gap-2">
                      <MoneyInput id="reception-opening-balance" label="Saldo inicial" value={openingBalance} onChange={setOpeningBalance} compact />
                      <ExplainedActionButton
                        label="Abrir caixa"
                        description="Abre o caixa desta unidade e operador para registrar recebimentos em dinheiro."
                        icon={Landmark}
                        size="sm"
                        loading={busyAction === "cash-open"}
                        disabled={openingValue < 0 || Boolean(busyAction)}
                        onClick={() => void run(
                          "cash-open",
                          () => receptionCheckoutService.openCashSession(openingValue, "Abertura pela Recepção"),
                          "Caixa aberto para recebimentos",
                        )}
                      />
                    </div>
                  </div>
                )}

                <div className="flex justify-end">
                  <ExplainedActionButton
                    label="Registrar pagamento"
                    description="Vincula o pagamento ao título; dinheiro movimenta o caixa e cartão cria recebíveis da adquirente."
                    icon={paymentMethod === "dinheiro" ? Banknote : CreditCard}
                    loading={busyAction === "payment"}
                    loadingLabel="Registrando..."
                    disabled={
                      paymentValue <= 0
                      || paymentValue > summary.patient_pending_amount + 0.01
                      || (paymentNeedsReference && !paymentReference.trim())
                      || (paymentMethod === "dinheiro" && !summary.cash_session_open)
                      || Boolean(busyAction)
                    }
                    disabledReason={
                      paymentValue <= 0
                        ? "Informe um valor maior que zero."
                        : paymentValue > summary.patient_pending_amount + 0.01
                          ? "O valor não pode superar o saldo do paciente."
                          : paymentNeedsReference && !paymentReference.trim()
                            ? "Informe o comprovante, NSU ou referência externa."
                            : paymentMethod === "dinheiro" && !summary.cash_session_open
                              ? "Abra o caixa antes de receber em dinheiro."
                              : undefined
                    }
                    onClick={() => void registerPayment()}
                  />
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function MoneyInput({
  id,
  label,
  value,
  onChange,
  compact = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  return (
    <div className={`space-y-2 ${compact ? "w-32" : ""}`}>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min="0"
        step="0.01"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function SummaryValue({
  label,
  value,
  emphasize = false,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`text-sm font-semibold ${emphasize ? "text-destructive" : ""}`}>{value}</p>
    </div>
  );
}
