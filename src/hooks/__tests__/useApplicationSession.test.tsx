import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useApplicationSession } from "@/hooks/useApplicationSession";
import { authSessionService } from "@/services/authSessionService";
import { supabase } from "@/lib/supabase";
import {
  clearApplicationSession,
  getClientDeviceId,
  readApplicationSession,
} from "@/services/applicationSessionStorage";

vi.mock("@/services/authSessionService", () => ({
  authSessionService: { heartbeat: vi.fn() },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { signOut: vi.fn() } },
}));
vi.mock("@/services/applicationSessionStorage", () => ({
  clearApplicationSession: vi.fn(),
  getClientDeviceId: vi.fn(),
  readApplicationSession: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readApplicationSession).mockReturnValue({
    session_id: "10000000-0000-0000-0000-000000000001",
    device_id: "20000000-0000-0000-0000-000000000002",
    idle_expires_at: "2026-07-17T00:00:00Z",
  });
  vi.mocked(getClientDeviceId).mockReturnValue("30000000-0000-0000-0000-000000000003");
  vi.mocked(supabase.auth.signOut).mockResolvedValue({ error: null } as never);
});

afterEach(() => vi.useRealTimers());

describe("useApplicationSession", () => {
  it("faz heartbeat imediato e encerra localmente uma sessão revogada", async () => {
    vi.mocked(authSessionService.heartbeat).mockResolvedValue(false);
    const onRevoked = vi.fn();

    renderHook(() => useApplicationSession(onRevoked));

    await waitFor(() => expect(onRevoked).toHaveBeenCalledTimes(1));
    expect(clearApplicationSession).toHaveBeenCalledTimes(1);
    expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("repete heartbeat e cancela o intervalo ao desmontar", async () => {
    vi.useFakeTimers();
    vi.mocked(authSessionService.heartbeat).mockResolvedValue(true);
    const { unmount } = renderHook(() => useApplicationSession(vi.fn()));

    await act(async () => { await Promise.resolve(); });
    expect(authSessionService.heartbeat).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(60_000); await Promise.resolve(); });
    expect(authSessionService.heartbeat).toHaveBeenCalledTimes(2);

    unmount();
    await act(async () => { vi.advanceTimersByTime(60_000); await Promise.resolve(); });
    expect(authSessionService.heartbeat).toHaveBeenCalledTimes(2);
  });
});
