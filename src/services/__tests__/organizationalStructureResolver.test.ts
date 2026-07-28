import { describe, expect, it } from "vitest";
import { resolveInitialUnit, scopeOrganizationRecords } from "@/services/organizationalStructureResolver";

describe("organizational structure scoping", () => {
  it("prefers the authenticated primary unit and falls back to the first active unit", () => {
    const units = [{ id: 10, name: "Centro" }, { id: 20, name: "Zona Sul", active: false }, { id: 30, name: "Barra" }];
    expect(resolveInitialUnit(units, 30)).toBe(30);
    expect(resolveInitialUnit(units, 20)).toBe(10);
    expect(resolveInitialUnit([], 10)).toBeNull();
  });

  it("never mixes resources from another unit or inactive rows", () => {
    const rows = [
      { unit_id: 10, status: "active" },
      { unit_id: 20, status: "active" },
      { unit_id: 10, status: "inactive" },
      { unit_id: 10, lg_ativo: false },
    ];
    expect(scopeOrganizationRecords(rows, 10)).toEqual([{ unit_id: 10, status: "active" }]);
  });
});
