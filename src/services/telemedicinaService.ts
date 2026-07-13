/**
 * telemedicinaService — Módulo de Telemedicina (ProntoClinic Hub)
 *
 * Conformidade:
 *   - Resolução CFM 2.299/2021 (telemedicina no Brasil)
 *   - LGPD art. 7º II (consentimento para gravação) e art. 18 (direitos do titular)
 *   - Lei 14.063/2020 (assinatura eletrônica)
 *
 * Integração: Daily.co (https://docs.daily.co/reference/rest-api)
 * Env vars: VITE_DAILY_API_KEY, VITE_DAILY_DOMAIN, VITE_DAILY_WEBHOOK_SECRET
 *
 * Migration relacionada: 20260101000017_telemedicina.sql
 *
 * IMPORTANTE: nenhum segredo/credencial é embarcado no bundle do cliente.
 * Em produção, a chave de API Daily.co deve ser intermediada por uma
 * Supabase Edge Function (ver supabase/functions/daily-webhook/index.ts).
 * Para DEV, este service pode chamar a API REST diretamente se
 * VITE_DAILY_API_KEY estiver definida no .env.
 */

import { supabase } from "@/lib/supabase";
import { env } from "@/lib/env";

// ── Types ──────────────────────────────────────────────────────────

export type TelemedStatus =
  | "AGUARDANDO"
  | "EM_ANDAMENTO"
  | "FINALIZADA"
  | "CANCELADA"
  | "FALHOU";

export type TipoParticipante = "MEDICO" | "PACIENTE" | "OBSERVADOR" | "INTERPRETE";

export type TipoMensagem = "TEXTO" | "SISTEMA" | "ARQUIVO" | "PRESCRICAO";

export type TipoReceita = "BRANCA" | "AZUL" | "AMARELA" | "VERMELHA" | "CONTROLE_ESPECIAL";

export interface TelemedSala {
  id: string;
  company_id: string;
  cd_appointment?: number | null;
  cd_paciente: number;
  cd_medico: number;
  ds_token_acesso: string;
  dt_criacao: string;
  dt_inicio?: string | null;
  dt_fim?: string | null;
  ds_url_daily?: string | null;
  ds_sala_daily?: string | null;
  duracao_segundos?: number | null;
  tp_status: TelemedStatus;
  lg_gravacao_habilitada: boolean;
  ds_url_gravacao?: string | null;
  lg_consentimento_gravacao: boolean;
  dt_consentimento?: string | null;
  vl_bitrate_medio?: number | null;
  vl_latencia_media?: number | null;
  vl_packet_loss?: number | null;
  created_at?: string;
}

export interface TelemedParticipante {
  id: number;
  cd_sala: string;
  cd_usuario?: string | null;
  tp_participante: TipoParticipante;
  nm_nome?: string | null;
  dt_entrada: string;
  dt_saida?: string | null;
  ip_origem?: string | null;
  user_agent?: string | null;
  lg_microfone_ativo?: boolean | null;
  lg_camera_ativa?: boolean | null;
  lg_tela_compartilhada?: boolean | null;
}

export interface TelemedMensagem {
  id: number;
  cd_sala: string;
  cd_usuario?: string | null;
  nm_remetente?: string | null;
  ds_mensagem: string;
  tp_mensagem: TipoMensagem;
  cd_anexo_url?: string | null;
  dt_envio: string;
}

export interface TelemedPrescricao {
  id: number;
  cd_sala: string;
  cd_paciente: number;
  cd_medico: number;
  ds_receita: string;
  ds_observacoes?: string | null;
  dt_emissao: string;
  lg_assinada: boolean;
  cd_origem_sigh?: number | null;
}

export interface TelemedReceita {
  id: string;
  cd_prescricao_id: number;
  cd_paciente: number;
  cd_medico: number;
  ds_receita_url?: string | null;
  cd_hash_assinatura?: string | null;
  dt_assinatura: string;
  cd_certificado_digital?: string | null;
  tp_receita?: TipoReceita | null;
  dt_validade?: string | null;
  lg_dispensada: boolean;
  dt_dispensacao?: string | null;
  cd_farmacia_id?: number | null;
}

