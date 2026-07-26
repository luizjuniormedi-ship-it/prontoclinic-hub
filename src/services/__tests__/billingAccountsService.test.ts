import { describe, expect, it } from "vitest";
import {
  getBillingFinancialIssues,
  type BillingAccount,
} from "@/services/billingAccountsService";

function account(
  totalGrossAmount: number,
  totalNetAmount: number,
): BillingAccount {
  return {
    id: "billing-1",
    patient_id: 1,
    insurance_id: null,
    billing_type: "particular",
    account_type: "consulta",
    status: "aberta",
    competence_month: null,
    total_gross_amount: totalGrossAmount,
    total_net_amount: totalNetAmount,
    total_paid_amount: 0,
    total_pending_amount: totalNetAmount,
    authorization_number: null,
    guide_number: null,
    has_pending_issues: false,
    has_denial: false,
    is_reopened: false,
    opened_at: "2026-07-25T12:00:00.000Z",
    paid_at: null,
  };
}

describe("getBillingFinancialIssues", () => {
  it("aceita uma conta financeiramente consistente", () => {
    expect(getBillingFinancialIssues(account(200, 180))).toEqual([]);
  });

  it("impede conta pronta com bruto zerado ou líquido acima do bruto", () => {
    expect(getBillingFinancialIssues(account(0, 180))).toContain(
      "Valor bruto deve ser maior que zero.",
    );
    expect(getBillingFinancialIssues(account(100, 180))).toContain(
      "Valor líquido não pode superar o valor bruto.",
    );
  });
});
