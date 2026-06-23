/**
 * BiDashboard.tsx
 *
 * Dashboard executivo de BI/Indicadores — ORQUESTRADOR.
 *
 * Esta versão delega cada bloco visual a um sub-componente dedicado em
 * ./, cada um com cache isolado via TanStack Query:
 *
 *  - KPICard (e StatsCard)   → linha 1 (5 cards)
 *  - RankingProfissionais    → tabela top profissionais
 *  - OcupacaoChart           → gráfico de barras horizontais
 *  - DistribuicaoConvenios   → pizza por convênio (permanece aqui; é
 *                              conteúdo pequeno e não justifica um arquivo)
 *  - AlertasPanel            → linha de alertas + filtros
 *  - MetasPanel              → CRUD de metas
 *
 * Mantém 100% da funcionalidade anterior. A assinatura externa
 * (export function BiDashboard) é preservada.
 */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3, Calendar, DollarSign, CheckCircle2, AlertTriangle,
  RefreshCw, TrendingUp, Activity,
} from "lucide-react";
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
  Pie, PieChart, Cell, Legend,
} from "recharts";

import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { LoadingState, ErrorState } from "@/components/StateViews";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { KPICard, type KPIDefinition } from "./KPICard";
import { RankingProfissionais } from "./RankingProfissionais";
import { OcupacaoChart } from "./OcupacaoChart";
import { AlertasPanel } from "./AlertasPanel";
import { MetasPanel } from "./MetasPanel";
import { friendlyError } from "@/utils/friendlyError";
import {
  biService,
  type Alerta, type ComparativoConvenio, type SerieTemporal,
} from "@/services/biService";

const fmtBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const fmtPct = (v: number) => `${v.toFixed(1)}%`;

const PIE_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];

interface ChartLineTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number; payload: { data: string } }>;
}

function LineTooltip({ active, payload }: ChartLineTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0];
  return (
    <div className="rounded-md border bg-card p-2 text-xs shadow-sm">
      <p className="font-medium">{new Date(item.payload.data).toLocaleDateString("pt-BR")}</p>
      <p className="text-muted-foreground">Valor: <strong>{item.value.toLocaleString("pt-BR")}</strong></p>
    </div>
  );
}

