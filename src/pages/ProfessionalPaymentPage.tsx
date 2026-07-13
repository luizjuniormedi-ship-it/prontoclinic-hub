import { useCallback, useEffect, useRef, useState } from "react";
import { Ban, Banknote, Check, ChevronLeft, ChevronRight, Search, TrendingUp, WalletCards } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "@/components/StateViews";
import { StatsCard } from "@/components/StatsCard";
import {
  createProfessionalPaymentIntentKey,
  professionalPaymentsService,
  todayInSaoPaulo,
  type ProfessionalPayment,
  type ProfessionalPaymentListFilters,
  type ProfessionalPaymentStatus,
  type ProfessionalPaymentTargetStatus,
} from "@/services/professionalPaymentsService";
import { unitsService } from "@/services/catalogService";
import { formatCurrency } from "@/utils/formatters";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/useDebounce";

const paymentStatusLabels = {
  apurado: "Apurado",
  conferido: "Conferido",
  pago: "Pago",
  cancelado: "Cancelado",
} as const;

const paymentStatusColors = {
  apurado: "bg-warning/10 text-warning",
  conferido: "bg-primary/10 text-primary",
  pago: "bg-success/10 text-success",
  cancelado: "bg-muted text-muted-foreground",
} as const;

const remTypeLabels = {
  FIXED: "Valor Fixo",
  PACKAGE: "Pacote",
  CH: "CH",
  PERCENTAGE: "Percentual",
} as const;

const PAGE_SIZE = 25;

type PendingAction = {
  paymentId: number;
  professionalName: string;
  targetStatus: ProfessionalPaymentTargetStatus;
  idempotencyKey: string;
  reason: string;
  paymentDate: string | null;
  error: string | null;
};

type LoadOptions = {
  preserveCurrentRows?: boolean;
  rethrow?: boolean;
};

type PaymentQuery = {
  page: number;
  search: string;
  status: ProfessionalPaymentStatus | "all";
  unitId: string | "all";
};

function actionTitle(targetStatus: ProfessionalPaymentTargetStatus): string {
  if (targetStatus === "conferido") return "Confirmar conferencia";
  if (targetStatus === "pago") return "Confirmar pagamento";
  return "Cancelar repasse";
}

function actionButtonLabel(targetStatus: ProfessionalPaymentTargetStatus, retry: boolean): string {
  if (retry) return "Tentar novamente";
  if (targetStatus === "conferido") return "Confirmar conferencia";
  if (targetStatus === "pago") return "Confirmar pagamento";
  return "Confirmar cancelamento";
}

function actionSuccessTitle(targetStatus: ProfessionalPaymentTargetStatus): string {
  if (targetStatus === "conferido") return "Repasse conferido";
  if (targetStatus === "pago") return "Repasse pago";
  return "Repasse cancelado";
}

