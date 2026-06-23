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
  const { data: catalogoData, isLoading: loadingCatalogo } = useQuery({
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
  const { data: pedidosData, isLoading: loadingPedidos } = useQuery({
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

  const marcarColetadoMutation = useMutation({
    mutationFn: (id: number) => pedidoService.atualizarStatus(id, "COLETADO"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lab-pedidos"] });
      toast({ title: "Pedido marcado como coletado" });
    },
  });

  const iniciarAnaliseMutation = useMutation({
    mutationFn: (id: number) => pedidoService.atualizarStatus(id, "EM_ANALISE"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lab-pedidos"] });
      toast({ title: "Análise iniciada" });
    },
  });

  const cancelarPedidoMutation = useMutation({
    mutationFn: (id: number) => pedidoService.atualizarStatus(id, "CANCELADO"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lab-pedidos"] });
      toast({ title: "Pedido cancelado" });
    },
  });

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
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="pedidos">
                <ListOrdered className="h-4 w-4 mr-2" />
                Pedidos
              </TabsTrigger>
              <TabsTrigger value="catalogo">
                <TestTube className="h-4 w-4 mr-2" />
                Catálogo
              </TabsTrigger>
              <TabsTrigger value="coleta">
                <Syringe className="h-4 w-4 mr-2" />
                Coleta
              </TabsTrigger>
              <TabsTrigger value="resultados">
                <FileText className="h-4 w-4 mr-2" />
                Resultados
              </TabsTrigger>
              <TabsTrigger value="alertas">
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
                  <Select value={filterStatus} onValueChange={setFilterStatus}>
                    <SelectTrigger className="w-40">
                      <SelectValue placeholder="Todos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Todos</SelectItem>
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
                <p className="text-sm text-muted-foreground">Carregando...</p>
              ) : filteredPedidos.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  Nenhum pedido encontrado.
                </p>
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
                                onClick={() => marcarColetadoMutation.mutate(p.id)}
                              >
                                Coletar
                              </Button>
                            )}
                            {p.tp_status === "COLETADO" && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => iniciarAnaliseMutation.mutate(p.id)}
                              >
                                Analisar
                              </Button>
                            )}
                            {(p.tp_status === "PENDENTE" || p.tp_status === "COLETADO") && (
                              <Button
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
                  <Select value={filterCategoria} onValueChange={setFilterCategoria}>
                    <SelectTrigger className="w-44">
                      <SelectValue placeholder="Todas" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Todas</SelectItem>
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
                  <Select value={filterMaterial} onValueChange={setFilterMaterial}>
                    <SelectTrigger className="w-32">
                      <SelectValue placeholder="Todos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Todos</SelectItem>
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
                <p className="text-sm text-muted-foreground">Carregando...</p>
              ) : filteredCatalogo.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  Nenhum exame no catálogo.
                </p>
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
                          {c.vl_particular ? `R$ ${c.vl_particular.toFixed(2)}` : "—"}
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

  const { data: pedidosColeta, isLoading } = useQuery({
    queryKey: ["lab-pedidos-coleta", companyId],
    queryFn: () =>
      pedidoService.listar(companyId, {
        tp_status: ["PENDENTE", "COLETADO"],
      }),
    enabled: !!companyId,
  });

  const marcarColetado = useMutation({
    mutationFn: (id: number) => pedidoService.atualizarStatus(id, "COLETADO"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lab-pedidos-coleta"] });
      toast({ title: "Marcado como coletado" });
    },
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando...</p>;
  if (!pedidosColeta || pedidosColeta.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Nenhum pedido aguardando coleta.</p>;
  }

  return (
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
                {p.tp_status === "PENDENTE" && (
                  <Button size="sm" onClick={() => marcarColetado.mutate(p.id)}>
                    Confirmar coleta
                  </Button>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
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
  const { data: pedidos, isLoading } = useQuery({
    queryKey: ["lab-pedidos-analise", companyId],
    queryFn: () =>
      pedidoService.listar(companyId, {
        tp_status: ["EM_ANALISE", "COLETADO"],
      }),
    enabled: !!companyId,
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando...</p>;
  if (!pedidos || pedidos.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Nenhum pedido em análise.</p>;
  }

  return (
    <div className="space-y-3">
      {pedidos.map((p) => (
        <Card key={p.id}>
          <CardHeader>
            <CardTitle className="text-base">
              Pedido #{p.id} — {p.paciente_nome}
            </CardTitle>
            <CardDescription>
              {p.itens_count} exame(s) • {p.medico_nome} •{" "}
              {new Date(p.dt_pedido).toLocaleString("pt-BR")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Abra o pedido para inserir resultados de cada item individualmente.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() =>
                onOpenItem({
                  id: 0,
                  cd_exame: 0,
                  exame_nome: `Pedido #${p.id} (clique em cada item)`,
                })
              }
            >
              Ver itens
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── Sub-componente: aba Alertas ───────────────────────────────────────────────
function AlertasTab({ userId }: { userId?: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: alertas, isLoading } = useQuery({
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
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando...</p>;
  if (!alertas || alertas.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Nenhum alerta crítico pendente.</p>;
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

  const handleSubmit = () => {
    if (!dsExame || !dsSigla) return;
    onSubmit({
      company_id: companyId,
      ds_exame: dsExame,
      ds_sigla: dsSigla.toUpperCase(),
      cd_tuss: cdTuss || null,
      cd_loinc: cdLoinc || null,
      ds_categoria: categoria,
      ds_material: material,
      ds_metodo: metodo || null,
      nr_prazo_dias: prazo,
      vl_particular: vlParticular ? Number(vlParticular) : null,
      vl_convenio: vlConvenio ? Number(vlConvenio) : null,
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
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Sigla*</Label>
            <Input value={dsSigla} onChange={(e) => setDsSigla(e.target.value.toUpperCase())} />
          </div>
          <div>
            <Label>Exame*</Label>
            <Input value={dsExame} onChange={(e) => setDsExame(e.target.value)} />
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
            <Label>Prazo (dias)</Label>
            <Input
              type="number"
              value={prazo}
              onChange={(e) => setPrazo(Number(e.target.value))}
            />
          </div>
          <div>
            <Label>Valor Particular (R$)</Label>
            <Input
              type="number"
              step="0.01"
              value={vlParticular}
              onChange={(e) => setVlParticular(e.target.value)}
            />
          </div>
          <div>
            <Label>Valor Convênio (R$)</Label>
            <Input
              type="number"
              step="0.01"
              value={vlConvenio}
              onChange={(e) => setVlConvenio(e.target.value)}
            />
          </div>
        </div>
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
