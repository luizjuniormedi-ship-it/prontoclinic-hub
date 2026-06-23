/**
 * PaManager — Fila do Pronto Atendimento com classificação de risco.
 *
 * Mostra fila ordenada por Manchester (VERMELHO primeiro) + tempo de espera.
 * Permite triagem, atendimento e alta.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, AlertTriangle, Activity, ChevronRight, Save, X, Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, EmptyState, ErrorState } from "@/components/StateViews";
import { useToast } from "@/hooks/use-toast";
import {
  paService,
  TEMPO_MAX_ESPERA_MIN,
  tempoLimiteExcedido,
  type CorRisco,
  type PaAtendimento,
  type PaFilaItem,
} from "@/services/paService";

const COR_CLASSIFICACAO: Record<CorRisco, string> = {
  VERMELHO: "bg-red-500 text-white",
  LARANJA: "bg-orange-500 text-white",
  AMARELO: "bg-yellow-500 text-white",
  VERDE: "bg-green-500 text-white",
  AZUL: "bg-blue-500 text-white",
};

const COR_BORDA: Record<CorRisco, string> = {
  VERMELHO: "border-red-500",
  LARANJA: "border-orange-500",
  AMARELO: "border-yellow-500",
  VERDE: "border-green-500",
  AZUL: "border-blue-500",
};

export function PaManager() {
  const { toast } = useToast();
  const [fila, setFila] = useState<PaFilaItem[]>([]);
  const [estatisticas, setEstatisticas] = useState<Awaited<ReturnType<typeof paService.getEstatisticas>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNovo, setShowNovo] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedAtend, setSelectedAtend] = useState<PaAtendimento | null>(null);
  const [saving, setSaving] = useState(false);

  // form novo
  const [cdPaciente, setCdPaciente] = useState("");
  const [dsQueixa, setDsQueixa] = useState("");

  // form triagem
  const [corSelecionada, setCorSelecionada] = useState<CorRisco>("VERDE");
  const [news2, setNews2] = useState("");

  const carregar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [filaData, stats] = await Promise.all([paService.getFila(), paService.getEstatisticas()]);
      setFila(filaData);
      setEstatisticas(stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
    // refresh a cada 30s
    const interval = setInterval(() => void carregar(), 30_000);
    return () => clearInterval(interval);
  }, [carregar]);

  const abrirAtendimento = useCallback(async (id: number) => {
    setSelectedId(id);
    const atend = await paService.getById(id);
    setSelectedAtend(atend);
  }, []);

  const handleNovo = useCallback(async () => {
    if (!cdPaciente) {
      toast({ title: "Informe o paciente", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const created = await paService.create({
        cd_paciente: Number(cdPaciente),
        ds_queixa_principal: dsQueixa || null,
        tp_status: "AGUARDANDO",
      });
      toast({ title: "Atendimento registrado", description: `ID #${created.id}` });
      setShowNovo(false);
      setCdPaciente("");
      setDsQueixa("");
      void carregar();
    } catch (err) {
      toast({
        title: "Erro",
        description: err instanceof Error ? err.message : "Erro",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }, [cdPaciente, dsQueixa, toast, carregar]);

  const handleTriagem = useCallback(async () => {
    if (!selectedAtend) return;
    setSaving(true);
    try {
      await paService.registrarTriagem(selectedAtend.id, {
        id: 1, // classificação default (lookup local)
        cd_cor_risco: corSelecionada,
        vl_news2_score: news2 ? Number(news2) : null,
        ds_queixa_principal: selectedAtend.ds_queixa_principal,
      });
      toast({ title: "Triagem registrada" });
      void carregar();
    } catch (err) {
      toast({
        title: "Erro",
        description: err instanceof Error ? err.message : "Erro",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }, [selectedAtend, corSelecionada, news2, toast, carregar]);

  const handleAlta = useCallback(async (destino: PaAtendimento["tp_destino"]) => {
    if (!selectedAtend) return;
    setSaving(true);
    try {
      await paService.darAlta(selectedAtend.id, {
        tp_destino: destino,
      });
      toast({ title: `Alta registrada (${destino})` });
      setSelectedId(null);
      setSelectedAtend(null);
      void carregar();
    } catch (err) {
      toast({
        title: "Erro",
        description: err instanceof Error ? err.message : "Erro",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }, [selectedAtend, toast, carregar]);

  const stats = useMemo(() => {
    if (!estatisticas) return null;
    const total = Object.values(estatisticas).reduce((a, b) => a + b, 0);
    return { ...estatisticas, total };
  }, [estatisticas]);

  if (loading) return <LoadingState message="Carregando fila do PA..." />;
  if (error) return <ErrorState message={error} onRetry={carregar} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pronto Atendimento"
        description="Fila com classificação de risco Manchester + NEWS2"
        actions={
          <Button onClick={() => setShowNovo(!showNovo)}>
            <Plus className="h-4 w-4 mr-1" />
            Novo atendimento
          </Button>
        }
      />

      {stats && (
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
          <Card>
            <CardContent className="pt-3 pb-3">
              <p className="text-xs text-muted-foreground">Aguardando</p>
              <p className="text-2xl font-bold">{stats.aguardando + stats.emTriagem}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-3 pb-3">
              <p className="text-xs text-muted-foreground">Em atendimento</p>
              <p className="text-2xl font-bold text-orange-600">{stats.emAtendimento}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-3 pb-3">
              <p className="text-xs text-muted-foreground">Observação</p>
              <p className="text-2xl font-bold text-yellow-600">{stats.emObservacao}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-3 pb-3">
              <p className="text-xs text-muted-foreground">Altas</p>
              <p className="text-2xl font-bold text-green-600">{stats.alta}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-3 pb-3">
              <p className="text-xs text-muted-foreground">Evasões</p>
              <p className="text-2xl font-bold text-red-600">{stats.evadido}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-3 pb-3">
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-2xl font-bold">{stats.total}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {showNovo && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>Novo atendimento de PA</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setShowNovo(false)}>
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label htmlFor="cd_paciente">ID do Paciente</Label>
              <Input
                id="cd_paciente"
                type="number"
                value={cdPaciente}
                onChange={(e) => setCdPaciente(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="queixa">Queixa principal</Label>
              <Textarea
                id="queixa"
                rows={2}
                value={dsQueixa}
                onChange={(e) => setDsQueixa(e.target.value)}
              />
            </div>
            <Button onClick={() => void handleNovo()} disabled={saving}>
              <Save className="h-4 w-4 mr-1" /> Registrar
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4" /> Fila de espera
            <Badge variant="secondary">{fila.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {fila.length === 0 ? (
            <EmptyState
              icon={Activity}
              title="Fila vazia"
              description="Nenhum paciente aguardando no momento."
            />
          ) : (
            fila.map((item) => {
              const cor = item.cd_cor_risco;
              const excedido = cor ? tempoLimiteExcedido(cor, item.nr_minutos_espera) : false;
              return (
                <div
                  key={item.id}
                  onClick={() => void abrirAtendimento(item.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      void abrirAtendimento(item.id);
                    }
                  }}
                  className={`p-3 rounded-md border-l-4 bg-card hover:bg-accent cursor-pointer ${
                    cor ? COR_BORDA[cor] : "border-gray-300"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {cor && (
                        <span
                          className={`px-2 py-1 rounded text-xs font-bold ${COR_CLASSIFICACAO[cor]}`}
                        >
                          {cor}
                        </span>
                      )}
                      <div>
                        <p className="font-medium">Paciente #{item.cd_paciente}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.ds_queixa_principal || "Sem queixa registrada"}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-medium ${excedido ? "text-red-600" : ""}`}>
                        {Math.round(item.nr_minutos_espera)} min
                        {excedido && <AlertTriangle className="inline h-3 w-3 ml-1" />}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {item.tp_status} · NEWS2: {item.vl_news2_score ?? "—"}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {selectedAtend && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>Atendimento #{selectedAtend.id}</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}>
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="cor">Cor (Manchester)</Label>
                <select
                  id="cor"
                  className="w-full rounded-md border px-3 py-2 text-sm bg-background"
                  value={corSelecionada}
                  onChange={(e) => setCorSelecionada(e.target.value as CorRisco)}
                >
                  <option value="VERMELHO">🔴 VERMELHO — Emergência (0 min)</option>
                  <option value="LARANJA">🟠 LARANJA — Muito urgente (10 min)</option>
                  <option value="AMARELO">�� AMARELO — Urgente (60 min)</option>
                  <option value="VERDE">🟢 VERDE — Pouco urgente (120 min)</option>
                  <option value="AZUL">🔵 AZUL — Não urgente (240 min)</option>
                </select>
              </div>
              <div>
                <Label htmlFor="news2">NEWS2 (0-20)</Label>
                <Input
                  id="news2"
                  type="number"
                  min="0"
                  max="20"
                  value={news2}
                  onChange={(e) => setNews2(e.target.value)}
                  placeholder="0"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  ≥7 = alto risco · ≥5 = risco moderado
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              <Button onClick={() => void handleTriagem()} disabled={saving}>
                <Save className="h-4 w-4 mr-1" /> Registrar Triagem
              </Button>
              <Button variant="outline" onClick={() => void handleAlta("ALTA_MELHORADO")} disabled={saving}>
                <Check className="h-4 w-4 mr-1" /> Alta Melhorado
              </Button>
              <Button variant="outline" onClick={() => void handleAlta("INTERNACAO")} disabled={saving}>
                Internar
              </Button>
              <Button variant="outline" onClick={() => void handleAlta("TRANSFERENCIA")} disabled={saving}>
                Transferir
              </Button>
              <Button variant="destructive" onClick={() => void handleAlta("EVASAO")} disabled={saving}>
                Evasão
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
