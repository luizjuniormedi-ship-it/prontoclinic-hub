/**
 * OcupacaoChart.tsx
 *
 * Gráfico de barras horizontais com a ocupação por profissional.
 *
 * - Lista profissionais ordenados por taxa de atendimento
 * - Barra colorida conforme a faixa:
 *     >= 80% verde | 60-80% amarelo | < 60% vermelho
 * - Tooltip com detalhes (agendamentos, atendidos, no-show)
 *
 * Usa TanStack Query para cache isolado por (companyId) — ao navegar para
 * outra página e voltar, o gráfico aparece instantaneamente sem refetch.
 *
 * Dependências: Recharts (BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer)
 *               @tanstack/react-query
 *               biService (getComparativoProfissionais)
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { biService, type ComparativoProfissional } from "@/services/biService";

export type OcupacaoItem = ComparativoProfissional;

interface OcupacaoChartProps {
  companyId: string;
  maxItems?: number;
}

function colorFor(taxa: number | null): string {
  if (taxa === null) return "#94a3b8";
  if (taxa >= 80) return "#10b981";
  if (taxa >= 60) return "#f59e0b";
  return "#ef4444";
}

interface TooltipPayloadEntry {
  payload?: OcupacaoItem;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0]?.payload;
  if (!item) return null;
  return (
    <div className="rounded-md border bg-card p-3 shadow-sm text-xs space-y-1">
      <p className="font-semibold text-sm">{item.nm_profissional}</p>
      {item.ds_especialidade && (
        <p className="text-muted-foreground">{item.ds_especialidade}</p>
      )}
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 pt-1">
        <span className="text-muted-foreground">Agendamentos:</span>
        <span className="text-right font-medium">{item.nr_agendamentos_total}</span>
        <span className="text-muted-foreground">Confirmados:</span>
        <span className="text-right font-medium">{item.nr_confirmados}</span>
        <span className="text-muted-foreground">Atendidos:</span>
        <span className="text-right font-medium">{item.nr_atendidos}</span>
        <span className="text-muted-foreground">No-show:</span>
        <span className="text-right font-medium">{item.nr_faltaram}</span>
        <span className="text-muted-foreground">Taxa:</span>
        <span className="text-right font-semibold">
          {item.nr_taxa_atendimento === null ? "—" : `${item.nr_taxa_atendimento}%`}
        </span>
      </div>
    </div>
  );
}

export function OcupacaoChart({ companyId, maxItems = 10 }: OcupacaoChartProps) {
  const { data = [], isLoading } = useQuery({
    queryKey: ["bi", "ocupacao-profissionais", companyId],
    queryFn: () => biService.getComparativoProfissionais(companyId, { inicio: "", fim: "" }),
    enabled: !!companyId,
    // View já retorna últimos 30 dias — cache por 5 min é seguro
    staleTime: 5 * 60_000,
  });

  const chartData = useMemo(() => {
    return [...data]
      .filter((d) => d.nr_agendamentos_total > 0)
      .sort((a, b) => (b.nr_taxa_atendimento ?? 0) - (a.nr_taxa_atendimento ?? 0))
      .slice(0, maxItems)
      .map((d) => ({
        ...d,
        nomeCurto: truncate(d.nm_profissional, 20),
        taxa: d.nr_taxa_atendimento ?? 0,
      }));
  }, [data, maxItems]);

  if (isLoading) {
    return (
      <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
        Carregando...
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
        Sem dados de ocupação no período.
      </div>
    );
  }

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis
            type="number"
            domain={[0, 100]}
            tickFormatter={(v: number) => `${v}%`}
            stroke="hsl(var(--muted-foreground))"
            fontSize={11}
          />
          <YAxis
            type="category"
            dataKey="nomeCurto"
            width={130}
            stroke="hsl(var(--muted-foreground))"
            fontSize={11}
          />
          <Tooltip
            content={<CustomTooltip />}
            cursor={{ fill: "hsl(var(--muted))" }}
          />
          <Bar dataKey="taxa" radius={[0, 4, 4, 0]}>
            {chartData.map((d) => (
              <Cell key={d.cd_profissional} fill={colorFor(d.nr_taxa_atendimento)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}
