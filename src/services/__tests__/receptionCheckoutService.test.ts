import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/lib/supabase";
import {
  isReceptionGuideValid,
  normalizeReceptionCheckoutSummary,
  receptionCheckoutService,
} from "@/services/receptionCheckoutService";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("receptionCheckoutService", () => {
  it("normaliza valores numéricos e a versão TISS do resumo", async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: {
        appointment_id: 101,
        patient_id: 1,
        company_id: "company-1",
        unit_id: 2,
        account_id: 10,
        prepared: true,
        payer_type: "convenio",
        collection_policy: "accounts_receivable",
        gross_amount: "200.00",
        discount_amount: "0.00",
        net_amount: "200.00",
        copay_amount: "20.00",
        patient_responsibility_amount: "20.00",
        insurance_responsibility_amount: "180.00",
        patient_paid_amount: "0.00",
        patient_pending_amount: "20.00",
        requires_tiss_guide: true,
        requires_tiss_signature: true,
        suggested_guide_type: "consulta",
        active_tiss_versions: [
          {
            id: 9,
            version: "04.03.00",
            scope: "prestador_operadora",
            effective_from: "2026-04-01",
            effective_until: null,
          },
        ],
        guide: null,
        cash_session_open: false,
        receivable: { id: 44, status: "open", amount: "20.00", due_date: "2026-08-25" },
      },
      error: null,
    } as never);

    const result = await receptionCheckoutService.getSummary("101");

    expect(supabase.rpc).toHaveBeenCalledWith("get_reception_checkout_summary", {
      p_appointment_id: 101,
    });
    expect(result.net_amount).toBe(200);
    expect(result.patient_responsibility_amount).toBe(20);
    expect(result.active_tiss_versions[0].version).toBe("04.03.00");
    expect(result.receivable?.amount).toBe(20);
  });

  it("envia a preparação da cobrança com os nomes canônicos do RPC", async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: {
        appointment_id: 101,
        patient_id: 1,
        company_id: "company-1",
        prepared: true,
        payer_type: "particular",
        collection_policy: "before_checkin",
      },
      error: null,
    } as never);

    await receptionCheckoutService.prepare({
      appointmentId: "101",
      payerType: "particular",
      grossAmount: 150,
      discountAmount: 10,
      patientResponsibility: 140,
      insuranceResponsibility: 0,
      collectionPolicy: "before_checkin",
      notes: "Consulta particular",
    });

    expect(supabase.rpc).toHaveBeenCalledWith("prepare_reception_checkout_secure", {
      p_appointment_id: 101,
      p_payer_type: "particular",
      p_gross_amount: 150,
      p_discount_amount: 10,
      p_patient_responsibility: 140,
      p_insurance_responsibility: 0,
      p_collection_policy: "before_checkin",
      p_due_date: null,
      p_notes: "Consulta particular",
    });
  });

  it("preserva a chave idempotente ao registrar pagamento", async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: {
        appointment_id: 101,
        patient_id: 1,
        company_id: "company-1",
        prepared: true,
        payer_type: "particular",
        collection_policy: "before_checkin",
      },
      error: null,
    } as never);

    await receptionCheckoutService.registerPayment({
      appointmentId: "101",
      amount: 100,
      paymentMethod: "credito",
      idempotencyKey: "payment-101-attempt-1",
      externalReference: "NSU-123",
      installmentCount: 2,
      notes: "Pagamento dividido",
    });

    expect(supabase.rpc).toHaveBeenCalledWith("register_reception_payment_secure", {
      p_appointment_id: 101,
      p_amount: 100,
      p_payment_method: "credito",
      p_idempotency_key: "payment-101-attempt-1",
      p_external_reference: "NSU-123",
      p_installment_count: 2,
      p_notes: "Pagamento dividido",
    });
  });

  it("propaga mensagem de erro do backend sem converter sucesso falso", async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: null,
      error: { message: "Abra o caixa antes de receber em dinheiro" },
    } as never);

    await expect(receptionCheckoutService.registerPayment({
      appointmentId: "101",
      amount: 50,
      paymentMethod: "dinheiro",
      idempotencyKey: "cash-101",
    })).rejects.toThrow("Abra o caixa antes de receber em dinheiro");
  });

  it("não interpreta strings false como booleanos verdadeiros", () => {
    const result = normalizeReceptionCheckoutSummary({
      prepared: "false",
      requires_tiss_guide: "false",
      requires_tiss_signature: "0",
      cash_session_open: "no",
      guide: {
        requires_signature: "false",
        validation_errors: [],
      },
    });

    expect(result.prepared).toBe(false);
    expect(result.requires_tiss_guide).toBe(false);
    expect(result.requires_tiss_signature).toBe(false);
    expect(result.cash_session_open).toBe(false);
    expect(result.guide?.requires_signature).toBe(false);
  });

  it("só considera a guia válida com status confirmado e sem erros", () => {
    const valid = normalizeReceptionCheckoutSummary({
      guide: {
        status: "validated",
        validation_errors: [],
      },
    });
    const invalidStatus = normalizeReceptionCheckoutSummary({
      guide: {
        status: "generated",
        validation_errors: [],
      },
    });
    const invalidErrors = normalizeReceptionCheckoutSummary({
      guide: {
        status: "validated",
        validation_errors: ["Código do procedimento obrigatório"],
      },
    });

    expect(isReceptionGuideValid(valid)).toBe(true);
    expect(isReceptionGuideValid(invalidStatus)).toBe(false);
    expect(isReceptionGuideValid(invalidErrors)).toBe(false);
  });
});

