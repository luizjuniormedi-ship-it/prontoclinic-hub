import { describe, expect, it } from "vitest";
import { canAccessRoute } from "@/config/routePermissions";

const profileMatrix = {
  admin: {
    allowed: ["/admin/users", "/admin/permissions", "/attendance/fixture", "/nursing/care", "/billing-accounts"],
    denied: [],
  },
  gestor: {
    allowed: ["/patients", "/schedule", "/reception", "/billing-accounts", "/bi"],
    denied: ["/admin/users", "/admin/permissions", "/nursing/care"],
  },
  recepcao: {
    allowed: ["/patients", "/schedule", "/reception", "/callcenter", "/nursing/queue"],
    denied: ["/attendance/fixture", "/nursing/triage", "/nursing/care", "/admin/users", "/billing-accounts"],
  },
  medico: {
    allowed: ["/patients", "/schedule", "/records", "/encounters", "/attendance/fixture", "/nursing/care"],
    denied: ["/admin/users", "/financial", "/admin/permissions"],
  },
  enfermagem: {
    allowed: ["/nursing/triage", "/nursing/care", "/nursing/queue", "/internacao", "/pa"],
    denied: ["/admin/users", "/billing-accounts", "/records"],
  },
  laboratorio: {
    allowed: ["/lab", "/worklist"],
    denied: ["/admin/users", "/billing-accounts", "/nursing/care"],
  },
  diagnostico: {
    allowed: ["/dicom/orders", "/dicom/worklist", "/pacs", "/dicom/reports", "/admin/dicom"],
    denied: ["/admin/users", "/billing-accounts", "/nursing/care"],
  },
  farmacia: {
    allowed: ["/pharmacy", "/purchases"],
    denied: ["/admin/users", "/billing-accounts", "/records"],
  },
  financeiro: {
    allowed: ["/billing-accounts", "/billing-production", "/financial", "/professional-payment", "/admin/tiss"],
    denied: ["/admin/users", "/records", "/nursing/care"],
  },
  faturamento: {
    allowed: ["/billing-accounts", "/billing-production", "/admin/tiss", "/admin/price-tables"],
    denied: ["/financial", "/professional-payment", "/records", "/admin/users"],
  },
  call_center: {
    allowed: ["/callcenter", "/schedule", "/patients"],
    denied: ["/reception", "/billing-accounts", "/records", "/admin/users"],
  },
  dpo: {
    allowed: ["/admin/lgpd", "/admin/audit", "/admin/notifications"],
    denied: ["/patients", "/records", "/billing-accounts", "/admin/users"],
  },
  administrativo: {
    allowed: ["/professionals", "/companies", "/admin/insurances", "/admin/credentialing", "/master-data", "/settings"],
    denied: ["/admin/users", "/admin/profiles", "/admin/permissions", "/encounters", "/nursing/care"],
  },
  paciente: {
    allowed: ["/", "/meus-agendamentos"],
    denied: ["/patients", "/records", "/encounters", "/billing-accounts", "/admin/users"],
  },
} as const;

describe("independent profile permission matrix", () => {
  for (const [role, rules] of Object.entries(profileMatrix)) {
    it(`${role} grants only the audited route set`, () => {
      for (const route of rules.allowed) {
        expect(canAccessRoute(role, route), `${role} deveria acessar ${route}`).toBe(true);
      }
      for (const route of rules.denied) {
        expect(canAccessRoute(role, route), `${role} não deveria acessar ${route}`).toBe(false);
      }
    });
  }
});

