/**
 * dicomIntegrationService.test.ts
 *
 * Testes para o contrato DICOM/Orthanc:
 * - formatDicomDate (YYYYMMDD -> Date)
 * - formatDicomName (LAST^FIRST^MIDDLE order)
 * - generateUID (válido)
 * - formatWorklistForOrthanc (estrutura correta)
 * - syncOrderStatus (propagação de estado)
 *
 * Os métodos `format*` são privados; testamos indiretamente via formatWorklistForOrthanc.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { dicomIntegrationService } from "@/services/dicomIntegrationService";
import type { DicomWorklistItem } from "@/types/dicom";

vi.mock("@/lib/supabase", () => {
  return { supabase: { from: vi.fn(), rpc: vi.fn() } };
});

// Mock do serviço de itens usado pela sincronização agregada.
vi.mock("@/services/dicomService", () => ({
  imagingOrderItemsService: {
    listByOrder: vi.fn(),
    updateStatus: vi.fn(),
  } as unknown as typeof import("@/services/dicomService").imagingOrderItemsService & {
    listByOrder: ReturnType<typeof vi.fn>;
  },
}));

import { imagingOrderItemsService } from "@/services/dicomService";
import { supabase } from "@/lib/supabase";

const mockWorklistItem: DicomWorklistItem = {
  id: "wl1",
  company_id: "company-1",
  unit_id: 1,
  appointment_id: 42,
  imaging_order_item_id: "i1",
  idempotency_key: "reception:42:attempt-1",
  patient_id: "p1",
  patient_name: "João Silva",
  patient_birth_date: "1985-03-10",
  patient_sex: "M",
  patient_identifier: "p1",
  accession_number: "ACC001",
  requested_procedure_description: "TC Tórax",
  requested_procedure_id: "rp1",
  scheduled_procedure_step_id: "sps1",
  modality_type: "CT",
  scheduled_station_aetitle: "CT_SALA1",
  scheduled_station_name: "Sala 1",
  scheduled_datetime: "2026-06-22T14:30:00Z",
  referring_physician_name: "Dr. House",
  status: "pending",
  exported_to_worklist: false,
  created_at: "2026-06-22T10:00:00Z",
  updated_at: "2026-06-22T10:00:00Z",
};

describe("dicomIntegrationService — formatWorklistForOrthanc", () => {
  it("formata nome do paciente em ordem DICOM (LAST^FIRST)", () => {
    const entry = dicomIntegrationService.formatWorklistForOrthanc(mockWorklistItem);
    // "João Silva" -> "SILVA^JOAO"
    expect(entry["0010,0010"]).toBe("SILVA^JOAO");
  });

  it("normaliza modality para DICOM (3 chars uppercase)", () => {
    const entry = dicomIntegrationService.formatWorklistForOrthanc(mockWorklistItem);
    expect(entry["0008,0060"]).toBe("CT");
  });

  it("formata data de nascimento para YYYYMMDD", () => {
    const entry = dicomIntegrationService.formatWorklistForOrthanc(mockWorklistItem);
    expect(entry["0010,0030"]).toBe("19850310");
  });

  it("formata sexo para 1 char uppercase (M/F/O)", () => {
    const entry = dicomIntegrationService.formatWorklistForOrthanc(mockWorklistItem);
    expect(entry["0010,0040"]).toBe("M");
  });

  it("formata data agendada para YYYYMMDD no SPS", () => {
    const entry = dicomIntegrationService.formatWorklistForOrthanc(mockWorklistItem);
    // 2026-06-22 -> "20260622"
    expect(entry["0040,0100"]["0040,0002"]).toBe("20260622");
  });

  it("formata hora agendada para HHMMSS no SPS", () => {
    const entry = dicomIntegrationService.formatWorklistForOrthanc(mockWorklistItem);
    // 14:30:00 -> "143000"
    expect(entry["0040,0100"]["0040,0003"]).toMatch(/^\d{6}$/);
  });

  it("inclui patient_id e accession_number", () => {
    const entry = dicomIntegrationService.formatWorklistForOrthanc(mockWorklistItem);
    expect(entry["0010,0020"]).toBe("p1");
    expect(entry["0008,0050"]).toBe("ACC001");
  });

  it("default sex = O quando ausente", () => {
    const itemSemSexo = { ...mockWorklistItem, patient_sex: undefined };
    const entry = dicomIntegrationService.formatWorklistForOrthanc(itemSemSexo);
    expect(entry["0010,0040"]).toBe("O");
  });

  it("aceita nome único sem inverter", () => {
    const itemNomeUnico = { ...mockWorklistItem, patient_name: "Cher" };
    const entry = dicomIntegrationService.formatWorklistForOrthanc(itemNomeUnico);
    // 1 parte: apenas uppercase
    expect(entry["0010,0010"]).toBe("CHER");
  });

  it("inverte múltiplos sobrenomes corretamente", () => {
    const item3 = { ...mockWorklistItem, patient_name: "Maria de Souza Santos" };
    const entry = dicomIntegrationService.formatWorklistForOrthanc(item3);
    // last = SANTOS, first = MARIA DE SOUZA
    expect(entry["0010,0010"]).toBe("SANTOS^MARIA DE SOUZA");
  });
});

describe("dicomIntegrationService — getOrthancConfigTemplate", () => {
  it("retorna config com AE Title customizado", () => {
    const cfg = dicomIntegrationService.getOrthancConfigTemplate("MEU_AET", 4242);
    expect(cfg.DicomAet).toBe("MEU_AET");
    expect(cfg.DicomPort).toBe(4242);
    expect(cfg.Worklists.Enable).toBe(true);
  });
});

describe("dicomIntegrationService — syncOrderStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("propaga status do item menos avançado quando todos estão ativos", async () => {
    (imagingOrderItemsService.listByOrder as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "i1", status: "recebido_pacs" },
      { id: "i2", status: "agendado" }, // menos avançado
      { id: "i3", status: "laudado" },
    ]);

    const updateChain = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    };
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(updateChain);

    await dicomIntegrationService.syncOrderStatus("o1");

    // order.status deve ser igual ao menos avançado: "agendado"
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "agendado" }),
    );
  });

  it("marca order como cancelado quando todos os itens estão cancelados", async () => {
    (imagingOrderItemsService.listByOrder as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "i1", status: "cancelado" },
      { id: "i2", status: "cancelado" },
    ]);

    const updateChain = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    };
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(updateChain);

    await dicomIntegrationService.syncOrderStatus("o1");

    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "cancelado" }),
    );
  });

  it("não faz nada se não houver itens", async () => {
    (imagingOrderItemsService.listByOrder as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const updateChain = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    };
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(updateChain);

    await dicomIntegrationService.syncOrderStatus("o1");
    expect(updateChain.update).not.toHaveBeenCalled();
  });
});

describe("dicomIntegrationService — integração com worklist e PACS", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ignora notificação sem accession number", async () => {
    await expect(
      dicomIntegrationService.handleStudyReceived({
        ID: "orthanc-1",
        Path: "/studies/orthanc-1",
        PatientID: "p1",
        StudyInstanceUID: "1.2.3",
      }),
    ).resolves.toBeNull();
    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("retorna nulo quando a RPC não encontra o accession no escopo ativo", async () => {
    (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null,
      error: null,
    });

    await expect(
      dicomIntegrationService.handleStudyReceived({
        ID: "orthanc-unknown",
        Path: "/studies/orthanc-unknown",
        PatientID: "p1",
        StudyInstanceUID: "1.2.840.999",
        AccessionNumber: "ACC-UNKNOWN",
      }),
    ).resolves.toBeNull();

    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("delega o recebimento inteiro a uma única RPC canônica", async () => {
    const study = { id: "study1", study_instance_uid: "1.2.840.1" };
    (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [study],
      error: null,
    });

    const result = await dicomIntegrationService.handleStudyReceived({
      ID: "orthanc-1",
      Path: "/studies/orthanc-1",
      PatientID: "p1",
      StudyInstanceUID: "1.2.840.1",
      AccessionNumber: "ACC001",
      StudyDate: "20260717",
      StudyTime: "101500",
      Modality: "CT",
      StationName: "CT_SALA1",
      ScheduledProcedureStepID: "SPS-001",
    });

    expect(result).toEqual(study);
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith("m24_receive_pacs_study_secure", {
      p_accession_number: "ACC001",
      p_study_instance_uid: "1.2.840.1",
      p_study_date: "2026-07-17",
      p_study_time: "101500",
      p_modality_type: "CT",
      p_station_aetitle: "CT_SALA1",
      p_scheduled_procedure_step_id: "SPS-001",
    });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(imagingOrderItemsService.updateStatus).not.toHaveBeenCalled();
  });

  it("propaga erro contextualizado da RPC sem tentar mutações diretas", async () => {
    (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null,
      error: { message: "study already linked" },
    });

    await expect(dicomIntegrationService.handleStudyReceived({
      ID: "orthanc-1",
      Path: "/studies/orthanc-1",
      PatientID: "p1",
      StudyInstanceUID: "1.2.840.1",
      AccessionNumber: "ACC001",
    })).rejects.toThrow("Erro ao receber estudo PACS: study already linked");

    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
