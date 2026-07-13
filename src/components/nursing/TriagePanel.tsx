/**
 * TriagePanel — Painel principal de triagem
 *
 * Layout 3 colunas:
 * - Esquerda: Fila de triagem (senhas + tempo de espera)
 * - Centro: Paciente selecionado + TriageForm
 * - Direita: Resumo de sinais vitais + NEWS2 do paciente
 * - Topo: Botão para adicionar paciente à fila
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import { friendlyError } from "@/utils/friendlyError";
import {
  HeartPulse,
  Plus,
  Bell,
  ArrowRight,
  Clock,
  User,
  Stethoscope,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  nursingService,
  calcularNEWS2,
  type FilaItem,
  type ClassificacaoRisco,
  type TriagemCreate,
  type ClassificacaoCor,
} from "@/services/nursingService";
import { TriageForm } from "./TriageForm";

interface TriagePanelProps {
  companyId: string;
}

function useTicker(intervalMs: number = 1000): number {
  const [, setTick] = useState<number>(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return 0;
}

function formatarEspera(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "agora";
  const min = Math.floor(ms / 60000);
  const seg = Math.floor((ms % 60000) / 1000);
  if (min === 0) return `${seg}s`;
  return `${min}min ${seg}s`;
}

function createIdempotencyKey(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function TriagePanel({ companyId }: TriagePanelProps): JSX.Element {
  const { user } = useAuth();
  const { toast } = useToast();
  useTicker(1000);

  const [fila, setFila] = useState<FilaItem[]>([]);
  const [classificacoes, setClassificacoes] = useState<ClassificacaoRisco[]>([]);
  const [selecionado, setSelecionado] = useState<FilaItem | null>(null);
  const [carregando, setCarregando] = useState<boolean>(true);
  const [showForm, setShowForm] = useState<boolean>(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callKeysRef = useRef<Map<number, string>>(new Map());
  const completeOperationRef = useRef<{ fingerprint: string; idempotencyKey: string } | null>(null);

  const carregarFila = useCallback(async (): Promise<void> => {
    try {
      const itens = await nursingService.fila.getFilaAtiva(companyId);
      setFila(itens);
    } catch (err: unknown) {
      console.error("Erro ao carregar fila:", err);
    }
  }, [companyId]);

  const carregarClassificacoes = useCallback(async (): Promise<void> => {
    try {
      const cls = await nursingService.classificacao.getAll();
      setClassificacoes(cls);
    } catch (err: unknown) {
      console.error("Erro ao carregar classificações:", err);
    }
  }, []);

  useEffect(() => {
    void (async (): Promise<void> => {
      setCarregando(true);
      await Promise.all([carregarFila(), carregarClassificacoes()]);
      setCarregando(false);
    })();
  }, [carregarFila, carregarClassificacoes]);

  // Polling a cada 5s para atualizar a fila em tempo real
  useEffect(() => {
    pollRef.current = setInterval(() => {
      void carregarFila();
    }, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [carregarFila]);

  const handleChamar = useCallback(
    async (item: FilaItem): Promise<void> => {
      let idempotencyKey = callKeysRef.current.get(item.id);
      if (!idempotencyKey) {
        idempotencyKey = createIdempotencyKey();
        callKeysRef.current.set(item.id, idempotencyKey);
      }
      try {
        await nursingService.fila.chamar(item.id, idempotencyKey);
        callKeysRef.current.delete(item.id);
        toast({ title: `Senha ${item.cd_senha} chamada`, description: item.ds_queixa_inicial ?? "" });
        await carregarFila();
      } catch (err: unknown) {
        toast({ title: "Erro ao chamar senha", description: friendlyError(err), variant: "destructive" });
      }
    },
    [carregarFila, toast],
  );

  const handleSelecionar = useCallback((item: FilaItem): void => {
    setSelecionado(item);
    setShowForm(true);
  }, []);

  const handleSubmitTriagem = useCallback(
    async (data: TriagemCreate, _cor: ClassificacaoCor): Promise<void> => {
      if (!selecionado) throw new Error("Selecione um paciente da fila para concluir a triagem.");
      const sinais = data.sinaisVitais;
      const glasgowTotal = data.glasgow
        ? data.glasgow.ocular + data.glasgow.verbal + data.glasgow.motor
        : 15;
      const news2 = calcularNEWS2({
        frequenciaRespiratoria: sinais.frequenciaRespiratoria,
        saturacaoO2: sinais.saturacaoO2,
        temperatura: sinais.temperatura,
        pressaoSistolica: sinais.pressaoSistolica,
        frequenciaCardiaca: sinais.frequenciaCardiaca,
        nivelConsciencia: glasgowTotal < 15 ? 1 : 0,
      });
      const fingerprint = JSON.stringify({ filaId: selecionado.id, data, news2 });
      let operation = completeOperationRef.current;
      if (!operation || operation.fingerprint !== fingerprint) {
        operation = { fingerprint, idempotencyKey: createIdempotencyKey() };
        completeOperationRef.current = operation;
      }
      await nursingService.triagem.create(data, {
        filaId: selecionado.id,
        news2,
        idempotencyKey: operation.idempotencyKey,
      });
      completeOperationRef.current = null;
      await carregarFila();
      setSelecionado(null);
      setShowForm(false);
    },
    [selecionado, carregarFila],
  );

  const corPorClassificacao = useCallback(
    (id?: number | null): string => {
      if (!id) return "#6B7280";
      const c = classificacoes.find((x) => x.id === id);
      return c?.cd_cor_hex ?? "#6B7280";
    },
    [classificacoes],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <HeartPulse className="h-6 w-6 text-primary" />
            Triagem de Enfermagem
          </h1>
          <p className="text-sm text-muted-foreground">
            Classificação Manchester + NEWS2 — {fila.length} paciente(s) aguardando
          </p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)}>
          <Plus className="h-4 w-4 mr-2" />
          {showForm ? "Fechar formulário" : "Nova Triagem"}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Sidebar esquerda: fila */}
        <Card className="lg:col-span-3">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" /> Fila de Triagem
            </CardTitle>
            <CardDescription>Ordenada por gravidade e chegada</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[calc(100vh-280px)] min-h-[400px]">
              {carregando ? (
                <div className="p-4 text-sm text-muted-foreground">Carregando...</div>
              ) : fila.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  <Bell className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  Fila vazia
                </div>
              ) : (
                <ul className="space-y-1 p-2">
                  {fila.map((item) => {
                    const cor = corPorClassificacao(item.cd_classificacao_id);
                    return (
                      <li
                        key={item.id}
                        className={`group cursor-pointer rounded-md p-3 transition-colors border ${
                          selecionado?.id === item.id ? "bg-accent border-primary" : "hover:bg-accent/50 border-transparent"
                        }`}
                        onClick={() => handleSelecionar(item)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div
                              className="w-2 h-10 rounded-full"
                              style={{ background: cor }}
                              aria-hidden
                            />
                            <div>
                              <div className="font-mono font-bold text-sm" style={{ color: cor }}>
                                {item.cd_senha}
                              </div>
                              <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                                <Clock className="h-2.5 w-2.5" />
                                {formatarEspera(item.dt_chegada)}
                              </div>
                            </div>
                          </div>
                          <Badge
                            variant={item.tp_status === "CHAMADO" ? "default" : "outline"}
                            className="text-[10px]"
                          >
                            {item.tp_status}
                          </Badge>
                        </div>
                        {item.ds_queixa_inicial && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                            {item.ds_queixa_inicial}
                          </p>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="w-full mt-2 h-7 text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleChamar(item);
                          }}
                          disabled={item.tp_status === "CHAMADO"}
                        >
                          <Bell className="h-3 w-3 mr-1" />
                          {item.tp_status === "CHAMADO" ? "Chamado" : "Chamar"}
                          <ArrowRight className="h-3 w-3 ml-1" />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Centro: formulário ou painel inicial */}
        <div className="lg:col-span-6">
          {showForm && selecionado ? (
            <TriageForm
              cdPaciente={selecionado.cd_paciente}
              companyId={companyId}
              classificacoes={classificacoes}
              cdUsuarioEnfermeiro={user?.id}
              onSubmit={handleSubmitTriagem}
              onCancel={() => {
                setShowForm(false);
                setSelecionado(null);
              }}
            />
          ) : showForm ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Stethoscope className="h-5 w-5 text-primary" /> Selecione um paciente da fila
                </CardTitle>
                <CardDescription>Para iniciar a triagem, escolha uma senha na lista à esquerda</CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5 text-primary" /> Painel de Triagem
                </CardTitle>
                <CardDescription>
                  Selecione um paciente na fila à esquerda ou clique em "Nova Triagem".
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                  {classificacoes.map((c) => (
                    <div
                      key={c.id}
                      className="p-3 rounded-md border"
                      style={{ borderLeft: `4px solid ${c.cd_cor_hex}` }}
                    >
                      <div className="font-bold text-xs uppercase" style={{ color: c.cd_cor_hex }}>
                        {c.ds_classificacao}
                      </div>
                      <div className="text-2xl font-bold">{c.nr_tempo_max_atendimento_min}</div>
                      <div className="text-[10px] text-muted-foreground">min SLA</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar direita: estatísticas */}
        <Card className="lg:col-span-3">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Painel rápido</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="resumo">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="resumo">Resumo</TabsTrigger>
                <TabsTrigger value="info">Info</TabsTrigger>
              </TabsList>
              <TabsContent value="resumo" className="space-y-2 mt-3">
                {(["VERMELHO", "LARANJA", "AMARELO", "VERDE", "AZUL"] as ClassificacaoCor[]).map((cor) => {
                  const count = fila.filter(
                    (f) => classificacoes.find((c) => c.id === f.cd_classificacao_id)?.ds_classificacao === cor,
                  ).length;
                  const meta = classificacoes.find((c) => c.ds_classificacao === cor);
                  return (
                    <div
                      key={cor}
                      className="flex items-center justify-between p-2 rounded-md"
                      style={{ background: `${meta?.cd_cor_hex}15` }}
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ background: meta?.cd_cor_hex }} />
                        <span className="text-xs font-semibold">{cor}</span>
                      </div>
                      <span className="text-lg font-bold">{count}</span>
                    </div>
                  );
                })}
              </TabsContent>
              <TabsContent value="info" className="mt-3 text-xs space-y-2 text-muted-foreground">
                <p>
                  <strong>Manchester:</strong> Classificação de risco baseada em discriminadores.
                </p>
                <p>
                  <strong>NEWS2:</strong> Score de deterioração clínica. 0-4=BAIXO, 5-6=MEDIO, 7+=ALTO.
                </p>
                <p>
                  A fila é ordenada por gravidade e tempo de chegada.
                </p>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default TriagePanel;

