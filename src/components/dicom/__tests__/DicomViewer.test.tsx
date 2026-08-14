import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DicomExam, DicomExamImage } from "@/services/dicomService";

const { getImages } = vi.hoisted(() => ({ getImages: vi.fn() }));

vi.mock("@/services/dicomService", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/services/dicomService")>();
  return { ...original, examService: { ...original.examService, getImages } };
});

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import { DicomViewer } from "@/components/dicom/DicomViewer";

const exam: DicomExam = {
  id: 10,
  company_id: "company-a",
  nr_images: 1,
  ds_status: "RECEIVED",
  created_at: "2026-08-13T00:00:00Z",
  updated_at: "2026-08-13T00:00:00Z",
};

const image: DicomExamImage = {
  id: 20,
  cd_dicom_exam: exam.id,
  bl_dicom_url: "https://signed.example/image.dcm",
  created_at: "2026-08-13T00:00:00Z",
};

describe("DicomViewer lifecycle", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
  });

  afterEach(() => {
    delete window.cornerstone;
    delete window.cornerstoneTools;
    delete window.dicomParser;
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("habilita, exibe e desabilita o mesmo elemento Cornerstone", async () => {
    getImages.mockResolvedValue([image]);
    const enable = vi.fn();
    const disable = vi.fn();
    const displayImage = vi.fn();

    window.cornerstone = {
      enable,
      disable,
      loadAndCacheImage: vi.fn().mockResolvedValue(undefined),
      loadImage: vi.fn().mockResolvedValue({ imageId: "dicom-image" }),
      displayImage,
      getViewport: vi.fn().mockReturnValue({
        voi: { windowCenter: 40, windowWidth: 400 },
        scale: 1,
      }),
      setViewport: vi.fn(),
      elements: {
        getEnabledElement: vi.fn().mockReturnValue({
          element: document.createElement("canvas"),
        }),
      },
    };
    window.cornerstoneTools = { init: vi.fn(), setToolActive: vi.fn() };

    const { unmount } = render(<DicomViewer exam={exam} image={image} />);

    await waitFor(() => expect(displayImage).toHaveBeenCalledOnce());
    const enabledElement = enable.mock.calls[0][0];
    expect(displayImage.mock.calls[0][0]).toBe(enabledElement);

    unmount();

    expect(disable).toHaveBeenCalledOnce();
    expect(disable).toHaveBeenCalledWith(enabledElement);
  });
});
