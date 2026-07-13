/**
 * Indicadores TISS baseados exclusivamente na projecao canonica read-only.
 * Valores de glosa, liberacao e pagamento permanecem fora desta tela ate
 * existirem contratos tenant-safe para essas fontes.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { tissService } from "@/services/tissService";

export interface TissStatsProps {
  ano: number;
}

export function TissStats({ ano }: TissStatsProps) {
  const { data: rows, isLoading, isError, refetch } = useQuery({
    queryKey: ["tiss-read-model-stats", ano],
    queryFn: () => tissService.listFaturas({ ano }),
  });

  const totalFaturado = useMemo(
    () => (rows || []).reduce((total, row) => total + (row.billing_amount ?? 0), 0),
    [rows],
  );

  return (
    <div className="space-y-4">
      {isError && (
        <Alert variant="destructive" role="alert">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Nao foi possivel carregar os indicadores TISS</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>Nenhum total foi estimado a partir de dados incompletos.</span>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RefreshCw className="mr-1 h-4 w-4" />
              Tentar novamente
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {isLoading && !isError && (
        <div role="status" aria-live="polite" className="flex min-h-24 items-center justify-center text-sm text-muted-foreground">
          <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
          Carregando indicadores TISS...
        </div>
      )}

      {!isLoading && !isError && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Card>
            <CardHeader className="p-3 pb-1">
              <CardDescription>Registros TISS em {ano}</CardDescription>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <p className="text-2xl font-bold">{rows?.length ?? 0}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="p-3 pb-1">
              <CardDescription>Valor das faturas vinculadas</CardDescription>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <p className="text-2xl font-bold text-blue-600">
                {totalFaturado.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

export default TissStats;
