import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface AccessTransition {
  found: boolean;
  changed: boolean;
  membership_id: string;
  previous_status: "active" | "suspended";
  requested_status: "active" | "suspended" | "pending_activation";
  final_status: "active" | "suspended";
  expected_updated_at: string;
  active_memberships: number;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function readAal(jwt: string): string | null {
  try {
    const payload = jwt.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/");
    if (!payload) return null;
    const normalized = payload.padEnd(Math.ceil(payload.length / 4) * 4, "=");
    return (JSON.parse(atob(normalized)) as { aal?: string }).aal ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Serviço de autenticação não configurado." }, 503);
  }

  const authorization = req.headers.get("Authorization") ?? "";
  const accessToken = authorization.replace(/^Bearer\s+/i, "");
  if (!accessToken) return json({ error: "Não autorizado." }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser(accessToken);
  if (userError || !userData.user) return json({ error: "Não autorizado." }, 401);
  if (readAal(accessToken) !== "aal2") return json({ error: "MFA AAL2 obrigatório." }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido." }, 400);
  }

  try {
    const action = String(body.action ?? "");
    const isCompanyAdmin = async (companyId: string): Promise<boolean> => {
      if (!companyId) return false;
      const { data, error } = await userClient.rpc("current_context_is_company_admin", {
        p_company_id: companyId,
      });
      return !error && data === true;
    };

    if (action === "invite-user") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const fullName = String(body.fullName ?? "").trim();
      const companyId = String(body.companyId ?? "");
      const roleId = Number(body.roleId);
      const primaryUnitId = body.primaryUnitId == null ? null : Number(body.primaryUnitId);
      if (!email || !fullName || !Number.isInteger(roleId)) {
        return json({ error: "Dados de convite inválidos." }, 400);
      }
      if (!await isCompanyAdmin(companyId)) {
        return json({ error: "Acesso administrativo negado." }, 403);
      }

      const { data: existingProfile, error: existingProfileError } = await adminClient
        .from("user_profiles")
        .select("id")
        .eq("email", email)
        .maybeSingle();
      if (existingProfileError) throw existingProfileError;

      let userId = existingProfile?.id as string | undefined;
      let invitedNewUser = false;
      if (!userId) {
        const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
          data: { full_name: fullName },
          redirectTo: typeof body.redirectTo === "string" ? body.redirectTo : undefined,
        });
        if (inviteError || !invited.user) throw inviteError ?? new Error("Convite não criado.");
        userId = invited.user.id;
        invitedNewUser = true;
      }

      const { error: provisionError } = await adminClient.rpc("provision_user_access", {
        p_user_id: userId,
        p_email: email,
        p_full_name: fullName,
        p_company_id: companyId,
        p_role_id: roleId,
        p_primary_unit_id: primaryUnitId,
      });
      if (provisionError) {
        const { error: deleteError } = invitedNewUser
          ? await adminClient.auth.admin.deleteUser(userId)
          : { error: null };
        if (invitedNewUser && deleteError) {
          // Se a remoção compensatória falhar, bloqueia o usuário órfão para que
          // ele nunca obtenha acesso enquanto a reconciliação administrativa ocorre.
          const { error: banError } = await adminClient.auth.admin.updateUserById(userId, {
            ban_duration: "876000h",
          });
          console.error("[auth-admin] invite compensation failed", {
            userId,
            deleteFailed: true,
            banFailed: Boolean(banError),
          });
        }
        throw provisionError;
      }
      return json({ ok: true, userId }, 201);
    }

    if (action === "send-recovery") {
      const userId = String(body.userId ?? "");
      const companyId = String(body.companyId ?? "");
      const { data: target } = await adminClient
        .from("user_profiles")
        .select("id, email")
        .eq("id", userId)
        .maybeSingle();
      if (!target?.email) return json({ ok: true });
      const { data: targetMembership } = await adminClient
        .from("memberships")
        .select("id")
        .eq("user_id", userId)
        .eq("company_id", companyId)
        .maybeSingle();
      if (!targetMembership || !await isCompanyAdmin(companyId)) {
        return json({ error: "Acesso administrativo negado." }, 403);
      }
      const { error } = await userClient.auth.resetPasswordForEmail(target.email, {
        redirectTo: typeof body.redirectTo === "string" ? body.redirectTo : undefined,
      });
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "set-active") {
      const userId = String(body.userId ?? "");
      const companyId = String(body.companyId ?? "");
      const active = body.active === true;
      if (!await isCompanyAdmin(companyId)) {
        return json({ error: "Acesso administrativo negado." }, 403);
      }
      const { data, error: accessError } = await adminClient.rpc("prepare_user_access_active", {
        p_user_id: userId,
        p_company_id: companyId,
        p_active: active,
      });
      if (accessError) throw accessError;
      const transition = data as AccessTransition | null;
      if (!transition?.found) return json({ error: "Usuário não encontrado nesta empresa." }, 404);

      const { error: authError } = await adminClient.auth.admin.updateUserById(userId, {
        ban_duration: transition.active_memberships === 0 ? "876000h" : "none",
      });
      if (authError) {
        if (transition.changed) {
          const { data: compensated, error: compensationError } = await adminClient.rpc(
            "restore_user_access_active",
            {
              p_user_id: userId,
              p_membership_id: transition.membership_id,
              p_requested_status: transition.requested_status,
              p_previous_status: transition.previous_status,
              p_expected_updated_at: transition.expected_updated_at,
            },
          );
          if (compensationError || compensated !== true) {
            console.error("[auth-admin] set-active CAS compensation failed", {
              userId,
              membershipId: transition.membership_id,
              requestedStatus: transition.requested_status,
            });
            return json({ error: "Falha de autenticação; reconciliação administrativa necessária." }, 500);
          }
        }
        throw authError;
      }

      if (transition.changed) {
        const { data: finalized, error: finalizeError } = await adminClient.rpc(
          "finalize_user_access_active",
          {
            p_user_id: userId,
            p_membership_id: transition.membership_id,
            p_requested_status: transition.requested_status,
            p_expected_updated_at: transition.expected_updated_at,
          },
        );
        if (finalizeError || finalized !== true) {
          console.error("[auth-admin] set-active finalization failed", {
            userId,
            membershipId: transition.membership_id,
            requestedStatus: transition.requested_status,
          });
          return json({ error: "Acesso alterado; finalização administrativa necessária." }, 500);
        }
      }
      return json({ ok: true });
    }

    if (action === "logout-global") {
      const { error } = await userClient.auth.signOut({ scope: "global" });
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: "Ação não suportada." }, 400);
  } catch (error) {
    console.error("[auth-admin] operation failed", error);
    return json({ error: "Não foi possível concluir a operação de autenticação." }, 500);
  }
});
