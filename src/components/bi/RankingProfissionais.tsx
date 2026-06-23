/**
 * RankingProfissionais.tsx
 *
 * Tabela compacta de ranking de profissionais por performance.
 *
 * - Mostra nome, especialidade, total de agendamentos, atendidos, no-show
 *   e taxa de atendimento
 * - Ordena por taxa de atendimento (desc) com fallback em nº de atendidos
 * - Usa TanStack Query para cache isolado por (companyId) — compartilha
 *   cache com o componente OcupacaoChart (mesma query key)
 *
 * Dependências: lucide-react, ui/*, @tanstack/react-query, biService
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Crown, Users } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LoadingState } from "@/components/StateViews";
import { biService, type ComparativoProfissional } from "@/services/biService";

interface RankingProfissionaisProps {
  companyId: string;
  maxItems?: number;
  titulo?: string;
  descricao?: string;
}

const fmtPct = (v: number | null) => (v === null ? "—" : `${v.toFixed(0)}%`);

export function RankingProfissionais({
  companyId,
  maxItems = 8,
  titulo = "Top profissionais por ocupação",
  descricao = "Últimos 30 dias",
}: RankingProfissionaisProps) {
  const { data = [], isLoading } = useQuery({
    queryKey: ["bi", "ocupacao-profissionais", companyId],
    queryFn: () => biService.getComparativoProfissionais(companyId, { inicio: "", fim: "" }),
    enabled: !!companyId,
    staleTime: 5 * 60_000,
  });

  const ranking = useMemo<ComparativoProfissional[]>(() => {
    return [...data]
      .filter((d) => d.nr_agendamentos_total > 0)
      .sort((a, b) => {
        const taxaA = a.nr_taxa_atendimento ?? -1;
        const taxaB = b.nr_taxa_atendimento ?? -1;
        if (taxaB !== taxaA) return taxaB - taxaA;
        return b.nr_atendidos - a.nr_atendidos;
      })
      .slice(0, maxItems);
  }, [data, maxItems]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" />
            {titulo}
          </CardTitle>
          <CardDescription>{descricao}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <LoadingState message="Carregando profissionais..." />
        ) : ranking.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            Sem dados de profissionais no período.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="text-left py-2 font-medium">#</th>
                  <th className="text-left py-2 font-medium">Profissional</th>
                  <th className="text-right py-2 font-medium">Agend.</th>
                  <th className="text-right py-2 font-medium">Atend.</th>
                  <th className="text-right py-2 font-medium">No-show</th>
                  <th className="text-right py-2 font-medium">Taxa</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((p, idx) => {
                  const taxa = p.nr_taxa_atendimento ?? 0;
                  const taxaVariant =
                    taxa >= 80 ? "default" : taxa >= 60 ? "secondary" : "destructive";
                  return (
                    <tr key={p.cd_profissional} className="border-b last:border-0">
                      <td className="py-2 text-muted-foreground">
                        {idx === 0 ? (
                          <Crown className="h-3.5 w-3.5 text-amber-500" />
                        ) : (
                          idx + 1
                        )}
                      </td>
                      <td className="py-2">
                        <div className="flex flex-col">
                          <span className="font-medium">{p.nm_profissional}</span>
                          {p.ds_especialidade && (
                            <span className="text-xs text-muted-foreground">
                              {p.ds_especialidade}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 text-right tabular-nums">{p.nr_agendamentos_total}</td>
                      <td className="py-2 text-right tabular-nums">{p.nr_atendidos}</td>
                      <td className="py-2 text-right tabular-nums">{p.nr_faltaram}</td>
                      <td className="py-2 text-right">
                        <Badge variant={taxaVariant as "default" | "secondary" | "destructive"}>
                          {fmtPct(p.nr_taxa_atendimento)}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}