/**
 * CriticalAlertsBanner — Banner vermelho no topo quando há alertas críticos
 *
 * - Lista resumida
 * - Botão "Comunicar agora" por item
 * - Som de alerta (opcional, via Web Audio API)
 * - WCAG: role="alert", aria-live="assertive"
 *
 * Apenas aparece quando há alertas pendentes. Auto-refresh a cada 30s.
 */

import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, X, Phone, MessageSquare } from "lucide-react";
import {
  alerta as alertaService,
  type AlertaCritico,
  type FormaComunicacao,
} from "@/services/lisService";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/components/ui/use-toast";

function playAlertSound(): void {
  if (typeof window === "undefined") return;
  try {
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
    setTimeout(() => ctx.close(), 500);
  } catch {
    // silencioso: usuário pode ter bloqueado áudio
  }
}

export function CriticalAlertsBanner() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dismissed, setDismissed] = useState<number[]>([]);
  const lastCountRef = useRef(0);

  const { data: alertas } = useQuery({
    queryKey: ["lab-alertas-pendentes", "banner"],
    queryFn: () => alertaService.listarPendentes(),
    refetchInterval: 30_000,
  });

  const comunicarMutation = useMutation({
    mutationFn: ({ id, forma }: { id: number; forma: FormaComunicacao }) =>
      alertaService.comunicar(id, forma, user?.id ?? ""),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lab-alertas-pendentes"] });
      toast({ title: "Alerta comunicado ao médico" });
    },
    onError: (e: Error) =>
      toast({ title: "Erro ao comunicar", description: e.message, variant: "destructive" }),
  });

  // Toca som quando novo alerta aparece
  useEffect(() => {
    const count = alertas?.length ?? 0;
    if (count > lastCountRef.current && lastCountRef.current > 0) {
      playAlertSound();
    }
    lastCountRef.current = count;
  }, [alertas?.length]);

  const visiveis: AlertaCritico[] = (alertas ?? []).filter(
    (a: AlertaCritico) => !dismissed.includes(a.id),
  );

  if (visiveis.length === 0) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="rounded-md border-2 border-red-500 bg-red-50 dark:bg-red-950/30 p-3"
    >
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="h-5 w-5 text-red-600" aria-hidden="true" />
        <h2 className="text-sm font-bold text-red-900 dark:text-red-100">
          {visiveis.length} alerta(s) crítico(s) pendente(s) de comunicação
        </h2>
      </div>
      <div className="space-y-1.5 max-h-40 overflow-y-auto">
        {visiveis.slice(0, 5).map((a) => (
          <div
            key={a.id}
            className="flex items-center justify-between bg-white dark:bg-red-900/30 rounded p-2"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-sm">
                <Badge variant="destructive" className="font-mono">
                  {a.tp_alerta.replace("_", " ")}
                </Badge>
                <span className="font-semibold truncate">
                  {a.paciente_nome ?? `#${a.cd_paciente}`}
                </span>
              </div>
              <p className="text-xs text-muted-foreground truncate">
                {a.ds_parametro}: <span className="font-mono">{a.vl_resultado}</span>{" "}
                (ref: {a.vl_referencia}) • médico: {a.medico_nome ?? `#${a.cd_medico}`}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  comunicarMutation.mutate({ id: a.id, forma: "TELEFONE" })
                }
                disabled={comunicarMutation.isPending}
                aria-label="Comunicar por telefone"
              >
                <Phone className="h-3 w-3" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  comunicarMutation.mutate({ id: a.id, forma: "WHATSAPP" })
                }
                disabled={comunicarMutation.isPending}
                aria-label="Comunicar por WhatsApp"
              >
                <MessageSquare className="h-3 w-3" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDismissed((d) => [...d, a.id])}
                aria-label="Adiar alerta"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          </div>
        ))}
      </div>
      {visiveis.length > 5 && (
        <p className="text-xs text-red-700 mt-2">
          +{visiveis.length - 5} alerta(s) adicional(is). Acesse a aba "Alertas" para ver todos.
        </p>
      )}
    </div>
  );
}
