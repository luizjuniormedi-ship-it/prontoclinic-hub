import { accessContextService, type AccessContextOption } from "@/services/accessContextService";
import { authSessionService } from "@/services/authSessionService";
import {
  getClientDeviceId,
  readStoredAccessContext,
  writeApplicationSession,
  writeStoredAccessContext,
} from "@/services/applicationSessionStorage";

function sameContext(left: AccessContextOption, right: Partial<AccessContextOption>): boolean {
  return left.membershipId === right.membershipId
    && left.roleId === right.roleId
    && left.unitId === right.unitId;
}

export async function activateAccessContext(option: AccessContextOption): Promise<void> {
  const registration = await authSessionService.activate({
    membershipId: option.membershipId,
    roleId: option.roleId,
    clientDeviceId: getClientDeviceId(),
    unitId: option.unitId,
    displayName: navigator.platform || "Navegador",
    platform: navigator.platform || null,
    userAgent: navigator.userAgent,
  });
  writeApplicationSession(registration);
  writeStoredAccessContext(option);
  window.dispatchEvent(new CustomEvent("prontomedic:access-context-changed", { detail: option }));
}

export async function initializeAccessContext(): Promise<AccessContextOption | null> {
  const available = await accessContextService.listAuthorized();
  const stored = readStoredAccessContext<AccessContextOption>();
  const selected = stored
    ? available.find((option) => sameContext(option, stored)) ?? null
    : available.length === 1 ? available[0] : null;

  if (!selected) return null;
  await activateAccessContext(selected);
  return selected;
}

export { sameContext };