export interface ParticipanteInfo {
  userId: string;
  nome: string;
  role: TipoParticipante;
}

export interface QualityMetrics {
  bitrateMedio?: number;     // kbps
  latenciaMedia?: number;    // ms
  packetLoss?: number;       // %
}

export interface RelatorioTelemedicina {
  totalConsultas: number;
  duracaoMedia: number;                          // segundos
  qualidadeMedia: { latencia: number; packetLoss: number };
  taxaConclusao: number;                         // 0..1
}

export interface EntrarSalaResult {
  sala: TelemedSala;
  meetingToken: string;
  meetingUrl: string;
}

// ── Daily.co API helpers ──────────────────────────────────────────

const DAILY_API_BASE = "https://api.daily.co/v1";

interface DailyRoomConfig {
  name: string;
  privacy?: "public" | "private";
  properties?: {
    exp?: number;                       // epoch seconds
    enable_chat?: boolean;
    enable_screenshare?: boolean;
    enable_recording?: "cloud" | "local" | "raw-tracks";
    start_video_off?: boolean;
    start_audio_off?: boolean;
    eject_at_room_exp?: boolean;
    eject_after_elapsed?: number;       // segundos
  };
}

interface DailyRoomResponse {
  id: string;
  name: string;
  url: string;
  privacy: string;
  config?: { exp?: number; [k: string]: unknown };
}

interface DailyMeetingTokenResponse {
  token: string;
}

/**
 * Chama a API REST do Daily.co.
 * Em produção, isto deve ser roteado por uma Edge Function para não
 * expor a chave de API no bundle. Aqui o guard "VITE_DAILY_API_KEY"
 * garante que falhamos de forma explícita quando a chave não está
 * configurada — nunca embarcamos credenciais.
 */
async function dailyRequest<T>(
  path: string,
  method: "GET" | "POST" | "DELETE" = "GET",
  body?: unknown,
): Promise<T> {
  if (!env.VITE_DAILY_API_KEY) {
    throw new Error(
      "VITE_DAILY_API_KEY não configurada. Em produção, exponha a chave apenas via Supabase Edge Function.",
    );
  }
  const res = await fetch(`${DAILY_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.VITE_DAILY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Daily.co API error ${res.status}: ${text || res.statusText}`);
  }
  return (await res.json()) as T;
}

async function createDailyRoom(config: DailyRoomConfig): Promise<DailyRoomResponse> {
  return dailyRequest<DailyRoomResponse>("/rooms", "POST", config);
}

async function deleteDailyRoom(name: string): Promise<void> {
  await dailyRequest(`/rooms/${encodeURIComponent(name)}`, "DELETE");
}

async function createMeetingToken(
  roomName: string,
  opts: { userName: string; isOwner: boolean; expSecs?: number },
): Promise<string> {
  const res = await dailyRequest<DailyMeetingTokenResponse>(
    "/meeting-tokens",
    "POST",
    {
      properties: {
        room_name: roomName,
        user_name: opts.userName,
        is_owner: opts.isOwner,
        exp: opts.expSecs
          ? Math.floor(Date.now() / 1000) + opts.expSecs
          : Math.floor(Date.now() / 1000) + 60 * 60 * 2, // 2h default
      },
    },
  );
  return res.token;
}

function buildMeetingUrl(domain: string, roomName: string): string {
  // Domain pode ser "exemplo.daily.co/exemplo" ou apenas "exemplo"
  // Quando o domain é um subdomínio curinga, basta juntar com /<room>
  if (!domain) {
    throw new Error("VITE_DAILY_DOMAIN não configurado");
  }
  const cleanDomain = domain.replace(/\/+$/, "");
  return `https://${cleanDomain}.daily.co/${encodeURIComponent(roomName)}`;
}

// ── Service ────────────────────────────────────────────────────────

