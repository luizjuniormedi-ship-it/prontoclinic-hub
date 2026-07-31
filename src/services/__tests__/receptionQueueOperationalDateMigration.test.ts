import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260730235500_reception_queue_operational_date.sql",
  ),
  "utf8",
);

describe("reception queue operational date migration", () => {
  it("uses the clinic timezone for both transition overloads", () => {
    expect(
      migration.match(
        /CURRENT_TIMESTAMP AT TIME ZONE 'America\/Sao_Paulo'/g,
      ),
    ).toHaveLength(2);
    expect(migration).not.toMatch(/ticket\.ticket_date = CURRENT_DATE/);
  });

  it("preserves the restricted Reception owner and public grants", () => {
    expect(
      migration.match(/OWNER TO prontomedic_reception_rpc_owner/g),
    ).toHaveLength(2);
    expect(migration).toMatch(
      /FROM PUBLIC, anon[\s\S]*TO authenticated, app_prontomedic/,
    );
  });
});
