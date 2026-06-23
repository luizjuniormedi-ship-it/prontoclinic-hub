// supabase/functions/daily-webhook/index.ts
//
// Edge function que recebe webhooks do Daily.co.
// Eventos tratados:
//   - meeting.ended              → finalizar sala e calcular duração
//   - recording.started/completed → atualizar URL de gravação
//   - participant.joined/left    → log de participantes
//
// Configurar URL no dashboard Daily.co:
//   https://<project-ref>.functions.supabase.co/daily-webhook
//   Header: Authorization: Bearer ${DAILY_WEBHOOK_SECRET}
//
// Variáveis necessárias no Supabase:
//   - DAILY_WEBHOOK_SECRET
//   - SUPABASE_URL
//   - SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DAILY_WEBHOOK_SECRET = Deno.env.get("DAILY_WEBHOOK_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-daily-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface DailyWebhookPayload {
  event: string;
  payload: {
    room?: { name?: string; id?: string };
    meeting?: {
      id?: string;
      started_at?: string;
      ended_at?: string;
      duration?: number;
    };
    recording?: { id?: string; url?: string; start_ts?: number; end_ts?: number };
    participants?: Array<{ session_id: string; user_id?: string; user_name?: string; joined_at?: string; left_at?: string }>;
  };
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

async function verifySignature(req: Request, body: string): Promise<boolean> {
  // Daily.co envia o header x-daily-signature em formato
  // "t=<timestamp>,v1=<hmac-sha256>"
  const sigHeader = req.headers.get("x-daily-signature");
  if (!sigHeader || !DAILY_WEBHOOK_SECRET) return false;
  const parts = Object.fromEntries(sigHeader.split(",").map((p) => p.split("=")));
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return false;

  const signedPayload = `${t}.${body}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(DAILY_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  const expected = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return expected === v1;
}

async function findSalaByRoomName(roomName: string) {
  const { data, error } = await supabase
    .from("telemedicina_salas")
    .select("id, dt_inicio, duracao_segundos")
    .eq("ds_sala_daily", roomName)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function handleMeetingEnded(p: DailyWebhookPayload) {
  const roomName = p.payload.room?.name;
  if (!roomName) return;
  const sala = await findSalaByRoomName(roomName);
  if (!sala) return;

  // Calcula duração a partir de dt_inicio
  let duracao = p.payload.meeting?.duration ?? 0;
  if (!duracao && sala.dt_inicio) {
    duracao = Math.floor((Date.now() - new Date(sala.dt_inicio).getTime()) / 1000);
  }

  const { error } = await supabase.rpc("finalizar_sala_telemedicina", {
    p_sala_id: sala.id,
    p_duracao_segundos: duracao,
    p_bitrate_medio: null,
    p_latencia_media: null,
    p_packet_loss: null,
  });
  if (error) throw error;
}

async function handleRecordingCompleted(p: DailyWebhookPayload) {
  const roomName = p.payload.room?.name;
  const recUrl = p.payload.recording?.url;
  if (!roomName || !recUrl) return;
  const sala = await findSalaByRoomName(roomName);
  if (!sala) return;
  await supabase
    .from("telemedicina_salas")
    .update({ ds_url_gravacao: recUrl })
    .eq("id", sala.id);
}

async function handleParticipants(p: DailyWebhookPayload) {
  const roomName = p.payload.room?.name;
  if (!roomName || !p.payload.participants?.length) return;
  const sala = await findSalaByRoomName(roomName);
  if (!sala) return;

  for (const part of p.payload.participants) {
    if (!part.user_id) continue;
    await supabase.from("telemedicina_participantes").insert({
      cd_sala: sala.id,
      cd_usuario: part.user_id,
      tp_participante: "OBSERVADOR",
      nm_nome: part.user_name ?? "Convidado",
      dt_entrada: part.joined_at ?? new Date().toISOString(),
      dt_saida: part.left_at ?? null,
    });
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const body = await req.text();

  // Verifica assinatura (recomendado em produção)
  if (DAILY_WEBHOOK_SECRET) {
    const ok = await verifySignature(req, body);
    if (!ok) return jsonResponse({ error: "Invalid signature" }, 401);
  }

  let payload: DailyWebhookPayload;
  try {
    payload = JSON.parse(body) as DailyWebhookPayload;
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  try {
    switch (payload.event) {
      case "meeting.ended":
        await handleMeetingEnded(payload);
        break;
      case "recording.started":
      case "recording.completed":
        await handleRecordingCompleted(payload);
        break;
      case "participant.joined":
      case "participant.left":
        await handleParticipants(payload);
        break;
      default:
        // evento não tratado — ignorar
        break;
    }
    return jsonResponse({ received: true, event: payload.event });
  } catch (err) {
    console.error("[daily-webhook] erro:", err);
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
