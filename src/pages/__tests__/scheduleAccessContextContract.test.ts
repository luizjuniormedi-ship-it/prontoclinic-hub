import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/pages/SchedulePage.tsx", "utf8");

describe("SchedulePage access context contract", () => {
  it("resolves the active unit through the authorized context contract", () => {
    expect(source).toContain("accessContextService.listAuthorized()");
    expect(source).toContain("context.unitId === activeUnitId");
    expect(source).toContain("activeContext.unitName");
  });

  it("does not require reception users to read the administrative units table", () => {
    expect(source).not.toContain('.from("units")');
  });
});
