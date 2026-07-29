import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("clinical module rollout enforcement", () => {
  const appSource = readSource("src/App.tsx");
  const navigationSource = readSource("src/config/navigation.ts");
  const sidebarSource = readSource("src/components/AppSidebar.tsx");

  it.each([
    [23, "/lab"],
    [24, "/dicom/orders"],
    [24, "/dicom/worklist"],
  ])("keeps module %i route %s behind its rollout flag", (moduleId, route) => {
    const routePosition = appSource.indexOf(`path="${route}"`);
    const guardPosition = appSource.lastIndexOf(
      `isWaveModuleEnabled(${moduleId})`,
      routePosition,
    );

    expect(routePosition).toBeGreaterThan(-1);
    expect(guardPosition).toBeGreaterThan(-1);
    expect(routePosition - guardPosition).toBeLessThan(200);
  });

  it.each([
    [23, "/lab"],
    [24, "/dicom/orders"],
    [24, "/dicom/worklist"],
  ])("keeps module %i navigation %s behind its rollout flag", (moduleId, route) => {
    for (const source of [navigationSource, sidebarSource]) {
      const routePosition = source.indexOf(`url: "${route}"`);
      const guardPosition = source.lastIndexOf(
        `isWaveModuleEnabled(${moduleId})`,
        routePosition,
      );

      expect(routePosition).toBeGreaterThan(-1);
      expect(guardPosition).toBeGreaterThan(-1);
      expect(routePosition - guardPosition).toBeLessThan(350);
    }
  });
});
