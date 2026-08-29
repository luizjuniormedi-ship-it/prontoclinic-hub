import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260829013235_close_global_catalog_write_policies.sql",
  ),
  "utf8",
);

describe("global catalog write closure", () => {
  it.each([
    ["notification_templates", "notification_templates_admin_write"],
    ["roles", "module_roles_admin"],
    ["role_permissions", "module_role_permissions_admin"],
  ])("remove escrita direta em %s", (table, policy) => {
    expect(migration).toContain(`DROP POLICY IF EXISTS ${policy}`);
    expect(migration).toMatch(
      new RegExp(`REVOKE[\\s\\S]+ON public\\.${table}[\\s\\S]+authenticated`, "i"),
    );
  });

  it("remove policies permissivas de password reset", () => {
    expect(migration).toContain('DROP POLICY IF EXISTS "Users can read own password_resets"');
    expect(migration).toMatch(
      /REVOKE\s+ALL\s+ON\s+public\.password_resets[\s\S]+authenticated/i,
    );
  });
});
