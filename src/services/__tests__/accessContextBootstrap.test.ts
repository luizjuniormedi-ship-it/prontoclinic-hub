import { beforeEach, describe, expect, it, vi } from "vitest";
import { accessContextService, type AccessContextOption } from "@/services/accessContextService";
import { authSessionService } from "@/services/authSessionService";
import {
  initializeAccessContext,
} from "@/services/accessContextBootstrap";
import {
  getClientDeviceId,
  readStoredAccessContext,
  writeApplicationSession,
  writeStoredAccessContext,
} from "@/services/applicationSessionStorage";

vi.mock("@/services/accessContextService", () => ({
  accessContextService: { listAuthorized: vi.fn() },
}));
vi.mock("@/services/authSessionService", () => ({
  authSessionService: { activate: vi.fn() },
}));
vi.mock("@/services/applicationSessionStorage", () => ({
  getClientDeviceId: vi.fn(),
  readStoredAccessContext: vi.fn(),
  writeApplicationSession: vi.fn(),
  writeStoredAccessContext: vi.fn(),
}));

const option: AccessContextOption = {
  membershipId: "membership-1",
  roleId: 1,
  roleName: "admin",
  unitId: null,
  unitName: "Corporativo",
  companyId: "company-1",
  companyName: "Empresa",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getClientDeviceId).mockReturnValue("device-1");
  vi.mocked(authSessionService.activate).mockResolvedValue({
    session_id: "session-1",
    device_id: "device-1",
    idle_expires_at: "2026-07-17T12:00:00Z",
  });
});

describe("initializeAccessContext", () => {
  it("ativa o contexto armazenado antes de liberar a aplicação", async () => {
    vi.mocked(accessContextService.listAuthorized).mockResolvedValue([option]);
    vi.mocked(readStoredAccessContext).mockReturnValue(option);

    await expect(initializeAccessContext()).resolves.toEqual(option);

    expect(authSessionService.activate).toHaveBeenCalledWith(expect.objectContaining({
      membershipId: option.membershipId,
      roleId: option.roleId,
      unitId: null,
    }));
    expect(writeApplicationSession).toHaveBeenCalledTimes(1);
    expect(writeStoredAccessContext).toHaveBeenCalledWith(option);
  });

  it("não libera contexto quando existem várias opções sem seleção armazenada", async () => {
    vi.mocked(accessContextService.listAuthorized).mockResolvedValue([
      option,
      { ...option, membershipId: "membership-2", companyId: "company-2", companyName: "Outra" },
    ]);
    vi.mocked(readStoredAccessContext).mockReturnValue(null);

    await expect(initializeAccessContext()).resolves.toBeNull();
    expect(authSessionService.activate).not.toHaveBeenCalled();
  });
});
