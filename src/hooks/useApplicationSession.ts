import { useCallback, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { authSessionService } from "@/services/authSessionService";
import {
  clearApplicationSession,
  getClientDeviceId,
  readApplicationSession,
} from "@/services/applicationSessionStorage";

const HEARTBEAT_INTERVAL_MS = 60_000;

export function useApplicationSession(
  onRevoked: () => void = () => window.location.assign("/login?reason=session-revoked"),
  enabled = true,
): void {
  const running = useRef(false);

  const validate = useCallback(async () => {
    if (running.current) return;
    const registration = readApplicationSession();
    if (!registration) return;

    running.current = true;
    try {
      const allowed = await authSessionService.heartbeat(
        registration.session_id,
        getClientDeviceId(),
      );
      if (allowed) return;
      clearApplicationSession();
      await supabase.auth.signOut({ scope: "local" });
      onRevoked();
    } finally {
      running.current = false;
    }
  }, [onRevoked]);

  useEffect(() => {
    if (!enabled) return;
    void validate();
    const interval = window.setInterval(() => void validate(), HEARTBEAT_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void validate();
    };
    const onOnline = () => void validate();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, [enabled, validate]);
}
