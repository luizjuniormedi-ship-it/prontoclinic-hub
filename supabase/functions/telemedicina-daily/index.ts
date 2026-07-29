import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.3";
import { corsDenied, corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const DAILY_API_KEY = Deno.env.get("DAILY_API_KEY") ?? "";
const DAILY_API_BASE = (Deno.env.get("DAILY_API_BASE_URL") ?? "https://api.daily.co/v1").replace(/\/$/, "");

type ParticipantRole = "MEDICO" | "PACIENTE" | "OBSERVADOR" | "INTERPRETE";

type RequestBody =
  | { action: "create-room"; appointmentId: number }
  | {
      action: "join-room";
      accessToken: string;
      participant: { nome: string; role: ParticipantRole };
      userAgent?: string | null;
    }
  | { action: "delete-room"; salaId: string };

interface DailyRoomResponse {
  name: string;
  url: string;
}

interface DailyTokenResponse {
  token: string;
}

function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Falha inesperada";
}

async function dailyRequest<T>(
  path: string,
  method: "GET" | "POST" | "DELETE",
  body?: unknown,
): Promise<T> {
  if (!DAILY_API_KEY) throw new Error("Provedor de telemedicina não configurado");

  const response = await fetch(`${DAILY_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${DAILY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    console.error("[telemedicina-daily] provider error", response.status);
    throw new Error(`Provedor de telemedicina indisponível (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

async function findDailyRoom(name: string): Promise<DailyRoomResponse | null> {
  if (!DAILY_API_KEY) throw new Error("Provedor de telemedicina não configurado");
  const response = await fetch(`${DAILY_API_BASE}/rooms/${encodeURIComponent(name)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${DAILY_API_KEY}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Provedor de telemedicina indisponível (${response.status})`);
  return await response.json() as DailyRoomResponse;
}

async function deleteDailyRoom(name: string): Promise<void> {
  if (!DAILY_API_KEY) throw new Error("Provedor de telemedicina não configurado");
  const response = await fetch(`${DAILY_API_BASE}/rooms/${encodeURIComponent(name)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${DAILY_API_KEY}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404 || response.status === 204 || response.ok) return;
  throw new Error(`Provedor de telemedicina indisponível (${response.status})`);
}

function userClient(authorization: string) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function authenticate(authorization: string) {
  const client = userClient(authorization);
  const token = authorization.replace(/^Bearer\s+/i, "");
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new Error("JWT de usuário válido obrigatório");
  return { client, user: data.user };
}

async function createRoom(client: ReturnType<typeof userClient>, appointmentId: number) {
  if (!Number.isSafeInteger(appointmentId) || appointmentId <= 0) {
    return json({ error: "Agendamento inválido" }, 400);
  }
  const { data: authorized, error: permissionError } = await client.rpc("can_access", {
    p_module: "telemedicina",
    p_action: "create",
  });
  if (permissionError || authorized !== true) {
    return json({ error: "Criação de sala não autorizada" }, 403);
  }

  const { data: salaId, error: rpcError } = await client.rpc("criar_sala_telemedicina", {
    p_appointment_id: appointmentId,
  });
  if (rpcError || !salaId) throw new Error(rpcError?.message ?? "Sala local não criada");

  const { data: sala, error: selectError } = await client
    .from("telemedicina_salas")
    .select("*")
    .eq("id", salaId)
    .single();
  if (selectError || !sala?.ds_sala_daily) {
    throw new Error(selectError?.message ?? "Sala local inválida");
  }

  let remoteCreated = false;
  try {
    const existingRoom = await findDailyRoom(sala.ds_sala_daily);
    const room = existingRoom ?? await dailyRequest<DailyRoomResponse>("/rooms", "POST", {
        name: sala.ds_sala_daily,
        privacy: "private",
        properties: {
          exp: Math.floor(Date.now() / 1000) + 60 * 60 * 8,
          enable_chat: true,
          enable_screenshare: true,
          enable_recording: false,
          eject_at_room_exp: true,
          start_video_off: false,
          start_audio_off: false,
        },
      });
    remoteCreated = existingRoom === null;
    if (!room.url || room.name !== sala.ds_sala_daily) {
      throw new Error("Resposta inválida do provedor de telemedicina");
    }

    const { data: updated, error: updateError } = await client
      .from("telemedicina_salas")
      .update({ ds_url_daily: room.url })
      .eq("id", sala.id)
      .select("*")
      .single();
    if (updateError || !updated) {
      throw new Error(updateError?.message ?? "Sala remota não persistida");
    }
    return json({ sala: updated });
  } catch (error) {
    if (remoteCreated) {
      await deleteDailyRoom(sala.ds_sala_daily)
        .catch((cleanupError) => console.error("[telemedicina-daily] cleanup failed", cleanupError));
    }
    await admin
      .from("telemedicina_salas")
      .update({ tp_status: "FALHOU", ds_url_daily: null })
      .eq("id", sala.id);
    throw error;
  }
}

async function joinRoom(
  client: ReturnType<typeof userClient>,
  user: { id: string },
  body: Extract<RequestBody, { action: "join-room" }>,
) {
  const requestedRole = body.participant?.role;
  if (!body.accessToken || !requestedRole) {
    return json({ error: "Participante inválido" }, 400);
  }

  const { data: sala, error: salaError } = await client
    .from("telemedicina_salas")
    .select("*")
    .eq("ds_token_acesso", body.accessToken)
    .single();
  if (salaError || !sala) return json({ error: "Token inválido ou sala não encontrada" }, 404);
  if (!sala.ds_sala_daily || !sala.ds_url_daily) {
    return json({ error: "Sala remota não provisionada" }, 409);
  }
  if (["FINALIZADA", "CANCELADA", "FALHOU"].includes(sala.tp_status)) {
    return json({ error: `Sala ${String(sala.tp_status).toLowerCase()}` }, 409);
  }

  const { data: professional } = await admin
    .from("professionals")
    .select("id, full_name")
    .eq("id", sala.cd_medico)
    .eq("user_id", user.id)
    .maybeSingle();
  const { data: patient } = await admin
    .from("patients")
    .select("id, full_name")
    .eq("id", sala.cd_paciente)
    .eq("user_id", user.id)
    .maybeSingle();
  const role: ParticipantRole | null = professional
    ? "MEDICO"
    : patient
      ? "PACIENTE"
      : null;
  if (!role || role !== requestedRole) {
    return json({ error: "Participante não autorizado para esta sala" }, 403);
  }
  const nome = (professional?.full_name ?? patient?.full_name ?? "").trim();
  if (!nome) return json({ error: "Participante sem nome cadastrado" }, 409);
  const isOwner = role === "MEDICO";

  const token = await dailyRequest<DailyTokenResponse>("/meeting-tokens", "POST", {
    properties: {
      room_name: sala.ds_sala_daily,
      user_name: nome,
      user_id: user.id,
      is_owner: isOwner,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 2,
    },
  });
  if (!token.token) throw new Error("Token remoto não emitido");

  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await client
    .from("telemedicina_salas")
    .update({
      tp_status: "EM_ANDAMENTO",
      ...(sala.dt_inicio ? {} : { dt_inicio: now }),
    })
    .eq("id", sala.id)
    .select("*")
    .single();
  if (updateError || !updated) throw new Error(updateError?.message ?? "Sala não iniciada");

  const { error: participantError } = await client
    .from("telemedicina_participantes")
    .insert({
      cd_sala: sala.id,
      cd_usuario: user.id,
      tp_participante: role,
      nm_nome: nome,
      ip_origem: null,
      user_agent: body.userAgent?.slice(0, 500) ?? null,
    });
  if (participantError) throw new Error(participantError.message);

  return json({
    sala: updated,
    meetingToken: token.token,
    meetingUrl: sala.ds_url_daily,
  });
}

async function deleteRoom(client: ReturnType<typeof userClient>, salaId: string) {
  const { data: authorized, error: permissionError } = await client.rpc("can_access", {
    p_module: "telemedicina",
    p_action: "delete",
  });
  if (permissionError || authorized !== true) {
    return json({ error: "Exclusão de sala não autorizada" }, 403);
  }
  const { data: sala, error } = await client
    .from("telemedicina_salas")
    .select("id, ds_sala_daily")
    .eq("id", salaId)
    .single();
  if (error || !sala) return json({ error: "Sala não encontrada" }, 404);
  if (sala.ds_sala_daily) {
    await deleteDailyRoom(sala.ds_sala_daily);
  }
  const { error: updateError } = await client
    .from("telemedicina_salas")
    .update({ tp_status: "CANCELADA", dt_fim: new Date().toISOString() })
    .eq("id", sala.id);
  if (updateError) {
    const { error: reconcileError } = await admin
      .from("telemedicina_salas")
      .update({ tp_status: "CANCELADA", dt_fim: new Date().toISOString() })
      .eq("id", sala.id);
    if (reconcileError) throw new Error("Sala remota excluída; estado local requer reconciliação");
  }
  return json({ deleted: true });
}

Deno.serve(async (request: Request) => {
  const cors = corsHeaders(request);
  if (!cors) return corsDenied();
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);

  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization) return json({ error: "Autenticação obrigatória" }, 401, cors);

  try {
    const { client, user } = await authenticate(authorization);
    const body = await request.json() as RequestBody;
    switch (body.action) {
      case "create-room":
        return withCors(await createRoom(client, body.appointmentId), cors);
      case "join-room":
        return withCors(await joinRoom(client, user, body), cors);
      case "delete-room":
        return withCors(await deleteRoom(client, body.salaId), cors);
      default:
        return json({ error: "Ação inválida" }, 400, cors);
    }
  } catch (error) {
    console.error("[telemedicina-daily]", error);
    const message = errorMessage(error);
    return json({ error: message }, message.includes("JWT") ? 401 : 502, cors);
  }
});

function withCors(response: Response, headers: HeadersInit): Response {
  const merged = new Headers(response.headers);
  new Headers(headers).forEach((value, key) => merged.set(key, value));
  return new Response(response.body, { status: response.status, headers: merged });
}
