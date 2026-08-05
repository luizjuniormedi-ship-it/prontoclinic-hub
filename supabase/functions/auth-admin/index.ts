import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.3";
import { allowedRedirectUrl, corsDenied, corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ADMIN_REDIRECT_PATHS = new Set(["/reset-password"]);

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

function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
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
  const cors = corsHeaders(req);
  if (!cors) return corsDenied();
  const respond = (data: unknown, status = 200) => json(data, status, cors);

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return respond({ error: "Método não permitido." }, 405);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return respond({ error: "Serviço de autenticação não configurado." }, 503);
  }

  const authorization = req.headers.get("Authorization") ?? "";
  const accessToken = authorization.replace(/^Bearer\s+/i, "");
  if (!accessToken) return respond({ error: "Não autorizado." }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser(accessToken);
  if (userError || !userData.user) return respond({ error: "Não autorizado." }, 401);
  if (readAal(accessToken) !== "aal2") return respond({ error: "MFA AAL2 obrigatório." }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return respond({ error: "JSON inválido." }, 400);
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
      const redirectTo = allowedRedirectUrl(body.redirectTo, ADMIN_REDIRECT_PATHS);
      if (!email || !fullName || !Number.isInteger(roleId)) {
        return respond({ error: "Dados de convite inválidos." }, 400);
      }
      if (!redirectTo) return respond({ error: "Destino de convite inválido." }, 400);
      if (!await isCompanyAdmin(companyId)) {
        return respond({ error: "Acesso administrativo negado." }, 403);
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
          redirectTo,
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
      return respond({ ok: true, userId }, 201);
    }

    if (action === "send-recovery") {
      const userId = String(body.userId ?? "");
      const companyId = String(body.companyId ?? "");
      const redirectTo = allowedRedirectUrl(body.redirectTo, ADMIN_REDIRECT_PATHS);
      if (!redirectTo) return respond({ error: "Destino de recuperação inválido." }, 400);
      if (!await isCompanyAdmin(companyId)) {
        return respond({ error: "Acesso administrativo negado." }, 403);
      }
      const { data: target, error: targetError } = await adminClient
        .from("user_profiles")
        .select("id, email")
        .eq("id", userId)
        .maybeSingle();
      if (targetError) throw new Error("Falha ao consultar o usuário-alvo.");
      const { data: targetMembership, error: targetMembershipError } = await adminClient
        .from("memberships")
        .select("id")
        .eq("user_id", userId)
        .eq("company_id", companyId)
        .maybeSingle();
      if (targetMembershipError) throw new Error("Falha ao consultar o vínculo do usuário-alvo.");
      if (!target?.email || !targetMembership) return respond({ ok: true });
      const { error } = await userClient.auth.resetPasswordForEmail(target.email, {
        redirectTo,
      });
      if (error) throw error;
      return respond({ ok: true });
    }

    if (action === "set-active") {
      const userId = String(body.userId ?? "");
      const companyId = String(body.companyId ?? "");
      if (typeof body.active !== "boolean") {
        return respond({ error: "Estado ativo inválido." }, 400);
      }
      const active = body.active;
      if (!await isCompanyAdmin(companyId)) {
        return respond({ error: "Acesso administrativo negado." }, 403);
      }
      const { data, error: accessError } = await adminClient.rpc("prepare_user_access_active", {
        p_user_id: userId,
        p_company_id: companyId,
        p_active: active,
      });
      if (accessError) throw accessError;
      const transition = data as AccessTransition | null;
      if (!transition?.found) return respond({ error: "Usuário não encontrado nesta empresa." }, 404);

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
            return respond({ error: "Falha de autenticação; reconciliação administrativa necessária." }, 500);
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
          return respond({ error: "Acesso alterado; finalização administrativa necessária." }, 500);
        }
      }
      return respond({ ok: true });
    }

    if (action === "logout-global") {
      const userId = String(body.userId ?? "");
      const companyId = String(body.companyId ?? "");
      if (!await isCompanyAdmin(companyId)) {
        return respond({ error: "Acesso administrativo negado." }, 403);
      }
      const { data: membership, error: membershipError } = await adminClient
        .from("memberships")
        .select("id")
        .eq("user_id", userId)
        .eq("company_id", companyId)
        .maybeSingle();
      if (membershipError) throw new Error("Falha ao consultar o vínculo do usuário-alvo.");
      if (!membership) return respond({ ok: true });
      const logoutResponse = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}/logout`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          "Content-Type": "application/json",
        },
      });
      if (!logoutResponse.ok) throw new Error("Falha ao revogar sessões do usuário.");
      return respond({ ok: true });
    }

    return respond({ error: "Ação não suportada." }, 400);
  } catch (error) {
    console.error("[auth-admin] operation failed", error);
    return respond({ error: "Não foi possível concluir a operação de autenticação." }, 500);
  }
});
