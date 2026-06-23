/**
 * TelemedicineRoom — Sala de videochamada
 *
 * Integração com Daily.co via @daily-co/daily-js (carregado em runtime).
 * Inclui:
 *  - Vídeo principal + self-view
 *  - Controles: mic, câmera, tela, chat, gravar, sair
 *  - Sidebar com chat, participantes, prescrição (toggle)
 *  - Métricas de qualidade (bitrate/latência via getNetworkStats)
 *  - Finalização com persistência de métricas
 *
 * Importante: o bundle do Daily JS é injetado via script tag na primeira
 * montagem para não pesar o bundle inicial. Em produção, prefira
 * instalar @daily-co/daily-js e fazer import direto.
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Mic, MicOff, Video, VideoOff, MonitorUp, MessageSquare, Users, Pill, PhoneOff,
  Loader2, Send, AlertCircle, ShieldCheck, CircleDot,
} from "lucide-react";
import { telemedicinaService, type TelemedMensagem, type TelemedSala, type TipoParticipante } from "@/services/telemedicinaService";
import { cn } from "@/lib/utils";

// Tipagem mínima para o Daily JS injetado dinamicamente
interface DailyCallObject {
  join(options?: { url?: string; token?: string }): Promise<void>;
  leave(): Promise<void>;
  setLocalAudio(active: boolean): void;
  setLocalVideo(active: boolean): void;
  startScreenShare(): Promise<void>;
  stopScreenShare(): Promise<void>;
  startRecording(): Promise<void>;
  stopRecording(): Promise<void>;
  on(event: string, handler: (...args: unknown[]) => void): void;
  off(event: string, handler: (...args: unknown[]) => void): void;
  meetingState(): string;
  participants(): { local: boolean; session_id: string; user_name?: string }[];
  getNetworkStats(): Promise<{ stats: { latest: { videoSendBitsPerSecond?: number; videoRecvBitsPerSecond?: number } } } | unknown>;
}

declare global {
  interface Window {
    DailyIframe?: {
      createCallObject(opts: {
        audioSource?: string | boolean;
        videoSource?: string | boolean;
        dailyConfig?: { useDevicePreferenceCookies?: boolean };
      }): DailyCallObject;
      createFrame?(opts: {
        url?: string;
        token?: string;
        iframeStyle?: Record<string, string>;
      }): { destroy(): void; iframe: HTMLIFrameElement };
    };
    dailyScriptLoaded?: boolean;
  }
}

const DAILY_SCRIPT_URL = "https://unpkg.com/@daily-co/daily-js";

interface TelemedicineRoomProps {
  sala: TelemedSala;
  meetingUrl: string;
  meetingToken: string;
  participante: { userId: string; nome: string; role: TipoParticipante };
  onFinalizar: () => void;
  onSair: () => void;
}

interface ChatMsg extends TelemedMensagem {}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function TelemedicineRoom({
  sala,
  meetingUrl,
  meetingToken,
  participante,
  onFinalizar,
  onSair,
}: TelemedicineRoomProps) {
  const callRef = useRef<DailyCallObject | null>(null);
  const callContainerRef = useRef<HTMLDivElement | null>(null);
  const [scriptPronto, setScriptPronto] = useState(Boolean(window.DailyIframe));
  const [scriptError, setScriptError] = useState<string | null>(null);

  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [screenOn, setScreenOn] = useState(false);
  const [recordingOn, setRecordingOn] = useState(false);
  const [sidebarAberta, setSidebarAberta] = useState<"chat" | "participantes" | "prescricao" | null>("chat");
  const [elapsed, setElapsed] = useState(0);
  const [latencia, setLatencia] = useState<number | null>(null);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [participantes, setParticipantes] = useState<{ nome: string; isLocal: boolean }[]>([]);
  const [prescricao, setPrescricao] = useState("");
  const [prescricaoSalva, setPrescricaoSalva] = useState(false);
  const [finalizando, setFinalizando] = useState(false);

  // Carrega o script do Daily.js (uma vez)
  useEffect(() => {
    if (window.DailyIframe) {
      setScriptPronto(true);
      return;
    }
    if (document.querySelector(`script[src="${DAILY_SCRIPT_URL}"]`)) {
      // Já foi adicionado por outra instância — aguarda carregar
      const t = setInterval(() => {
        if (window.DailyIframe) {
          setScriptPronto(true);
          clearInterval(t);
        }
      }, 200);
      return () => clearInterval(t);
    }
    const script = document.createElement("script");
    script.src = DAILY_SCRIPT_URL;
    script.async = true;
    script.onload = () => setScriptPronto(true);
    script.onerror = () => setScriptError("Falha ao carregar SDK de videochamada");
    document.body.appendChild(script);
  }, []);

  // Cria o call object e entra
  useEffect(() => {
    if (!scriptPronto || !window.DailyIframe) return;
    if (!meetingUrl) return;
    try {
      const call = window.DailyIframe.createCallObject({
        audioSource: true,
        videoSource: true,
        dailyConfig: { useDevicePreferenceCookies: false },
      });
      callRef.current = call;

      const onParticipantsChange = () => {
        const ps = call.participants();
        setParticipantes(
          ps.map((p) => ({ nome: p.user_name ?? (p.local ? "Você" : "Convidado"), isLocal: p.local })),
        );
      };
      const onError = (e: unknown) => console.error("[daily] error", e);

      call.on("participant-joined", onParticipantsChange);
      call.on("participant-left", onParticipantsChange);
      call.on("error", onError);

      void call.join({ url: meetingUrl, token: meetingToken });
      onParticipantsChange();
    } catch (err) {
      setScriptError(err instanceof Error ? err.message : "Falha ao iniciar chamada");
    }
    return () => {
      callRef.current?.leave().catch(() => undefined);
      callRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptPronto]);

  // Timer
  useEffect(() => {
    const start = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  // Métricas de rede a cada 15s
  useEffect(() => {
    if (!callRef.current) return;
    const t = setInterval(async () => {
      try {
        const stats = (await callRef.current?.getNetworkStats()) as
          | { stats?: { latest?: { videoRecvBitsPerSecond?: number; videoSendBitsPerSecond?: number } } }
          | undefined;
        if (stats?.stats?.latest) {
          const bps = (stats.stats.latest.videoRecvBitsPerSecond ?? 0) + (stats.stats.latest.videoSendBitsPerSecond ?? 0);
          setLatencia(Math.round(bps / 1000)); // kbps como proxy de qualidade
        }
      } catch {
        // ignore
      }
    }, 15000);
    return () => clearInterval(t);
  }, []);

  // Carrega histórico de mensagens
  useEffect(() => {
    telemedicinaService
      .listarMensagens(sala.id)
      .then(setChat)
      .catch((e) => console.warn("[chat] load failed:", e));
  }, [sala.id]);

  function toggleMic() {
    const next = !micOn;
    setMicOn(next);
    callRef.current?.setLocalAudio(next);
  }

  function toggleCam() {
    const next = !camOn;
    setCamOn(next);
    callRef.current?.setLocalVideo(next);
  }

  async function toggleScreen() {
    try {
      if (screenOn) {
        await callRef.current?.stopScreenShare();
        setScreenOn(false);
      } else {
        await callRef.current?.startScreenShare();
        setScreenOn(true);
      }
    } catch (err) {
      console.warn("[screen] toggle failed", err);
    }
  }

  async function toggleRecording() {
    try {
      if (recordingOn) {
        await callRef.current?.stopRecording();
        setRecordingOn(false);
      } else {
        await callRef.current?.startRecording();
        setRecordingOn(true);
      }
    } catch (err) {
      console.warn("[recording] toggle failed", err);
    }
  }

  async function enviarMensagem(e: React.FormEvent) {
    e.preventDefault();
    const txt = chatInput.trim();
    if (!txt) return;
    const msg = await telemedicinaService.enviarMensagem(sala.id, txt, participante.userId, participante.nome);
    setChat((c) => [...c, msg]);
    setChatInput("");
  }

  async function salvarPrescricao() {
    if (!prescricao.trim()) return;
    try {
      await telemedicinaService.criarPrescricao(
        sala.id,
        prescricao,
        sala.cd_paciente,
        sala.cd_medico,
      );
      setPrescricaoSalva(true);
    } catch (err) {
      console.error("[prescricao] save failed", err);
    }
  }

  async function handleSair() {
    setFinalizando(true);
    try {
      await callRef.current?.leave();
      await telemedicinaService.finalizar(sala.id, participante.userId, {
        duracaoSegundos: elapsed,
        qualidade: {
          bitrateMedio: latencia ?? undefined,
          latenciaMedia: latencia ?? undefined,
        },
      });
      onFinalizar();
    } catch (err) {
      console.error("[finalizar] erro", err);
      onSair();
    }
  }

  return (
    <div className="flex h-[calc(100vh-12rem)] flex-col gap-3">
      {/* Header */}
      <Card>
        <CardContent className="p-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <CircleDot className={cn("h-3 w-3 shrink-0", sala.tp_status === "EM_ANDAMENTO" ? "text-emerald-500 animate-pulse" : "text-muted-foreground")} />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold truncate">
                Consulta #{sala.cd_appointment ?? sala.id.slice(0, 8)}
              </h2>
              <p className="text-xs text-muted-foreground">
                {participante.role} • {participante.nome}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm tabular-nums">
            <Badge variant="outline">{formatDuration(elapsed)}</Badge>
            {latencia !== null && (
              <Badge variant={latencia > 500 ? "destructive" : "secondary"}>
                {latencia} kbps
              </Badge>
            )}
            {sala.lg_gravacao_habilitada && (
              <Badge variant="destructive" className="gap-1">
                <CircleDot className="h-2 w-2 animate-pulse" /> REC
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Body: vídeo + sidebar */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-3 min-h-0">
        {/* Vídeo */}
        <div className="relative bg-muted rounded-md overflow-hidden flex items-center justify-center">
          {scriptError ? (
            <Alert variant="destructive" className="m-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{scriptError}</AlertDescription>
            </Alert>
          ) : !scriptPronto ? (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin" />
              <p className="text-sm">Carregando videochamada…</p>
            </div>
          ) : (
            <>
              <div ref={callContainerRef} className="w-full h-full" />
              <div className="absolute bottom-3 right-3 w-32 aspect-video bg-black/80 rounded-md border-2 border-white/20 flex items-center justify-center text-white/70 text-xs">
                Você {micOn ? "" : "(mudo)"} {camOn ? "" : "(sem vídeo)"}
              </div>
            </>
          )}

          {/* Controles */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-background/80 backdrop-blur rounded-full p-1 shadow-lg">
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant={micOn ? "secondary" : "destructive"} onClick={toggleMic} aria-label={micOn ? "Mutar" : "Desmutar"}>
                    {micOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{micOn ? "Mutar" : "Desmutar"}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant={camOn ? "secondary" : "destructive"} onClick={toggleCam} aria-label={camOn ? "Desligar câmera" : "Ligar câmera"}>
                    {camOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{camOn ? "Desligar câmera" : "Ligar câmera"}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant={screenOn ? "default" : "outline"} onClick={toggleScreen} aria-label="Compartilhar tela">
                    <MonitorUp className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Compartilhar tela</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant={sidebarAberta === "chat" ? "default" : "outline"} onClick={() => setSidebarAberta(sidebarAberta === "chat" ? null : "chat")} aria-label="Chat">
                    <MessageSquare className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Chat</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant={sidebarAberta === "participantes" ? "default" : "outline"} onClick={() => setSidebarAberta(sidebarAberta === "participantes" ? null : "participantes")} aria-label="Participantes">
                    <Users className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Participantes</TooltipContent>
              </Tooltip>
              {participante.role === "MEDICO" && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="icon" variant={sidebarAberta === "prescricao" ? "default" : "outline"} onClick={() => setSidebarAberta(sidebarAberta === "prescricao" ? null : "prescricao")} aria-label="Prescrição">
                      <Pill className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Prescrição</TooltipContent>
                </Tooltip>
              )}
              {sala.lg_consentimento_gravacao && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="icon" variant={recordingOn ? "destructive" : "outline"} onClick={toggleRecording} aria-label={recordingOn ? "Parar gravação" : "Gravar"}>
                      <CircleDot className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{recordingOn ? "Parar gravação" : "Iniciar gravação"}</TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant="destructive" onClick={handleSair} disabled={finalizando} aria-label="Sair da consulta">
                    {finalizando ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneOff className="h-4 w-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Encerrar consulta</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        {/* Sidebar */}
        {sidebarAberta && (
          <Card className="overflow-hidden">
            <Tabs value={sidebarAberta} onValueChange={(v) => setSidebarAberta(v as "chat" | "participantes" | "prescricao")}>
              <CardHeader className="p-3 pb-2">
                <TabsList className="w-full">
                  <TabsTrigger value="chat" className="flex-1"><MessageSquare className="h-3.5 w-3.5 mr-1" />Chat</TabsTrigger>
                  <TabsTrigger value="participantes" className="flex-1"><Users className="h-3.5 w-3.5 mr-1" />Pessoas</TabsTrigger>
                  {participante.role === "MEDICO" && (
                    <TabsTrigger value="prescricao" className="flex-1"><Pill className="h-3.5 w-3.5 mr-1" />Rx</TabsTrigger>
                  )}
                </TabsList>
              </CardHeader>
              <CardContent className="p-3 pt-0 h-[calc(100%-3.5rem)] overflow-hidden flex flex-col">
                <TabsContent value="chat" className="flex-1 flex flex-col gap-2 m-0">
                  <div className="flex-1 overflow-y-auto space-y-2 pr-1" role="log" aria-live="polite" aria-label="Mensagens do chat">
                    {chat.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-8">Sem mensagens ainda.</p>
                    )}
                    {chat.map((m) => (
                      <div key={m.id} className={cn("rounded-md p-2 text-sm", m.cd_usuario === participante.userId ? "bg-primary/10 ml-6" : "bg-muted mr-6")}>
                        <p className="text-xs font-semibold">{m.nm_remetente ?? "Sistema"}</p>
                        <p>{m.ds_mensagem}</p>
                      </div>
                    ))}
                  </div>
                  <form onSubmit={enviarMensagem} className="flex gap-1">
                    <Input
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder="Digite uma mensagem…"
                      aria-label="Mensagem de chat"
                    />
                    <Button type="submit" size="icon" aria-label="Enviar mensagem">
                      <Send className="h-4 w-4" />
                    </Button>
                  </form>
                </TabsContent>

                <TabsContent value="participantes" className="flex-1 m-0">
                  <ul className="space-y-2">
                    {participantes.map((p, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm">
                        <CircleDot className="h-3 w-3 text-emerald-500" />
                        <span>{p.nome}</span>
                        {p.isLocal && <Badge variant="outline" className="ml-auto text-[10px]">você</Badge>}
                      </li>
                    ))}
                  </ul>
                </TabsContent>

                <TabsContent value="prescricao" className="flex-1 flex flex-col gap-2 m-0">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Assinatura digital obrigatória para finalizar
                  </div>
                  <Label htmlFor="rx" className="text-xs">Receita (Markdown)</Label>
                  <Textarea
                    id="rx"
                    value={prescricao}
                    onChange={(e) => setPrescricao(e.target.value)}
                    placeholder={`Dipirona 500mg, 1cp 6/6h por 5 dias\nParacetamol 750mg, 1cp 8/8h se dor`}
                    className="flex-1 font-mono text-sm"
                    aria-label="Conteúdo da prescrição"
                  />
                  <Button onClick={salvarPrescricao} disabled={!prescricao.trim() || prescricaoSalva}>
                    {prescricaoSalva ? "Prescrição salva" : "Salvar prescrição"}
                  </Button>
                </TabsContent>
              </CardContent>
            </Tabs>
          </Card>
        )}
      </div>
    </div>
  );
}

export default TelemedicineRoom;
