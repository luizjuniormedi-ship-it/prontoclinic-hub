import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(
  resolve(process.cwd(), "src/pages/PatientCreatePage.tsx"),
  "utf8",
);

describe("PatientCreatePage tenant scope contract", () => {
  it("persists both company and unit required by the patients RLS policy", () => {
    expect(page).toMatch(/const \{ activeCompanyId, activeUnitId \} = useAuth\(\)/);
    expect(page).toMatch(/company_id:\s*activeCompanyId/);
    expect(page).toMatch(/unit_id:\s*activeUnitId/);
    expect(page).toMatch(/if \(!activeCompanyId \|\| !activeUnitId\)/);
  });

  it("surfaces a useful database error instead of a title-only toast", () => {
    expect(page).toMatch(/friendlyError\(err, "Cadastrar paciente"\)/);
  });
});
