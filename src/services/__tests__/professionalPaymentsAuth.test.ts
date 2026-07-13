import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

type RpcPermission = {
  module: string;
  action: "can_view" | "can_create" | "can_edit";
};

const source = readFileSync(resolve(process.cwd(), "local-auth-server.mjs"), "utf8");

function sourceBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) {
    throw new Error(`Trecho nao encontrado: ${startMarker} -> ${endMarker}`);
  }
  return source.slice(start, end);
}

function loadRpcPermissions(): Record<string, RpcPermission> {
  const permissionsSource = sourceBetween(
    "const RPC_PERMISSIONS",
    "const CENTRAL_PERMISSION_RPCS",
  );

  return new Function(`${permissionsSource}; return RPC_PERMISSIONS;`)() as Record<
    string,
    RpcPermission
  >;
}

function loadTableToModule(): (table: string, method?: string) => string | null {
  const tableMappingSource = sourceBetween(
    "const REFERENCE_TABLES",
    "const METHOD_TO_ACTION",
  );
  return new Function(`${tableMappingSource}; return tableToModule;`)() as (
    table: string,
    method?: string,
  ) => string | null;
}

function loadRpcSerializationHarness(): {
  buildRpcQuery: (functionName: string, parameterNames: string[]) => string;
  serializeRpcResult: (functionName: string, rows: Array<{ result: unknown }>) => unknown;
} {
  const identifierSource = sourceBetween("const IDENT =", "const companyScopedTableCache");
  const permissionsSource = sourceBetween(
    "const RPC_PERMISSIONS",
    "const CENTRAL_PERMISSION_RPCS",
  );
  const serializationSource = sourceBetween(
    "const STRUCTURED_ROW_RPCS",
    "const RPC_ONLY_TABLES",
  );

  return new Function(
    `${identifierSource}\n${permissionsSource}\n${serializationSource}\n` +
      "return { buildRpcQuery, serializeRpcResult };",
  )() as {
    buildRpcQuery: (functionName: string, parameterNames: string[]) => string;
    serializeRpcResult: (functionName: string, rows: Array<{ result: unknown }>) => unknown;
  };
}

type PermissionRow = {
  module: string;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
};

function loadAuthorizationHarness(query: (sql: string, values: string[]) => Promise<{ rows: PermissionRow[] }>): {
  loadRolePerms: (role: string, action: string) => Promise<Record<string, PermissionRow>>;
  authorizeRpc: (
    profile: { lg_ativo: boolean; role_name: string },
    functionName: string,
  ) => Promise<{ ok: boolean; reason?: string }>;
} {
  const permissionLoaderSource = sourceBetween(
    "const VIEW_PERMISSION_CACHE_TTL_MS",
    "/** Retorna {ok:true}",
  );
  const rpcAuthorizationSource = sourceBetween(
    "const RPC_PERMISSIONS",
    "const configuredOrigins",
  );

  return new Function(
    "pool",
    `${permissionLoaderSource}\n${rpcAuthorizationSource}\n` +
      "return { loadRolePerms, authorizeRpc };",
  )({ query }) as {
    loadRolePerms: (role: string, action: string) => Promise<Record<string, PermissionRow>>;
    authorizeRpc: (
      profile: { lg_ativo: boolean; role_name: string },
      functionName: string,
    ) => Promise<{ ok: boolean; reason?: string }>;
  };
}

describe("professional payments local backend authorization", () => {
  it("libera somente leitura tenant-scoped do catalogo de unidades", () => {
    const tableToModule = loadTableToModule();

    expect(tableToModule("units", "GET")).toBeNull();
    expect(tableToModule("units", "HEAD")).toBeNull();
    expect(tableToModule("units", "POST")).toBe("admin");
    expect(tableToModule("units", "PATCH")).toBe("admin");
  });

  it("mapeia as tres RPCs no modulo financeiro com as acoes corretas", () => {
    const permissions = loadRpcPermissions();

    expect(permissions.create_professional_payment).toEqual({
      module: "financeiro",
      action: "can_create",
    });
    expect(permissions.list_professional_payments).toEqual({
      module: "financeiro",
      action: "can_view",
    });
    expect(permissions.transition_professional_payment).toEqual({
      module: "financeiro",
      action: "can_edit",
    });
  });

  it("serializa cada RETURNS TABLE como JSON estruturado e preserva array de uma linha", () => {
    const { buildRpcQuery, serializeRpcResult } = loadRpcSerializationHarness();
    const parameterNames = ["p_payment_id", "p_target_status"];

    for (const functionName of [
      "create_professional_payment",
      "list_professional_payments",
      "transition_professional_payment",
    ]) {
      expect(buildRpcQuery(functionName, parameterNames)).toBe(
        `SELECT to_jsonb(r) AS result FROM public."${functionName}"("p_payment_id" => $1, "p_target_status" => $2) AS r`,
      );
      expect(serializeRpcResult(functionName, [{ result: { id: 41, status: "apurado" } }])).toEqual([
        { id: 41, status: "apurado" },
      ]);
    }

    expect(() => buildRpcQuery("nao_autorizada", [])).toThrow("nao autorizada");
    expect(() => buildRpcQuery("create_professional_payment", ['p_id"; DROP TABLE roles; --'])).toThrow(
      "parametro RPC invalido",
    );
  });

  it.each(["can_create", "can_edit", "can_delete"])(
    "ignora o cache de leitura para %s",
    async (action) => {
      const permission: PermissionRow = {
        module: "financeiro",
        can_view: true,
        can_create: true,
        can_edit: true,
        can_delete: true,
      };
      const query = vi.fn(async (sql: string, values: string[]) => {
        expect(sql).toContain("FROM role_permissions rp JOIN roles ro");
        expect(values).toEqual(["financeiro"]);
        return { rows: [permission] };
      });
      const { loadRolePerms } = loadAuthorizationHarness(query);

      await loadRolePerms("financeiro", action);
      await loadRolePerms("financeiro", action);

      expect(query).toHaveBeenCalledTimes(2);
    },
  );

  it("aplica revogacao de can_create na chamada RPC seguinte sem restart", async () => {
    const granted: PermissionRow = {
      module: "financeiro",
      can_view: true,
      can_create: true,
      can_edit: true,
      can_delete: false,
    };
    const revoked = { ...granted, can_create: false };
    const responses = [[granted], [revoked]];
    const query = vi.fn(async (sql: string, values: string[]) => {
      expect(sql).toContain("FROM role_permissions rp JOIN roles ro");
      expect(values).toEqual(["financeiro"]);
      const rows = responses.shift();
      if (!rows) throw new Error("consulta RBAC inesperada");
      return { rows };
    });
    const { authorizeRpc } = loadAuthorizationHarness(query);
    const profile = { lg_ativo: true, role_name: "financeiro" };

    await expect(authorizeRpc(profile, "create_professional_payment")).resolves.toEqual({ ok: true });
    await expect(authorizeRpc(profile, "create_professional_payment")).resolves.toMatchObject({
      ok: false,
      reason: expect.stringContaining("can_create"),
    });
    expect(query).toHaveBeenCalledTimes(2);
  });
});

