/**
 * TissStats — totalizadores do header e graficos de distribuicao
 * Sub-componente extraido de TissManager.tsx
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, PieChart, Pie, Cell } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { tissService, type TissXml } from "@/services/tissService";

const CHART_COLORS = ["#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

export interface TissStatsProps {
  companyId: string;
  ano: number;
  faturas?: TissXml[];
}

export function TissStats({ companyId, ano, faturas }: TissStatsProps) {
  const { data: stats, isError, refetch } = useQuery({
    queryKey: ["tiss-stats", companyId, ano],
    queryFn: () => tissService.getEstatisticas(companyId, ano),
    enabled: !!companyId,
  });

  const glosaPorConvenio = useMemo(
    () => (stats?.por_convenio || []).map((c) => ({
      name: c.convenio,
      informado: c.informado,
      glosa: c.glosa,
      liberado: c.liberado,
    })),
    [stats],
  );

  const statusDist = useMemo(() => {
    const dist: Record<string, number> = {};
    (faturas || []).forEach((f) => {
      dist[f.status] = (dist[f.status] || 0) + 1;
    });
    return Object.entries(dist).map(([name, value]) => ({ name, value }));
  }, [faturas]);

  return (
    <div className="space-y-4">
      {isError && (
        <Alert variant="destructive" role="alert">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Nao foi possivel carregar os indicadores TISS</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>Os totalizadores permanecem indisponiveis ate uma nova consulta segura.</span>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Tentar novamente
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <Card>
            <CardHeader className="p-3 pb-1">
              <CardDescription>Total Guias</CardDescription>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <p className="text-2xl font-bold">{stats.total_guias}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="p-3 pb-1">
              <CardDescription>Informado</CardDescription>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <p className="text-2xl font-bold text-blue-600">
                {stats.total_enviado.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="p-3 pb-1">
              <CardDescription>Liberado</CardDescription>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <p className="text-2xl font-bold text-indigo-600">
                {stats.total_liberado.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="p-3 pb-1">
              <CardDescription>Glosado</CardDescription>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <p className="text-2xl font-bold text-orange-600">
                {stats.total_glosado.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="p-3 pb-1">
              <CardDescription>Recebido</CardDescription>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <p className="text-2xl font-bold text-emerald-600">
                {stats.total_pago.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="p-3 pb-1">
              <CardDescription>Taxa Glosa</CardDescription>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <p className="text-2xl font-bold text-red-600">
                {stats.taxa_glosa_percent.toFixed(2)}%
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
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={glosaPorConvenio}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" angle={-15} textAnchor="end" height={60} interval={0} fontSize={10} />
                <YAxis tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} />
                <Legend />
                <Bar dataKey="informado" name="Informado" fill="#0ea5e9" />
                <Bar dataKey="liberado" name="Liberado" fill="#10b981" />
                <Bar dataKey="glosa" name="Glosa" fill="#f59e0b" />
              </BarChart>
            </ResponsiveContainer>
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

