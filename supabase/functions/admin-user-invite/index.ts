import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type InvitePayload = {
  email: string;
  full_name: string;
  role_name: string;
  phone?: string | null;
  cpf?: string | null;
  primary_unit_id?: number | null;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = request.headers.get("Authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "missing_authorization" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const userClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
  const adminClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await userClient.auth.getUser(token);
  if (authError || !authData.user) return json({ error: "unauthorized" }, 401);

  const { data: actor, error: actorError } = await adminClient
    .from("user_profiles")
    .select("id, user_id, company_id, role_name, lg_ativo, blocked_at, access_valid_until")
    .or(`id.eq.${authData.user.id},user_id.eq.${authData.user.id}`)
    .maybeSingle();
  const isAdmin = actor && ["admin", "administrador"].includes(String(actor.role_name ?? "").toLowerCase());
  const active = actor?.lg_ativo !== false && !actor?.blocked_at && (!actor?.access_valid_until || new Date(actor.access_valid_until) > new Date());
  if (actorError || !actor || !isAdmin || !active || !actor.company_id) return json({ error: "forbidden" }, 403);

  let payload: InvitePayload;
  try { payload = await request.json() as InvitePayload; } catch { return json({ error: "invalid_json" }, 400); }
  const email = String(payload.email ?? "").trim().toLowerCase();
  const fullName = String(payload.full_name ?? "").trim();
  const roleName = String(payload.role_name ?? "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email) || fullName.length < 2 || !roleName) return json({ error: "invalid_payload" }, 400);

  const { data: role } = await adminClient.from("roles").select("name").eq("name", roleName).maybeSingle();
  if (!role) return json({ error: "invalid_role" }, 422);

  const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName, role_name: roleName, company_id: actor.company_id },
  });
  if (inviteError || !invited.user) return json({ error: "invite_failed" }, 502);

  const { error: profileError } = await adminClient.from("user_profiles").upsert({
    id: invited.user.id,
    user_id: invited.user.id,
    company_id: actor.company_id,
    full_name: fullName,
    email,
    role_name: roleName,
    phone: payload.phone ?? null,
    cpf: payload.cpf ?? null,
    primary_unit_id: payload.primary_unit_id ?? null,
    lg_ativo: true,
  }, { onConflict: "id" });
  if (profileError) return json({ error: "profile_provision_failed" }, 502);
  return json({ user_id: invited.user.id, company_id: actor.company_id, role_name: roleName });
});
