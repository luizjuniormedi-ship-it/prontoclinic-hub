import { useEffect, useState } from "react";
import type { AccessContextOption } from "@/services/accessContextService";
import {
  readApplicationSession,
  readStoredAccessContext,
} from "@/services/applicationSessionStorage";

export type ActiveAccessContext = {
  roleName: string | null;
  companyId: string | null;
  unitId: number | null;
};

function readActiveContext(
  fallbackRole: string | null | undefined,
  fallbackCompanyId?: string | null,
): ActiveAccessContext {
  const stored = readStoredAccessContext<AccessContextOption>();
  const registration = readApplicationSession();
  const registrationMatchesStored = Boolean(
    registration
    && stored
    && registration.company_id === stored.companyId
    && registration.membership_id === stored.membershipId
    && registration.role_id === stored.roleId
    && registration.unit_id === stored.unitId,
  );

  if (registrationMatchesStored && typeof stored?.roleName === "string" && stored.roleName.trim()) {
    return {
      roleName: stored.roleName,
      companyId: registration!.company_id,
      unitId: registration!.unit_id,
    };
  }

  return {
    roleName: fallbackRole ?? null,
    companyId: fallbackCompanyId ?? null,
    unitId: null,
  };
}

/**
 * Mantém navegação e gates de interface sincronizados com o papel efetivamente
 * ativado na sessão da empresa/unidade atual.
 */
export function useActiveAccessContext(
  fallbackRole: string | null | undefined,
  fallbackCompanyId?: string | null,
): ActiveAccessContext {
  const [context, setContext] = useState(
    () => readActiveContext(fallbackRole, fallbackCompanyId),
  );

  useEffect(() => {
    const refresh = () => setContext(readActiveContext(fallbackRole, fallbackCompanyId));
    refresh();

    window.addEventListener("prontomedic:access-context-changed", refresh);
    return () => window.removeEventListener("prontomedic:access-context-changed", refresh);
  }, [fallbackCompanyId, fallbackRole]);

  return context;
}

export function useActiveAccessRole(fallbackRole: string | null | undefined): string | null {
  return useActiveAccessContext(fallbackRole).roleName;
}
