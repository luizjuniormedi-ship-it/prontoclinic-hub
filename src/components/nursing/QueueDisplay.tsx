/**
 * QueueDisplay — TV / Painel de chamada para sala de espera
 *
 * Características:
 * - Senhas em ordem de classificação (mais graves primeiro)
 * - Cor por gravidade
 * - Tempo de espera atualiza a cada segundo
 * - Som de chamada (opcional, via Web Audio API)
 * - Botão "Chamar próxima" (apenas para enfermagem)
 */

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Volume2, VolumeX, Bell, ArrowRight, Clock, AlertCircle } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { friendlyError } from "@/utils/friendlyError";
import {
  nursingService,
  type FilaItem,
  type ClassificacaoRisco,
  type ClassificacaoCor,
} from "@/services/nursingService";

interface QueueDisplayProps {
  companyId: string;
  /** Quando true (modo TV), esconde controles administrativos */
  modoTV?: boolean;
}

function formatarEspera(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "agora";
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 60) return `${totalMin}min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${m}min`;
}

function tocarBeepCurto(): void {
  try {
    if (typeof window === "undefined") return;
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 800;
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
    setTimeout(() => {
      void ctx.close();
    }, 600);
  } catch {
    // Silencia erros de audio
  }
}

export function QueueDisplay({ companyId, modoTV = false }: QueueDisplayProps): JSX.Element {
  const { toast } = useToast();
  const [fila, setFila] = useState<FilaItem[]>([]);
  const [classificacoes, setClassificacoes] = useState<ClassificacaoRisco[]>([]);
  const [somAtivo, setSomAtivo] = useState<boolean>(false);
  const [carregando, setCarregando] = useState<boolean>(true);
  const [, setTick] = useState<number>(0);
  const ultChamadaRef = useRef<number | null>(null);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const carregar = useCallback(async (): Promise<void> => {
    try {
      const [itens, cls] = await Promise.all([
        nursingService.fila.getFilaAtiva(companyId),
        nursingService.classificacao.getAll(),
      ]);
      setFila(itens);
      setClassificacoes(cls);
    } catch (err: unknown) {
      console.error("Erro ao carregar:", err);
    } finally {
      setCarregando(false);
    }
  }, [companyId]);

  useEffect(() => {
    void carregar();
    const t = setInterval(() => void carregar(), 5000);
    return () => clearInterval(t);
  }, [carregar]);

  // Detecta nova chamada e toca beep
  useEffect(() => {
    const chamada = fila.find((f) => f.tp_status === "CHAMADO");
    if (chamada && ultChamadaRef.current !== chamada.id) {
      ultChamadaRef.current = chamada.id;
      if (somAtivo) tocarBeepCurto();
    }
  }, [fila, somAtivo]);

  // Ordenação: por gravidade (cor) e depois por tempo de espera
  const filaOrdenada = useMemo<FilaItem[]>(() => {
    const ordem: Record<ClassificacaoCor, number> = {
      VERMELHO: 0,
      LARANJA: 1,
      AMARELO: 2,
      VERDE: 3,
      AZUL: 4,
    };
    return [...fila]
      .filter((f) => f.tp_status === "AGUARDANDO" || f.tp_status === "CHAMADO")
      .sort((a, b) => {
        const ca = classificacoes.find((c) => c.id === a.cd_classificacao_id)?.ds_classificacao;
        const cb = classificacoes.find((c) => c.id === b.cd_classificacao_id)?.ds_classificacao;
        const oa = ca ? ordem[ca] : 4;
        const ob = cb ? ordem[cb] : 4;
        if (oa !== ob) return oa - ob;
        return new Date(a.dt_chegada).getTime() - new Date(b.dt_chegada).getTime();
      });
  }, [fila, classificacoes]);

  const corPorClassificacao = useCallback(
    (id?: number | null): string => {
      if (!id) return "#6B7280";
      const c = classificacoes.find((x) => x.id === id);
      return c?.cd_cor_hex ?? "#6B7280";
    },
    [classificacoes],
  );

  const handleChamarProxima = useCallback(async (): Promise<void> => {
    const proxima = filaOrdenada.find((f) => f.tp_status === "AGUARDANDO");
    if (!proxima) {
      toast({ title: "Fila vazia", description: "Nenhum paciente aguardando." });
      return;
    }
    try {
      await nursingService.fila.chamar(proxima.id);
      toast({ title: `Senha ${proxima.cd_senha} chamada!` });
      if (somAtivo) tocarBeepCurto();
      await carregar();
    } catch (err: unknown) {
      toast({ title: "Erro ao chamar", description: friendlyError(err), variant: "destructive" });
    }
  }, [filaOrdenada, somAtivo, toast, carregar]);

  // Tamanho do texto principal varia conforme modo
  const senhaClass = modoTV ? "text-7xl md:text-9xl" : "text-3xl";
  const labelClass = modoTV ? "text-xl" : "text-xs";

  if (carregando) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <Clock className="h-12 w-12 mx-auto mb-3 opacity-30" />
        Carregando fila de triagem...
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${modoTV ? "min-h-screen p-6 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900" : ""}`}>
      {/* Cabeçalho */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className={`font-bold flex items-center gap-2 ${modoTV ? "text-3xl" : "text-2xl"}`}>
            <Bell className="h-6 w-6 text-primary" /> Painel de Chamada
          </h1>
          <p className="text-sm text-muted-foreground">
            {filaOrdenada.length} senha(s) em atendimento
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={somAtivo ? "default" : "outline"}
            size={modoTV ? "lg" : "sm"}
            onClick={() => setSomAtivo((v) => !v)}
            aria-pressed={somAtivo}
            aria-label={somAtivo ? "Desativar som" : "Ativar som"}
          >
            {somAtivo ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            {somAtivo ? "Som ON" : "Som OFF"}
          </Button>
          {!modoTV && (
            <Button onClick={handleChamarProxima}>
              <ArrowRight className="h-4 w-4 mr-2" />
              Chamar próxima
            </Button>
          )}
        </div>
      </div>

      {/* Senha atualmente chamada (destaque) */}
      {(() => {
        const chamada = fila.find((f) => f.tp_status === "CHAMADO");
        if (!chamada) return null;
        const cor = corPorClassificacao(chamada.cd_classificacao_id);
        return (
          <Card
            className="overflow-hidden border-4 animate-pulse"
            style={{ borderColor: cor, background: `${cor}10` }}
          >
            <CardContent className="p-8 text-center">
              <p className={`uppercase tracking-wider font-bold ${labelClass}`} style={{ color: cor }}>
                Senha em atendimento
              </p>
              <p
                className={`${senhaClass} font-black tracking-widest my-2`}
                style={{ color: cor }}
              >
                {chamada.cd_senha}
              </p>
              {chamada.ds_queixa_inicial && (
                <p className="text-sm text-muted-foreground">{chamada.ds_queixa_inicial}</p>
              )}
            </CardContent>
          </Card>
        );
      })()}

      {/* Lista de senhas aguardando */}
      {filaOrdenada.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <Clock className="h-12 w-12 mx-auto mb-3 opacity-30" />
            Nenhum paciente aguardando triagem no momento.
          </CardContent>
        </Card>
      ) : (
        <div className={modoTV ? "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3" : "space-y-2"}>
          {filaOrdenada.map((item) => {
            const cor = corPorClassificacao(item.cd_classificacao_id);
            const classMeta = classificacoes.find((c) => c.id === item.cd_classificacao_id);
            return (
              <Card
                key={item.id}
                className={`overflow-hidden transition-all ${
                  item.tp_status === "CHAMADO" ? "ring-2 ring-primary animate-pulse" : ""
                }`}
                style={{ borderLeft: `6px solid ${cor}` }}
              >
                <CardContent className={modoTV ? "p-4" : "p-3"}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p
                        className={`font-mono font-black ${modoTV ? "text-3xl" : "text-2xl"}`}
                        style={{ color: cor }}
                      >
                        {item.cd_senha}
                      </p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                        <Clock className="h-3 w-3" />
                        {formatarEspera(item.dt_chegada)}
                      </p>
                    </div>
                    {classMeta && (
                      <div className="text-right">
                        <Badge style={{ background: cor, color: "white" }}>{classMeta.ds_classificacao}</Badge>
                        {item.tp_status === "CHAMADO" && (
                          <p className="text-[10px] text-primary mt-1 font-bold flex items-center gap-1 justify-end">
                            <AlertCircle className="h-3 w-3" /> CHAMANDO
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  {item.ds_queixa_inicial && !modoTV && (
                    <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
                      {item.ds_queixa_inicial}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default QueueDisplay;
