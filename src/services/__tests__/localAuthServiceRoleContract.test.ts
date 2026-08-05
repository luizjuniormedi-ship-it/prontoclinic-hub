import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "local-auth-server.mjs"), "utf8");

describe("local auth privileged contract", () => {
  it("validates the opaque server-side key in both Supabase headers", () => {
    expect(source).toContain("LOCAL_AUTH_SERVICE_KEY");
    expect(source).toContain("constantTimeEqual(bearer, SERVICE_API_KEY)");
    expect(source).toContain("constantTimeEqual(apiKey, SERVICE_API_KEY)");
  });

  it("keeps service_role out of generic REST, HEAD and RPC authorization", () => {
    expect(source).not.toContain("function verifyRequestJwt");
    expect(source).not.toContain("payload.role === 'service_role' ? { ok: true }");
    expect(source).not.toContain("payload.role === 'service_role' || isSelfProfileRead");
    expect(source).toContain("SERVICE_ROUTE_ALLOWLIST");
    expect(source).toContain("SERVICE_RPC_ALLOWLIST");
    expect(source).toContain("SERVICE_READ_TABLE_ALLOWLIST");
    expect(source).not.toContain("'set_user_access_active',");
    expect(source).toContain("'admin_record_auth_operation',");
  });

  it("uses a distinct least-privilege database pool", () => {
    expect(source).toContain("LOCAL_AUTH_SERVICE_PGUSER");
    expect(source).toContain("LOCAL_AUTH_SERVICE_PGPASSWORD");
    expect(source).toContain("SERVICE_PGUSER === 'app_prontomedic'");
    expect(source).toContain("app_is_service_member");
    expect(source).toContain("SET LOCAL ROLE service_role");
  });

  it("enforces suspension on login and refresh and revokes refresh tokens", () => {
    expect(source.match(/banned_until IS NULL OR banned_until <= now\(\)/gi)?.length)
      .toBeGreaterThanOrEqual(3);
    expect(source).toContain(
      "UPDATE auth.refresh_tokens SET revoked = true, updated_at = now() WHERE user_id = $1 AND revoked = false",
    );
  });

  it("restricts delete to compensation of a recent unconsumed invite", () => {
    expect(source).toContain("Compensating delete not allowed");
    expect(source).toContain("c.type = 'invite'");
    expect(source).toContain("c.created_at > NOW() - INTERVAL '5 minutes'");
  });

  it("keeps password-flow sessions restricted and makes global logout immediate", () => {
    expect(source).toContain("password_update_required");
    expect(source).toContain("password_updated_at IS NULL");
    expect(source).toContain("rt.session_jti = $2");
    expect(source).toContain("rt.revoked = false");
  });
});
