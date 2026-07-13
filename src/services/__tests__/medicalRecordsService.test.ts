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
  return { supabase: { from: vi.fn(() => chain), rpc: vi.fn() } };
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
        diagnosis: null,
        prescription: null,
          vital_signs: null,
          notes: null,
          status: "draft",
          signed_at: null,
          signed_by: null,
          content_hash: null,
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
        diagnosis: null,
        prescription: null,
          vital_signs: null,
          notes: null,
          status: "draft",
          signed_at: null,
          signed_by: null,
          content_hash: null,
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
        diagnosis: null,
        prescription: null,
        vital_signs: null,
        notes: null,
        status: "draft",
        signed_at: null,
        signed_by: null,
        content_hash: null,
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
    it("cria prontuário via RPC seguro", async () => {
      const created = { id: 10, patient_id: 101, anamnesis: "Q" };
      (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: created,
        error: null,
      });

      const result = await medicalRecordsService.create({
        patient_id: "101",
        professional_id: "202",
        anamnesis: "Q",
      });

      expect(result.id).toBe(10);
      expect(supabase.rpc).toHaveBeenCalledWith("create_medical_record_secure", expect.objectContaining({
        p_patient_id: 101,
        p_professional_id: 202,
        p_anamnesis: "Q",
      }));
    });

    it("rejeita input sem patient_id numérico", async () => {
      await expect(
        medicalRecordsService.create({ patient_id: "", anamnesis: "Queixa" }),
      ).rejects.toThrow(/patient_id/);
    });
  });

  describe("update", () => {
    it("atualiza prontuário por RPC seguro", async () => {
      const updated = { id: 10, patient_id: 101, anamnesis: "Atualizado" };
      (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: updated,
        error: null,
      });

      const result = await medicalRecordsService.update("10", { anamnesis: "Atualizado" });

      expect(result.anamnesis).toBe("Atualizado");
      expect(supabase.rpc).toHaveBeenCalledWith("update_medical_record_secure", {
        p_record_id: 10,
        p_patch: { anamnesis: "Atualizado" },
      });
    });
  });

  describe("finalizeAttendance", () => {
    it("finaliza e assina o atendimento por uma única RPC", async () => {
      const finalized = { id: 10, appointment_id: 303, status: "signed" };
      (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: finalized,
        error: null,
      });

      const result = await medicalRecordsService.finalizeAttendance({
        appointment_id: "303",
        anamnesis: "Queixa",
        evolution: "Evolução",
        vital_signs: { pa: "120/80" },
      });

      expect(result.status).toBe("signed");
      expect(supabase.rpc).toHaveBeenCalledWith("finalize_medical_attendance_secure", {
        p_appointment_id: "303",
        p_record_date: null,
        p_anamnesis: "Queixa",
        p_evolution: "Evolução",
        p_diagnosis: null,
        p_prescription: null,
        p_vital_signs: { pa: "120/80" },
        p_notes: null,
      });
    });

    it("rejeita appointment_id não numérico antes da RPC", async () => {
      await expect(medicalRecordsService.finalizeAttendance({
        appointment_id: "inválido",
      })).rejects.toThrow(/appointment_id/);
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it("preserva BIGINT acima de Number.MAX_SAFE_INTEGER como string", async () => {
      (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: { id: "1", status: "signed" }, error: null,
      });
      await medicalRecordsService.finalizeAttendance({ appointment_id: "9007199254740993" });
      expect(supabase.rpc).toHaveBeenCalledWith(
        "finalize_medical_attendance_secure",
        expect.objectContaining({ p_appointment_id: "9007199254740993" }),
      );
    });
  });
});