class TelemedicinaService {
  // 2.1. Criar sala a partir de um agendamento
  async criarSala(appointmentId: number): Promise<TelemedSala> {
    // 1. RPC cria a linha no banco (gera token, ds_sala_daily)
    const { data: salaId, error: rpcErr } = await supabase.rpc(
      "criar_sala_telemedicina",
      { p_appointment_id: appointmentId },
    );
    if (rpcErr) throw new Error(rpcErr.message);

    // 2. Buscar a sala recém-criada
    const { data: sala, error: selErr } = await supabase
      .from("telemedicina_salas")
      .select("*")
      .eq("id", salaId)
      .single();
    if (selErr || !sala) throw new Error(selErr?.message ?? "Sala não encontrada");

    const markRoomAsFailed = async () => {
      await supabase
        .from("telemedicina_salas")
        .update({ tp_status: "FALHOU" })
        .eq("id", sala.id);
    };

    // 3. A consulta só pode ser liberada quando a sala remota existir.
    let meetingUrl: string | null = null;
    if (env.VITE_DAILY_API_KEY && env.VITE_DAILY_DOMAIN && sala.ds_sala_daily) {
      try {
        const dailyRoom = await createDailyRoom({
          name: sala.ds_sala_daily,
          privacy: "private",
          properties: {
            exp: Math.floor(Date.now() / 1000) + 60 * 60 * 8, // 8h
            enable_chat: true,
            enable_screenshare: true,
            enable_recording: "cloud",
            eject_at_room_exp: true,
            start_video_off: false,
            start_audio_off: false,
          },
        });
        meetingUrl = dailyRoom.url;
        const { data: upd, error: updErr } = await supabase
          .from("telemedicina_salas")
          .update({ ds_url_daily: meetingUrl })
          .eq("id", sala.id)
          .select("*")
          .single();
        if (updErr) throw new Error(updErr.message);
        return upd as TelemedSala;
      } catch (err) {
        console.warn("[telemedicina] Daily.co room create falhou:", err);
        await markRoomAsFailed();
        throw new Error("Não foi possível criar a sala de telemedicina no provedor");
      }
    }

    await markRoomAsFailed();
    throw new Error(
      "Telemedicina indisponível: integração Daily.co não está configurada",
    );
  }

  // 2.2. Entrar na sala com token de acesso
  async entrarSala(
    token: string,
    participante: ParticipanteInfo,
  ): Promise<EntrarSalaResult> {
    // 1. Validar token
    const { data: sala, error } = await supabase
      .from("telemedicina_salas")
      .select("*")
      .eq("ds_token_acesso", token)
      .single();
    if (error || !sala) throw new Error("Token inválido ou sala não encontrada");
    if (sala.tp_status === "FINALIZADA" || sala.tp_status === "CANCELADA") {
      throw new Error(`Sala ${sala.tp_status.toLowerCase()}`);
    }

    // 2. Marcar EM_ANDAMENTO se for a primeira entrada
    if (sala.tp_status === "AGUARDANDO") {
      await supabase
        .from("telemedicina_salas")
        .update({ tp_status: "EM_ANDAMENTO", dt_inicio: new Date().toISOString() })
        .eq("id", sala.id);
    }

    // 3. Logar participação
    await supabase.from("telemedicina_participantes").insert({
      cd_sala: sala.id,
      cd_usuario: participante.userId,
      tp_participante: participante.role,
      nm_nome: participante.nome,
      ip_origem: null,         // preenchido no backend em produção
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    });

    // 4. Gerar meeting token no Daily.co
    let meetingToken = "";
    if (env.VITE_DAILY_API_KEY && sala.ds_sala_daily) {
      meetingToken = await createMeetingToken(sala.ds_sala_daily, {
        userName: participante.nome,
        isOwner: participante.role === "MEDICO",
        expSecs: 60 * 60 * 2,
      });
    }

    const meetingUrl =
      sala.ds_url_daily ||
      (env.VITE_DAILY_DOMAIN && sala.ds_sala_daily
        ? buildMeetingUrl(env.VITE_DAILY_DOMAIN, sala.ds_sala_daily)
        : "");

    return {
      sala: { ...(sala as TelemedSala), tp_status: "EM_ANDAMENTO" },
      meetingToken,
      meetingUrl,
    };
  }

