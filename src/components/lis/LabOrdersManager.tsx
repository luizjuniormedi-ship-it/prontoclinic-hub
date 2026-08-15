/**
 * LabOrdersManager — UI principal do módulo LIS/Laboratório
 *
 * Abas:
 *   - Catálogo: CRUD de exames (sigla, TUSS, LOINC, valores de referência)
 *   - Pedidos: Lista de pedidos com filtros (status, paciente, médico, data)
 *   - Coleta: Marcar pedido como coletado
 *   - Resultados: Inserir resultados com classificação automática
 *   - Alertas Críticos: Lista de valores críticos pendentes
 *
 * Migration: 20260101000018_lis.sql
 */

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Plus,
  Pencil,
  TestTube,
  FlaskConical,
  ListOrdered,
  Syringe,
  FileText,
  AlertTriangle,
  Trash2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { LabResultForm } from "./LabResultForm";
import { CriticalAlertsBanner } from "./CriticalAlertsBanner";
import {
  catalogo,
  pedido as pedidoService,
  alerta as alertaService,
  LAB_CATEGORIAS,
  LAB_MATERIAIS,
  LAB_STATUS_OPTIONS,
  type ExameCatalogo,
  type LabExamCategoria,
  type LabMaterial,
  type LabPedidoStatus,
  type PedidoLab,
} from "@/services/lisService";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/components/ui/use-toast";
import { formatCurrency } from "@/utils/formatters";
import { EmptyState, ErrorState, LoadingState } from "@/components/StateViews";

function statusBadge(status: LabPedidoStatus): { label: string; cls: string } {
  const map: Record<LabPedidoStatus, { label: string; cls: string }> = {
    PENDENTE: { label: "Pendente", cls: "bg-gray-100 text-gray-800" },
    COLETADO: { label: "Coletado", cls: "bg-blue-100 text-blue-800" },
    EM_ANALISE: { label: "Em análise", cls: "bg-yellow-100 text-yellow-800" },
    LIBERADO: { label: "Liberado", cls: "bg-green-100 text-green-800" },
    ENTREGUE: { label: "Entregue", cls: "bg-emerald-100 text-emerald-800" },
    CANCELADO: { label: "Cancelado", cls: "bg-red-100 text-red-800" },
  };
  return map[status] ?? { label: status, cls: "bg-gray-100" };
}

function prioridadeBadge(p: string): { cls: string } {
  if (p === "EMERGENCIA") return { cls: "bg-red-100 text-red-800" };
  if (p === "URGENTE") return { cls: "bg-amber-100 text-amber-800" };
  return { cls: "bg-gray-100 text-gray-700" };
}