export default function ProfessionalPaymentPage() {
  const [payments, setPayments] = useState<ProfessionalPayment[]>([]);
  const [units, setUnits] = useState<Array<{ id: string; name: string }>>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [query, setQuery] = useState<PaymentQuery>({
    page: 0,
    search: "",
    status: "all",
    unitId: "all",
  });
  const [loading, setLoading] = useState(true);
  const [unitsLoading, setUnitsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [unitsError, setUnitsError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const inFlightIntent = useRef<string | null>(null);
  const latestLoadRequest = useRef(0);
  const queryRef = useRef(query);
  queryRef.current = query;
  const { toast } = useToast();
  const debouncedSearch = useDebounce(searchInput, 300);

  useEffect(() => {
    const search = debouncedSearch.trim();
    setQuery((current) => current.search === search
      ? current
      : { ...current, page: 0, search });
  }, [debouncedSearch]);

  const requestPage = useCallback((activeQuery: PaymentQuery) => {
    const filters: ProfessionalPaymentListFilters = {
      limit: PAGE_SIZE,
      offset: activeQuery.page * PAGE_SIZE,
    };
    if (activeQuery.search) filters.search = activeQuery.search;
    if (activeQuery.status !== "all") filters.status = activeQuery.status;
    if (activeQuery.unitId !== "all") filters.unitId = Number(activeQuery.unitId);
    return professionalPaymentsService.list(filters);
  }, []);

  const load = useCallback(async (options: LoadOptions = {}) => {
    const preserveCurrentRows = options.preserveCurrentRows === true;
    const activeQuery = queryRef.current;
    const requestId = latestLoadRequest.current + 1;
    latestLoadRequest.current = requestId;
    if (!preserveCurrentRows) {
      setLoading(true);
      setLoadError(null);
    }
    try {
      const rows = await requestPage(activeQuery);
      if (requestId !== latestLoadRequest.current || queryRef.current !== activeQuery) return;
      if (rows.length === 0 && activeQuery.page > 0) {
        setQuery((current) => ({ ...current, page: Math.max(0, current.page - 1) }));
        return;
      }
      setPayments(rows);
      setTotalCount(rows[0]?.totalCount ?? 0);
    } catch (error) {
      if (requestId !== latestLoadRequest.current) return;
      if (!preserveCurrentRows) {
        setPayments([]);
        setTotalCount(0);
        setLoadError(error instanceof Error ? error.message : String(error));
      }
      if (options.rethrow) throw error;
    } finally {
      if (requestId === latestLoadRequest.current) setLoading(false);
    }
  }, [requestPage]);

  const loadUnits = useCallback(async () => {
    setUnitsLoading(true);
    setUnitsError(null);
    try {
      const rows = await unitsService.getAll();
      setUnits(rows.map(({ id, name }) => ({ id, name })));
    } catch (error) {
      setUnits([]);
      setUnitsError(error instanceof Error ? error.message : String(error));
    } finally {
      setUnitsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, query]);

  useEffect(() => {
    void loadUnits();
  }, [loadUnits]);

  const openAction = (payment: ProfessionalPayment, targetStatus: ProfessionalPaymentTargetStatus) => {
    try {
      setPendingAction({
        paymentId: payment.id,
        professionalName: payment.professionalName ?? `Profissional #${payment.professionalId}`,
        targetStatus,
        idempotencyKey: createProfessionalPaymentIntentKey(),
        reason: "",
        paymentDate: targetStatus === "pago" ? todayInSaoPaulo() : null,
        error: null,
      });
    } catch (error) {
      toast({
        title: "Nao foi possivel iniciar a acao",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  const confirmAction = async () => {
    if (!pendingAction || inFlightIntent.current) return;
    const reason = pendingAction.reason.trim();
    if (pendingAction.targetStatus === "cancelado" && !reason) {
      setPendingAction((current) => current ? { ...current, error: "Informe o motivo do cancelamento." } : current);
      return;
    }

    inFlightIntent.current = pendingAction.idempotencyKey;
    setActionPending(true);
    setPendingAction((current) => current ? { ...current, error: null } : current);
    try {
      await professionalPaymentsService.transition(
        pendingAction.paymentId,
        pendingAction.targetStatus,
        {
          idempotencyKey: pendingAction.idempotencyKey,
          reason: pendingAction.targetStatus === "cancelado" ? reason : null,
          paymentDate: pendingAction.paymentDate,
        },
      );
      await load({ preserveCurrentRows: true, rethrow: true });
      toast({ title: actionSuccessTitle(pendingAction.targetStatus) });
      setPendingAction(null);
    } catch (error) {
      setPendingAction((current) => current ? {
        ...current,
        error: error instanceof Error ? error.message : String(error),
      } : current);
    } finally {
      inFlightIntent.current = null;
      setActionPending(false);
    }
  };

  const totalPending = payments
    .filter((payment) => payment.status === "apurado" || payment.status === "conferido")
    .reduce((sum, payment) => sum + payment.totalValue, 0);
  const totalPaid = payments
    .filter((payment) => payment.status === "pago")
    .reduce((sum, payment) => sum + payment.totalValue, 0);
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const firstItem = totalCount === 0 ? 0 : query.page * PAGE_SIZE + 1;
  const lastItem = Math.min((query.page + 1) * PAGE_SIZE, totalCount);
  const hasFilters = query.search !== "" || query.status !== "all" || query.unitId !== "all";

  if (loading || unitsLoading) return <LoadingState message="Carregando repasses..." />;
  if (loadError || unitsError) {
    return (
      <ErrorState
        message={loadError ?? unitsError ?? "Erro ao carregar repasses"}
        onRetry={() => {
          if (loadError) void load();
          if (unitsError) void loadUnits();
        }}
      />
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Pagamento Medico" description="Repasses e remuneracao de profissionais" />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatsCard title="Total pendente nesta pagina" value={formatCurrency(totalPending)} icon={TrendingUp} variant="warning" />
        <StatsCard title="Total pago nesta pagina" value={formatCurrency(totalPaid)} icon={Banknote} variant="success" />
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[200px] max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Buscar repasses"
            placeholder="Buscar profissional..."
            className="pl-9"
            value={searchInput}
            maxLength={200}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>
        <Select
          value={query.status}
          onValueChange={(status) => setQuery((current) => ({
            ...current,
            page: 0,
            status: status as ProfessionalPaymentStatus | "all",
          }))}
        >
          <SelectTrigger aria-label="Filtrar por status" className="w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {Object.entries(paymentStatusLabels).map(([key, value]) => (
              <SelectItem key={key} value={key}>{value}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={query.unitId}
          onValueChange={(unitId) => setQuery((current) => ({ ...current, page: 0, unitId }))}
        >
          <SelectTrigger aria-label="Filtrar por unidade" className="w-[170px]">
            <SelectValue placeholder="Unidade" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            {units.map(({ id, name }) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {payments.length === 0 ? (
        <EmptyState
          icon={Banknote}
          title="Nenhum repasse"
          description={hasFilters
            ? "Nao ha repasses para os filtros selecionados."
            : "Cadastre repasses na producao medica para visualizar aqui."}
        />
      ) : (
        <div className="overflow-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Profissional</TableHead>
                <TableHead>Unidade</TableHead>
                <TableHead>Referencia</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Descricao</TableHead>
                <TableHead>Qtd</TableHead>
                <TableHead>%</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Acoes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map((payment) => (
                <TableRow key={payment.id} data-payment-id={payment.id}>
                  <TableCell className="text-sm font-medium">
                    {payment.professionalName ?? `Profissional #${payment.professionalId}`}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{payment.unitName ?? "-"}</TableCell>
                  <TableCell className="text-xs">
                    {new Date(`${payment.referenceDate}T00:00:00`).toLocaleDateString("pt-BR")}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="border-0 bg-primary/10 text-[10px] text-primary">
                      {remTypeLabels[payment.remunerationType]}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[150px] truncate text-xs text-muted-foreground">
                    {payment.referenceDescription ?? "-"}
                  </TableCell>
                  <TableCell className="text-xs">{payment.totalProcedures}</TableCell>
                  <TableCell className="text-xs">{payment.percentage.toFixed(1)}%</TableCell>
                  <TableCell className="text-sm font-medium">{formatCurrency(payment.totalValue)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`border-0 text-[10px] ${paymentStatusColors[payment.status]}`}>
                      {paymentStatusLabels[payment.status]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex min-w-max items-center gap-1">
                      {payment.status === "apurado" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openAction(payment, "conferido")}
                          disabled={actionPending}
                        >
                          <Check className="mr-1 h-4 w-4" />
                          Conferir
                        </Button>
                      )}
                      {payment.status === "conferido" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openAction(payment, "pago")}
                          disabled={actionPending}
                        >
                          <WalletCards className="mr-1 h-4 w-4" />
                          Pagar
                        </Button>
                      )}
                      {(payment.status === "apurado" || payment.status === "conferido") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openAction(payment, "cancelado")}
                          disabled={actionPending}
                        >
                          <Ban className="mr-1 h-4 w-4" />
                          Cancelar
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="flex items-center justify-between gap-3" aria-label="Paginacao de repasses">
        <p className="text-xs text-muted-foreground">
          {firstItem}-{lastItem} de {totalCount} repasses
        </p>
        <div className="flex gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8"
            aria-label="Pagina anterior"
            title="Pagina anterior"
            disabled={query.page === 0 || actionPending}
            onClick={() => setQuery((current) => ({ ...current, page: Math.max(0, current.page - 1) }))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8"
            aria-label="Proxima pagina"
            title="Proxima pagina"
            disabled={query.page >= totalPages - 1 || actionPending}
            onClick={() => setQuery((current) => ({ ...current, page: current.page + 1 }))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <AlertDialog
        open={pendingAction !== null}
        onOpenChange={(open) => {
          if (!open && !actionPending) setPendingAction(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingAction ? actionTitle(pendingAction.targetStatus) : "Confirmar acao"}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAction?.targetStatus === "pago"
                ? `Confirme explicitamente o pagamento do repasse de ${pendingAction.professionalName}.`
                : pendingAction?.targetStatus === "conferido"
                  ? `O repasse de ${pendingAction.professionalName} foi revisado e pode ser conferido?`
                  : `O repasse de ${pendingAction?.professionalName ?? "profissional"} sera cancelado.`}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {pendingAction?.targetStatus === "cancelado" && (
            <div className="space-y-2">
              <Label htmlFor="professional-payment-cancel-reason">Motivo do cancelamento</Label>
              <Textarea
                id="professional-payment-cancel-reason"
                value={pendingAction.reason}
                maxLength={1000}
                disabled={actionPending}
                onChange={(event) => setPendingAction((current) => current ? {
                  ...current,
                  reason: event.target.value,
                  error: null,
                } : current)}
              />
            </div>
          )}

          {pendingAction?.error && (
            <p role="alert" className="text-sm text-destructive">{pendingAction.error}</p>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionPending}>Voltar</AlertDialogCancel>
            <Button
              type="button"
              variant={pendingAction?.targetStatus === "cancelado" ? "destructive" : "default"}
              disabled={actionPending}
              onClick={() => void confirmAction()}
            >
              {actionPending
                ? "Processando..."
                : pendingAction
                  ? actionButtonLabel(pendingAction.targetStatus, pendingAction.error !== null)
                  : "Confirmar"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