  // 2.3. Iniciar consulta (atribui dt_inicio se ainda não estiver)
  async iniciar(salaId: string, _userId: string): Promise<void> {
    const { error } = await supabase
      .from("telemedicina_salas")
      .update({ dt_inicio: new Date().toISOString(), tp_status: "EM_ANDAMENTO" })
      .eq("id", salaId)
      .is("dt_inicio", null);
    if (error) throw new Error(error.message);
  }

  // 2.4. Finalizar consulta + métricas
  async finalizar(
    salaId: string,
    _userId: string,
    dados: { duracaoSegundos: number; qualidade?: QualityMetrics },
  ): Promise<void> {
    const { error } = await supabase.rpc("finalizar_sala_telemedicina", {
      p_sala_id: salaId,
      p_duracao_segundos: dados.duracaoSegundos,
      p_bitrate_medio: dados.qualidade?.bitrateMedio ?? null,
      p_latencia_media: dados.qualidade?.latenciaMedia ?? null,
      p_packet_loss: dados.qualidade?.packetLoss ?? null,
    });
    if (error) throw new Error(error.message);
  }

  async cancelar(salaId: string, _userId: string, motivo?: string): Promise<void> {
    const { error } = await supabase
      .from("telemedicina_salas")
      .update({
        tp_status: "CANCELADA",
        dt_fim: new Date().toISOString(),
        ds_url_gravacao: motivo ? null : undefined,
      })
      .eq("id", salaId);
    if (error) throw new Error(error.message);
  }

  // 2.5. Chat
  async enviarMensagem(
    salaId: string,
    mensagem: string,
    userId: string,
    remetente: string,
  ): Promise<TelemedMensagem> {
    const { data, error } = await supabase
      .from("telemedicina_mensagens")
      .insert({
        cd_sala: salaId,
        cd_usuario: userId,
        nm_remetente: remetente,
        ds_mensagem: mensagem,
        tp_mensagem: "TEXTO",
      })
      .select("*")
      .single();
    if (error || !data) throw new Error(error?.message ?? "Falha ao enviar mensagem");
    return data as TelemedMensagem;
  }

