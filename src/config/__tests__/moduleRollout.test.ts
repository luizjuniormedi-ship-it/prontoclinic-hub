import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  features: {
    module19: false,
    module20: false,
    module21: false,
    module22: false,
    module23: false,
  },
}));

import { getWaveModule, waveModules } from "@/config/moduleRollout";

describe("moduleRollout", () => {
  it("registra cada módulo clínico uma única vez", () => {
    expect(waveModules.map((item) => item.id)).toEqual([19, 20, 21, 22, 23]);
    expect(new Set(waveModules.map((item) => item.path)).size).toBe(5);
  });

  it("mantém os módulos desabilitados sem flag explícita", () => {
    expect(waveModules.every((item) => item.enabled === false)).toBe(true);
  });

  it("falha claramente para um módulo não registrado", () => {
    expect(() => getWaveModule(24 as never)).toThrow(
      "Módulo 24 não está registrado na onda clínica",
    );
  });
});
