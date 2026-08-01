import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.3";
import { corsDenied, corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const ORTHANC_URL = Deno.env.get("ORTHANC_URL") ?? "";
const ORTHANC_USER = Deno.env.get("ORTHANC_USER") ?? "";
const ORTHANC_PASSWORD = Deno.env.get("ORTHANC_PASSWORD") ?? "";

type BridgeBody = {
  action?: "echo" | "store-study" | "query-studies";
  equipmentId?: number;
  examId?: number;
  patientId?: string;
};

function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function orthancConfiguration(): { baseUrl: string; authorization: string } | null {
  if (!ORTHANC_URL || !ORTHANC_USER || !ORTHANC_PASSWORD) return null;
  let parsed: URL;
  try {
    parsed = new URL(ORTHANC_URL);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    return null;
  }
  return {
    baseUrl: parsed.toString().replace(/\/$/, ""),
    authorization: `Basic ${btoa(`${ORTHANC_USER}:${ORTHANC_PASSWORD}`)}`,
  };
}

async function orthancFetch(
  configuration: { baseUrl: string; authorization: string },
  path: string,
  init: RequestInit,
  timeoutMs: number,
) {
  const response = await fetch(`${configuration.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: configuration.authorization,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    console.error("[dicom-bridge] Orthanc request failed", {
      path,
      status: response.status,
    });
    throw new Error("O servidor PACS rejeitou a operação");
  }
  return response;
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req);
  if (!cors) return corsDenied();
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Método não permitido" }, 405, cors);

  const authorization = req.headers.get("Authorization") ?? "";
  const accessToken = authorization.replace(/^Bearer\s+/i, "");
  if (!accessToken) return json({ ok: false, error: "Não autorizado" }, 401, cors);

  const configuration = orthancConfiguration();
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !configuration) {
    return json({ ok: false, error: "Bridge DICOM não configurada" }, 503, cors);
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(accessToken);
  if (userError || !userData.user) {
    return json({ ok: false, error: "Não autorizado" }, 401, cors);
  }

  let body: BridgeBody;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "JSON inválido" }, 400, cors);
  }

  try {
    const permission = body.action === "store-study" ? "edit" : "view";
    const { data: authorized, error: permissionError } = await userClient.rpc("can_access", {
      p_module: "dicom",
      p_action: permission,
    });
    if (permissionError || authorized !== true) {
      return json({ ok: false, error: "Operação DICOM não autorizada" }, 403, cors);
    }

    if (body.action === "echo") {
      const equipmentId = Number(body.equipmentId);
      if (!Number.isSafeInteger(equipmentId) || equipmentId <= 0) {
        return json({ ok: false, error: "Equipamento inválido" }, 400, cors);
      }
      const { data: equipment, error } = await userClient
        .from("dicom_equipment")
        .select("id, ds_aetitle, ds_ip, ds_orthanc_alias, lg_active")
        .eq("id", equipmentId)
        .eq("lg_active", true)
        .maybeSingle();
      if (error || !equipment?.ds_aetitle || !equipment.ds_ip) {
        return json({ ok: false, error: "Equipamento não encontrado no contexto ativo" }, 404, cors);
      }
      if (!equipment.ds_orthanc_alias) {
        return json({ ok: false, error: "Alias Orthanc do equipamento não configurado" }, 409, cors);
      }
      const startedAt = performance.now();
      await orthancFetch(
        configuration,
        `/modalities/${encodeURIComponent(equipment.ds_orthanc_alias)}/echo`,
        { method: "POST" },
        5_000,
      );
      const latencyMs = Math.round(performance.now() - startedAt);
      return json({
        ok: true,
        result: { ok: true, latencyMs, message: `Echo OK em ${latencyMs}ms` },
      }, 200, cors);
    }

    if (body.action === "store-study") {
      return json({
        ok: false,
        error: "C-STORE indisponível até homologação do contrato PACS",
      }, 501, cors);
    }

    if (body.action === "query-studies") {
      const patientId = String(body.patientId ?? "").trim();
      if (!patientId || patientId.length > 128) {
        return json({ ok: false, error: "Paciente inválido" }, 400, cors);
      }
      const { data: patient, error } = await userClient
        .from("dicom_exams")
        .select("ds_id_patient")
        .eq("cd_patient", patientId)
        .not("ds_id_patient", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error || !patient?.ds_id_patient) {
        return json({
          ok: false,
          error: "Paciente sem identificador DICOM homologado no contexto ativo",
        }, 409, cors);
      }
      const response = await orthancFetch(
        configuration,
        "/tools/find",
        {
          method: "POST",
          body: JSON.stringify({
            Level: "Study",
            Query: { PatientID: patient.ds_id_patient },
            Expand: true,
            Limit: 100,
          }),
        },
        10_000,
      );
      const studies = await response.json() as Array<{
        MainDicomTags?: Record<string, string>;
      }>;
      return json({
        ok: true,
        result: studies.map(({ MainDicomTags: tags = {} }) => ({
          studyInstanceUID: tags.StudyInstanceUID ?? "",
          studyDate: tags.StudyDate ?? "",
          studyTime: tags.StudyTime ?? "",
          modality: tags.ModalitiesInStudy ?? tags.Modality ?? "",
          accessionNumber: tags.AccessionNumber ?? "",
        })),
      }, 200, cors);
    }

    return json({ ok: false, error: "Ação não suportada" }, 400, cors);
  } catch (error) {
    console.error("[dicom-bridge] operation failed", {
      action: body.action,
      message: error instanceof Error ? error.message : "unknown",
    });
    return json({ ok: false, error: "Não foi possível concluir a operação DICOM" }, 502, cors);
  }
});
