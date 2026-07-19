// Server-side DICOM gateway contract.
// It resolves a unit-scoped dicom_nodes row and reads the Orthanc URL/secret
// only from Edge Function environment variables. No Orthanc credential reaches
// the browser or is stored in the database.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function safeRef(ref: string): string {
  return ref.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
}

function allowedPath(path: string): boolean {
  // The gateway accepts only the DICOM/Orthanc resources used by the app.
  // Reject encoded or ambiguous traversal before the upstream URL is built.
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return false;
  }
  const hasControlCharacter = Array.from(decoded).some((character) => character.charCodeAt(0) < 32);
  if (decoded !== path || /\\|\.\.|:\/\/|\/\//.test(decoded) || hasControlCharacter) return false;
  return /^\/(modalities|dicom-web|wado|peers)(\/|\?|$)/.test(decoded);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "authentication_required" }, 401);

  const { data: auth, error: authError } = await supabase.auth.getUser(token);
  if (authError || !auth.user) return json({ error: "invalid_session" }, 401);
  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select("company_id, primary_unit_id, role_name")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (profileError || !profile?.company_id) return json({ error: "tenant_not_found" }, 403);

  const url = new URL(req.url);
  const path = url.searchParams.get("path") ?? "";
  const nodeId = url.searchParams.get("node_id");
  const unitId = url.searchParams.get("unit_id");
  const kind = url.searchParams.get("kind") === "worklist" ? "worklist" : "pacs";
  if (!allowedPath(path)) return json({ error: "dicom_path_not_allowed" }, 400);

  let query = supabase.from("dicom_nodes").select("*").eq("company_id", profile.company_id).eq("node_kind", kind).eq("is_active", true);
  if (nodeId) query = query.eq("id", nodeId);
  else if (unitId) query = query.or(`unit_id.eq.${unitId},unit_id.is.null`);
  else query = query.is("unit_id", null);
  const { data: nodes, error: nodeError } = await query.order("is_default", { ascending: false }).order("priority").limit(10);
  if (nodeError || !nodes?.length) return json({ error: "dicom_node_not_found" }, 404);
  const node = nodes.find((candidate) =>
    candidate.unit_id == null || candidate.unit_id === Number(profile.primary_unit_id) || ["admin", "administrador"].includes(String(profile.role_name).toLowerCase())
  );
  if (!node || !node.rest_endpoint_ref) return json({ error: "dicom_node_gateway_reference_missing" }, 409);
  if (node.unit_id != null && !["admin", "administrador"].includes(String(profile.role_name).toLowerCase()) && node.unit_id !== Number(profile.primary_unit_id)) {
    return json({ error: "dicom_unit_forbidden" }, 403);
  }

  const ref = safeRef(node.rest_endpoint_ref);
  const base = Deno.env.get(`DICOM_ORTHANC_${ref}_URL`);
  const username = Deno.env.get(`DICOM_ORTHANC_${ref}_USER`);
  const password = Deno.env.get(`DICOM_ORTHANC_${ref}_PASSWORD`);
  if (!base || !username || !password) return json({ error: "dicom_gateway_not_configured" }, 503);

  const target = `${base.replace(/\/$/, "")}${path}`;
  const headers = new Headers(req.headers);
  headers.delete("host");
  headers.set("Authorization", `Basic ${btoa(`${username}:${password}`)}`);
  const body = req.method === "GET" ? undefined : await req.arrayBuffer();
  const upstream = await fetch(target, { method: req.method, headers, body });
  return new Response(upstream.body, { status: upstream.status, headers: { ...corsHeaders, "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream" } });
});
