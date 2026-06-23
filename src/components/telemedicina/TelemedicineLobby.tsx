/**
 * TelemedicineLobby — Lobby pré-consulta
 *
 * Permite ao paciente/médico:
 *  - Ver preview da câmera
 *  - Testar microfone (VU meter)
 *  - Verificar latência (Network Information API)
 *  - Aceitar termo de consentimento LGPD (gravação)
 *  - Entrar na consulta
 *
 * LGPD art. 7º II: o consentimento é gravado antes de iniciar a
 * gravação. Se o paciente recusar, a gravação fica desabilitada
 * (ver telemedicinaService.registrarConsentimento).
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Mic, MicOff, Video, VideoOff, Loader2, ShieldCheck, Activity, Wifi } from "lucide-react";
import { telemedicinaService, type TelemedSala } from "@/services/telemedicinaService";
import { cn } from "@/lib/utils";

interface TelemedicineLobbyProps {
  sala: TelemedSala;
  participante: { userId: string; nome: string; role: "MEDICO" | "PACIENTE" };
  onEntrar: (sala: TelemedSala, meetingToken: string, meetingUrl: string) => void;
  onCancelar: () => void;
}

type NetQuality = "DESCONHECIDA" | "BOA" | "MEDIA" | "FRACA";

function detectNetworkQuality(): NetQuality {
  // @ts-expect-error navigator.connection é experimental
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!conn) return "DESCONHECIDA";
  const eff = conn.effectiveType as string | undefined;
  if (eff === "4g") return "BOA";
  if (eff === "3g") return "MEDIA";
  if (eff === "2g" || eff === "slow-2g") return "FRACA";
  return "DESCONHECIDA";
}

export function TelemedicineLobby({
  sala,
  participante,
  onEntrar,
  onCancelar,
}: TelemedicineLobbyProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  const [cameraAtiva, setCameraAtiva] = useState(true);
  const [micAtivo, setMicAtivo] = useState(true);
  const [nivelMic, setNivelMic] = useState(0);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [netQuality, setNetQuality] = useState<NetQuality>("DESCONHECIDA");

  const [consentGravacao, setConsentGravacao] = useState(false);
  const [consentTermos, setConsentTermos] = useState(false);

  // Detecta rede
  useEffect(() => {
    setNetQuality(detectNetworkQuality());
    const handler = () => setNetQuality(detectNetworkQuality());
    // @ts-expect-error addEventListener em connection
    navigator.connection?.addEventListener?.("change", handler);
    return () => {
      // @ts-expect-error
      navigator.connection?.removeEventListener?.("change", handler);
    };
  }, []);

  // Inicia preview de mídia
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: cameraAtiva,
          audio: micAtivo,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setMediaError(null);
        startMicMeter(stream);
      } catch (err) {
        setMediaError(
          err instanceof Error
            ? err.message
            : "Não foi possível acessar câmera/microfone. Verifique as permissões do navegador.",
        );
      }
    }
    init();
    return () => {
      cancelled = true;
      stopAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraAtiva, micAtivo]);

  function startMicMeter(stream: MediaStream) {
    if (!micAtivo) return;
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const loop = () => {
        analyser.getByteTimeDomainData(data);
        let max = 0;
        for (let i = 0; i < data.length; i++) {
          const v = Math.abs(data[i] - 128);
          if (v > max) max = v;
        }
        setNivelMic(Math.min(100, Math.round((max / 128) * 100)));
        rafRef.current = requestAnimationFrame(loop);
      };
      loop();
    } catch (err) {
      console.warn("[lobby] mic meter falhou:", err);
    }
  }

  function stopAll() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    audioCtxRef.current?.close().catch(() => undefined);
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }

  async function handleEntrar() {
    if (!consentTermos) return;
    setCarregando(true);
    try {
      // Registra consentimento de gravação (LGPD)
      if (consentGravacao) {
        await telemedicinaService.registrarConsentimento(sala.id, true);
      } else {
        await telemedicinaService.registrarConsentimento(sala.id, false);
      }
      const result = await telemedicinaService.entrarSala(sala.ds_token_acesso, {
        userId: participante.userId,
        nome: participante.nome,
        role: participante.role,
      });
      onEntrar(result.sala, result.meetingToken, result.meetingUrl);
    } catch (err) {
      setMediaError(err instanceof Error ? err.message : "Falha ao entrar na sala");
    } finally {
      setCarregando(false);
    }
  }

  const podeEntrar = consentTermos && !carregando;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Coluna 1: preview + controles */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Video className="h-5 w-5" /> Teste de câmera e microfone
          </CardTitle>
          <CardDescription>
            Verifique se seus dispositivos estão funcionando antes de entrar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative aspect-video bg-muted rounded-md overflow-hidden">
            {cameraAtiva ? (
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-full object-cover"
                aria-label="Pré-visualização da câmera"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                <VideoOff className="h-12 w-12" />
              </div>
            )}
            {mediaError && (
              <div className="absolute inset-0 bg-background/80 flex items-center justify-center p-4">
                <p className="text-sm text-destructive text-center">{mediaError}</p>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant={micAtivo ? "default" : "outline"}
              onClick={() => setMicAtivo((v) => !v)}
              aria-pressed={micAtivo}
              aria-label={micAtivo ? "Desligar microfone" : "Ligar microfone"}
            >
              {micAtivo ? <Mic className="h-4 w-4 mr-2" /> : <MicOff className="h-4 w-4 mr-2" />}
              {micAtivo ? "Mic lig." : "Mic des."}
            </Button>
            <Button
              type="button"
              variant={cameraAtiva ? "default" : "outline"}
              onClick={() => setCameraAtiva((v) => !v)}
              aria-pressed={cameraAtiva}
              aria-label={cameraAtiva ? "Desligar câmera" : "Ligar câmera"}
            >
              {cameraAtiva ? <Video className="h-4 w-4 mr-2" /> : <VideoOff className="h-4 w-4 mr-2" />}
              {cameraAtiva ? "Câm. lig." : "Câm. des."}
            </Button>
          </div>

          {/* VU meter */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Nível do microfone</Label>
            <div
              className="h-2 bg-muted rounded overflow-hidden"
              role="meter"
              aria-label="Nível do microfone"
              aria-valuenow={nivelMic}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className={cn(
                  "h-full transition-all",
                  nivelMic < 30 && "bg-emerald-500",
                  nivelMic >= 30 && nivelMic < 70 && "bg-yellow-500",
                  nivelMic >= 70 && "bg-red-500",
                )}
                style={{ width: `${nivelMic}%` }}
              />
            </div>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <Wifi className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Conexão:</span>
            <Badge
              variant={
                netQuality === "BOA" ? "default" : netQuality === "FRACA" ? "destructive" : "secondary"
              }
            >
              {netQuality}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Coluna 2: consentimentos + ação */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" /> Consentimento LGPD
          </CardTitle>
          <CardDescription>
            Antes de iniciar, leia e aceite os termos obrigatórios.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <Activity className="h-4 w-4" />
            <AlertTitle>Como funciona a consulta</AlertTitle>
            <AlertDescription>
              Esta é uma teleconsulta regida pela Resolução CFM 2.299/2021. Sua participação
              é registrada (horário, duração) e o chat fica armazenado para fins de prontuário.
            </AlertDescription>
          </Alert>

          <div className="space-y-3 rounded-md border p-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <Checkbox
                checked={consentTermos}
                onCheckedChange={(v) => setConsentTermos(Boolean(v))}
                aria-required="true"
              />
              <span className="text-sm leading-relaxed">
                Li e aceito os <strong>termos de uso</strong> e a Política de Privacidade
                (LGPD). Autorizo o registro da consulta para fins assistenciais.
              </span>
            </label>

            <label className="flex items-start gap-3 cursor-pointer">
              <Checkbox
                checked={consentGravacao}
                onCheckedChange={(v) => setConsentGravacao(Boolean(v))}
              />
              <span className="text-sm leading-relaxed">
                Autorizo a <strong>gravação em vídeo</strong> desta consulta (LGPD art. 7º II).
                Você pode revogar a qualquer momento. Sem este consentimento, a
                gravação permanece desabilitada.
              </span>
            </label>
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onCancelar}
              className="flex-1"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleEntrar}
              disabled={!podeEntrar}
              className="flex-1"
              aria-label="Entrar na consulta"
            >
              {carregando ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Conectando...
                </>
              ) : (
                "Aceitar e Entrar"
              )}
            </Button>
          </div>

          {!telemedicinaService.isConfigured() && (
            <Alert variant="destructive">
              <AlertDescription>
                Daily.co não configurado (VITE_DAILY_API_KEY / VITE_DAILY_DOMAIN ausentes).
                Configure o .env para habilitar a videochamada.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default TelemedicineLobby;
