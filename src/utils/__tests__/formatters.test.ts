import { describe, expect, it } from "vitest";
import { addDays, localDateKey } from "@/utils/formatters";

describe("localDateKey", () => {
  it("preserva a data do calendário local sem conversão UTC", () => {
    const date = new Date(2026, 0, 7, 23, 30);
    expect(localDateKey(date)).toBe("2026-01-07");
  });

  it("adiciona dias sem deslocar o calendário local", () => {
    expect(addDays("2026-01-07", 1)).toBe("2026-01-08");
  });
});
