/**
 * dicomIntegrationService.test.ts
 *
 * Testes para o contrato DICOM/Orthanc:
 * - formatDicomDate (YYYYMMDD -> Date)
 * - formatDicomName (LAST^FIRST^MIDDLE order)
 * - generateUID (válido)
 * - formatWorklistForOrthanc (estrutura correta)
 * - cancelOrder / syncOrderStatus (cascata)
 *
 * Os métodos `format*` são privados; testamos indiretamente via formatWorklistForOrthanc.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { dicomIntegrationService } from "@/services/dicomIntegrationService";
import type { DicomWorklistItem, ImagingOrderItem } from "@/types/dicom";

vi.mock("@/lib/supabase", () => {
  return { supabase: { from: vi.fn() } };
});

// Mock do dicomService (worklistQueueService etc)
vi.mock("@/services/dicomService", () => ({
  imagingOrderItemsService: {
    listByOrder: vi.fn(),
    updateStatus: vi.fn(),
  },
  worklistQueueService: {
    list: vi.fn(),
    markExported: vi.fn(),
    cancel: vi.fn(),
    createFromOrderItem: vi.fn(),
  },
}));

import { imagingOrderItemsService, worklistQueueService } from "@/services/dicomService";
import { supabase } from "@/lib/supabase";

const mockWorklistItem: DicomWorklistItem = {
  id: "wl1",
  imaging_order_item_id: "i1",
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

describe("dicomIntegrationService — cancelOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cancela todos os itens e marca order como cancelado", async () => {
    const mockItems: Partial<ImagingOrderItem>[] = [
      { id: "i1", status: "agendado" },
      { id: "i2", status: "liberado_worklist" },
    ];

    (imagingOrderItemsService.listByOrder as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(mockItems);
    (imagingOrderItemsService.updateStatus as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    // Mock supabase.from('dicom_worklist_queue')
    const wlChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockResolvedValue({ data: [{ id: "wl1" }] }),
    };
    // Mock supabase.from('imaging_orders')
    const orderChain = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    };

    (supabase.from as unknown as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(wlChain) // primeiro chamado: worklist
      .mockReturnValueOnce(orderChain); // segundo: orders

    (worklistQueueService.cancel as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await dicomIntegrationService.cancelOrder("o1");

    expect(imagingOrderItemsService.listByOrder).toHaveBeenCalledWith("o1");
    expect(imagingOrderItemsService.updateStatus).toHaveBeenCalledWith("i1", "cancelado");
    expect(imagingOrderItemsService.updateStatus).toHaveBeenCalledWith("i2", "cancelado");
    expect(orderChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "cancelado" }),
    );
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