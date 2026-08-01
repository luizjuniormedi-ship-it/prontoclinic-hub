/**
 * TissStats — totalizadores do header e graficos de distribuicao
 * Sub-componente extraido de TissManager.tsx
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, PieChart, Pie, Cell } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { tissService } from "@/services/tissService";
import {
  finiteTissNumberOrZero,
  formatTissErrorMessage,
  formatTissCurrency,
  formatTissInteger,
  formatTissPercent,
  toFiniteTissNumber,
} from "./tissDisplay";

const CHART_COLORS = ["#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

export interface TissStatsProps {
  companyId: string;
  ano: number;
}

export function TissStats({ companyId, ano }: TissStatsProps) {
  const {
    data: stats,
    error,
    isError,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["tiss-stats", companyId, ano],
    queryFn: () => tissService.getEstatisticas(companyId, ano),
    enabled: !!companyId,
  });

  const {
    data: annualFaturas,
    error: statusError,
    isError: isStatusError,
    isLoading: isStatusLoading,
    refetch: refetchStatus,
  } = useQuery({
    queryKey: ["tiss-status-distribution", companyId, ano],
    queryFn: () => tissService.listFaturas(companyId, { ano }),
    enabled: !!companyId,
  });

  const glosaPorConvenio = useMemo(
    () => (stats?.por_convenio || []).map((c) => ({
      name: c.convenio || "Convênio não informado",
      informado: finiteTissNumberOrZero(c.informado),
      glosa: finiteTissNumberOrZero(c.glosa),
      liberado: finiteTissNumberOrZero(c.liberado),
    })),
    [stats],
  );

  const statusDist = useMemo(() => {
    const dist: Record<string, number> = {};
    (annualFaturas || []).forEach((f) => {
      dist[f.status] = (dist[f.status] || 0) + 1;
    });
    return Object.entries(dist).map(([name, value]) => ({ name, value }));
  }, [annualFaturas]);

  const hasStats =
    !!stats &&
    (finiteTissNumberOrZero(stats.total_guias) > 0 || glosaPorConvenio.length > 0);

  if (!companyId) {
    return (
      <div role="alert" className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        Empresa não identificada. Os indicadores TISS não podem ser consultados.
      </div>
    );
  }

  if (isLoading || isStatusLoading) {
    return (
      <div role="status" className="rounded border p-6 text-center text-sm text-muted-foreground">
        Carregando indicadores TISS...
      </div>
    );
  }

  if (isError || isStatusError) {
    return (
      <div role="alert" className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-900">
        <p>Não foi possível carregar os indicadores TISS.</p>
        <p className="mt-1 text-xs">
          {formatTissErrorMessage(error ?? statusError)}
        </p>
        <Button
          className="mt-3"
          size="sm"
          variant="outline"
          onClick={() => Promise.all([refetch(), refetchStatus()])}
        >
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (!hasStats) {
    return (
      <div role="status" className="rounded border p-6 text-center text-sm text-muted-foreground">
        Nenhum indicador TISS disponível para {ano}.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <Card>
            <CardHeader className="p-3 pb-1">
              <CardDescription>Total Guias</CardDescription>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <p className="text-2xl font-bold break-words">
                {formatTissInteger(stats.total_guias)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="p-3 pb-1">
              <CardDescription>Informado</CardDescription>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <p className="text-xl font-bold text-blue-600 break-words">
                {formatTissCurrency(stats.total_enviado)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="p-3 pb-1">
              <CardDescription>Liberado</CardDescription>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <p className="text-xl font-bold text-indigo-600 break-words">
                {formatTissCurrency(stats.total_liberado)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="p-3 pb-1">
              <CardDescription>Glosado</CardDescription>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <p className="text-xl font-bold text-orange-600 break-words">
                {formatTissCurrency(stats.total_glosado)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="p-3 pb-1">
              <CardDescription>Recebido</CardDescription>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <p className="text-xl font-bold text-emerald-600 break-words">
                {formatTissCurrency(stats.total_pago)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="p-3 pb-1">
              <CardDescription>Taxa Glosa</CardDescription>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <p className="text-xl font-bold text-red-600 break-words">
                {formatTissPercent(stats.taxa_glosa_percent)}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Informado x Liberado x Glosa por Convenio</CardTitle>
            <CardDescription>Ano {ano}</CardDescription>
          </CardHeader>
          <CardContent>
            {glosaPorConvenio.length === 0 ? (
              <p className="text-muted-foreground text-sm py-8 text-center">
                Sem valores por convênio no período.
              </p>
            ) : (
              <div className="min-w-0 overflow-x-auto">
                <div className="h-[300px] min-w-[480px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={glosaPorConvenio}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" angle={-15} textAnchor="end" height={60} interval={0} fontSize={10} />
                      <YAxis tickFormatter={(value) => {
                        const parsed = toFiniteTissNumber(value);
                        return parsed === null ? "—" : `R$${(parsed / 1000).toFixed(0)}k`;
                      }} />
                      <Tooltip formatter={(value) => formatTissCurrency(value)} />
                      <Legend />
                      <Bar dataKey="informado" name="Informado" fill="#0ea5e9" />
                      <Bar dataKey="liberado" name="Liberado" fill="#10b981" />
                      <Bar dataKey="glosa" name="Glosa" fill="#f59e0b" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Distribuicao de Status</CardTitle>
            <CardDescription>Guia do periodo</CardDescription>
          </CardHeader>
          <CardContent>
            {statusDist.length === 0 ? (
              <p className="text-muted-foreground text-sm py-8 text-center">Sem dados.</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie data={statusDist} dataKey="value" nameKey="name" outerRadius={100} label>
                    {statusDist.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default TissStats;
