import { afterEach, describe, expect, it, vi } from "vitest";
import { withTimeout } from "@/utils/asyncTimeout";

describe("withTimeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retorna o resultado quando a operação conclui no prazo", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 100, "timeout")).resolves.toBe("ok");
  });

  it("rejeita uma operação travada com a mensagem operacional", async () => {
    vi.useFakeTimers();
    const result = withTimeout(new Promise<never>(() => undefined), 100, "Agenda indisponível");
    const assertion = expect(result).rejects.toThrow("Agenda indisponível");

    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });
});
