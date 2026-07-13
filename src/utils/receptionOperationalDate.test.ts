import { afterEach, describe, expect, it, vi } from "vitest";
import { getReceptionOperationalDate } from "./receptionOperationalDate";

describe("getReceptionOperationalDate", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("mantem a data civil de Sao Paulo apos 21h, quando UTC ja virou o dia", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T00:30:00.000Z"));

    expect(getReceptionOperationalDate()).toBe("2026-07-12");
  });

  it("avanca a data operacional na meia-noite de Sao Paulo", () => {
    expect(getReceptionOperationalDate(new Date("2026-07-13T03:00:00.000Z"))).toBe("2026-07-13");
  });
});
