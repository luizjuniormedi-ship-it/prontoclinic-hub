import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke },
    from: vi.fn(),
    storage: { from: vi.fn() },
  },
}));

import { equipmentService, examService } from "@/services/dicomService";

describe("DICOM bridge client", () => {
  beforeEach(() => invoke.mockReset());

  it("routes C-ECHO through the authenticated bridge", async () => {
    invoke.mockResolvedValue({
      data: {
        ok: true,
        result: { ok: true, latencyMs: 12, message: "Echo OK em 12ms" },
      },
      error: null,
    });

    await expect(equipmentService.testConnection(7)).resolves.toEqual({
      ok: true,
      latencyMs: 12,
      message: "Echo OK em 12ms",
    });
    expect(invoke).toHaveBeenCalledWith("dicom-bridge", {
      body: { action: "echo", equipmentId: 7 },
    });
  });

  it("routes C-STORE through the bridge and rejects invalid exams locally", async () => {
    invoke.mockResolvedValue({
      data: {
        ok: true,
        result: { orthancId: "orthanc-study", studyUid: "1.2.3" },
      },
      error: null,
    });

    await expect(examService.requestStudy(42)).resolves.toEqual({
      orthancId: "orthanc-study",
      studyUid: "1.2.3",
    });
    expect(invoke).toHaveBeenCalledWith("dicom-bridge", {
      body: { action: "store-study", examId: 42 },
    });

    invoke.mockClear();
    await expect(examService.requestStudy(0)).rejects.toThrow("Exame DICOM inválido");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("fails closed when the bridge is unavailable or malformed", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: { message: "network failure" },
    });
    await expect(examService.requestStudy(42)).rejects.toThrow(
      "Bridge DICOM indisponível",
    );

    invoke.mockResolvedValue({ data: { ok: false }, error: null });
    await expect(examService.requestStudy(42)).rejects.toThrow(
      "Bridge DICOM retornou uma resposta inválida",
    );
  });
});