export function LabOrdersManager() {
  const { companyId, user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState("pedidos");

  // Catálogo filters
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategoria, setFilterCategoria] = useState<string>("");
  const [filterMaterial, setFilterMaterial] = useState<string>("");

  // Pedido filters
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterDataInicio, setFilterDataInicio] = useState("");
  const [filterDataFim, setFilterDataFim] = useState("");

  // Modals
  const [catalogoModal, setCatalogoModal] = useState<{ open: boolean; editing: ExameCatalogo | null }>({
    open: false,
    editing: null,
  });
  const [novoPedidoModal, setNovoPedidoModal] = useState(false);
  const [resultadoItem, setResultadoItem] = useState<{ cdItemPedido: number; cdExame: number; dsExame: string } | null>(null);

  // Catálogo
  const {
    data: catalogoData,
    error: catalogoError,
    isError: catalogoIsError,
    isLoading: loadingCatalogo,
    refetch: refetchCatalogo,
  } = useQuery({
    queryKey: ["lab-catalogo", companyId, searchTerm, filterCategoria, filterMaterial],
    queryFn: () =>
      catalogo.getAll(companyId!, {
        search: searchTerm || undefined,
        categoria: (filterCategoria as LabExamCategoria) || undefined,
        material: (filterMaterial as LabMaterial) || undefined,
        ativo: true,
      }),
    enabled: !!companyId,
  });

  // Pedidos
  const {
    data: pedidosData,
    error: pedidosError,
    isError: pedidosIsError,
    isLoading: loadingPedidos,
    refetch: refetchPedidos,
  } = useQuery({
    queryKey: ["lab-pedidos", companyId, filterStatus, filterDataInicio, filterDataFim],
    queryFn: () =>
      pedidoService.listar(companyId!, {
        tp_status: (filterStatus as LabPedidoStatus) || undefined,
        dt_inicio: filterDataInicio || undefined,
        dt_fim: filterDataFim || undefined,
      }),
    enabled: !!companyId,
  });

  // Alertas
  const { data: alertas } = useQuery({
    queryKey: ["lab-alertas-pendentes", companyId],
    queryFn: () => alertaService.listarPendentes(companyId!),
    enabled: !!companyId,
    refetchInterval: 30_000,
  });

  const filteredCatalogo = useMemo(() => {
    return catalogoData ?? [];
  }, [catalogoData]);

  const filteredPedidos = useMemo(() => {
    return pedidosData ?? [];
  }, [pedidosData]);

  // Mutations
  const createCatalogoMutation = useMutation({
    mutationFn: (payload: Omit<ExameCatalogo, "id" | "created_at" | "updated_at">) =>
      catalogo.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lab-catalogo"] });
      setCatalogoModal({ open: false, editing: null });
      toast({ title: "Exame cadastrado com sucesso" });
    },
    onError: (e: Error) => toast({ title: "Erro ao cadastrar", description: e.message, variant: "destructive" }),
  });

  const updateCatalogoMutation = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<ExameCatalogo> }) =>
      catalogo.update(id, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lab-catalogo"] });
      setCatalogoModal({ open: false, editing: null });
      toast({ title: "Exame atualizado" });
    },
    onError: (e: Error) => toast({ title: "Erro ao atualizar", description: e.message, variant: "destructive" }),
  });

  const cancelarPedidoMutation = useMutation({
    mutationFn: (id: number) => pedidoService.atualizarStatus(id, "CANCELADO"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lab-pedidos"] });
      toast({ title: "Pedido cancelado" });
    },
    onError: (e: Error) =>
      toast({
        title: "Erro ao cancelar pedido",
        description: e.message,
        variant: "destructive",
      }),
  });

  if (!companyId) {
    return (
      <ErrorState message="Não foi possível identificar a empresa vinculada à sessão." />
    );
  }

  return (
    <div className="space-y-4">
      <CriticalAlertsBanner />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5" />
            Módulo LIS — Laboratório
          </CardTitle>
          <CardDescription>
            Catálogo de exames, pedidos, resultados (HL7 v2.5) e alertas críticos
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-5">
              <TabsTrigger value="pedidos" className="min-h-10 text-xs sm:text-sm">
                <ListOrdered className="h-4 w-4 mr-2" />
                Pedidos
              </TabsTrigger>
              <TabsTrigger value="catalogo" className="min-h-10 text-xs sm:text-sm">
                <TestTube className="h-4 w-4 mr-2" />
                Catálogo
              </TabsTrigger>
              <TabsTrigger value="coleta" className="min-h-10 text-xs sm:text-sm">
                <Syringe className="h-4 w-4 mr-2" />
                Coleta
              </TabsTrigger>
              <TabsTrigger value="resultados" className="min-h-10 text-xs sm:text-sm">
                <FileText className="h-4 w-4 mr-2" />
                Resultados
              </TabsTrigger>
              <TabsTrigger value="alertas" className="col-span-2 min-h-10 text-xs sm:col-span-1 sm:text-sm">
                <AlertTriangle className="h-4 w-4 mr-2" />
                Alertas
                {alertas && alertas.length > 0 && (
                  <Badge variant="destructive" className="ml-2">
                    {alertas.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            {/* ABA: PEDIDOS */}
            <TabsContent value="pedidos" className="space-y-4">
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <Label>Status</Label>
                  <Select value={filterStatus || "all"} onValueChange={(value) => setFilterStatus(value === "all" ? "" : value)}>
                    <SelectTrigger className="w-40">
                      <SelectValue placeholder="Todos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      {LAB_STATUS_OPTIONS.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>De</Label>
                  <Input
                    type="date"
                    value={filterDataInicio}
                    onChange={(e) => setFilterDataInicio(e.target.value)}
                    className="w-40"
                  />
                </div>
                <div>
                  <Label>Até</Label>
                  <Input
                    type="date"
                    value={filterDataFim}
                    onChange={(e) => setFilterDataFim(e.target.value)}
                    className="w-40"
                  />
                </div>
                <div className="ml-auto">
                  <Button onClick={() => setNovoPedidoModal(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Novo pedido
                  </Button>
                </div>
              </div>

              {loadingPedidos ? (
                <LoadingState message="Carregando pedidos laboratoriais..." />
              ) : pedidosIsError ? (
                <ErrorState
                  message={pedidosError?.message || "Não foi possível carregar os pedidos laboratoriais."}
                  onRetry={() => void refetchPedidos()}
                />
              ) : filteredPedidos.length === 0 ? (
                <EmptyState
                  icon={ListOrdered}
                  title="Nenhum pedido encontrado"
                  description="Ajuste os filtros ou crie um novo pedido laboratorial."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Paciente</TableHead>
                      <TableHead>Médico</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Prioridade</TableHead>
                      <TableHead>Exames</TableHead>
                      <TableHead>Data</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredPedidos.map((p) => {
                      const sb = statusBadge(p.tp_status);
                      const pb = prioridadeBadge(p.tp_prioridade);
                      return (
                        <TableRow key={p.id}>
                          <TableCell>{p.id}</TableCell>
                          <TableCell>{p.paciente_nome ?? "—"}</TableCell>
                          <TableCell>{p.medico_nome ?? "—"}</TableCell>
                          <TableCell>
                            <Badge className={sb.cls}>{sb.label}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge className={pb.cls}>{p.tp_prioridade}</Badge>
                          </TableCell>
                          <TableCell>{p.itens_count ?? 0}</TableCell>
                          <TableCell>
                            {new Date(p.dt_pedido).toLocaleDateString("pt-BR")}
                          </TableCell>
                          <TableCell className="text-right space-x-1">
                            {p.tp_status === "PENDENTE" && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setActiveTab("coleta")}
                              >
                                Registrar coleta
                              </Button>
                            )}
                            {(p.tp_status === "PENDENTE" || p.tp_status === "COLETADO") && (
                              <Button
                                aria-label={`Cancelar pedido ${p.id}`}
                                size="sm"
                                variant="ghost"
                                onClick={() => cancelarPedidoMutation.mutate(p.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </TabsContent>

            {/* ABA: CATÁLOGO */}
            <TabsContent value="catalogo" className="space-y-4">
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex-1 min-w-[200px]">
                  <Label>Buscar</Label>
                  <Input
                    placeholder="Nome, sigla ou TUSS..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Categoria</Label>
                  <Select value={filterCategoria || "all"} onValueChange={(value) => setFilterCategoria(value === "all" ? "" : value)}>
                    <SelectTrigger className="w-44">
                      <SelectValue placeholder="Todas" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas</SelectItem>
                      {LAB_CATEGORIAS.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Material</Label>
                  <Select value={filterMaterial || "all"} onValueChange={(value) => setFilterMaterial(value === "all" ? "" : value)}>
                    <SelectTrigger className="w-32">
                      <SelectValue placeholder="Todos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      {LAB_MATERIAIS.map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="ml-auto">
                  <Button
                    onClick={() => setCatalogoModal({ open: true, editing: null })}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Novo exame
                  </Button>
                </div>
              </div>

              {loadingCatalogo ? (
                <LoadingState message="Carregando catálogo de exames..." />
              ) : catalogoIsError ? (
                <ErrorState
                  message={catalogoError?.message || "Não foi possível carregar o catálogo de exames."}
                  onRetry={() => void refetchCatalogo()}
                />
              ) : filteredCatalogo.length === 0 ? (
                <EmptyState
                  icon={TestTube}
                  title="Nenhum exame no catálogo"
                  description="Ajuste os filtros ou cadastre o primeiro exame."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sigla</TableHead>
                      <TableHead>Exame</TableHead>
                      <TableHead>Categoria</TableHead>
                      <TableHead>Material</TableHead>
                      <TableHead>TUSS</TableHead>
                      <TableHead>LOINC</TableHead>
                      <TableHead>Prazo</TableHead>
                      <TableHead>Particular</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredCatalogo.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-mono">{c.ds_sigla}</TableCell>
                        <TableCell>{c.ds_exame}</TableCell>
                        <TableCell>
                          {c.ds_categoria && <Badge variant="outline">{c.ds_categoria}</Badge>}
                        </TableCell>
                        <TableCell>{c.ds_material ?? "—"}</TableCell>
                        <TableCell className="font-mono text-xs">{c.cd_tuss ?? "—"}</TableCell>
                        <TableCell className="font-mono text-xs">{c.cd_loinc ?? "—"}</TableCell>
                        <TableCell>{c.nr_prazo_dias}d</TableCell>
                        <TableCell>
                          {c.vl_particular === null || c.vl_particular === undefined
                            ? "—"
                            : formatCurrency(c.vl_particular)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setCatalogoModal({ open: true, editing: c })}
                            aria-label={`Editar ${c.ds_exame}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>

            {/* ABA: COLETA */}
            <TabsContent value="coleta" className="space-y-4">
              <ColetaTab companyId={companyId!} />
            </TabsContent>

            {/* ABA: RESULTADOS */}
            <TabsContent value="resultados" className="space-y-4">
              <ResultadosTab
                companyId={companyId!}
                onOpenItem={(item) =>
                  setResultadoItem({
                    cdItemPedido: item.id,
                    cdExame: item.cd_exame,
                    dsExame: item.exame_nome || item.exame_sigla || "Exame",
                  })
                }
              />
            </TabsContent>

            {/* ABA: ALERTAS */}
            <TabsContent value="alertas" className="space-y-4">
              <AlertasTab userId={user?.id} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Modais */}
      {catalogoModal.open && (
        <CatalogoFormModal
          companyId={companyId!}
          editing={catalogoModal.editing}
          onClose={() => setCatalogoModal({ open: false, editing: null })}
          onSubmit={(payload) => {
            if (catalogoModal.editing) {
              updateCatalogoMutation.mutate({ id: catalogoModal.editing.id, patch: payload });
            } else {
              createCatalogoMutation.mutate(payload);
            }
          }}
        />
      )}

      {novoPedidoModal && (
        <NovoPedidoModal
          companyId={companyId!}
          onClose={() => setNovoPedidoModal(false)}
          onCreated={() => {
            queryClient.invalidateQueries({ queryKey: ["lab-pedidos"] });
            setNovoPedidoModal(false);
          }}
        />
      )}

      {resultadoItem && (
        <Dialog open onOpenChange={() => setResultadoItem(null)}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Resultado — {resultadoItem.dsExame}</DialogTitle>
              <DialogDescription>
                Registre os parâmetros do item selecionado e libere somente após conferência.
              </DialogDescription>
            </DialogHeader>
            <LabResultForm
              cdItemPedido={resultadoItem.cdItemPedido}
              cdExame={resultadoItem.cdExame}
              userId={user?.id}
              onSaved={() => {
                setResultadoItem(null);
                queryClient.invalidateQueries({ queryKey: ["lab-pedidos"] });
                queryClient.invalidateQueries({ queryKey: ["lab-alertas-pendentes"] });
              }}
              onCancel={() => setResultadoItem(null)}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ── Sub-componente: aba Coleta ───────────────────────────────────────────────
function ColetaTab({ companyId }: { companyId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [sampleIds, setSampleIds] = useState<Record<number, string>>({});

  const {
    data: pedidosColeta,
    error,
    isError,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["lab-pedidos-coleta", companyId],
    queryFn: () =>
      pedidoService.listar(companyId, {
        tp_status: ["PENDENTE", "COLETADO"],
      }),
    enabled: !!companyId,
  });

  const {
    data: selectedOrder,
    error: selectedOrderError,
    isError: selectedOrderIsError,
    isLoading: selectedOrderIsLoading,
    refetch: refetchSelectedOrder,
  } = useQuery({
    queryKey: ["lab-pedido-coleta-detail", selectedOrderId],
    queryFn: () => pedidoService.getById(selectedOrderId!),
    enabled: selectedOrderId !== null,
  });

  const marcarColetado = useMutation({
    mutationFn: ({ itemId, sampleId }: { itemId: number; sampleId: string }) =>
      pedidoService.marcarColetado(itemId, sampleId),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["lab-pedidos-coleta"] });
      queryClient.invalidateQueries({ queryKey: ["lab-pedidos"] });
      await queryClient.invalidateQueries({
        queryKey: ["lab-pedido-coleta-detail", selectedOrderId],
      });
      toast({ title: "Amostra coletada e identificada" });
    },
    onError: (mutationError: Error) =>
      toast({
        title: "Erro ao registrar coleta",
        description: mutationError.message,
        variant: "destructive",
      }),
  });

  if (isLoading) return <LoadingState message="Carregando pedidos para coleta..." />;
  if (isError) {
    return (
      <ErrorState
        message={error?.message || "Não foi possível carregar a fila de coleta."}
        onRetry={() => void refetch()}
      />
    );
  }
  if (!pedidosColeta || pedidosColeta.length === 0) {
    return (
      <EmptyState
        icon={Syringe}
        title="Nenhum pedido aguardando coleta"
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pedido</TableHead>
              <TableHead>Paciente</TableHead>
              <TableHead>Exames</TableHead>
              <TableHead>Prioridade</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pedidosColeta.map((p: PedidoLab) => {
              const sb = statusBadge(p.tp_status);
              return (
                <TableRow key={p.id}>
                  <TableCell>#{p.id}</TableCell>
                  <TableCell>{p.paciente_nome}</TableCell>
                  <TableCell>{p.itens_count}</TableCell>
                  <TableCell>
                    <Badge className={prioridadeBadge(p.tp_prioridade).cls}>
                      {p.tp_prioridade}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge className={sb.cls}>{sb.label}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      onClick={() => {
                        setSampleIds({});
                        setSelectedOrderId(p.id);
                      }}
                    >
                      {p.tp_status === "PENDENTE"
                        ? "Registrar amostras"
                        : "Revisar amostras"}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog
        open={selectedOrderId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedOrderId(null);
            setSampleIds({});
          }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Coleta do pedido #{selectedOrderId}</DialogTitle>
            <DialogDescription>
              Identifique cada amostra antes de confirmar a coleta. O código não
              poderá ser alterado depois do registro.
            </DialogDescription>
          </DialogHeader>

          {selectedOrderIsLoading ? (
            <LoadingState message="Carregando itens para coleta..." />
          ) : selectedOrderIsError ? (
            <ErrorState
              message={
                selectedOrderError?.message ||
                "Não foi possível carregar os itens para coleta."
              }
              onRetry={() => void refetchSelectedOrder()}
            />
          ) : !selectedOrder || selectedOrder.itens.length === 0 ? (
            <EmptyState
              icon={TestTube}
              title="Pedido sem itens para coleta"
            />
          ) : (
            <div className="divide-y rounded-md border">
              {selectedOrder.itens.map((item) => {
                const collected = item.tp_status !== "PENDENTE";
                const sampleId = collected
                  ? item.ds_amostra_id ?? ""
                  : sampleIds[item.id] ?? "";
                return (
                  <div key={item.id} className="space-y-3 p-3">
                    <div>
                      <p className="font-medium">
                        {item.exame_nome ||
                          item.exame_sigla ||
                          `Exame #${item.cd_exame}`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Item #{item.id} • {statusBadge(item.tp_status).label}
                      </p>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                      <div className="space-y-1">
                        <Label htmlFor={`sample-${item.id}`}>
                          Identificador da amostra
                        </Label>
                        <Input
                          id={`sample-${item.id}`}
                          maxLength={50}
                          required
                          disabled={collected}
                          value={sampleId}
                          onChange={(event) =>
                            setSampleIds((current) => ({
                              ...current,
                              [item.id]: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <Button
                        size="sm"
                        disabled={
                          collected ||
                          marcarColetado.isPending ||
                          sampleId.trim().length === 0
                        }
                        onClick={() =>
                          marcarColetado.mutate({
                            itemId: item.id,
                            sampleId: sampleId.trim(),
                          })
                        }
                      >
                        {collected ? "Coleta registrada" : "Confirmar coleta"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Sub-componente: aba Resultados ────────────────────────────────────────────
function ResultadosTab({
  companyId,
  onOpenItem,
}: {
  companyId: string;
  onOpenItem: (item: { id: number; cd_exame: number; exame_nome?: string; exame_sigla?: string }) => void;
}) {
  const {
    data: pedidos,
    error,
    isError,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["lab-pedidos-analise", companyId],
    queryFn: () =>
      pedidoService.listar(companyId, {
        tp_status: ["EM_ANALISE", "COLETADO"],
      }),
    enabled: !!companyId,
  });

  if (isLoading) return <LoadingState message="Carregando pedidos em análise..." />;
  if (isError) {
    return (
      <ErrorState
        message={error?.message || "Não foi possível carregar os pedidos em análise."}
        onRetry={() => void refetch()}
      />
    );
  }
  if (!pedidos || pedidos.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="Nenhum pedido em análise"
      />
    );
  }

  return (
    <div className="space-y-3">
      {pedidos.map((p) => (
        <ResultadoPedidoCard key={p.id} pedido={p} onOpenItem={onOpenItem} />
      ))}
    </div>
  );
}

function ResultadoPedidoCard({
  pedido,
  onOpenItem,
}: {
  pedido: PedidoLab;
  onOpenItem: (item: { id: number; cd_exame: number; exame_nome?: string; exame_sigla?: string }) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const {
    data: detail,
    error,
    isError,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["lab-pedido-detail", pedido.id],
    queryFn: () => pedidoService.getById(pedido.id),
    enabled: expanded,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Pedido #{pedido.id} — {pedido.paciente_nome}
        </CardTitle>
        <CardDescription>
          {pedido.itens_count} exame(s) • {pedido.medico_nome} •{" "}
          {new Date(pedido.dt_pedido).toLocaleString("pt-BR")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button
          variant="outline"
          size="sm"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 mr-2" />
          ) : (
            <ChevronRight className="h-4 w-4 mr-2" />
          )}
          {expanded ? "Ocultar itens" : "Ver itens"}
        </Button>

        {expanded && (
          isLoading ? (
            <LoadingState message="Carregando itens do pedido..." />
          ) : isError ? (
            <ErrorState
              message={error?.message || "Não foi possível carregar os itens do pedido."}
              onRetry={() => void refetch()}
            />
          ) : !detail || detail.itens.length === 0 ? (
            <EmptyState
              icon={TestTube}
              title="Pedido sem itens"
              description="Este pedido não pode receber resultados."
            />
          ) : (
            <div className="divide-y rounded-md border">
              {detail.itens.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-3"
                >
                  <div>
                    <p className="font-medium">
                      {item.exame_nome || item.exame_sigla || `Exame #${item.cd_exame}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Item #{item.id} • {statusBadge(item.tp_status).label}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => onOpenItem(item)}
                    disabled={item.tp_status === "LIBERADO" || item.tp_status === "CANCELADO"}
                  >
                    Inserir resultado
                  </Button>
                </div>
              ))}
            </div>
          )
        )}
      </CardContent>
    </Card>
  );
}

// ── Sub-componente: aba Alertas ───────────────────────────────────────────────
function AlertasTab({ userId }: { userId?: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const {
    data: alertas,
    error,
    isError,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["lab-alertas-pendentes", userId],
    queryFn: () => alertaService.listarPendentes(),
  });

  const comunicarMutation = useMutation({
    mutationFn: ({ id, forma }: { id: number; forma: "TELEFONE" | "SMS" | "PRESENCIAL" | "WHATSAPP" | "EMAIL" }) =>
      alertaService.comunicar(id, forma, userId || ""),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lab-alertas-pendentes"] });
      toast({ title: "Alerta comunicado" });
    },
    onError: (e: Error) =>
      toast({
        title: "Erro ao comunicar alerta",
        description: e.message,
        variant: "destructive",
      }),
  });

  if (isLoading) return <LoadingState message="Carregando alertas críticos..." />;
  if (isError) {
    return (
      <ErrorState
        message={error?.message || "Não foi possível carregar os alertas críticos."}
        onRetry={() => void refetch()}
      />
    );
  }
  if (!alertas || alertas.length === 0) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Nenhum alerta crítico pendente"
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Paciente</TableHead>
          <TableHead>Parâmetro</TableHead>
          <TableHead>Valor</TableHead>
          <TableHead>Referência</TableHead>
          <TableHead>Tipo</TableHead>
          <TableHead>Quando</TableHead>
          <TableHead className="text-right">Ações</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {alertas.map((a) => (
          <TableRow key={a.id}>
            <TableCell>{a.paciente_nome}</TableCell>
            <TableCell>{a.ds_parametro}</TableCell>
            <TableCell className="font-mono">{a.vl_resultado}</TableCell>
            <TableCell className="font-mono text-xs">{a.vl_referencia}</TableCell>
            <TableCell>
              <Badge variant="destructive">{a.tp_alerta}</Badge>
            </TableCell>
            <TableCell>
              {new Date(a.dt_alerta).toLocaleString("pt-BR")}
            </TableCell>
            <TableCell className="text-right space-x-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => comunicarMutation.mutate({ id: a.id, forma: "TELEFONE" })}
              >
                Comunicar
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ── Modal: Formulário de catálogo ────────────────────────────────────────────
function CatalogoFormModal({
  companyId,
  editing,
  onClose,
  onSubmit,
}: {
  companyId: string;
  editing: ExameCatalogo | null;
  onClose: () => void;
  onSubmit: (payload: Omit<ExameCatalogo, "id" | "created_at" | "updated_at">) => void;
}) {
  const [dsExame, setDsExame] = useState(editing?.ds_exame ?? "");
  const [dsSigla, setDsSigla] = useState(editing?.ds_sigla ?? "");
  const [cdTuss, setCdTuss] = useState(editing?.cd_tuss ?? "");
  const [cdLoinc, setCdLoinc] = useState(editing?.cd_loinc ?? "");
  const [categoria, setCategoria] = useState(editing?.ds_categoria ?? "BIOQUIMICA");
  const [material, setMaterial] = useState(editing?.ds_material ?? "SANGUE");
  const [metodo, setMetodo] = useState(editing?.ds_metodo ?? "");
  const [prazo, setPrazo] = useState(editing?.nr_prazo_dias ?? 3);
  const [vlParticular, setVlParticular] = useState<string>(editing?.vl_particular?.toString() ?? "");
  const [vlConvenio, setVlConvenio] = useState<string>(editing?.vl_convenio?.toString() ?? "");
  const [validationError, setValidationError] = useState("");

  const parseOptionalPrice = (value: string): number | null | undefined => {
    const normalized = value.trim().replace(",", ".");
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  };

  const handleSubmit = () => {
    const privatePrice = parseOptionalPrice(vlParticular);
    const insurancePrice = parseOptionalPrice(vlConvenio);
    if (dsExame.trim().length < 2 || !dsSigla.trim()) {
      setValidationError("Informe uma sigla e um nome de exame com pelo menos 2 caracteres.");
      return;
    }
    if (!Number.isInteger(prazo) || prazo < 0 || prazo > 32767) {
      setValidationError("O prazo deve ser um número inteiro entre 0 e 32767 dias.");
      return;
    }
    if (privatePrice === undefined || insurancePrice === undefined) {
      setValidationError("Os valores devem ser números maiores ou iguais a zero.");
      return;
    }
    setValidationError("");
    onSubmit({
      company_id: companyId,
      ds_exame: dsExame.trim(),
      ds_sigla: dsSigla.trim().toUpperCase(),
      cd_tuss: cdTuss.trim() || null,
      cd_loinc: cdLoinc.trim() || null,
      ds_categoria: categoria,
      ds_material: material,
      ds_metodo: metodo.trim() || null,
      nr_prazo_dias: prazo,
      vl_particular: privatePrice,
      vl_convenio: insurancePrice,
      lg_ativo: true,
      cd_origem_sigh: null,
    });
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar exame" : "Novo exame"}</DialogTitle>
          <DialogDescription>Catálogo de exames laboratoriais</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="lab-exam-code">Sigla*</Label>
            <Input
              id="lab-exam-code"
              value={dsSigla}
              onChange={(e) => setDsSigla(e.target.value.toUpperCase())}
            />
          </div>
          <div>
            <Label htmlFor="lab-exam-name">Exame*</Label>
            <Input
              id="lab-exam-name"
              value={dsExame}
              onChange={(e) => setDsExame(e.target.value)}
            />
          </div>
          <div>
            <Label>Categoria</Label>
            <Select value={categoria} onValueChange={setCategoria}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {LAB_CATEGORIAS.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Material</Label>
            <Select value={material} onValueChange={setMaterial}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {LAB_MATERIAIS.map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>TUSS</Label>
            <Input value={cdTuss} onChange={(e) => setCdTuss(e.target.value)} />
          </div>
          <div>
            <Label>LOINC</Label>
            <Input value={cdLoinc} onChange={(e) => setCdLoinc(e.target.value)} />
          </div>
          <div>
            <Label>Método</Label>
            <Input value={metodo} onChange={(e) => setMetodo(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="lab-exam-deadline">Prazo (dias)</Label>
            <Input
              id="lab-exam-deadline"
              type="number"
              min={0}
              max={32767}
              step={1}
              value={prazo}
              onChange={(e) => setPrazo(Number(e.target.value))}
            />
          </div>
          <div>
            <Label htmlFor="lab-exam-private-price">Valor Particular (R$)</Label>
            <Input
              id="lab-exam-private-price"
              type="number"
              min={0}
              step="0.01"
              value={vlParticular}
              onChange={(e) => setVlParticular(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="lab-exam-insurance-price">Valor Convênio (R$)</Label>
            <Input
              id="lab-exam-insurance-price"
              type="number"
              min={0}
              step="0.01"
              value={vlConvenio}
              onChange={(e) => setVlConvenio(e.target.value)}
            />
          </div>
        </div>
        {validationError && (
          <p className="text-sm text-destructive" role="alert">
            {validationError}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSubmit}>{editing ? "Atualizar" : "Cadastrar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Modal: Novo Pedido ───────────────────────────────────────────────────────
function NovoPedidoModal({
  companyId,
  onClose,
  onCreated,
}: {
  companyId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [cdPaciente, setCdPaciente] = useState("");
  const [cdMedico, setCdMedico] = useState("");
  const [hipotese, setHipotese] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [prioridade, setPrioridade] = useState<"ROTINA" | "URGENTE" | "EMERGENCIA">("ROTINA");
  const [tipoAtendimento, setTipoAtendimento] = useState<"AMBULATORIAL" | "INTERNACAO" | "URGENCIA" | "DOMICILIAR">("AMBULATORIAL");
  const [itensSelecionados, setItensSelecionados] = useState<number[]>([]);
  const { toast } = useToast();

  const { data: examesDisponiveis } = useQuery({
    queryKey: ["lab-catalogo-select", companyId],
    queryFn: () => catalogo.getAll(companyId, { ativo: true }),
    enabled: !!companyId,
  });

  const criar = useMutation({
    mutationFn: () =>
      pedidoService.create({
        company_id: companyId,
        cd_paciente: Number(cdPaciente),
        cd_medico: Number(cdMedico),
        cd_tipo_atendimento: tipoAtendimento,
        tp_prioridade: prioridade,
        ds_hipotese_diagnostica: hipotese || undefined,
        ds_observacoes: observacoes || undefined,
        itens: itensSelecionados.map((id) => ({ cd_exame: id })),
      }),
    onSuccess: () => {
      toast({ title: "Pedido criado com sucesso" });
      onCreated();
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo pedido de exame</DialogTitle>
          <DialogDescription>Selecione paciente, médico e exames</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>ID Paciente*</Label>
            <Input
              type="number"
              value={cdPaciente}
              onChange={(e) => setCdPaciente(e.target.value)}
            />
          </div>
          <div>
            <Label>ID Médico*</Label>
            <Input
              type="number"
              value={cdMedico}
              onChange={(e) => setCdMedico(e.target.value)}
            />
          </div>
          <div>
            <Label>Prioridade</Label>
            <Select value={prioridade} onValueChange={(v: typeof prioridade) => setPrioridade(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ROTINA">Rotina</SelectItem>
                <SelectItem value="URGENTE">Urgente</SelectItem>
                <SelectItem value="EMERGENCIA">Emergência</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Tipo de atendimento</Label>
            <Select value={tipoAtendimento} onValueChange={(v: typeof tipoAtendimento) => setTipoAtendimento(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="AMBULATORIAL">Ambulatorial</SelectItem>
                <SelectItem value="INTERNACAO">Internação</SelectItem>
                <SelectItem value="URGENCIA">Urgência</SelectItem>
                <SelectItem value="DOMICILIAR">Domiciliar</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label>Hipótese diagnóstica</Label>
            <Textarea
              value={hipotese}
              onChange={(e) => setHipotese(e.target.value)}
              rows={2}
            />
          </div>
          <div className="col-span-2">
            <Label>Observações</Label>
            <Textarea
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              rows={2}
            />
          </div>
          <div className="col-span-2">
            <Label>Exames* (selecione 1+)</Label>
            <div className="border rounded-md p-2 max-h-40 overflow-y-auto space-y-1">
              {examesDisponiveis?.map((ex) => (
                <label key={ex.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={itensSelecionados.includes(ex.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setItensSelecionados((p) => [...p, ex.id]);
                      } else {
                        setItensSelecionados((p) => p.filter((i) => i !== ex.id));
                      }
                    }}
                  />
                  <span className="font-mono">{ex.ds_sigla}</span>
                  <span>{ex.ds_exame}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {itensSelecionados.length} exame(s) selecionado(s)
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            onClick={() => criar.mutate()}
            disabled={
              !cdPaciente || !cdMedico || itensSelecionados.length === 0 || criar.isPending
            }
          >
            Criar pedido
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
