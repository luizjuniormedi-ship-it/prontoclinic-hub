import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useActiveAccessRole } from "@/hooks/useActiveAccessRole";
import {
  writeApplicationSession,
  writeStoredAccessContext,
} from "@/services/applicationSessionStorage";

describe("useActiveAccessRole", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("uses the authenticated profile role when no context was activated", () => {
    const { result } = renderHook(() => useActiveAccessRole("recepcao"));
    expect(result.current).toBe("recepcao");
  });

  it("uses the stored active context and reacts immediately to role changes", () => {
    writeStoredAccessContext({
      companyId: "company-a",
      membershipId: "membership-a",
      roleId: 3,
      roleName: "medico",
      unitId: 10,
    });
    writeApplicationSession({
      session_id: "session-a",
      device_id: "device-a",
      idle_expires_at: "2026-07-25T12:00:00Z",
      company_id: "company-a",
      membership_id: "membership-a",
      role_id: 3,
      unit_id: 10,
    });
    const { result } = renderHook(() => useActiveAccessRole("recepcao"));
    expect(result.current).toBe("medico");

    act(() => {
      writeStoredAccessContext({
        companyId: "company-a",
        membershipId: "membership-a",
        roleId: 4,
        roleName: "dpo",
        unitId: 10,
      });
      writeApplicationSession({
        session_id: "session-b",
        device_id: "device-a",
        idle_expires_at: "2026-07-25T12:00:00Z",
        company_id: "company-a",
        membership_id: "membership-a",
        role_id: 4,
        unit_id: 10,
      });
      window.dispatchEvent(new CustomEvent("prontomedic:access-context-changed", {
        detail: { roleName: "dpo" },
      }));
    });

    expect(result.current).toBe("dpo");
  });

  it("ignores a stored role that does not match the backend session tuple", () => {
    writeStoredAccessContext({
      companyId: "company-a",
      membershipId: "membership-a",
      roleId: 99,
      roleName: "admin",
      unitId: 10,
    });
    writeApplicationSession({
      session_id: "session-a",
      device_id: "device-a",
      idle_expires_at: "2026-07-25T12:00:00Z",
      company_id: "company-a",
      membership_id: "membership-a",
      role_id: 2,
      unit_id: 10,
    });

    const { result } = renderHook(() => useActiveAccessRole("recepcao"));
    expect(result.current).toBe("recepcao");
  });
});
