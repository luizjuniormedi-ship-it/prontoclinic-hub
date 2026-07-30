import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260730203000_patients_search_trigram_indexes.sql",
  "utf8",
);

describe("patient search indexes", () => {
  it.each(["cpf", "phone", "email"])(
    "indexes %s with the trigram operator class",
    (column) => {
      expect(migration).toContain(`(${column} gin_trgm_ops)`);
    },
  );

  it("refreshes planner statistics after creating the indexes", () => {
    expect(migration).toContain("ANALYZE public.patients");
  });
});