  async listarMensagens(salaId: string, limit = 200): Promise<TelemedMensagem[]> {
    const { data, error } = await supabase
      .from("telemedicina_mensagens")
      .select("*")
      .eq("cd_sala", salaId)
      .order("dt_envio", { ascending: true })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []) as TelemedMensagem[];
  }

  // 2.6. Prescrição / Receita digital
  async criarPrescricao(
    salaId: string,
    conteudo: string,
    paciente: number,
    medico: number,
    observacoes?: string,
  ): Promise<number> {
    const { data, error } = await supabase
      .from("telemedicina_prescricoes")
      .insert({
        cd_sala: salaId,
        cd_paciente: paciente,
        cd_medico: medico,
        ds_receita: conteudo,
        ds_observacoes: observacoes,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message ?? "Falha ao criar prescrição");
    return data.id as number;
  }

  async assinarPrescricao(
    prescricaoId: number,
    hashAssinatura: string,
    certificado: string,
    tipoReceita: TipoReceita = "BRANCA",
    validadeEmDias = 30,
  ): Promise<{ receitaId: string; urlPdf: string }> {
    // 1. Buscar prescrição
    const { data: presc, error: selErr } = await supabase
      .from("telemedicina_prescricoes")
      .select("*")
      .eq("id", prescricaoId)
      .single();
    if (selErr || !presc) throw new Error(selErr?.message ?? "Prescrição não encontrada");

    // A assinatura só pode ser confirmada depois de gerar e armazenar o PDF
    // assinado. Este serviço ainda não possui pipeline real de PDF/Storage;
    // falhar fechado evita marcar a prescrição como assinada com uma URL
    // inexistente ou registrar uma receita que não pode ser baixada.
    void hashAssinatura;
    void certificado;
    void tipoReceita;
    void validadeEmDias;
    throw new Error(
      "Assinatura digital indisponível: armazenamento real do PDF ainda não está configurado",
    );
  }

  // 2.7. Gravação (com consentimento LGPD)
  async habilitarGravacao(
    salaId: string,
    consentimento: boolean,
  ): Promise<{ urlGravacao?: string; habilitada: boolean }> {
    if (!consentimento) {
      // LGPD: revogação → desabilitar imediatamente
      await this.registrarConsentimento(salaId, false);
      return { habilitada: false };
    }

    // O consentimento não pode ser apresentado como gravação ativa. A chamada
    // Daily.co /recordings/start e o callback que persistirá a URL ainda não
    // estão implementados; falhar antes do RPC evita registrar consentimento
    // como se a gravação tivesse iniciado.
    throw new Error(
      "Gravação indisponível: integração real de gravação ainda não está configurada",
    );
  }

  async registrarConsentimento(salaId: string, consentimento: boolean): Promise<void> {
    const { error } = await supabase.rpc("registrar_consentimento_gravacao", {
      p_sala_id: salaId,
      p_consentimento: consentimento,
    });
    if (error) throw new Error(error.message);
  }

  async getSala(salaId: string): Promise<TelemedSala> {
    const { data, error } = await supabase
      .from("telemedicina_salas")
      .select("*")
      .eq("id", salaId)
      .single();
    if (error || !data) throw new Error(error?.message ?? "Sala não encontrada");
    return data as TelemedSala;
  }

  async getSalaByToken(token: string): Promise<TelemedSala> {
    const { data, error } = await supabase
      .from("telemedicina_salas")
      .select("*")
      .eq("ds_token_acesso", token)
      .single();
    if (error || !data) throw new Error(error?.message ?? "Sala não encontrada");
    return data as TelemedSala;
  }

  // 2.8. Relatórios
  async getRelatorioTelemedicina(
    companyId: string,
    periodo: { inicio: string; fim: string },
  ): Promise<RelatorioTelemedicina> {
    const { data, error } = await supabase
      .from("telemedicina_salas")
      .select("tp_status, duracao_segundos, vl_latencia_media, vl_packet_loss")
      .eq("company_id", companyId)
      .gte("dt_criacao", periodo.inicio)
      .lte("dt_criacao", periodo.fim);

    if (error) throw new Error(error.message);
    const rows = data ?? [];
    const finalizadas = rows.filter((r) => r.tp_status === "FINALIZADA");
    const total = rows.length;
    const finalizadasCount = finalizadas.length;
    const somaDuracao = finalizadas.reduce(
      (acc, r) => acc + (r.duracao_segundos ?? 0),
      0,
    );
    const somaLatencia = finalizadas.reduce(
      (acc, r) => acc + (r.vl_latencia_media ?? 0),
      0,
    );
    const somaLoss = finalizadas.reduce(
      (acc, r) => acc + Number(r.vl_packet_loss ?? 0),
      0,
    );

    return {
      totalConsultas: total,
      duracaoMedia: finalizadasCount
        ? Math.round(somaDuracao / finalizadasCount)
        : 0,
      qualidadeMedia: {
        latencia: finalizadasCount ? Math.round(somaLatencia / finalizadasCount) : 0,
        packetLoss: finalizadasCount
          ? Number((somaLoss / finalizadasCount).toFixed(2))
          : 0,
      },
      taxaConclusao: total ? Number((finalizadasCount / total).toFixed(3)) : 0,
    };
  }

  // Helpers públicos
  isConfigured(): boolean {
    return Boolean(env.VITE_DAILY_API_KEY && env.VITE_DAILY_DOMAIN);
  }

  /**
   * Cleanup explícito: remove a sala no Daily.co (se ainda existir).
   * Use quando a consulta for cancelada antes de começar.
   */
  async cleanupDailyRoom(sala: TelemedSala): Promise<void> {
    if (!sala.ds_sala_daily) return;
    if (!env.VITE_DAILY_API_KEY) return;
    try {
      await deleteDailyRoom(sala.ds_sala_daily);
    } catch (err) {
      console.warn("[telemedicina] Falha ao deletar Daily room:", err);
    }
  }
}

export const telemedicinaService = new TelemedicinaService();
export default telemedicinaService;