export function BiDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const companyId = user?.company_id ?? "";

  // Período (controlado aqui pois afeta os 2 gráficos de série temporal)
  const [periodo, setPeriodo] = useState("30");

  // KPIs do dia
  const {
    data: kpis,
    isLoading: loadingKpis,
    error: errorKpis,
    refetch: refetchKpis,
  } = useQuery({
    queryKey: ["bi", "kpis-hoje", companyId],
    queryFn: () => biService.getKPIsHoje(companyId),
    enabled: !!companyId,
    staleTime: 60_000,
  });

  // Séries temporais (uma query por KPI — cache individual)
  const { data: serieAgendamentos = [] } = useQuery({
    queryKey: ["bi", "serie-temporal", companyId, "agendamentos", periodo],
    queryFn: () => biService.getSerieTemporal(companyId, "agendamentos", Number(periodo)),
    enabled: !!companyId,
    staleTime: 60_000,
  });

  const { data: serieFaturamento = [] } = useQuery({
    queryKey: ["bi", "serie-temporal", companyId, "faturamento", periodo],
    queryFn: () => biService.getSerieTemporal(companyId, "faturamento", Number(periodo)),
    enabled: !!companyId,
    staleTime: 60_000,
  });

  // Comparativo por convênio (dados para a pizza)
  const { data: conveniosRaw = [] } = useQuery({
    queryKey: ["bi", "comparativo-convenios", companyId],
    queryFn: () => biService.getComparativoConvenios(companyId, { inicio: "", fim: "" }),
    enabled: !!companyId,
    staleTime: 5 * 60_000,
  });

  // Alertas pendentes — para o banner de críticos
  const { data: alertasPendentes = [] } = useQuery({
    queryKey: ["bi", "alertas", companyId, "pendentes"],
    queryFn: () => biService.getAlertasPendentes(companyId, { limite: 50 }),
    enabled: !!companyId,
    staleTime: 30_000,
  });

  // Recalcular KPIs
  const recalcularMut = useMutation({
    mutationFn: () => biService.recalcularKPIs(companyId, new Date()),
    onSuccess: () => {
      toast({ title: "KPIs recalculados." });
      void queryClient.invalidateQueries({ queryKey: ["bi"] });
    },
    onError: (err) => {
      toast({ variant: "destructive", title: friendlyError(err, "Recalcular") });
    },
  });

  // Detectar alertas
  const detectarMut = useMutation({
    mutationFn: async () => {
      const novos = await biService.detectarAlertas(companyId);
      return novos;
    },
    onSuccess: (novos) => {
      toast({
        title: novos > 0 ? `${novos} novo(s) alerta(s) detectado(s).` : "Nenhum alerta novo.",
      });
      void queryClient.invalidateQueries({ queryKey: ["bi", "alertas", companyId] });
    },
    onError: (err) => {
      toast({ variant: "destructive", title: friendlyError(err, "Detectar alertas") });
    },
  });

  // Erro agregado para o ErrorState
  const errorMessage = useMemo(() => {
    if (errorKpis) return friendlyError(errorKpis, "Carregar BI");
    if (!user?.company_id) return "Usuário sem empresa associada.";
    return null;
  }, [errorKpis, user?.company_id]);

  if (loadingKpis && !kpis) {
    return <LoadingState message="Carregando dashboard executivo..." />;
  }
  if (errorMessage && !kpis) {
    return <ErrorState message={errorMessage} onRetry={() => void refetchKpis()} />;
  }
  if (!kpis) return null;

  // KPIs da primeira linha (declarativos)
  const kpiDefs: KPIDefinition[] = [
    {
      key: "agendamentos",
      title: "Agendamentos hoje",
      value: kpis.agendamentos.total,
      icon: Calendar,
      description: `${kpis.agendamentos.confirmados} confirmados`,
      variant: "primary",
    },
    {
      key: "faturado",
      title: "Faturado hoje",
      value: fmtBRL(kpis.financeiro.faturado),
      icon: DollarSign,
      description: `Recebido: ${fmtBRL(kpis.financeiro.recebido)}`,
      variant: "success",
    },
    {
      key: "confirmacao",
      title: "Taxa de confirmação",
      value: fmtPct(kpis.agendamentos.taxaConfirmacao),
      icon: CheckCircle2,
      description: `${kpis.agendamentos.confirmados}/${kpis.agendamentos.total}`,
      variant: "default",
    },
    {
      key: "no-show",
      title: "Taxa de no-show",
      value: fmtPct(kpis.agendamentos.taxaNoShow),
      icon: AlertTriangle,
      variant: kpis.agendamentos.taxaNoShow > 15 ? "destructive" : "warning",
      description: `${kpis.agendamentos.faltaram} faltas`,
    },
    {
      key: "ticket",
      title: "Ticket médio",
      value: fmtBRL(kpis.financeiro.ticketMedio),
      icon: TrendingUp,
      description: `${kpis.agendamentos.atendidos} atendidos`,
      variant: "secondary",
    },
  ];

  // Convênios para a pizza (filtra > 0 e top 6)
  const convenios: Array<{ name: string; value: number }> = conveniosRaw
    .filter((c: ComparativoConvenio) => c.vl_faturado > 0)
    .slice(0, 6)
    .map((c) => ({ name: c.nm_convenio, value: c.vl_faturado }));

  const alertasCriticos = alertasPendentes.filter(
    (a: Alerta) => a.tp_severidade === "CRITICO",
  ).length;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="BI / Indicadores"
        description="Visão executiva de performance, faturamento e operação da clínica."
        actions={
          <div className="flex flex-wrap gap-2">
            <Select value={periodo} onValueChange={setPeriodo}>
              <SelectTrigger className="h-9 w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Últimos 7 dias</SelectItem>
                <SelectItem value="15">15 dias</SelectItem>
                <SelectItem value="30">30 dias</SelectItem>
                <SelectItem value="90">90 dias</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => detectarMut.mutate()}
              disabled={detectarMut.isPending}
            >
              <Activity className="mr-1.5 h-3.5 w-3.5" />
              Detectar alertas
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => recalcularMut.mutate()}
              disabled={recalcularMut.isPending}
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Recalcular KPIs
            </Button>
          </div>
        }
      />

      {/* Linha 1 — 5 KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {kpiDefs.map((k) => (
          <KPICard
            key={k.key}
            title={k.title}
            value={k.value}
            icon={k.icon}
            description={k.description}
            variant={k.variant}
          />
        ))}
      </div>

      {/* Indicador comparativo */}
      {(kpis.comparativo.variacao.faturamento !== 0 ||
        kpis.comparativo.variacao.atendimentos !== 0) && (
        <Card>
          <CardContent className="py-3">
            <div className="flex items-center gap-4 text-sm">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Comparativo mês anterior:</span>
              <Badge variant={kpis.comparativo.variacao.faturamento >= 0 ? "default" : "destructive"}>
                Faturamento {kpis.comparativo.variacao.faturamento >= 0 ? "↑" : "↓"}{" "}
                {Math.abs(kpis.comparativo.variacao.faturamento).toFixed(1)}%
              </Badge>
              <Badge variant={kpis.comparativo.variacao.atendimentos >= 0 ? "default" : "destructive"}>
                Atendimentos {kpis.comparativo.variacao.atendimentos >= 0 ? "↑" : "↓"}{" "}
                {Math.abs(kpis.comparativo.variacao.atendimentos).toFixed(1)}%
              </Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Linha 2 — Gráficos de série temporal */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SerieTemporalCard
          titulo={`Agendamentos — últimos ${periodo} dias`}
          descricao="Evolução diária do volume de agendamentos."
          dados={serieAgendamentos}
          cor="hsl(var(--primary))"
          tickFormatterY={(v) => v.toLocaleString("pt-BR")}
        />
        <SerieTemporalCard
          titulo={`Faturamento — últimos ${periodo} dias`}
          descricao="Evolução diária do faturamento bruto."
          dados={serieFaturamento}
          cor="#10b981"
          tickFormatterY={(v) => v.toLocaleString("pt-BR", { notation: "compact" })}
        />
      </div>

      {/* Linha 3 — Top profissionais + Convênios */}
      <div className="grid gap-4 lg:grid-cols-2">
        <RankingProfissionais companyId={companyId} maxItems={8} />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Distribuição por convênio</CardTitle>
            <CardDescription>Faturamento dos últimos 90 dias</CardDescription>
          </CardHeader>
          <CardContent>
            {convenios.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Sem faturamento de convênios no período.
              </p>
            ) : (
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={convenios}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={90}
                      label={(entry) =>
                        `${entry.name}: ${fmtBRL(entry.value)}`
                      }
                      labelLine={false}
                    >
                      {convenios.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Legend />
                    <Tooltip
                      formatter={(v: number) => fmtBRL(v)}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Linha 4 — Alertas + Metas */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <AlertasPanel companyId={companyId} />
        </div>
        <div>
          <MetasPanel companyId={companyId} />
        </div>
      </div>

      {/* Banner de ação se houver alertas críticos */}
      {alertasCriticos > 0 && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex items-center justify-between py-3">
            <div className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <span>
                <strong>{alertasCriticos}</strong> alerta(s) crítico(s) pendente(s).
              </span>
            </div>
            <Button variant="outline" size="sm" onClick={() => navigate("/bi/alertas")}>
              Ver todos
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// =============================================================================
// Helpers locais
// =============================================================================

interface SerieTemporalCardProps {
  titulo: string;
  descricao: string;
  dados: SerieTemporal[];
  cor: string;
  tickFormatterY: (v: number) => string;
}

function SerieTemporalCard({ titulo, descricao, dados, cor, tickFormatterY }: SerieTemporalCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{titulo}</CardTitle>
        <CardDescription>{descricao}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-64 w-full">
          {dados.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Sem dados no período.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dados}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="data"
                  tickFormatter={(v: string) =>
                    new Date(v).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
                  }
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={10}
                />
                <YAxis
                  tickFormatter={(v: number) => tickFormatterY(v)}
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={10}
                />
                <Tooltip content={<LineTooltip />} />
                <Line
                  type="monotone"
                  dataKey="valor"
                  stroke={cor}
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// Hook de estado local para o período (encapsulado aqui)