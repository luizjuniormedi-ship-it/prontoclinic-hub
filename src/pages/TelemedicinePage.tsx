/**
 * TelemedicinePage — Entry point do módulo Telemedicina
 *
 * Modos:
 *  - Lista de agendamentos do dia com botão "Iniciar telemedicina"
 *  - Se ?roomId= estiver presente → renderiza a sala diretamente
 *  - Se ?token= estiver presente → lobby (entrar via token)
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Video, AlertCircle, ArrowRight, ListChecks } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { telemedicinaService, type TelemedSala } from "@/services/telemedicinaService";
import { TelemedicineLobby } from "@/components/telemedicina/TelemedicineLobby";
import { TelemedicineRoom } from "@/components/telemedicina/TelemedicineRoom";
import { TelemedicineHistory } from "@/components/telemedicina/TelemedicineHistory";

type Modo = "lista" | "lobby" | "sala" | "historico";

export default function TelemedicinePage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [modo, setModo] = useState<Modo>("lista");
  const [salaAtual, setSalaAtual] = useState<TelemedSala | null>(null);
  const [meetingCtx, setMeetingCtx] = useState<{ token: string; url: string }>({ token: "", url: "" });
  const [erro, setErro] = useState<string | null>(null);
  const [loadingSala, setLoadingSala] = useState(false);

  const companyId = user?.company_id ?? "";

  // Carrega sala via token na URL
  useEffect(() => {
    const token = params.get("token");
    if (token) {
      setLoadingSala(true);
      telemedicinaService
        .getSalaByToken(token)
        .then((s) => {
          setSalaAtual(s);
          setModo("lobby");
          setErro(null);
        })
        .catch((e) => setErro(e.message))
        .finally(() => setLoadingSala(false));
    }
  }, [params]);

  // Lista de agendamentos do dia marcados como teleconsulta
  const { data: agendamentos, isLoading } = useQuery({
    queryKey: ["telemed-agendamentos", companyId],
    enabled: Boolean(companyId) && modo === "lista",
    queryFn: async () => {
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      const amanha = new Date(hoje);
      amanha.setDate(amanha.getDate() + 1);
      const { data, error } = await supabase
        .from("appointments")
        .select("id, dt_start, ds_observations, paciente:patients!appointments_cd_paciente_fkey(id, full_name), medico:professionals!appointments_cd_medico_fkey(id, full_name)")
        .eq("company_id", companyId)
        .eq("tp_modalidade", "TELEMEDICINA")
        .gte("dt_start", hoje.toISOString())
        .lt("dt_start", amanha.toISOString())
        .order("dt_start")
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  const participante = useMemo(() => ({
    userId: user?.id ?? "anon",
    nome: user?.full_name ?? "Visitante",
    role: user?.role_name?.toLowerCase().includes("medic") ? "MEDICO" : "PACIENTE",
  }), [user]);

  async function iniciarSala(appointmentId: number) {
    setErro(null);
    try {
      const sala = await telemedicinaService.criarSala(appointmentId);
      setSalaAtual(sala);
      setModo("lobby");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao criar sala");
    }
  }

  async function onEntrarLobby(sala: TelemedSala, meetingToken: string, meetingUrl: string) {
    setSalaAtual(sala);
    setMeetingCtx({ token: meetingToken, url: meetingUrl });
    setModo("sala");
    setParams({});
  }

  function onFinalizarSala() {
    setModo("lista");
    setSalaAtual(null);
    setMeetingCtx({ token: "", url: "" });
  }

  function voltarLista() {
    setModo("lista");
    setSalaAtual(null);
    setMeetingCtx({ token: "", url: "" });
    setParams({});
  }

  // ──────────────── Render: lista (default) ────────────────
  if (modo === "lista") {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Telemedicina"
          description="Consultas por videochamada conforme Resolução CFM 2.299/2021"
          actions={
            <Button variant="outline" onClick={() => setModo("historico")}>
              <ListChecks className="h-4 w-4 mr-2" /> Histórico
            </Button>
          }
        />

        {erro && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Erro</AlertTitle>
            <AlertDescription>{erro}</AlertDescription>
          </Alert>
        )}

        {!telemedicinaService.isConfigured() && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Daily.co não configurado</AlertTitle>
            <AlertDescription>
              Configure <code>VITE_DAILY_API_KEY</code> e <code>VITE_DAILY_DOMAIN</code> no <code>.env</code> para habilitar videochamada.
            </AlertDescription>
          </Alert>
        )}

        {modo === "lista" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Video className="h-5 w-5" /> Teleconsultas de hoje
              </CardTitle>
              <CardDescription>
                Agendamentos marcados como modalidade TELEMEDICINA.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : !agendamentos || agendamentos.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Video className="h-10 w-10 mx-auto mb-3 opacity-40" />
                  <p>Nenhuma teleconsulta agendada para hoje.</p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {agendamentos.map((a) => {
                    const p = Array.isArray(a.paciente) ? a.paciente[0] : a.paciente;
                    const m = Array.isArray(a.medico) ? a.medico[0] : a.medico;
                    return (
                      <li key={a.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold truncate">
                            {new Date(a.dt_start).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                            {" — "}
                            {p?.full_name ?? `Paciente #${a.id}`}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Dr(a). {m?.full_name ?? "—"}
                            {a.ds_observations ? ` · ${a.ds_observations}` : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge variant="outline">#{a.id}</Badge>
                          <Button size="sm" onClick={() => iniciarSala(a.id)}>
                            Iniciar
                            <ArrowRight className="h-4 w-4 ml-1" />
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  if (modo === "historico") {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Histórico de Telemedicina"
          description="Todas as teleconsultas realizadas"
          actions={
            <Button variant="outline" onClick={() => setModo("lista")}>
              Voltar
            </Button>
          }
        />
        <TelemedicineHistory companyId={companyId} />
      </div>
    );
  }

  // ──────────────── Render: lobby ────────────────
  if (modo === "lobby") {
    if (loadingSala || !salaAtual) {
      return (
        <div className="space-y-4">
          <Skeleton className="h-10 w-1/3" />
          <Skeleton className="h-64 w-full" />
        </div>
      );
    }
    return (
      <div className="space-y-6">
        <PageHeader
          title="Lobby — Pré-consulta"
          description="Teste câmera, microfone e conexão antes de entrar."
          actions={
            <Button variant="outline" onClick={voltarLista}>
              Voltar
            </Button>
          }
        />
        <TelemedicineLobby
          sala={salaAtual}
          participante={participante as { userId: string; nome: string; role: "MEDICO" | "PACIENTE" }}
          onEntrar={onEntrarLobby}
          onCancelar={voltarLista}
        />
      </div>
    );
  }

  // ──────────────── Render: sala ────────────────
  if (modo === "sala" && salaAtual) {
    return (
      <div className="space-y-4">
        <TelemedicineRoom
          sala={salaAtual}
          meetingUrl={meetingCtx.url}
          meetingToken={meetingCtx.token}
          participante={participante as { userId: string; nome: string; role: "MEDICO" | "PACIENTE" | "OBSERVADOR" | "INTERPRETE" }}
          onFinalizar={onFinalizarSala}
          onSair={voltarLista}
        />
      </div>
    );
  }

  return null;
}
