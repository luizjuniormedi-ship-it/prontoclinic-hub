/**
 * NpsDashboard — Dashboard de NPS com análise por pesquisa.
 *
 * Funcionalidades:
 *   - Lista pesquisas (ativas/inativas)
 *   - Seleciona pesquisa para ver análise detalhada
 *   - Mostra score NPS (%), distribuição de notas (histograma simples),
 *     promotores/Neutros/detratores e comentários dos detratores
 *
 * Decisões:
 *   - Visualização via cards (KPIs) + barras CSS (sem libs de chart para
 *     reduzir bundle). Para gráficos avançados, pode-se trocar por recharts.
 *   - Comentários de detratores são destacados com ícone de alerta para
 *     ação rápida do gestor.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ThumbsUp, ThumbsDown, Minus, MessageSquare, Star, AlertTriangle, Loader2 } from "lucide-react";
import {
  pesquisasService,
  respostasService,
  npsReportsService,
  type Pesquisa,
  type NpsAnalise,
} from "@/services/npsService";

function NpsScoreCard({ analise }: { analise: NpsAnalise }) {
  // Cor do score conforme classificação universal NPS
  const scoreColor =
    analise.nr_nps_score >= 75 ? "text-green-700 bg-green-50" :
    analise.nr_nps_score >= 50 ? "text-lime-700 bg-lime-50" :
    analise.nr_nps_score >= 0 ? "text-amber-700 bg-amber-50" :
    "text-red-700 bg-red-50";

  return (
    <Card className={scoreColor}>
      <CardHeader>
        <CardTitle className="text-sm">NPS Score</CardTitle>
        <CardDescription>{analise.ds_titulo}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="text-5xl font-bold">{analise.nr_nps_score.toFixed(1)}</div>
        <p className="text-xs mt-2">
          {analise.nr_respostas} respostas · Nota média {analise.nr_nota_media}
        </p>
      </CardContent>
    </Card>
  );
}

function DistribuicaoNotas({ distribuicao }: { distribuicao: Record<number, number> }) {
  const max = Math.max(...Object.values(distribuicao), 1);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Distribuição de Notas</CardTitle>
        <CardDescription>Histograma de notas 0-10</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-end gap-1 h-32">
          {Array.from({ length: 11 }, (_, i) => i).map((nota) => {
            const count = distribuicao[nota] ?? 0;
            const height = (count / max) * 100;
            const color =
              nota >= 9 ? "bg-green-500" :
              nota >= 7 ? "bg-yellow-500" :
              "bg-red-500";
            return (
              <div key={nota} className="flex-1 flex flex-col items-center gap-1">
                <div className="text-xs font-medium">{count}</div>
                <div
                  className={`w-full rounded-t ${color} transition-all`}
                  style={{ height: `${height}%` }}
                  aria-label={`Nota ${nota}: ${count} respostas`}
                />
                <div className="text-xs text-muted-foreground">{nota}</div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function CategoriaCards({ analise }: { analise: NpsAnalise }) {
  return (
    <div className="grid grid-cols-3 gap-4">
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Promotores</p>
              <p className="text-2xl font-bold text-green-700">{analise.nr_promotores}</p>
              <p className="text-xs text-muted-foreground">{analise.nr_percent_promotores.toFixed(1)}%</p>
            </div>
            <ThumbsUp className="h-8 w-8 text-green-500" />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Neutros</p>
              <p className="text-2xl font-bold text-yellow-700">{analise.nr_neutros}</p>
              <p className="text-xs text-muted-foreground">—</p>
            </div>
            <Minus className="h-8 w-8 text-yellow-500" />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Detratores</p>
              <p className="text-2xl font-bold text-red-700">{analise.nr_detrators}</p>
              <p className="text-xs text-muted-foreground">{analise.nr_percent_detrators.toFixed(1)}%</p>
            </div>
            <ThumbsDown className="h-8 w-8 text-red-500" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ComentariosDetratores({ pesquisaId }: { pesquisaId: number }) {
  const { data: comentarios, isLoading } = useQuery({
    queryKey: ["nps-comentarios-detrator", pesquisaId],
    queryFn: () => respostasService.getComentariosDetratores(pesquisaId),
    enabled: !!pesquisaId,
  });

  if (isLoading) return <div className="flex justify-center p-4"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (!comentarios || comentarios.length === 0) {
    return (
      <div className="text-center p-4 text-muted-foreground text-sm">
        Nenhum comentário de detrator. Ótimo sinal!
      </div>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Nota</TableHead>
          <TableHead>Data</TableHead>
          <TableHead>Comentário</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {comentarios.map((c) => (
          <TableRow key={c.id}>
            <TableCell>
              <Badge variant="destructive">{c.nr_nota_nps}</Badge>
            </TableCell>
            <TableCell className="text-sm">{new Date(c.dt_resposta).toLocaleString("pt-BR")}</TableCell>
            <TableCell className="text-sm">{c.ds_comentario}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function NpsDashboard() {
  const [pesquisaId, setPesquisaId] = useState<number | null>(null);

  const { data: pesquisas, isLoading: loadingPesquisas } = useQuery({
    queryKey: ["nps-pesquisas"],
    queryFn: () => pesquisasService.getAll(),
  });

  const { data: analise } = useQuery({
    queryKey: ["nps-analise", pesquisaId],
    queryFn: () => pesquisaId ? npsReportsService.getAnalise(pesquisaId) : Promise.resolve(null),
    enabled: !!pesquisaId,
  });

  const { data: distribuicao } = useQuery({
    queryKey: ["nps-distribuicao", pesquisaId],
    queryFn: () => pesquisaId ? npsReportsService.getDistribuicaoNotas(pesquisaId) : Promise.resolve({}),
    enabled: !!pesquisaId,
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Star className="h-5 w-5" />Dashboard NPS</CardTitle>
          <CardDescription>Análise de satisfação dos pacientes (Net Promoter Score).</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Select value={pesquisaId?.toString() ?? ""} onValueChange={(v) => setPesquisaId(Number(v))}>
              <SelectTrigger className="max-w-md">
                <SelectValue placeholder={loadingPesquisas ? "Carregando..." : "Selecione uma pesquisa"} />
              </SelectTrigger>
              <SelectContent>
                {(pesquisas ?? []).map((p: Pesquisa) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.ds_titulo}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {pesquisaId && (
              <Button variant="outline" onClick={() => window.open(`/nps/${pesquisaId}`, "_blank")}>
                <MessageSquare className="h-4 w-4 mr-2" />Abrir Pesquisa Pública
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {!pesquisaId ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Selecione uma pesquisa para visualizar a análise.
          </CardContent>
        </Card>
      ) : !analise ? (
        <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <NpsScoreCard analise={analise} />
            <CategoriaCards analise={analise} />
          </div>
          {distribuicao && <DistribuicaoNotas distribuicao={distribuicao} />}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                Comentários de Detratores
              </CardTitle>
              <CardDescription>Ação rápida — notas 0-6 com comentário.</CardDescription>
            </CardHeader>
            <CardContent>
              <ComentariosDetratores pesquisaId={pesquisaId} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}