/**
 * medicalRecordsService.test.ts
 *
 * Testes unitários do CRUD de prontuário médico.
 * Cobre: getByPatient, getById, create (com/sem validação), update.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  medicalRecordsService,
  type DbMedicalRecord,
} from "@/services/medicalRecordsService";

vi.mock("@/lib/supabase", () => {
  const chain: {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    single: ReturnType<typeof vi.fn>;
  } = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(),
    order: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    single: vi.fn(),
  };
  return { supabase: { from: vi.fn(() => chain) } };
});

import { supabase } from "@/lib/supabase";

describe("medicalRecordsService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getByPatient", () => {
    it("retorna lista de prontuários do paciente ordenados por data", async () => {
      const mockRecords: DbMedicalRecord[] = [
        {
          id: "r2",
          company_id: null,
          unit_id: null,
          patient_id: "p1",
          professional_id: "d1",
          appointment_id: null,
          record_date: "2026-06-15",
          anamnesis: "Queixa",
          evolution: null,
          vital_signs: null,
          notes: null,
          created_at: "2026-06-15T10:00:00Z",
        },
        {
          id: "r1",
          company_id: null,
          unit_id: null,
          patient_id: "p1",
          professional_id: null,
          appointment_id: null,
          record_date: "2026-01-01",
          anamnesis: null,
          evolution: null,
          vital_signs: null,
          notes: null,
          created_at: "2026-01-01T10:00:00Z",
        },
      ];

      const chain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: mockRecords, error: null }),
      };
      (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      const result = await medicalRecordsService.getByPatient("p1");
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("r2");
      expect(chain.eq).toHaveBeenCalledWith("patient_id", "p1");
    });

    it("lança erro quando Supabase falha", async () => {
      const chain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({
          data: null,
          error: { message: "permission denied" },
        }),
      };
      (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      await expect(medicalRecordsService.getByPatient("p1")).rejects.toThrow(
        /Erro ao buscar prontuários/,
      );
    });
  });

  describe("getById", () => {
    it("retorna um prontuário quando encontrado", async () => {
      const mockRecord: DbMedicalRecord = {
        id: "r1",
        company_id: "c1",
        unit_id: null,
        patient_id: "p1",
        professional_id: "d1",
        appointment_id: null,
        record_date: "2026-06-15",
        anamnesis: null,
        evolution: null,
        vital_signs: null,
        notes: null,
        created_at: "2026-06-15T10:00:00Z",
      };
      const chain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: mockRecord, error: null }),
      };
      (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      const result = await medicalRecordsService.getById("r1");
      expect(result?.id).toBe("r1");
    });

    it("retorna null quando não encontrado", async () => {
      const chain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
      (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      const result = await medicalRecordsService.getById("missing");
      expect(result).toBeNull();
    });
  });

  describe("create", () => {
    it("cria prontuário com record_date automático quando não informado", async () => {
      const created: DbMedicalRecord = {
        id: "r-new",
        company_id: null,
        unit_id: null,
        patient_id: "p1",
        professional_id: "d1",
        appointment_id: null,
        record_date: new Date().toISOString(),
        anamnesis: "Q",
        evolution: null,
        vital_signs: null,
        notes: null,
        created_at: new Date().toISOString(),
      };
      const single = vi.fn().mockResolvedValue({ data: created, error: null });
      const insert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single }) });
      (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ insert });

      const result = await medicalRecordsService.create({
        patient_id: "p1",
        professional_id: "d1",
        anamnesis: "Q",
      });

      expect(result.id).toBe("r-new");
      expect(insert).toHaveBeenCalled();
      const callArg = insert.mock.calls[0][0];
      expect(callArg.patient_id).toBe("p1");
      expect(callArg.record_date).toBeDefined(); // auto-filled
    });

    it("rejeita input sem patient_id", async () => {
      await expect(
        medicalRecordsService.create({
          patient_id: "",
          anamnesis: "Queixa",
        }),
      ).rejects.toThrow(/patient_id é obrigatório/);
    });

    it("respeita record_date quando fornecido", async () => {
      const fixedDate = "2025-01-15T08:00:00Z";
      const single = vi.fn().mockResolvedValue({
        data: { id: "r-fixed", record_date: fixedDate, patient_id: "p1" },
        error: null,
      });
      const insert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single }) });
      (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ insert });

      await medicalRecordsService.create({
        patient_id: "p1",
        record_date: fixedDate,
      });

      const callArg = insert.mock.calls[0][0];
      expect(callArg.record_date).toBe(fixedDate);
    });
  });

  describe("update", () => {
    it("atualiza prontuário por id", async () => {
      const updated: DbMedicalRecord = {
        id: "r1",
        company_id: null,
        unit_id: null,
        patient_id: "p1",
        professional_id: null,
        appointment_id: null,
        record_date: "2026-06-15",
        anamnesis: "Atualizado",
        evolution: null,
        vital_signs: null,
        notes: null,
        created_at: "2026-06-15T10:00:00Z",
      };
      const single = vi.fn().mockResolvedValue({ data: updated, error: null });
      const update = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single }) }),
      });
      (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ update });

      const result = await medicalRecordsService.update("r1", { anamnesis: "Atualizado" });
      expect(result.anamnesis).toBe("Atualizado");
    });
  });
});